"""Federal Contractors Recurrence & Total Contracted Value Leaderboard.

Aggregates all awarded contracts in `nocopo_contracts` (`2001–2026`) by
normalized contractor entity (stripping leading `M/S`, `M/s`, `MESSRS`
honorifics and standardizing Ltd/Plc suffixes via `entity_normalizer.py`),
joins Treasury cash disbursements from `govspend_payments` (`2018–2026`), and
writes `public/datasets/contractors_leaderboard.json` atomically.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.procurement_risk_builder import is_sandbox_or_test_procurement
from ingestion.parsers.entity_normalizer import (
    clean_display_name as clean_entity_display_name,
    normalize_entity_name,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"

HONORIFIC_KEY_RE = re.compile(r"^(?:M\s+S|MS|MESSRS)\s+", re.IGNORECASE)
HONORIFIC_DISPLAY_RE = re.compile(r"^(?:M/S\.?|MESSRS\.?)\s+", re.IGNORECASE)


def canonical_contractor_key(raw_name: str) -> str:
    """Normalize contractor name and strip honorifics like M/S or MESSRS."""
    norm = normalize_entity_name(raw_name)
    stripped = HONORIFIC_KEY_RE.sub("", norm).strip()
    return stripped or norm


def clean_display_name(raw_name: str) -> str:
    """Clean display name by removing leading honorifics, mojibake, and trailing punctuation."""
    txt = HONORIFIC_DISPLAY_RE.sub("", (raw_name or "").strip())
    txt = clean_entity_display_name(txt)
    return txt.strip()


def shard_bucket_for_name(name: str) -> str:
    """Return '00'..'63' FNV-1a shard bucket for a contractor display name."""
    s = (name or "").strip()
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return f"{h % 64:02d}"


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def build_contractors_leaderboard(
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    write: bool = True,
) -> dict[str, Any]:
    """Build ranked contractor recurrence & value leaderboard JSON."""
    db_path = Path(fts_sqlite_path)
    ds_dir = Path(datasets_dir)
    out_path = ds_dir / "contractors_leaderboard.json"

    if not db_path.exists():
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_LEDGER_DB",
            "awardCoverageYears": "2001–2026",
            "treasuryCoverageRange": "2018-09-01 to 2026-06-19",
            "coverageNote": (
                "Federal Appropriation Act PDFs (1999–2026) do not list contractor names. "
                "Public contract awards cover 2001–2026 (densest 2017–2026) and Open Treasury disbursements cover 2018–2026."
            ),
            "totalDistinctContractors": 0,
            "repeatContractorsCount": 0,
            "totalAwardedContracts": 0,
            "totalContractedNaira": 0,
            "totalGovspendMatchedNaira": 0,
            "contractors": [],
        }
        if write:
            _atomic_write_json(out_path, payload)
        return payload

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        tables = {
            r["name"]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        if "nocopo_contracts" not in tables:
            payload = {
                "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "status": "AWAITING_NOCOPO_CONTRACTS",
                "awardCoverageYears": "2001–2026",
                "treasuryCoverageRange": "2018-09-01 to 2026-06-19",
                "coverageNote": (
                    "Federal Appropriation Act PDFs (1999–2026) do not list contractor names. "
                    "Public contract awards cover 2001–2026 (densest 2017–2026) and Open Treasury disbursements cover 2018–2026."
                ),
                "totalDistinctContractors": 0,
                "repeatContractorsCount": 0,
                "totalAwardedContracts": 0,
                "totalContractedNaira": 0,
                "totalGovspendMatchedNaira": 0,
                "contractors": [],
            }
            if write:
                _atomic_write_json(out_path, payload)
            return payload

        nocopo_rows = conn.execute(
            """
            SELECT ocid, stage, title, award_date, procurement_method, project_code, match_type,
                   contractor_name, norm_contractor, bpp_contractor_id,
                   contract_award_naira, total_paid_naira, financial_year, mda_name
            FROM nocopo_contracts
            WHERE LENGTH(norm_contractor) > 0 AND contract_award_naira > 0
            """
        ).fetchall()

        govspend_by_key: dict[str, tuple[int, int]] = {}
        gov_rows_raw: list[sqlite3.Row] = []
        if "govspend_payments" in tables:
            gov_rows = conn.execute(
                """
                SELECT norm_beneficiary, COUNT(*) AS cnt, COALESCE(SUM(amount_naira), 0) AS amt
                FROM govspend_payments
                WHERE amount_naira > 0 AND LENGTH(norm_beneficiary) > 0
                GROUP BY norm_beneficiary
                """
            ).fetchall()
            for gr in gov_rows:
                g_key = HONORIFIC_KEY_RE.sub("", str(gr["norm_beneficiary"])).strip()
                if not g_key:
                    continue
                prev_cnt, prev_amt = govspend_by_key.get(g_key, (0, 0))
                govspend_by_key[g_key] = (prev_cnt + int(gr["cnt"] or 0), prev_amt + int(gr["amt"] or 0))
            if write:
                gov_rows_raw = conn.execute(
                    """
                    SELECT payment_no, payment_date, financial_year, payer_code,
                           organization_name, beneficiary_name, norm_beneficiary, amount_naira, description
                    FROM govspend_payments
                    WHERE amount_naira > 0 AND LENGTH(norm_beneficiary) > 0
                    ORDER BY payment_date DESC, amount_naira DESC
                    """
                ).fetchall()
    finally:
        conn.close()

    agg: dict[str, dict[str, Any]] = {}
    total_contracts = 0
    total_contracted_naira = 0
    min_yr_seen = 9999
    max_yr_seen = 0

    for row in nocopo_rows:
        raw_name = str(row["contractor_name"] or "").strip()
        base_norm = str(row["norm_contractor"] or "").strip()
        key = HONORIFIC_KEY_RE.sub("", base_norm).strip() or canonical_contractor_key(raw_name)
        if not key:
            continue

        mda_raw = str(row["mda_name"] or "").strip()
        title_raw = str(row["title"] or "").strip()
        ocid_raw = str(row["ocid"] or "").strip()
        if is_sandbox_or_test_procurement(mda_raw, title_raw, ocid_raw):
            continue

        award_amt = int(row["contract_award_naira"] or 0)
        paid_amt = int(row["total_paid_naira"] or 0)
        fy = int(row["financial_year"] or 0)
        mda = clean_entity_display_name(mda_raw)
        bpp_id = str(row["bpp_contractor_id"] or "").strip()
        display = clean_display_name(raw_name) or key.title()

        entry = agg.get(key)
        if entry is None:
            entry = {
                "contractorKey": key,
                "contractorName": display,
                "bppContractorId": bpp_id or None,
                "contractCount": 0,
                "totalContractedNaira": 0,
                "nocopoDisbursedNaira": 0,
                "firstYear": fy if 1999 <= fy <= 2030 else None,
                "lastYear": fy if 1999 <= fy <= 2030 else None,
                "_mdas": Counter(),
                "_contracts": [],
            }
            agg[key] = entry
        elif len(display) > len(entry["contractorName"]) and display.upper() != display:
            entry["contractorName"] = display
        elif entry["contractorName"].upper() == entry["contractorName"] and display.upper() != display:
            entry["contractorName"] = display

        if not entry["bppContractorId"] and bpp_id:
            entry["bppContractorId"] = bpp_id

        entry["contractCount"] += 1
        entry["totalContractedNaira"] += award_amt
        entry["nocopoDisbursedNaira"] += paid_amt
        entry["_contracts"].append(
            {
                "ocdsReleaseId": str(row["ocid"] or ""),
                "financialYear": fy,
                "stage": str(row["stage"] or "award"),
                "budgetTitle": str(row["title"] or ""),
                "mdaName": mda,
                "contractAwardNaira": award_amt,
                "totalPaidNaira": paid_amt,
                "awardDate": str(row["award_date"] or "") or None,
                "procurementMethod": str(row["procurement_method"] or "") or None,
                "projectCode": str(row["project_code"] or ""),
            }
        )

        if 1999 <= fy <= 2030:
            min_yr_seen = min(min_yr_seen, fy)
            max_yr_seen = max(max_yr_seen, fy)
            if entry["firstYear"] is None or fy < entry["firstYear"]:
                entry["firstYear"] = fy
            if entry["lastYear"] is None or fy > entry["lastYear"]:
                entry["lastYear"] = fy

        if mda:
            entry["_mdas"][mda] += 1

        total_contracts += 1
        total_contracted_naira += award_amt

    contractors: list[dict[str, Any]] = []
    repeat_count = 0
    total_govspend_matched_naira = 0
    history_by_key: dict[str, dict[str, Any]] = {}

    gov_vouchers_by_key: dict[str, list[dict[str, Any]]] = {}
    if write and gov_rows_raw:
        for gr in gov_rows_raw:
            g_key = HONORIFIC_KEY_RE.sub("", str(gr["norm_beneficiary"] or "")).strip()
            if g_key not in agg:
                continue
            bucket_list = gov_vouchers_by_key.setdefault(g_key, [])
            if len(bucket_list) < 50:
                bucket_list.append(
                    {
                        "paymentNo": str(gr["payment_no"] or ""),
                        "paymentDate": str(gr["payment_date"] or ""),
                        "financialYear": int(gr["financial_year"] or 0),
                        "payerCode": str(gr["payer_code"] or ""),
                        "organizationName": str(gr["organization_name"] or ""),
                        "beneficiaryName": str(gr["beneficiary_name"] or ""),
                        "amountNaira": int(gr["amount_naira"] or 0),
                        "description": str(gr["description"] or ""),
                    }
                )

    for key, item in agg.items():
        mda_counter: Counter = item.pop("_mdas")
        item_contracts: list[dict[str, Any]] = item.pop("_contracts")
        item_contracts.sort(
            key=lambda c: (int(c.get("financialYear") or 0), int(c.get("contractAwardNaira") or 0)),
            reverse=True,
        )
        if write:
            history_by_key[key] = {
                "contractorName": item["contractorName"],
                "contracts": item_contracts,
                "payments": gov_vouchers_by_key.get(key, []),
            }
        if item["contractCount"] >= 2:
            repeat_count += 1

        gov_cnt, gov_amt = govspend_by_key.get(key, (0, 0))
        total_govspend_matched_naira += gov_amt

        rec: dict[str, Any] = {
            "contractorName": item["contractorName"],
            "contractCount": item["contractCount"],
            "totalContractedNaira": item["totalContractedNaira"],
            "firstYear": item["firstYear"],
            "lastYear": item["lastYear"],
            "mdaCount": len(mda_counter),
            "topMdas": [m for m, _ in mda_counter.most_common(2)],
        }
        if item["nocopoDisbursedNaira"] > 0:
            rec["nocopoDisbursedNaira"] = item["nocopoDisbursedNaira"]
        if gov_cnt > 0:
            rec["govspendPaymentCount"] = gov_cnt
            rec["govspendPaidNaira"] = gov_amt
        if item["bppContractorId"]:
            rec["bppContractorId"] = item["bppContractorId"]
        contractors.append(rec)

    contractors.sort(key=lambda r: (r["totalContractedNaira"], r["contractCount"]), reverse=True)

    award_years_label = (
        f"{min_yr_seen}–{max_yr_seen}" if min_yr_seen <= max_yr_seen else "2001–2026"
    )

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_CONTRACTORS_LEADERBOARD",
        "awardCoverageYears": award_years_label,
        "treasuryCoverageRange": "2018-09-01 to 2026-06-19",
        "coverageNote": (
            f"Federal Appropriation Act PDFs (1999–2026) do not list contractor names. "
            f"Public contract awards cover {award_years_label} (densest 2017–2026) and Open Treasury disbursements cover 2018–2026."
        ),
        "totalDistinctContractors": len(contractors),
        "repeatContractorsCount": repeat_count,
        "totalAwardedContracts": total_contracts,
        "totalContractedNaira": total_contracted_naira,
        "totalGovspendMatchedNaira": total_govspend_matched_naira,
        "contractors": contractors,
    }

    if write:
        _atomic_write_json(out_path, payload)
        shards: dict[str, dict[str, Any]] = {}
        for rec in history_by_key.values():
            b = shard_bucket_for_name(rec["contractorName"])
            shards.setdefault(b, {})[rec["contractorName"]] = {
                "contracts": rec["contracts"],
                "payments": rec["payments"],
            }
        shards_dir = ds_dir / "contractor_history"
        if shards_dir.exists():
            for old_shard in shards_dir.glob("*.json"):
                old_shard.unlink()
        for bucket, shard_map in shards.items():
            _atomic_write_json(shards_dir / f"{bucket}.json", shard_map)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build contractors recurrence & value leaderboard JSON.")
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    args = parser.parse_args()

    res = build_contractors_leaderboard(
        fts_sqlite_path=args.sqlite,
        datasets_dir=args.datasets_dir,
        write=True,
    )
    print(
        f"Contractors Leaderboard [{res['status']}]: contractors={res['totalDistinctContractors']} | "
        f"repeat={res['repeatContractorsCount']} | contracts={res['totalAwardedContracts']} | "
        f"contracted=NGN {res['totalContractedNaira'] / 1e12:.2f}T"
    )


if __name__ == "__main__":
    main()
