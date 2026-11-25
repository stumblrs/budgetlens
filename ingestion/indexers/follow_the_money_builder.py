"""Padded-to-Paid & Zombie Projects Follow-the-Money Cross-Link Builder (Phase 3 · Stage P3-S1).

Joins Bill-vs-Act legislative diff items (`public/datasets/bill_act_diffs/*.json`) and
multi-year recurring lineages (`public/datasets/recurring_lineages.json`) against
deduplicated NOCOPO procurement contracts (`nocopo_contracts`) and Open Treasury GovSpend
payments (`govspend_payments`) inside `backend/data/external_ledger_fts.sqlite`.

Writes compact, static-first `public/datasets/follow_the_money_links.json` (< 2.5 MB)
so frontend explorers operate 100% offline with zero live-backend dependency.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.parsers.entity_normalizer import (
    extract_ergp_codes,
    mda_core_key,
    normalize_entity_name,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_DIFFS_DIR = DEFAULT_DATASETS_DIR / "bill_act_diffs"
DEFAULT_LINEAGES_PATH = DEFAULT_DATASETS_DIR / "recurring_lineages.json"
DEFAULT_LEADERBOARD_PATH = DEFAULT_DATASETS_DIR / "contractors_leaderboard.json"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"

AWARDED_STAGES = frozenset({"award", "contract", "implementation"})
PLANNING_STAGES = frozenset({"planning", "tender"})

# Strict project-code guard: only unique alphanumeric ERGP/MDA project identifiers (never bare numeric IPSAS codes)
UNIQUE_PROJECT_CODE_RE = re.compile(r"^(?:ERGP\d{5,12}|[A-Z]{3,8}\d{5,12})$")

_NON_COMPETITIVE_KEYWORDS = (
    "direct",
    "selective",
    "emergency",
    "repeat",
    "single",
    "restricted",
)

_BOILERPLATE_SUBSTRINGS = (
    "SERVICE WIDE VOTE",
    "CONSOLIDATED SALARY",
    "OVERHEAD COST",
    "LOCAL TRAVEL",
    "ELECTRICITY CHARGES",
    "TELEPHONE CHARGES",
    "MAINTENANCE OF MOTOR VEHICLE",
    "PURCHASE OF OFFICE FURNITURE",
    "INTEREST - INTERNAL PUBLIC DEBT",
    "STATUTORY TRANSFER",
    "PERSONNEL COST",
    "SOCIAL CONTRIBUTION",
)

_BOILERPLATE_EXACT_TITLES = frozenset(
    {
        "SALARY",
        "SALARIES",
        "SALARIES AND WAGES",
        "OVERHEAD",
        "FUEL",
        "PENSION",
        "GRATUITY",
        "CLEANING",
        "STATIONERY",
        "ALLOWANCES",
        "TELEPHONE CHARGES",
    }
)

_BOILERPLATE_TOKENS = frozenset(
    {
        "CONSTRUCTION",
        "REHABILITATION",
        "PROCUREMENT",
        "SUPPLY",
        "PROVISION",
        "PURCHASE",
        "COMPLETION",
        "ONGOING",
        "INSTALLATION",
        "FEDERAL",
        "MINISTRY",
        "NIGERIA",
        "NIGERIAN",
        "PROJECT",
        "PROJECTS",
        "PHASE",
        "STATE",
        "LOCAL",
        "GOVERNMENT",
        "WORKS",
        "SERVICES",
        "EQUIPMENT",
        "MATERIALS",
        "GENERAL",
        "NATIONAL",
        "DEVELOPMENT",
        "MANAGEMENT",
        "PROGRAMME",
        "PROGRAM",
        "AGENCY",
        "DEPARTMENT",
        "OFFICE",
        "HQTRS",
        "VARIOUS",
        "SELECTED",
        "CONSTITUENCY",
        "SENATORIAL",
        "DISTRICT",
        "AREAS",
        "ACROSS",
        "BUILDING",
        "BUILDINGS",
        "CENTER",
        "CENTRE",
        "CENTRES",
        "CENTERS",
        "MAINTENANCE",
        "REPAIRS",
        "FURNISHING",
        "EQUIPPING",
        "TRAINING",
        "EMPOWERMENT",
        "CAPACITY",
        "SUPPORT",
    }
)

_TOKEN_RE = re.compile(r"[A-Z0-9]{4,}")


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


def is_unique_project_code(raw_code: str | None) -> str:
    """Return canonical uppercase unique project code (e.g., `ERGP22101448`, `MOBAN09501181`), else `""`."""
    raw = str(raw_code or "").strip().upper()
    if not raw:
        return ""
    ergps = extract_ergp_codes(raw)
    if ergps:
        return ergps[0]
    compact = re.sub(r"[\s-]+", "", raw)
    if UNIQUE_PROJECT_CODE_RE.fullmatch(compact):
        return compact
    return ""


def _is_boilerplate_title(title: str) -> bool:
    up = re.sub(r"\s+", " ", str(title or "").upper()).strip()
    if not up:
        return True
    if up in _BOILERPLATE_EXACT_TITLES:
        return True
    return any(sub in up for sub in _BOILERPLATE_SUBSTRINGS)


def _distinctive_tokens(title: str) -> frozenset[str]:
    if _is_boilerplate_title(title):
        return frozenset()
    tokens = {
        tok
        for tok in _TOKEN_RE.findall(str(title or "").upper())
        if tok not in _BOILERPLATE_TOKENS and not tok.isdigit()
    }
    return frozenset(tokens)


def _is_non_competitive(method: str | None) -> bool:
    low = str(method or "").strip().lower()
    if not low:
        return False
    return any(kw in low for kw in _NON_COMPETITIVE_KEYWORDS)


def _load_leaderboard_map(leaderboard_path: Path) -> dict[str, dict[str, Any]]:
    if not leaderboard_path.exists():
        return {}
    try:
        data = json.loads(leaderboard_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for entry in data.get("contractors", []):
        name = str(entry.get("contractorName") or "").strip()
        norm = normalize_entity_name(name)
        if norm and norm not in out:
            out[norm] = entry
    return out


def _load_govspend_aggregates(
    conn: sqlite3.Connection,
) -> tuple[dict[str, tuple[int, int]], dict[tuple[str, str], tuple[int, int]]]:
    by_beneficiary: dict[str, list[int]] = {}
    by_mda_beneficiary: dict[tuple[str, str], list[int]] = {}

    has_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
    ).fetchone()
    if not has_table:
        return {}, {}

    for norm_ben, org_name, norm_mda, amt in conn.execute(
        """
        SELECT norm_beneficiary, organization_name, norm_mda, COALESCE(amount_naira, 0)
        FROM govspend_payments
        WHERE norm_beneficiary IS NOT NULL AND norm_beneficiary != '' AND COALESCE(amount_naira, 0) > 0
        """
    ):
        amt_i = int(round(float(amt)))
        ben_key = str(norm_ben).strip()
        if not ben_key:
            continue

        tot = by_beneficiary.get(ben_key)
        if tot is None:
            by_beneficiary[ben_key] = [1, amt_i]
        else:
            tot[0] += 1
            tot[1] += amt_i

        core = mda_core_key(org_name or norm_mda or "")
        if core:
            pair_key = (core, ben_key)
            ptot = by_mda_beneficiary.get(pair_key)
            if ptot is None:
                by_mda_beneficiary[pair_key] = [1, amt_i]
            else:
                ptot[0] += 1
                ptot[1] += amt_i

    return (
        {k: (v[0], v[1]) for k, v in by_beneficiary.items()},
        {k: (v[0], v[1]) for k, v in by_mda_beneficiary.items()},
    )


def _aggregate_matched_contracts(
    rows: list[dict[str, Any]],
    target_mda_core: str,
    gov_by_ben: dict[str, tuple[int, int]],
    gov_by_mda_ben: dict[tuple[str, str], tuple[int, int]],
    leaderboard_map: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate deduplicated OCID matches strictly separating planning vs. awarded stages."""
    seen_ocids: set[str] = set()
    awarded_rows: list[dict[str, Any]] = []
    planning_count = 0

    for r in rows:
        ocid = str(r.get("ocid") or "")
        if ocid and ocid in seen_ocids:
            continue
        if ocid:
            seen_ocids.add(ocid)

        stage = str(r.get("stage") or "").strip().lower()
        if stage in AWARDED_STAGES:
            awarded_rows.append(r)
        else:
            planning_count += 1

    total_awarded = 0
    total_nocopo_disbursed = 0
    non_comp_count = 0
    methods_set: set[str] = set()

    contractors_acc: dict[str, dict[str, Any]] = {}
    for r in awarded_rows:
        award_amt = max(0, int(round(float(r.get("contract_award_naira") or 0))))
        paid_amt = max(0, int(round(float(r.get("total_paid_naira") or 0))))
        total_awarded += award_amt
        total_nocopo_disbursed += paid_amt

        method = str(r.get("procurement_method") or "").strip()
        if method:
            methods_set.add(method)
        is_nc = _is_non_competitive(method)
        if is_nc:
            non_comp_count += 1

        cname = str(r.get("contractor_name") or "").strip()
        norm_c = str(r.get("norm_contractor") or "").strip() or normalize_entity_name(cname)
        if not cname and not norm_c:
            continue

        key = norm_c or cname.upper()
        acc = contractors_acc.get(key)
        if acc is None:
            acc = {
                "contractorName": cname or key,
                "normContractor": key,
                "bppContractorId": r.get("bpp_contractor_id") or None,
                "awardCount": 0,
                "awardedNaira": 0,
                "nocopoDisbursedNaira": 0,
                "nonCompetitiveCount": 0,
                "methods": set(),
                "years": set(),
                "mdaCores": set(),
            }
            contractors_acc[key] = acc

        acc["awardCount"] += 1
        acc["awardedNaira"] += award_amt
        acc["nocopoDisbursedNaira"] += paid_amt
        if is_nc:
            acc["nonCompetitiveCount"] += 1
        if method:
            acc["methods"].add(method)
        fy = r.get("financial_year")
        if isinstance(fy, int) and 1999 <= fy <= 2030:
            acc["years"].add(fy)
        rcore = r.get("mda_core") or mda_core_key(r.get("mda_name") or "")
        if rcore:
            acc["mdaCores"].add(rcore)
        if not acc["bppContractorId"] and r.get("bpp_contractor_id"):
            acc["bppContractorId"] = r.get("bpp_contractor_id")

    # Attach GovSpend & leaderboard summary per distinct contractor
    contractors_list: list[dict[str, Any]] = []
    matched_mda_govspend_total = 0

    for key, acc in contractors_acc.items():
        mda_candidates = set(acc["mdaCores"])
        if target_mda_core:
            mda_candidates.add(target_mda_core)

        mda_gov_cnt = 0
        mda_gov_amt = 0
        for mcore in mda_candidates:
            c_cnt, c_amt = gov_by_mda_ben.get((mcore, key), (0, 0))
            mda_gov_cnt += c_cnt
            mda_gov_amt += c_amt

        matched_mda_govspend_total += mda_gov_amt
        tot_gov_cnt, tot_gov_amt = gov_by_ben.get(key, (0, 0))

        lb = leaderboard_map.get(key)
        c_entry: dict[str, Any] = {
            "contractorName": acc["contractorName"],
            "bppContractorId": acc["bppContractorId"],
            "awardCount": acc["awardCount"],
            "awardedNaira": acc["awardedNaira"],
            "nocopoDisbursedNaira": acc["nocopoDisbursedNaira"],
            "mdaGovspendCount": mda_gov_cnt,
            "mdaGovspendPaidNaira": mda_gov_amt,
            "totalGovspendCount": tot_gov_cnt,
            "totalGovspendPaidNaira": tot_gov_amt,
            "nonCompetitiveCount": acc["nonCompetitiveCount"],
            "procurementMethods": sorted(acc["methods"]),
            "years": sorted(acc["years"]),
        }
        if lb:
            c_entry["leaderboardContractCount"] = lb.get("contractCount")
            c_entry["leaderboardTotalContractedNaira"] = lb.get("totalContractedNaira")
            c_entry["leaderboardFirstYear"] = lb.get("firstYear")
            c_entry["leaderboardLastYear"] = lb.get("lastYear")
            c_entry["leaderboardMdaCount"] = lb.get("mdaCount")
            c_entry["leaderboardTopMdas"] = lb.get("topMdas") or []
        contractors_list.append(c_entry)

    contractors_list.sort(key=lambda c: (-c["awardedNaira"], -c["awardCount"], c["contractorName"]))

    return {
        "awardedContractCount": len(awarded_rows),
        "planningCount": planning_count,
        "totalAwardedNaira": total_awarded,
        "totalNocopoDisbursedNaira": total_nocopo_disbursed,
        "matchedMdaGovspendPaidNaira": matched_mda_govspend_total,
        "distinctContractorCount": len(contractors_acc),
        "nonCompetitiveCount": non_comp_count,
        "procurementMethods": sorted(methods_set),
        "contractors": contractors_list[:10],
    }


