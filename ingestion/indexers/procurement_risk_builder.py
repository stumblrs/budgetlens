"""Non-Competitive Procurement Risk & Variation Overrun Monitor Builder (Phase 3 · Stage P3-S3).

Analyzes all awarded NOCOPO contracts (`stage IN ('award', 'contract', 'implementation')`)
in `backend/data/external_ledger_fts.sqlite` while strictly excluding `planning`/`tender`
rows from awarded totals, overrun ratios, and zero-paid calculations.

Writes compact static `public/datasets/procurement_risk_index.json` (< 2 MB).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.follow_the_money_builder import (
    AWARDED_STAGES,
    _atomic_write_json,
)
from ingestion.indexers.project_lifecycle_builder import canonical_contractor_key
from ingestion.parsers.entity_normalizer import clean_display_name

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_LEADERBOARD_PATH = DEFAULT_DATASETS_DIR / "contractors_leaderboard.json"

_OPEN_METHODS = frozenset(
    {
        "national competitive bidding",
        "international competitive bidding",
        "open",
        "open competitive",
        "open competitive bidding",
    }
)
_NON_COMP_KEYWORDS = (
    "selective",
    "emergency",
    "direct procurement",
    "repeat procurement",
    "sole source",
    "direct labour",
    "single source",
    "restricted",
)
_MINOR_QUOTATION_KEYWORDS = ("request for quotation", "national shopping", "shopping")
_SANDBOX_MDA_RE = re.compile(
    r"\b(?:TEST\s+MINISTRY|TEST\s+MDA|DEMO\s+MINISTRY|SANDBOX|DUMMY\s+MINISTRY|TEST\s*-\s*NOCOPO|NOCOPO\s+TEST)\b",
    flags=re.IGNORECASE,
)
_EXACT_PLACEHOLDER_LABELS = frozenset(
    {
        "test",
        "testing",
        "sample",
        "dummy",
        "demo",
        "test project",
        "test contract",
        "asdf",
        "qwerty",
    }
)
_TEST_TITLE_NUM_RE = re.compile(r"^test\s*\d+$", flags=re.IGNORECASE)
_SANDBOX_OCID_RE = re.compile(
    r"(?:^|[-_])(?:test|sandbox|dummy)(?:$|[-_\d])",
    flags=re.IGNORECASE,
)


def is_sandbox_or_test_procurement(
    mda_name: str | None,
    title: str | None = None,
    ocid: str | None = None,
) -> bool:
    """Detect portal sandbox/test agencies, placeholder titles, or test OCIDs."""
    mda_s = str(mda_name or "").strip()
    if mda_s:
        if _SANDBOX_MDA_RE.search(mda_s) or mda_s.lower() in _EXACT_PLACEHOLDER_LABELS:
            return True

    title_s = " ".join(str(title or "").strip().lower().split())
    if title_s and (
        title_s in _EXACT_PLACEHOLDER_LABELS or bool(_TEST_TITLE_NUM_RE.fullmatch(title_s))
    ):
        return True

    ocid_s = str(ocid or "").strip().lower()
    if ocid_s and _SANDBOX_OCID_RE.search(ocid_s):
        return True

    return False


def classify_overrun_anomaly(award_naira: int, paid_naira: int) -> tuple[str, str] | None:
    """Classify deterministic decimal/kobo-shift NOCOPO entry typos vs genuine overruns."""
    if award_naira <= 0 or paid_naira <= award_naira:
        return None
    ratio = paid_naira / award_naira
    if abs(ratio - 100.0) <= 0.5:
        return (
            "KOBO_SHIFT_100X",
            "Recorded payment is ~100x award (likely kobo entered as Naira on NOCOPO)",
        )
    if abs(ratio - 1000.0) <= 5.0:
        return (
            "DECIMAL_SHIFT_1000X",
            "Recorded payment is ~1,000x award (likely missing '000' decimal shift on NOCOPO)",
        )
    if abs(ratio - 10000.0) <= 50.0:
        return (
            "DECIMAL_SHIFT_10000X",
            "Recorded payment is ~10,000x award (4-order decimal entry typo on NOCOPO)",
        )
    if award_naira < 1_000 and paid_naira >= 1_000_000:
        return (
            "UNIT_SCALE_MISMATCH",
            "Award entered below ₦1,000 against ≥₦1M payment (likely millions typed without zeroes)",
        )
    return None


def classify_procurement_method(method: str | None) -> str:
    """Classify an OCDS procurement_method string into a deterministic risk category."""
    low = str(method or "").strip().lower()
    if not low:
        return "UNSPECIFIED"
    if low in _OPEN_METHODS:
        return "COMPETITIVE_OPEN"
    if any(kw in low for kw in _NON_COMP_KEYWORDS):
        return "NON_COMPETITIVE"
    if any(kw in low for kw in _MINOR_QUOTATION_KEYWORDS):
        return "MINOR_QUOTATION"
    return "UNSPECIFIED"


def _load_leaderboard_lookup(lb_path: Path) -> dict[str, dict[str, Any]]:
    if not lb_path.exists():
        return {}
    try:
        data = json.loads(lb_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for entry in data.get("contractors") or []:
        key = canonical_contractor_key(entry.get("contractorName"))
        if key and key not in out:
            out[key] = entry
    return out


def build_procurement_risk_index(
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    leaderboard_path: str | Path = DEFAULT_LEADERBOARD_PATH,
    write: bool = True,
) -> dict[str, Any]:
    """Build static `procurement_risk_index.json` from awarded NOCOPO contracts."""
    db_file = Path(fts_sqlite_path)
    ds_dir = Path(datasets_dir)
    lb_map = _load_leaderboard_lookup(Path(leaderboard_path))

    if not db_file.exists():
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_LEDGER_DB",
            "headline": {
                "totalAwardedRows": 0,
                "pricedAwardedCount": 0,
                "totalAwardedNaira": 0,
                "totalPaidNaira": 0,
                "planningExcludedCount": 0,
                "nonCompetitiveCount": 0,
                "nonCompetitiveAwardedNaira": 0,
                "nonCompetitivePaidNaira": 0,
                "nonCompetitiveValueSharePct": 0.0,
                "overrunCount": 0,
                "overrunAwardedNaira": 0,
                "overrunPaidNaira": 0,
                "overrunDeltaNaira": 0,
                "zeroPaidCount": 0,
                "zeroPaidAwardedNaira": 0,
                "excludedTestRecordsCount": 0,
                "excludedTestAwardedNaira": 0,
                "excludedTestPaidNaira": 0,
                "koboShiftAnomalyCount": 0,
                "koboShiftAnomalyDeltaNaira": 0,
                "totalQuarantinedAnomaliesCount": 0,
            },
            "methodBreakdown": [],
            "yearlyRiskTrend": [],
            "mdaRiskRanking": [],
            "topOverrunContracts": [],
            "topZeroPaidAwards": [],
            "topNonCompetitiveAwards": [],
            "portalDataEntryAnomalies": [],
        }
        if write:
            _atomic_write_json(ds_dir / "procurement_risk_index.json", payload)
        return payload

    conn = sqlite3.connect(str(db_file))
    try:
        has_noc = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
        ).fetchone()
        if not has_noc:
            rows = []
            planning_excluded_count = 0
        else:
            planning_excluded_count = conn.execute(
                "SELECT COUNT(*) FROM nocopo_contracts WHERE LOWER(COALESCE(stage,'')) NOT IN ('award','contract','implementation')"
            ).fetchone()[0]
            rows = conn.execute(
                """
                SELECT ocid, financial_year, stage, title, mda_name, contractor_name,
                       norm_contractor, bpp_contractor_id, contract_award_naira,
                       total_paid_naira, award_date, procurement_method, project_code
                FROM nocopo_contracts
                WHERE LOWER(COALESCE(stage, '')) IN ('award', 'contract', 'implementation')
                """
            ).fetchall()
    finally:
        conn.close()

    total_awarded_rows = 0
    priced_awarded_count = 0
    total_awarded_naira = 0
    total_paid_naira = 0
    non_comp_count = 0
    non_comp_awarded_naira = 0
    non_comp_paid_naira = 0
    overrun_count = 0
    overrun_awarded_naira = 0
    overrun_paid_naira = 0
    overrun_delta_naira = 0
    zero_paid_count = 0
    zero_paid_awarded_naira = 0
    excluded_test_records_count = 0
    excluded_test_awarded_naira = 0
    excluded_test_paid_naira = 0
    kobo_shift_anomaly_count = 0
    kobo_shift_anomaly_delta_naira = 0

    method_acc: dict[str, dict[str, Any]] = {}
    year_acc: dict[int, dict[str, Any]] = {}
    mda_acc: dict[str, dict[str, Any]] = {}

    overrun_candidates: list[dict[str, Any]] = []
    zero_paid_candidates: list[dict[str, Any]] = []
    non_comp_candidates: list[dict[str, Any]] = []
    portal_anomalies: list[dict[str, Any]] = []

    for row in rows:
        (
            ocid,
            fy_raw,
            stage_raw,
            title_raw,
            mda_raw,
            contractor_raw,
            norm_contractor_raw,
            bpp_id,
            award_raw,
            paid_raw,
            award_date_raw,
            method_raw,
            proj_code_raw,
        ) = row

        stage = str(stage_raw or "").strip().lower()
        if stage not in AWARDED_STAGES:
            continue

        award_amt = max(0, int(round(float(award_raw or 0))))
        paid_amt = max(0, int(round(float(paid_raw or 0))))
        fy = int(fy_raw) if fy_raw is not None and str(fy_raw).isdigit() else 0
        mda_name = clean_display_name(mda_raw) or "Unspecified Federal MDA"
        method_label = str(method_raw or "").strip() or "Unspecified"

        cname = str(contractor_raw or "").strip()
        ckey = canonical_contractor_key(norm_contractor_raw or cname)
        lb = lb_map.get(ckey)
        resolved_cname = (str(lb.get("contractorName") or "").strip() if lb else "") or cname or None

        base_contract_obj: dict[str, Any] = {
            "ocid": str(ocid or ""),
            "financialYear": fy,
            "stage": stage,
            "title": str(title_raw or "")[:180],
            "mdaName": mda_name,
            "contractorName": resolved_cname,
            "bppContractorId": bpp_id or (lb.get("bppContractorId") if lb else None),
            "procurementMethod": method_label,
            "awardNaira": award_amt,
            "paidNaira": paid_amt,
            "awardDate": str(award_date_raw or "").strip() or None,
            "projectCode": str(proj_code_raw or "").strip() or None,
        }

        if is_sandbox_or_test_procurement(mda_raw, title_raw, ocid):
            excluded_test_records_count += 1
            excluded_test_awarded_naira += award_amt
            excluded_test_paid_naira += paid_amt
            portal_anomalies.append(
                {
                    **base_contract_obj,
                    "overrunDeltaNaira": max(0, paid_amt - award_amt),
                    "paidToAwardRatio": round(paid_amt / award_amt, 2) if award_amt > 0 else None,
                    "anomalyType": "PORTAL_TEST_RECORD",
                    "anomalyReason": "NOCOPO portal sandbox/test entry excluded from public rankings",
                }
            )
            continue

        anom = classify_overrun_anomaly(award_amt, paid_amt)
        effective_paid_amt = award_amt if anom is not None else paid_amt
        if anom is not None:
            kobo_shift_anomaly_count += 1
            kobo_shift_anomaly_delta_naira += paid_amt - award_amt
            portal_anomalies.append(
                {
                    **base_contract_obj,
                    "overrunDeltaNaira": paid_amt - award_amt,
                    "paidToAwardRatio": round(paid_amt / award_amt, 2) if award_amt > 0 else None,
                    "anomalyType": anom[0],
                    "anomalyReason": anom[1],
                }
            )

        total_awarded_rows += 1
        if award_amt > 0:
            priced_awarded_count += 1
        total_awarded_naira += award_amt
        total_paid_naira += effective_paid_amt

        method_cat = classify_procurement_method(method_raw)
        is_non_comp = method_cat == "NON_COMPETITIVE"
        is_overrun = (anom is None) and (award_amt > 0 and paid_amt > award_amt)
        overrun_delta = (paid_amt - award_amt) if is_overrun else 0
        is_zero_paid = award_amt > 0 and paid_amt == 0

        if is_non_comp:
            non_comp_count += 1
            non_comp_awarded_naira += award_amt
            non_comp_paid_naira += effective_paid_amt

        if is_overrun:
            overrun_count += 1
            overrun_awarded_naira += award_amt
            overrun_paid_naira += paid_amt
            overrun_delta_naira += overrun_delta

        if is_zero_paid:
            zero_paid_count += 1
            zero_paid_awarded_naira += award_amt

        # Method breakdown
        ma = method_acc.get(method_label)
        if ma is None:
            ma = {
                "method": method_label,
                "category": method_cat,
                "contractCount": 0,
                "awardedNaira": 0,
                "paidNaira": 0,
                "overrunCount": 0,
                "zeroPaidCount": 0,
            }
            method_acc[method_label] = ma
        ma["contractCount"] += 1
        ma["awardedNaira"] += award_amt
        ma["paidNaira"] += effective_paid_amt
        if is_overrun:
            ma["overrunCount"] += 1
        if is_zero_paid:
            ma["zeroPaidCount"] += 1

        # Yearly trend
        if 2000 <= fy <= 2030:
            ya = year_acc.get(fy)
            if ya is None:
                ya = {
                    "financialYear": fy,
                    "totalCount": 0,
                    "awardedNaira": 0,
                    "paidNaira": 0,
                    "nonCompetitiveCount": 0,
                    "nonCompetitiveAwardedNaira": 0,
                    "overrunCount": 0,
                    "overrunDeltaNaira": 0,
                    "zeroPaidCount": 0,
                    "zeroPaidAwardedNaira": 0,
                }
                year_acc[fy] = ya
            ya["totalCount"] += 1
            ya["awardedNaira"] += award_amt
            ya["paidNaira"] += effective_paid_amt
            if is_non_comp:
                ya["nonCompetitiveCount"] += 1
                ya["nonCompetitiveAwardedNaira"] += award_amt
            if is_overrun:
                ya["overrunCount"] += 1
                ya["overrunDeltaNaira"] += overrun_delta
            if is_zero_paid:
                ya["zeroPaidCount"] += 1
                ya["zeroPaidAwardedNaira"] += award_amt

        # MDA risk aggregation
        mda_entry = mda_acc.get(mda_name)
        if mda_entry is None:
            mda_entry = {
                "mdaName": mda_name,
                "awardCount": 0,
                "totalAwardedNaira": 0,
                "totalPaidNaira": 0,
                "nonCompetitiveCount": 0,
                "nonCompetitiveAwardedNaira": 0,
                "emergencyCount": 0,
                "emergencyAwardedNaira": 0,
                "directCount": 0,
                "directAwardedNaira": 0,
                "selectiveCount": 0,
                "selectiveAwardedNaira": 0,
                "overrunCount": 0,
                "overrunDeltaNaira": 0,
                "zeroPaidCount": 0,
                "zeroPaidAwardedNaira": 0,
            }
            mda_acc[mda_name] = mda_entry
        mda_entry["awardCount"] += 1
        mda_entry["totalAwardedNaira"] += award_amt
        mda_entry["totalPaidNaira"] += effective_paid_amt
        if is_non_comp:
            mda_entry["nonCompetitiveCount"] += 1
            mda_entry["nonCompetitiveAwardedNaira"] += award_amt
            m_low = method_label.lower()
            if "emergency" in m_low:
                mda_entry["emergencyCount"] += 1
                mda_entry["emergencyAwardedNaira"] += award_amt
            elif "direct" in m_low or "sole" in m_low or "single" in m_low:
                mda_entry["directCount"] += 1
                mda_entry["directAwardedNaira"] += award_amt
            elif "selective" in m_low:
                mda_entry["selectiveCount"] += 1
                mda_entry["selectiveAwardedNaira"] += award_amt
        if is_overrun:
            mda_entry["overrunCount"] += 1
            mda_entry["overrunDeltaNaira"] += overrun_delta
        if is_zero_paid:
            mda_entry["zeroPaidCount"] += 1
            mda_entry["zeroPaidAwardedNaira"] += award_amt

        if is_overrun or is_zero_paid or is_non_comp:
            contract_obj: dict[str, Any] = {
                **base_contract_obj,
                "paidNaira": effective_paid_amt,
            }
            if lb:
                contract_obj["leaderboardContractCount"] = lb.get("contractCount")
                contract_obj["leaderboardTotalContractedNaira"] = lb.get("totalContractedNaira")
                contract_obj["leaderboardFirstYear"] = lb.get("firstYear")
                contract_obj["leaderboardLastYear"] = lb.get("lastYear")
                contract_obj["leaderboardMdaCount"] = lb.get("mdaCount")
                contract_obj["leaderboardTopMdas"] = lb.get("topMdas") or []
                contract_obj["leaderboardGovspendCount"] = lb.get("govspendPaymentCount") or 0
                contract_obj["leaderboardGovspendPaidNaira"] = lb.get("govspendPaidNaira") or 0

            if is_overrun:
                ov_item = dict(contract_obj)
                ov_item["overrunDeltaNaira"] = overrun_delta
                ov_item["overrunPct"] = round((overrun_delta / award_amt) * 100.0, 2)
                overrun_candidates.append(ov_item)
            if is_zero_paid:
                zero_paid_candidates.append(contract_obj)
            if is_non_comp and award_amt > 0:
                non_comp_candidates.append(contract_obj)

    method_breakdown = sorted(method_acc.values(), key=lambda x: (-x["awardedNaira"], -x["contractCount"]))
    for mb in method_breakdown:
        mb["sharePct"] = round((mb["awardedNaira"] / total_awarded_naira) * 100.0, 2) if total_awarded_naira > 0 else 0.0

    yearly_trend = []
    for fy in sorted(year_acc.keys()):
        ya = year_acc[fy]
        ya["nonCompetitiveSharePct"] = (
            round((ya["nonCompetitiveAwardedNaira"] / ya["awardedNaira"]) * 100.0, 2)
            if ya["awardedNaira"] > 0
            else 0.0
        )
        yearly_trend.append(ya)

    mda_list: list[dict[str, Any]] = []
    for m in mda_acc.values():
        aw = m["totalAwardedNaira"]
        nc_share = round((m["nonCompetitiveAwardedNaira"] / aw) * 100.0, 2) if aw > 0 else 0.0
        zp_share = round((m["zeroPaidAwardedNaira"] / aw) * 100.0, 2) if aw > 0 else 0.0
        ov_ratio = min(100.0, (m["overrunDeltaNaira"] / aw) * 100.0) if aw > 0 else 0.0
        risk_score = round(min(100.0, 0.45 * nc_share + 0.30 * ov_ratio + 0.25 * zp_share), 1)
        m["nonCompetitiveSharePct"] = nc_share
        m["zeroPaidSharePct"] = zp_share
        m["riskScore"] = risk_score
        mda_list.append(m)

    mda_list.sort(
        key=lambda m: (
            -(m["nonCompetitiveAwardedNaira"] + m["overrunDeltaNaira"]),
            -m["totalAwardedNaira"],
            m["mdaName"],
        )
    )

    overrun_candidates.sort(key=lambda x: (-x["overrunDeltaNaira"], -x["paidNaira"]))
    zero_paid_candidates.sort(key=lambda x: (-x["awardNaira"], -x["financialYear"]))
    non_comp_candidates.sort(key=lambda x: (-x["awardNaira"], -x["financialYear"]))
    portal_anomalies.sort(
        key=lambda x: (-x["overrunDeltaNaira"], -x["paidNaira"], -x["awardNaira"])
    )

    nc_share_pct = (
        round((non_comp_awarded_naira / total_awarded_naira) * 100.0, 2)
        if total_awarded_naira > 0
        else 0.0
    )

    payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_PROCUREMENT_RISK",
        "headline": {
            "totalAwardedRows": total_awarded_rows,
            "pricedAwardedCount": priced_awarded_count,
            "totalAwardedNaira": total_awarded_naira,
            "totalPaidNaira": total_paid_naira,
            "planningExcludedCount": planning_excluded_count,
            "nonCompetitiveCount": non_comp_count,
            "nonCompetitiveAwardedNaira": non_comp_awarded_naira,
            "nonCompetitivePaidNaira": non_comp_paid_naira,
            "nonCompetitiveValueSharePct": nc_share_pct,
            "overrunCount": overrun_count,
            "overrunAwardedNaira": overrun_awarded_naira,
            "overrunPaidNaira": overrun_paid_naira,
            "overrunDeltaNaira": overrun_delta_naira,
            "zeroPaidCount": zero_paid_count,
            "zeroPaidAwardedNaira": zero_paid_awarded_naira,
            "excludedTestRecordsCount": excluded_test_records_count,
            "excludedTestAwardedNaira": excluded_test_awarded_naira,
            "excludedTestPaidNaira": excluded_test_paid_naira,
            "koboShiftAnomalyCount": kobo_shift_anomaly_count,
            "koboShiftAnomalyDeltaNaira": kobo_shift_anomaly_delta_naira,
            "totalQuarantinedAnomaliesCount": excluded_test_records_count + kobo_shift_anomaly_count,
        },
        "methodBreakdown": method_breakdown,
        "yearlyRiskTrend": yearly_trend,
        "mdaRiskRanking": mda_list[:40],
        "topOverrunContracts": overrun_candidates[:100],
        "topZeroPaidAwards": zero_paid_candidates[:100],
        "topNonCompetitiveAwards": non_comp_candidates[:100],
        "portalDataEntryAnomalies": portal_anomalies[:100],
    }

    if write:
        _atomic_write_json(ds_dir / "procurement_risk_index.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build Non-Competitive Procurement Risk & Overrun Monitor (P3-S3)."
    )
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    parser.add_argument("--leaderboard", type=Path, default=DEFAULT_LEADERBOARD_PATH)
    args = parser.parse_args()

    res = build_procurement_risk_index(
        fts_sqlite_path=args.sqlite,
        datasets_dir=args.datasets_dir,
        leaderboard_path=args.leaderboard,
        write=True,
    )
    out_path = args.datasets_dir / "procurement_risk_index.json"
    size_kb = out_path.stat().st_size / 1024.0 if out_path.exists() else 0.0
    h = res["headline"]
    print(
        f"Procurement Risk [{res['status']}]: awarded={h['totalAwardedRows']} (NGN {h['totalAwardedNaira']/1e12:.2f}T) "
        f"| planningExcluded={h['planningExcludedCount']} | nonComp={h['nonCompetitiveCount']} "
        f"(NGN {h['nonCompetitiveAwardedNaira']/1e12:.2f}T, {h['nonCompetitiveValueSharePct']}%) "
        f"| overruns={h['overrunCount']} (+NGN {h['overrunDeltaNaira']/1e9:.2f}B) "
        f"| zeroPaid={h['zeroPaidCount']} (NGN {h['zeroPaidAwardedNaira']/1e12:.2f}T) "
        f"| excludedTest={h['excludedTestRecordsCount']} | koboAnomalies={h['koboShiftAnomalyCount']} "
        f"| file={size_kb:.1f} KB"
    )


if __name__ == "__main__":
    main()