def _match_fuzzy_candidates(
    title: str,
    target_mda_core: str,
    min_year: int | None,
    max_year: int | None,
    inverted_index: dict[tuple[str, str], list[dict[str, Any]]],
    *,
    min_score: float = 0.78,
) -> tuple[list[dict[str, Any]], float]:
    """Return high-confidence `(matched_rows, best_score)` via MDA-scoped token overlap."""
    q_tokens = _distinctive_tokens(title)
    if not target_mda_core or len(q_tokens) < 4:
        return [], 0.0

    # Gather candidate rows sharing >= 3 distinctive tokens within the same MDA
    candidate_hits: dict[str, tuple[int, dict[str, Any]]] = {}
    for tok in q_tokens:
        for row in inverted_index.get((target_mda_core, tok), ()):
            ocid = row["ocid"]
            prev = candidate_hits.get(ocid)
            if prev is None:
                candidate_hits[ocid] = (1, row)
            else:
                candidate_hits[ocid] = (prev[0] + 1, row)

    matched: list[dict[str, Any]] = []
    best_score = 0.0
    for shared_cnt, row in candidate_hits.values():
        if shared_cnt < 3:
            continue
        r_tokens: frozenset[str] = row["tokens"]
        if len(r_tokens) < 4:
            continue

        # Enforce year window when NOCOPO record has a financial year
        noc_fy = row.get("financial_year")
        if min_year is not None and max_year is not None and isinstance(noc_fy, int) and noc_fy > 0:
            if noc_fy < (min_year - 1) or noc_fy > (max_year + 2):
                continue

        union_cnt = len(q_tokens | r_tokens)
        if union_cnt == 0:
            continue
        jaccard = shared_cnt / union_cnt
        if jaccard < 0.55:
            continue
        containment = shared_cnt / min(len(q_tokens), len(r_tokens))
        score = round(0.65 * jaccard + 0.35 * containment, 4)
        if score >= min_score:
            matched.append(row)
            if score > best_score:
                best_score = score

    return matched, best_score


def build_follow_the_money_links(
    diffs_dir: str | Path = DEFAULT_DIFFS_DIR,
    lineages_path: str | Path = DEFAULT_LINEAGES_PATH,
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    leaderboard_path: str | Path = DEFAULT_LEADERBOARD_PATH,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    write: bool = True,
) -> dict[str, Any]:
    """Build `follow_the_money_links.json` joining Bill-vs-Act diffs and Recurring Lineages to NOCOPO + GovSpend."""
    diffs_root = Path(diffs_dir)
    lin_file = Path(lineages_path)
    sqlite_file = Path(fts_sqlite_path)
    lb_file = Path(leaderboard_path)
    out_dir = Path(datasets_dir)

    leaderboard_map = _load_leaderboard_map(lb_file)

    contracts_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    awarded_inverted_idx: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    gov_by_ben: dict[str, tuple[int, int]] = {}
    gov_by_mda_ben: dict[tuple[str, str], tuple[int, int]] = {}

    if sqlite_file.exists():
        conn = sqlite3.connect(str(sqlite_file))
        try:
            gov_by_ben, gov_by_mda_ben = _load_govspend_aggregates(conn)
            has_noc = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
            ).fetchone()
            if has_noc:
                for row in conn.execute(
                    """
                    SELECT ocid, financial_year, stage, title, mda_name, norm_mda,
                           contractor_name, norm_contractor, bpp_contractor_id,
                           contract_award_naira, total_paid_naira,
                           procurement_method, project_code
                    FROM nocopo_contracts
                    """
                ):
                    (
                        ocid,
                        fy,
                        stage,
                        title,
                        mda_name,
                        norm_mda,
                        contractor_name,
                        norm_contractor,
                        bpp_id,
                        award_naira,
                        paid_naira,
                        method,
                        proj_code,
                    ) = row
                    core = mda_core_key(mda_name or norm_mda or "")
                    ucode = is_unique_project_code(proj_code)
                    title_ergps = extract_ergp_codes(title)
                    stage_low = str(stage or "").strip().lower()
                    rec: dict[str, Any] = {
                        "ocid": str(ocid or ""),
                        "financial_year": int(fy) if fy is not None and str(fy).isdigit() else 0,
                        "stage": stage_low,
                        "title": str(title or ""),
                        "mda_name": str(mda_name or ""),
                        "mda_core": core,
                        "contractor_name": str(contractor_name or ""),
                        "norm_contractor": str(norm_contractor or ""),
                        "bpp_contractor_id": bpp_id or None,
                        "contract_award_naira": award_naira or 0,
                        "total_paid_naira": paid_naira or 0,
                        "procurement_method": str(method or ""),
                        "unique_code": ucode,
                    }

                    codes_for_row = set()
                    if ucode:
                        codes_for_row.add(ucode)
                    for tc in title_ergps:
                        codes_for_row.add(tc)
                    for c_key in codes_for_row:
                        contracts_by_code[c_key].append(rec)

                    if stage_low in AWARDED_STAGES and core:
                        tokens = _distinctive_tokens(rec["title"])
                        if len(tokens) >= 4:
                            rec["tokens"] = tokens
                            for tok in tokens:
                                awarded_inverted_idx[(core, tok)].append(rec)
        finally:
            conn.close()

    # 1. Process Bill vs. Act Diff cycles
    diff_links_by_id: dict[str, dict[str, Any]] = {}
    diff_by_cycle: dict[str, dict[str, Any]] = {}
    diff_cycles_scanned = 0
    diff_items_scanned = 0
    diff_matched_any = 0
    diff_matched_awarded = 0
    diff_awarded_disbursed = 0
    diff_awarded_unpaid = 0
    diff_planned_only = 0
    diff_positive_padding_awarded = 0
    diff_positive_padding_awarded_naira = 0
    diff_total_awarded_naira = 0
    diff_total_nocopo_disbursed_naira = 0
    diff_non_comp_awards = 0

    if diffs_root.exists():
        diff_files = sorted(
            p for p in diffs_root.glob("*.json") if p.name != "index.json" and p.stem.isdigit()
        )
        for df in diff_files:
            payload = json.loads(df.read_text(encoding="utf-8"))
            yr = int(payload.get("financialYear") or df.stem)
            items = payload.get("items") or []
            diff_cycles_scanned += 1

            c_scanned = len(items)
            c_matched_awarded = 0
            c_awarded_disbursed = 0
            c_awarded_unpaid = 0
            c_planned_only = 0
            c_pos_pad_awarded = 0
            c_pos_pad_naira = 0
            c_award_naira = 0
            c_paid_naira = 0
            c_non_comp = 0

            for it in items:
                diff_items_scanned += 1
                item_id = str(it.get("id") or "")
                if not item_id:
                    continue
                item_yr = int(it.get("financialYear") or yr)
                title = str(it.get("projectName") or "")
                core = mda_core_key(it.get("mdaName") or "")
                ucode = is_unique_project_code(it.get("projectCode"))
                if not ucode:
                    t_ergps = extract_ergp_codes(title)
                    if t_ergps:
                        ucode = t_ergps[0]

                matched_rows: list[dict[str, Any]] = []
                match_method = ""
                confidence = 0.0

                if ucode and ucode in contracts_by_code:
                    matched_rows = contracts_by_code[ucode]
                    match_method = "EXACT_PROJECT_CODE"
                    confidence = 1.0
                else:
                    fuzzy_rows, best_s = _match_fuzzy_candidates(
                        title, core, item_yr, item_yr, awarded_inverted_idx
                    )
                    if fuzzy_rows:
                        matched_rows = fuzzy_rows
                        match_method = "FUZZY_MDA_TITLE"
                        confidence = best_s

                if not matched_rows:
                    continue

                agg = _aggregate_matched_contracts(
                    matched_rows, core, gov_by_ben, gov_by_mda_ben, leaderboard_map
                )
                if agg["awardedContractCount"] == 0 and agg["planningCount"] == 0:
                    continue

                diff_matched_any += 1
                has_cash = (
                    agg["totalNocopoDisbursedNaira"] > 0
                    or agg["matchedMdaGovspendPaidNaira"] > 0
                )
                if agg["awardedContractCount"] > 0:
                    exec_status = (
                        "CONTRACTED_AND_DISBURSED" if has_cash else "CONTRACTED_NO_DISBURSEMENT"
                    )
                    diff_matched_awarded += 1
                    c_matched_awarded += 1
                    if has_cash:
                        diff_awarded_disbursed += 1
                        c_awarded_disbursed += 1
                    else:
                        diff_awarded_unpaid += 1
                        c_awarded_unpaid += 1

                    diff_total_awarded_naira += agg["totalAwardedNaira"]
                    diff_total_nocopo_disbursed_naira += agg["totalNocopoDisbursedNaira"]
                    diff_non_comp_awards += agg["nonCompetitiveCount"]
                    c_award_naira += agg["totalAwardedNaira"]
                    c_paid_naira += agg["totalNocopoDisbursedNaira"]
                    c_non_comp += agg["nonCompetitiveCount"]

                    if it.get("status") in ("NASS_INSERTION", "ALLOCATION_INFLATED"):
                        diff_positive_padding_awarded += 1
                        diff_positive_padding_awarded_naira += agg["totalAwardedNaira"]
                        c_pos_pad_awarded += 1
                        c_pos_pad_naira += agg["totalAwardedNaira"]
                else:
                    exec_status = "PLANNED_TENDER_ONLY"
                    diff_planned_only += 1
                    c_planned_only += 1

                diff_links_by_id[item_id] = {
                    "id": item_id,
                    "financialYear": item_yr,
                    "diffStatus": it.get("status"),
                    "executionStatus": exec_status,
                    "matchMethod": match_method,
                    "confidenceScore": confidence,
                    **agg,
                }

            diff_by_cycle[str(yr)] = {
                "financialYear": yr,
                "itemsScanned": c_scanned,
                "awardedCount": c_matched_awarded,
                "awardedDisbursedCount": c_awarded_disbursed,
                "awardedUnpaidCount": c_awarded_unpaid,
                "plannedOnlyCount": c_planned_only,
                "positivePaddingAwardedCount": c_pos_pad_awarded,
                "positivePaddingAwardedNaira": c_pos_pad_naira,
                "totalAwardedNaira": c_award_naira,
                "totalNocopoDisbursedNaira": c_paid_naira,
                "nonCompetitiveAwardCount": c_non_comp,
            }

    # 2. Process Recurring Lineages ("Zombie Projects" Reality Check)
    lineage_links_by_id: dict[str, dict[str, Any]] = {}
    lineage_counts = {
        "VENDOR_SWITCHED_REPEAT": 0,
        "ACTIVE_PHASED_BUILD": 0,
        "AWARDED_UNPAID": 0,
        "PLANNED_ONLY_REPEAT": 0,
        "BUDGET_ONLY_REPEAT": 0,
    }
    lineages_scanned = 0
    lineage_total_awarded_naira = 0
    lineage_total_nocopo_disbursed_naira = 0

    if lin_file.exists():
        rl_data = json.loads(lin_file.read_text(encoding="utf-8"))
        for lin in rl_data.get("lineages", []):
            lineages_scanned += 1
            lid = str(lin.get("lineage_id") or lin.get("lineageId") or "")
            title = str(lin.get("canonical_title") or lin.get("canonicalTitle") or "")
            core = mda_core_key(lin.get("agency") or "")
            years = [
                int(y)
                for y in (lin.get("years_appeared") or lin.get("yearsAppeared") or [])
                if str(y).isdigit()
            ]
            min_yr = min(years) if years else None
            max_yr = max(years) if years else None

            candidate_codes: list[str] = []
            for raw_c in [
                lin.get("project_code") or lin.get("projectCode"),
                *[
                    inst.get("projectCode") or inst.get("project_code")
                    for inst in (lin.get("instances") or lin.get("appearances") or [])
                ],
            ]:
                uc = is_unique_project_code(raw_c)
                if uc and uc not in candidate_codes:
                    candidate_codes.append(uc)

            matched_rows = []
            match_method = ""
            confidence = 0.0

            code_hits: list[dict[str, Any]] = []
            for uc in candidate_codes:
                if uc in contracts_by_code:
                    code_hits.extend(contracts_by_code[uc])

            if code_hits:
                matched_rows = code_hits
                match_method = "EXACT_PROJECT_CODE"
                confidence = 1.0
            else:
                fuzzy_rows, best_s = _match_fuzzy_candidates(
                    title, core, min_yr, max_yr, awarded_inverted_idx
                )
                if fuzzy_rows:
                    matched_rows = fuzzy_rows
                    match_method = "FUZZY_MDA_TITLE"
                    confidence = best_s

            if not matched_rows:
                lineage_counts["BUDGET_ONLY_REPEAT"] += 1
                continue

            agg = _aggregate_matched_contracts(
                matched_rows, core, gov_by_ben, gov_by_mda_ben, leaderboard_map
            )
            if agg["awardedContractCount"] == 0 and agg["planningCount"] == 0:
                lineage_counts["BUDGET_ONLY_REPEAT"] += 1
                continue

            has_cash = (
                agg["totalNocopoDisbursedNaira"] > 0
                or agg["matchedMdaGovspendPaidNaira"] > 0
            )
            if agg["awardedContractCount"] >= 2 and agg["distinctContractorCount"] >= 2:
                classification = "VENDOR_SWITCHED_REPEAT"
            elif agg["awardedContractCount"] >= 1 and has_cash:
                classification = "ACTIVE_PHASED_BUILD"
            elif agg["awardedContractCount"] >= 1:
                classification = "AWARDED_UNPAID"
            else:
                classification = "PLANNED_ONLY_REPEAT"

            lineage_counts[classification] += 1
            lineage_total_awarded_naira += agg["totalAwardedNaira"]
            lineage_total_nocopo_disbursed_naira += agg["totalNocopoDisbursedNaira"]

            if lid:
                lineage_links_by_id[lid] = {
                    "lineageId": lid,
                    "classification": classification,
                    "matchMethod": match_method,
                    "confidenceScore": confidence,
                    **agg,
                }

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_FOLLOW_THE_MONEY",
        "govspendScopeNote": (
            "GovSpend receipts reflect Treasury disbursements from the matched contractor's MDA "
            "(mdaGovspendPaidNaira) alongside total federal GovSpend receipts (totalGovspendPaidNaira), "
            "because Open Treasury vouchers do not always include ERGP line-item codes."
        ),
        "summary": {
            "diffCyclesScanned": diff_cycles_scanned,
            "diffItemsScanned": diff_items_scanned,
            "diffMatchedAnyCount": diff_matched_any,
            "diffMatchedAwardedCount": diff_matched_awarded,
            "diffAwardedDisbursedCount": diff_awarded_disbursed,
            "diffAwardedUnpaidCount": diff_awarded_unpaid,
            "diffPlannedOnlyCount": diff_planned_only,
            "diffPositivePaddingAwardedCount": diff_positive_padding_awarded,
            "diffPositivePaddingAwardedNaira": diff_positive_padding_awarded_naira,
            "diffTotalAwardedNaira": diff_total_awarded_naira,
            "diffTotalNocopoDisbursedNaira": diff_total_nocopo_disbursed_naira,
            "diffNonCompetitiveAwardCount": diff_non_comp_awards,
            "diffByCycle": diff_by_cycle,
            "lineagesScanned": lineages_scanned,
            "lineageClassificationCounts": lineage_counts,
            "lineageTotalAwardedNaira": lineage_total_awarded_naira,
            "lineageTotalNocopoDisbursedNaira": lineage_total_nocopo_disbursed_naira,
        },
        "diffLinksById": diff_links_by_id,
        "lineageLinksById": lineage_links_by_id,
    }

    if write:
        _atomic_write_json(out_dir / "follow_the_money_links.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build Padded-to-Paid & Zombie Projects Cross-Link Index (P3-S1)."
    )
    parser.add_argument("--diffs-dir", type=Path, default=DEFAULT_DIFFS_DIR)
    parser.add_argument("--lineages", type=Path, default=DEFAULT_LINEAGES_PATH)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--leaderboard", type=Path, default=DEFAULT_LEADERBOARD_PATH)
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    args = parser.parse_args()

    out_path = args.datasets_dir / "follow_the_money_links.json"
    res = build_follow_the_money_links(
        diffs_dir=args.diffs_dir,
        lineages_path=args.lineages,
        fts_sqlite_path=args.sqlite,
        leaderboard_path=args.leaderboard,
        datasets_dir=args.datasets_dir,
        write=True,
    )
    s = res["summary"]
    size_kb = out_path.stat().st_size / 1024.0 if out_path.exists() else 0.0
    print(
        f"Follow the Money [{res['status']}]: diffMatchedAny={s['diffMatchedAnyCount']} "
        f"(awarded={s['diffMatchedAwardedCount']}, posPadAwarded={s['diffPositivePaddingAwardedCount']}, "
        f"awardedNaira=NGN {s['diffTotalAwardedNaira']/1e9:.2f}B) | "
        f"lineages={s['lineagesScanned']} classifications={s['lineageClassificationCounts']} | "
        f"file={size_kb:.1f} KB"
    )


if __name__ == "__main__":
    main()
