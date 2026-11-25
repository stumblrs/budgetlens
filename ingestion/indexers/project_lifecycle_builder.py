"""Unified 5-Stage Project Lifecycle Timeline Builder (Phase 3 · Stage P3-S2).

Connects all five federal accountability layers for 1999–2026 line items:
  Stage 1: MTEF Macro Context (`public/datasets/policy_benchmarks.json`)
  Stage 2: Bill vs. Act Legislative Delta (`public/datasets/bill_act_diffs/*.json`)
  Stage 3: Parent MDA BIR Release & Utilization % (`public/datasets/execution_tracker.json`)
  Stage 4: NOCOPO Procurement Contract & Vendor (`nocopo_contracts` in SQLite)
  Stage 5: GovSpend Open Treasury Cash Vouchers (`govspend_payments` in SQLite)

Writes a compact manifest `public/datasets/project_lifecycle_index.json` (< 2.5 MB)
and 64 deterministic FNV-1a shards under `public/datasets/project_lifecycle/00.json`–`63.json`
(< 2.5 MB each) so Project Dossier, Evidence Modal, and Public Scrutiny views operate
100% offline without requiring a live FastAPI server.
"""

from __future__ import annotations

import argparse
import heapq
import json
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.follow_the_money_builder import (
    AWARDED_STAGES,
    PLANNING_STAGES,
    _atomic_write_json,
    _is_non_competitive,
    _match_fuzzy_candidates,
    _distinctive_tokens,
    is_unique_project_code,
)
from ingestion.parsers.entity_normalizer import (
    canonical_contractor_key,
    extract_ergp_codes,
    is_valid_mda_name,
    mda_core_key,
    normalize_entity_name,
    normalize_mda_name,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_POLICY_PATH = DEFAULT_DATASETS_DIR / "policy_benchmarks.json"
DEFAULT_EXECUTION_PATH = DEFAULT_DATASETS_DIR / "execution_tracker.json"
DEFAULT_DIFFS_DIR = DEFAULT_DATASETS_DIR / "bill_act_diffs"
DEFAULT_SWEEP_PATH = DEFAULT_DATASETS_DIR / "forensic_sweep_1999_2026.json"
DEFAULT_LEADERBOARD_PATH = DEFAULT_DATASETS_DIR / "contractors_leaderboard.json"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"

_SPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^A-Z0-9\s]+")

MAX_SHARD_BYTES = 2_450_000


def shard_bucket_for_key(raw_key: str) -> str:
    """Return '00'..'63' deterministic 32-bit FNV-1a bucket matching TypeScript client."""
    s = str(raw_key or "").strip().upper()
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return f"{h % 64:02d}"


def _norm_title_key(title: str | None) -> str:
    up = _NON_ALNUM_RE.sub(" ", str(title or "").upper())
    return _SPACE_RE.sub(" ", up).strip()


def _load_canonical_leaderboard(leaderboard_path: Path) -> dict[str, dict[str, Any]]:
    if not leaderboard_path.exists():
        return {}
    try:
        data = json.loads(leaderboard_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for entry in data.get("contractors", []):
        name = str(entry.get("contractorName") or "").strip()
        key = canonical_contractor_key(name)
        if key and key not in out:
            out[key] = entry
    return out


_ANTI_CORRUPTION_RE = re.compile(
    r"\b(?:ICPC|INDEPENDENT\s+CORRUPT\s+PRACTICES|EFCC|ECONOMIC\s+AND\s+FINANCIAL\s+CRIMES|CODE\s+OF\s+CONDUCT)\b",
    flags=re.IGNORECASE,
)


def _has_family_pattern(txt: str, patterns: tuple[str, ...]) -> bool:
    return any(re.search(pat, txt) for pat in patterns)


# Canonical Parent Ministry families shared symmetrically with src/utils/projectLifecycle.ts
def classify_parent_ministry_families(raw_mda: str | None) -> list[str]:
    """Map an MDA or summary ministry label to ordered canonical ministry family keys."""
    txt = normalize_mda_name(raw_mda)
    if not txt:
        return []

    if _ANTI_CORRUPTION_RE.search(txt):
        return ["ANTI_CORRUPTION"]

    families: list[str] = []

    def add(fam: str) -> None:
        if fam not in families:
            families.append(fam)

    # Multi-ministry BIR labels (e.g., "Works, Power & Housing", "Housing Transportation")
    if _has_family_pattern(
        txt,
        (r"\bWORKS?\b", r"\bFERMA\b", r"\bROAD\s+MAINTENANCE\b", r"\bHIGHWAYS?\b", r"\bSURVEYOR\s+GENERAL\b"),
    ):
        add("WORKS")
    if _has_family_pattern(txt, (r"\bHOUSING\b", r"\bURBAN\s+DEVT\b", r"\bURBAN\s+DEVELOPMENT\b")):
        add("HOUSING")
    if _has_family_pattern(
        txt,
        (r"\bPOWER\b", r"\bELECTRIFICATION\b", r"\bELECTRICITY\b", r"\bTRANSMISSION\s+COMPANY\b"),
    ):
        add("POWER")
    if _has_family_pattern(
        txt,
        (
            r"\bINLAND\s+WATERWAYS\b",
            r"\bWATERWAYS\b",
            r"\bMARITIME\b",
            r"\bRAILWAYS?\b",
            r"\bTRANSPORT(?:ATION)?\b",
            r"\bROAD\s+SAFETY\b",
            r"\bFRSC\b",
        ),
    ):
        add("TRANSPORT")
    if _has_family_pattern(
        txt,
        (r"\bAVIATION\b", r"\bAIRPORTS?\b", r"\bAIRSPACE\b", r"\bNAMA\b", r"\bNCAA\b", r"\bNIMET\b"),
    ):
        add("AVIATION")
    if _has_family_pattern(
        txt,
        (r"\bWATER\s+RESOURCES\b", r"\bBASIN\b", r"\bRBDAS?\b", r"\bHYDROLOG", r"^WATER$"),
    ):
        add("WATER")
    if _has_family_pattern(
        txt,
        (r"\bHEALTH\b", r"\bHOSPITALS?\b", r"\bMEDICAL\b", r"\bNACA\b", r"\bNAFDAC\b", r"\bN?PHCDA\b"),
    ):
        add("HEALTH")
    if _has_family_pattern(
        txt,
        (
            r"\bEDUCATION\b",
            r"\bUNIVERSIT(?:Y|IES)\b",
            r"\bPOLYTECHNICS?\b",
            r"\bUNITY\s+SCHOOLS?\b",
            r"\bUBEC\b",
            r"\bBASIC\s+EDUCATION\b",
            r"\bTETFUND\b",
            r"\bNBTE\b",
            r"\bNCCE\b",
            r"\bNUC\b",
            r"\bNECO\b",
            r"\bJAMB\b",
            r"\bMASS\s+LITERACY\b",
            r"\bLIBRARY\b",
        ),
    ):
        add("EDUCATION")
    if _has_family_pattern(
        txt,
        (
            r"\bAGRICULTUR",
            r"\bRURAL\s+DEVELOPMENT\b",
            r"\bHORTICULTURE\b",
            r"\bFORESTRY\b",
            r"\bFISHER",
            r"\bLIVESTOCK\b",
            r"\bGRAINS?\b",
            r"\bCOCOA\b",
            r"\bNALDA\b",
        ),
    ):
        add("AGRICULTURE")
    if _has_family_pattern(
        txt,
        (r"\bCIVIL\s+DEFENCE\b", r"\bIMMIGRATION\b", r"\bPRISONS?\b", r"\bCORRECTIONAL\b", r"\bFIRE\s+SERVICE\b", r"\bINTERIOR\b"),
    ):
        add("INTERIOR")
    if _has_family_pattern(txt, (r"\bPOLICE\b",)):
        add("POLICE")
    if _has_family_pattern(
        txt,
        (
            r"\bDEFENCE\b",
            r"\bDEFENSE\b",
            r"\bARMY\b",
            r"\bNAVY\b",
            r"\bNAVAL\b",
            r"\bAIRFORCE\b",
            r"\bAIR\s+FORCE\b",
            r"\bDICON\b",
            r"\bNDA\b",
            r"\bMAIN\s+MOD\b",
        ),
    ):
        add("DEFENCE")
    if _has_family_pattern(
        txt,
        (r"\bNATIONAL\s+SECURITY\s+ADVISER\b", r"\bONSA\b", r"\bSTATE\s+SECURITY\b", r"\bDSS\b", r"\bINTELLIGEN(?:CE|T)\s+AGENCY\b"),
    ):
        add("ONSA")
    if _has_family_pattern(txt, (r"\bFCTA?\b", r"\bFEDERAL\s+CAPITAL\s+TERRITORY\b")):
        add("FCTA")
    if _has_family_pattern(txt, (r"\bNIGER\s+DELTA\b", r"\bNDDC\b")):
        add("NIGER_DELTA")
    if _has_family_pattern(
        txt,
        (r"\bSCIENCE\b", r"\bTECHNOLOG", r"\bBIOTECHNOLOG", r"\bSPACE\s+RESEARCH\b", r"\bNASENI\b", r"\bPRODA\b", r"\bENERGY\s+COMMISSION\b"),
    ):
        add("SCIENCE_TECH")
    if _has_family_pattern(txt, (r"\bENVIRONMENT\b", r"\bECOLOGICAL\b", r"\bBIOSAFETY\b", r"\bCLIMATE\s+CHANGE\b", r"\bHYPREP\b")):
        add("ENVIRONMENT")
    if _has_family_pattern(txt, (r"\bTRADE\b", r"\bINVESTMENT\b", r"\bINDUSTRY\b", r"\bSMEDAN\b", r"\bEXPORT\s+PROMOTION\b", r"\bNEPZA\b")):
        add("TRADE_INVESTMENT")
    if _has_family_pattern(txt, (r"\bHUMANITARIAN\b", r"\bDISASTER\b", r"\bNEMA\b", r"\bREFUGEES?\b", r"\bNORTH\s+EAST\s+DEVELOPMENT\b", r"\bNEDC\b")):
        add("HUMANITARIAN")
    if _has_family_pattern(txt, (r"\bLABOUR\b", r"\bLABOR\b", r"\bEMPLOYMENT\b", r"\bPRODUCTIVITY\b", r"\bNDE\b")):
        add("LABOUR")
    if _has_family_pattern(txt, (r"\bWOMEN\s+AFFAIRS\b", r"\bWOMEN\s+DEVELOPMENT\b")):
        add("WOMEN_AFFAIRS")
    if _has_family_pattern(txt, (r"\bYOUTH\b", r"\bSPORTS?\b", r"\bNYSC\b")):
        add("YOUTH_SPORTS")
    if _has_family_pattern(txt, (r"\bMINES\b", r"\bSTEEL\b", r"\bSOLID\s+MINERALS\b", r"\bGEOLOGICAL\b", r"\bMETALLURGICAL\b")):
        add("MINES_STEEL")
    if _has_family_pattern(txt, (r"\bSECRETARY\s+TO\s+(?:THE\s+)?GOVERNMENT\b", r"\bOSGF\b", r"\bSGF\b", r"\bBORDER\s+COMMUNITIES\b")):
        add("OSGF")
    if _has_family_pattern(txt, (r"\bSTATE\s+HOUSE\b", r"\bPRESIDENCY\b")):
        add("PRESIDENCY")

    return families


def _build_mtef_by_year(policy_path: Path) -> dict[str, dict[str, Any]]:
    by_year_candidates: dict[int, list[dict[str, Any]]] = defaultdict(list)
    docs_list: list[dict[str, Any]] = []

    if policy_path.exists():
        data = json.loads(policy_path.read_text(encoding="utf-8"))
        docs_list = list(data.get("documents") or [])
        for mb in data.get("macroBenchmarks") or []:
            fy = mb.get("financialYear")
            if isinstance(fy, int):
                by_year_candidates[fy].append(mb)

    out: dict[str, dict[str, Any]] = {}
    for fy in range(1999, 2027):
        cands = by_year_candidates.get(fy, [])
        if cands:
            def _score(entry: dict[str, Any]) -> tuple[int, int, int]:
                slug = str(entry.get("docSlug") or "").lower()
                is_full_mtef = 0 if ("consultative" in slug or "presentation" in slug or "citizen" in slug) else 1
                populated = sum(
                    1
                    for k in (
                        "oilPriceUsdPerBbl",
                        "oilProductionMbpd",
                        "exchangeRateNairaPerUsd",
                        "gdpGrowthPct",
                        "inflationPct",
                    )
                    if entry.get(k) is not None
                )
                is_revised = 1 if ("addendum" in slug or "revised" in slug) else 0
                return (is_full_mtef, populated, is_revised)

            best = max(cands, key=_score)
            out[str(fy)] = {
                "financialYear": fy,
                "status": "EXACT_YEAR_MTEF",
                "oilPriceUsdPerBbl": best.get("oilPriceUsdPerBbl"),
                "oilProductionMbpd": best.get("oilProductionMbpd"),
                "exchangeRateNairaPerUsd": best.get("exchangeRateNairaPerUsd"),
                "gdpGrowthPct": best.get("gdpGrowthPct"),
                "inflationPct": best.get("inflationPct"),
                "docTitle": best.get("docTitle"),
                "docSlug": best.get("docSlug"),
                "sourcePage": best.get("sourcePage"),
                "sha256": best.get("sha256"),
                "coveringDocTitle": None,
                "coveringDocSha256": None,
            }
            continue

        covering = None
        for d in docs_list:
            if d.get("docType") != "MTEF_FSP" or d.get("extractionStatus") == "INVALID_PDF":
                continue
            s_yr = d.get("fiscalYearStart")
            e_yr = d.get("fiscalYearEnd")
            if isinstance(s_yr, int) and isinstance(e_yr, int) and s_yr <= fy <= e_yr:
                covering = d
                break

        out[str(fy)] = {
            "financialYear": fy,
            "status": "NO_MTEF_BENCHMARK",
            "oilPriceUsdPerBbl": None,
            "oilProductionMbpd": None,
            "exchangeRateNairaPerUsd": None,
            "gdpGrowthPct": None,
            "inflationPct": None,
            "docTitle": None,
            "docSlug": None,
            "sourcePage": None,
            "sha256": None,
            "coveringDocTitle": covering.get("title") if covering else None,
            "coveringDocSha256": covering.get("sha256") if covering else None,
        }
    return out


def _build_bir_by_year(exec_path: Path) -> dict[str, dict[str, Any]]:
    if not exec_path.exists():
        return {}
    data = json.loads(exec_path.read_text(encoding="utf-8"))
    out: dict[str, dict[str, Any]] = {}
    for y in data.get("years") or []:
        if y.get("status") != "VERIFIED_BIR_SOURCE":
            continue
        fy = y.get("financialYear")
        if not isinstance(fy, int):
            continue
        compact_mdas: list[dict[str, Any]] = []
        for m in y.get("mdaBreakdown") or []:
            app = int(round(float(m.get("appropriatedNaira") or 0)))
            rel = int(round(float(m.get("releasedNaira") or 0)))
            util_raw = m.get("utilizedNaira")
            util = int(round(float(util_raw))) if util_raw is not None else None
            rel_pct = m.get("releasePct")
            # FY 2010 & 2011 BIR tables omitted the Appropriated denominator (stored as 0 with releasePct=0.0)
            if app <= 0 and rel > 0:
                rel_pct = None
            raw_name = str(m.get("mdaName") or "").strip()
            if not is_valid_mda_name(raw_name):
                continue
            compact_mdas.append(
                {
                    "mdaName": raw_name,
                    "normMda": normalize_mda_name(raw_name),
                    "coreKey": mda_core_key(raw_name),
                    "families": classify_parent_ministry_families(raw_name),
                    "appropriatedNaira": app,
                    "releasedNaira": rel,
                    "utilizedNaira": util,
                    "releasePct": rel_pct,
                    "utilizationPct": m.get("utilizationPct"),
                    "overspendVirement": bool(m.get("overspendVirement")),
                }
            )
        out[str(fy)] = {
            "financialYear": fy,
            "quarterCovered": y.get("quarterCovered"),
            "reportPeriodLabel": y.get("reportPeriodLabel"),
            "reportTitle": y.get("reportTitle"),
            "granularity": y.get("granularity"),
            "overallReleasePct": y.get("overallReleasePct"),
            "overallUtilizationPct": y.get("overallUtilizationPct"),
            "mdaCount": len(compact_mdas),
            "mdaBreakdown": compact_mdas,
        }
    return out


def match_bir_mda(bir_year_entry: dict[str, Any] | None, raw_mda_name: str | None) -> dict[str, Any]:
    """Match a record's executing MDA to a verified BIR MDA row, returning explicit non-zero fallback states."""
    if not bir_year_entry:
        return {
            "status": "NO_BIR_REPORT",
            "matchType": "NONE",
            "matchedMdaName": None,
            "quarterCovered": None,
            "reportPeriodLabel": None,
            "appropriatedNaira": None,
            "releasedNaira": None,
            "utilizedNaira": None,
            "releasePct": None,
            "utilizationPct": None,
            "overspendVirement": False,
            "nationalOverallReleasePct": None,
            "nationalOverallUtilizationPct": None,
        }

    mdas = bir_year_entry.get("mdaBreakdown") or []
    base_nat = {
        "quarterCovered": bir_year_entry.get("quarterCovered"),
        "reportPeriodLabel": bir_year_entry.get("reportPeriodLabel"),
        "nationalOverallReleasePct": bir_year_entry.get("overallReleasePct"),
        "nationalOverallUtilizationPct": bir_year_entry.get("overallUtilizationPct"),
    }
    if not mdas:
        return {
            "status": "NO_MDA_BREAKDOWN",
            "matchType": "NONE",
            "matchedMdaName": None,
            "appropriatedNaira": None,
            "releasedNaira": None,
            "utilizedNaira": None,
            "releasePct": None,
            "utilizationPct": None,
            "overspendVirement": False,
            **base_nat,
        }

    norm_q = normalize_mda_name(raw_mda_name)
    core_q = mda_core_key(raw_mda_name)

    matched_row: dict[str, Any] | None = None
    match_type = "NONE"

    if norm_q or core_q:
        # 1. Exact normMda or coreKey match
        for m in mdas:
            if (norm_q and m["normMda"] == norm_q) or (core_q and m["coreKey"] == core_q):
                matched_row = m
                match_type = "EXACT_MDA"
                break

        # 2. Parent ministry family match
        if matched_row is None:
            q_fams = classify_parent_ministry_families(raw_mda_name)
            if q_fams:
                best_row: dict[str, Any] | None = None
                best_rank = -1
                for qf in q_fams:
                    for m in mdas:
                        m_fams = m.get("families") or []
                        if qf in m_fams:
                            # Prefer single-family BIR row over combined multi-ministry row when available
                            rank = 2 if len(m_fams) == 1 else 1
                            if rank > best_rank:
                                best_rank = rank
                                best_row = m
                    if best_row is not None:
                        break
                if best_row is not None:
                    matched_row = best_row
                    match_type = "PARENT_MINISTRY_MDA"

    if matched_row is None:
        return {
            "status": "NO_MDA_BREAKDOWN",
            "matchType": "NONE",
            "matchedMdaName": None,
            "appropriatedNaira": None,
            "releasedNaira": None,
            "utilizedNaira": None,
            "releasePct": None,
            "utilizationPct": None,
            "overspendVirement": False,
            **base_nat,
        }

    return {
        "status": "MATCHED_MDA",
        "matchType": match_type,
        "matchedMdaName": matched_row["mdaName"],
        "appropriatedNaira": matched_row["appropriatedNaira"],
        "releasedNaira": matched_row["releasedNaira"],
        "utilizedNaira": matched_row["utilizedNaira"],
        "releasePct": matched_row["releasePct"],
        "utilizationPct": matched_row["utilizationPct"],
        "overspendVirement": bool(matched_row.get("overspendVirement")),
        **base_nat,
    }


def _load_diff_indexes(
    diffs_dir: Path,
) -> tuple[
    list[int],
    dict[tuple[int, str], dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[tuple[int, str, str], dict[str, Any] | None],
    list[dict[str, Any]],
]:
    cycles: list[int] = []
    by_year_code: dict[tuple[int, str], dict[str, Any]] = {}
    by_diff_id: dict[str, dict[str, Any]] = {}
    by_year_mda_title: dict[tuple[int, str, str], dict[str, Any] | None] = {}
    all_diff_items: list[dict[str, Any]] = []

    if not diffs_dir.exists():
        return cycles, by_year_code, by_diff_id, by_year_mda_title, all_diff_items

    diff_files = sorted(
        p for p in diffs_dir.glob("*.json") if p.name != "index.json" and p.stem.isdigit()
    )
    for df in diff_files:
        payload = json.loads(df.read_text(encoding="utf-8"))
        yr = int(payload.get("financialYear") or df.stem)
        cycles.append(yr)
        for it in payload.get("items") or []:
            did = str(it.get("id") or "").strip().upper()
            fy = int(it.get("financialYear") or yr)
            item_entry = {
                "id": did,
                "financialYear": fy,
                "status": it.get("status"),
                "projectCode": str(it.get("projectCode") or "").strip(),
                "projectName": str(it.get("projectName") or "").strip(),
                "mdaName": str(it.get("mdaName") or "").strip(),
                "proposedAmountNaira": int(round(float(it.get("proposedAmountNaira") or 0))),
                "enactedAmountNaira": int(round(float(it.get("enactedAmountNaira") or 0))),
                "deltaNaira": int(round(float(it.get("deltaNaira") or 0))),
                "deltaPct": it.get("deltaPct"),
                "isZonalIntervention": bool(it.get("isZonalIntervention")),
                "billPage": it.get("billPage"),
                "actPage": it.get("actPage"),
                "matchConfidence": it.get("matchConfidence"),
            }
            all_diff_items.append(item_entry)
            if did:
                by_diff_id[did] = item_entry

            uc = is_unique_project_code(item_entry["projectCode"])
            if uc:
                prev = by_year_code.get((fy, uc))
                if prev is None or abs(item_entry["deltaNaira"]) > abs(prev["deltaNaira"]):
                    by_year_code[(fy, uc)] = item_entry

            nt = _norm_title_key(item_entry["projectName"])
            core = mda_core_key(item_entry["mdaName"])
            if len(nt) >= 18 and core:
                key = (fy, core, nt)
                if key not in by_year_mda_title:
                    by_year_mda_title[key] = item_entry
                else:
                    # Mark ambiguous so exact-title fallback stays unambiguous
                    by_year_mda_title[key] = None

    return sorted(set(cycles)), by_year_code, by_diff_id, by_year_mda_title, all_diff_items


def _resolve_bill_diff_stage(
    fy: int,
    record_id: str,
    ucode: str,
    title: str,
    core_mda: str,
    diff_cycles_set: set[int],
    by_year_code: dict[tuple[int, str], dict[str, Any]],
    by_diff_id: dict[str, dict[str, Any]],
    by_year_mda_title: dict[tuple[int, str, str], dict[str, Any] | None],
) -> dict[str, Any]:
    if fy not in diff_cycles_set:
        return {"status": "NO_BILL_DIFF_CYCLE", "cycleAvailable": False}

    hit = None
    rid_up = record_id.strip().upper()
    if rid_up and rid_up in by_diff_id:
        hit = by_diff_id[rid_up]
    elif ucode and (fy, ucode) in by_year_code:
        hit = by_year_code[(fy, ucode)]
    else:
        nt = _norm_title_key(title)
        if len(nt) >= 18 and core_mda:
            cand = by_year_mda_title.get((fy, core_mda, nt))
            if cand is not None:
                hit = cand

    if hit is None:
        return {"status": "NOT_IN_ALTERED_DIFF", "cycleAvailable": True}

    return {
        "status": hit["status"],
        "diffId": hit["id"],
        "proposedAmountNaira": hit["proposedAmountNaira"],
        "enactedAmountNaira": hit["enactedAmountNaira"],
        "deltaNaira": hit["deltaNaira"],
        "deltaPct": hit["deltaPct"],
        "isZonalIntervention": hit["isZonalIntervention"],
        "billPage": hit["billPage"],
        "actPage": hit["actPage"],
        "matchConfidence": hit["matchConfidence"],
        "cycleAvailable": True,
    }


def _push_top_k(heap: list[tuple[int, int, dict[str, Any]]], item: dict[str, Any], amt: int, seq: int, k: int) -> None:
    entry = (amt, seq, item)
    if len(heap) < k:
        heapq.heappush(heap, entry)
    elif entry > heap[0]:
        heapq.heapreplace(heap, entry)


def classify_paid_on_paper(
    total_nocopo_disbursed_naira: int,
    awarded_contract_count: int,
    direct_govspend_paid_naira: int,
    direct_govspend_voucher_count: int,
    vendor_mda_govspend_paid_naira: int,
    vendor_mda_govspend_voucher_count: int,
) -> tuple[bool, str, str, int]:
    """Compute Paid-on-Paper citizen field-verification priority without double-counting ledgers."""
    if total_nocopo_disbursed_naira > 0 or direct_govspend_paid_naira > 0:
        parts: list[str] = []
        if total_nocopo_disbursed_naira > 0:
            parts.append(f"NGN {total_nocopo_disbursed_naira:,.0f} recorded as disbursed in NOCOPO")
        if direct_govspend_paid_naira > 0:
            parts.append(
                f"NGN {direct_govspend_paid_naira:,.0f} across {direct_govspend_voucher_count} ERGP-cited Open Treasury voucher(s)"
            )
        reason = "; ".join(parts) + "."
        return True, "DIRECT_PROJECT_PAID", reason, max(total_nocopo_disbursed_naira, direct_govspend_paid_naira)

    if awarded_contract_count > 0 and vendor_mda_govspend_paid_naira > 0:
        reason = (
            f"Awarded contractor received NGN {vendor_mda_govspend_paid_naira:,.0f} across "
            f"{vendor_mda_govspend_voucher_count} same-MDA Open Treasury voucher(s) "
            "(MDA-to-contractor Treasury context; vouchers may span multiple contracts)."
        )
        return True, "VENDOR_MDA_PAID", reason, 0

    return False, "NONE", "", 0


def _aggregate_lifecycle_execution(
    matched_rows: list[dict[str, Any]],
    match_method: str,
    confidence: float,
    target_mda_core: str,
    ucodes: list[str],
    gov_by_ben: dict[str, tuple[int, int]],
    gov_by_mda_ben: dict[tuple[str, str], tuple[int, int]],
    direct_by_code: dict[str, dict[str, Any]],
    vendor_mda_samples: dict[tuple[str, str], list[dict[str, Any]]],
    leaderboard_map: dict[str, dict[str, Any]],
    max_contracts: int = 8,
    max_vouchers: int = 8,
) -> tuple[dict[str, Any], dict[str, Any], tuple[bool, str, str, int]]:
    seen_ocids: set[str] = set()
    awarded_rows: list[dict[str, Any]] = []
    planning_rows: list[dict[str, Any]] = []

    for r in matched_rows:
        ocid = str(r.get("ocid") or "")
        if ocid and ocid in seen_ocids:
            continue
        if ocid:
            seen_ocids.add(ocid)
        if str(r.get("stage") or "").lower() in AWARDED_STAGES:
            awarded_rows.append(r)
        else:
            planning_rows.append(r)

    total_awarded = 0
    total_nocopo_paid = 0
    non_comp = 0
    contractors_acc: dict[str, dict[str, Any]] = {}

    for r in awarded_rows:
        aw = max(0, int(round(float(r.get("contract_award_naira") or 0))))
        pd = max(0, int(round(float(r.get("total_paid_naira") or 0))))
        total_awarded += aw
        total_nocopo_paid += pd
        method = str(r.get("procurement_method") or "").strip()
        is_nc = _is_non_competitive(method)
        if is_nc:
            non_comp += 1

        cname = str(r.get("contractor_name") or "").strip()
        ckey = canonical_contractor_key(r.get("norm_contractor") or cname)
        if not cname and not ckey:
            continue

        lb = leaderboard_map.get(ckey)
        # Prefer exact leaderboard contractorName so static /datasets/contractor_history/<bucket>.json matches directly
        display_name = str(lb.get("contractorName") or "").strip() if lb else ""
        resolved_name = display_name or cname or ckey
        acc = contractors_acc.get(ckey)
        if acc is None:
            acc = {
                "contractorName": resolved_name,
                "bppContractorId": r.get("bpp_contractor_id") or (lb.get("bppContractorId") if lb else None),
                "awardCount": 0,
                "awardedNaira": 0,
                "nocopoDisbursedNaira": 0,
                "nonCompetitiveCount": 0,
                "methods": set(),
                "years": set(),
                "mdaCores": set(),
                "lb": lb,
            }
            contractors_acc[ckey] = acc

        acc["awardCount"] += 1
        acc["awardedNaira"] += aw
        acc["nocopoDisbursedNaira"] += pd
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

    # Compact ordered contracts list (awarded first sorted by award desc, then planning)
    awarded_sorted = sorted(
        awarded_rows,
        key=lambda x: (int(round(float(x.get("total_paid_naira") or 0))), int(round(float(x.get("contract_award_naira") or 0)))),
        reverse=True,
    )
    planning_sorted = sorted(
        planning_rows,
        key=lambda x: int(round(float(x.get("contract_award_naira") or 0))),
        reverse=True,
    )
    compact_contracts = []
    for r in (awarded_sorted + planning_sorted)[:max_contracts]:
        cname = str(r.get("contractor_name") or "").strip()
        ckey = canonical_contractor_key(r.get("norm_contractor") or cname)
        lb = leaderboard_map.get(ckey)
        resolved_c = (str(lb.get("contractorName") or "").strip() if lb else "") or cname or None
        compact_contracts.append(
            {
                "ocid": r.get("ocid") or "",
                "financialYear": int(r.get("financial_year") or 0),
                "stage": r.get("stage") or "",
                "title": str(r.get("title") or "")[:180],
                "mdaName": str(r.get("mda_name") or ""),
                "contractorName": resolved_c,
                "bppContractorId": r.get("bpp_contractor_id") or None,
                "awardNaira": max(0, int(round(float(r.get("contract_award_naira") or 0)))),
                "paidNaira": max(0, int(round(float(r.get("total_paid_naira") or 0)))),
                "awardDate": r.get("award_date") or None,
                "procurementMethod": r.get("procurement_method") or None,
            }
        )

    contractors_list: list[dict[str, Any]] = []
    vendor_mda_paid_total = 0
    vendor_mda_cnt_total = 0
    vendor_sample_pool: list[dict[str, Any]] = []

    for ckey, acc in contractors_acc.items():
        mda_candidates = set(acc["mdaCores"])
        if target_mda_core:
            mda_candidates.add(target_mda_core)

        m_cnt = 0
        m_amt = 0
        for mcore in mda_candidates:
            c_cnt, c_amt = gov_by_mda_ben.get((mcore, ckey), (0, 0))
            m_cnt += c_cnt
            m_amt += c_amt
            if c_cnt > 0:
                vendor_sample_pool.extend(vendor_mda_samples.get((mcore, ckey), ()))

        vendor_mda_paid_total += m_amt
        vendor_mda_cnt_total += m_cnt
        tot_cnt, tot_amt = gov_by_ben.get(ckey, (0, 0))
        lb = acc["lb"]

        c_entry: dict[str, Any] = {
            "contractorName": acc["contractorName"],
            "bppContractorId": acc["bppContractorId"],
            "awardCount": acc["awardCount"],
            "awardedNaira": acc["awardedNaira"],
            "nocopoDisbursedNaira": acc["nocopoDisbursedNaira"],
            "mdaGovspendCount": m_cnt,
            "mdaGovspendPaidNaira": m_amt,
            "totalGovspendCount": tot_cnt,
            "totalGovspendPaidNaira": tot_amt,
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

    if len(awarded_rows) > 0 and total_nocopo_paid > 0:
        noc_status = "AWARDED_AND_PAID"
    elif len(awarded_rows) > 0:
        noc_status = "AWARDED_UNPAID"
    elif len(planning_rows) > 0:
        noc_status = "PLANNING_OR_TENDER_ONLY"
    else:
        noc_status = "NO_PUBLIC_CONTRACT"

    nocopo_stage: dict[str, Any] = {
        "status": noc_status,
        "matchMethod": match_method if (awarded_rows or planning_rows) else "NONE",
        "confidenceScore": confidence if (awarded_rows or planning_rows) else 0.0,
        "awardedContractCount": len(awarded_rows),
        "planningCount": len(planning_rows),
        "totalAwardedNaira": total_awarded,
        "totalNocopoDisbursedNaira": total_nocopo_paid,
        "distinctContractorCount": len(contractors_acc),
        "nonCompetitiveCount": non_comp,
        "contractors": contractors_list[:8],
        "contracts": compact_contracts,
    }

    # Stage 5: Direct ERGP Open Treasury vouchers + Awarded-vendor MDA context
    direct_vouchers_seen: dict[str, dict[str, Any]] = {}
    direct_cnt = 0
    direct_amt = 0
    for uc in ucodes:
        dv = direct_by_code.get(uc)
        if not dv:
            continue
        direct_cnt += dv["count"]
        direct_amt += dv["totalNaira"]
        for v in dv["vouchers"]:
            v_key = f"{v['paymentNo']}|{v['beneficiaryName']}|{v['amountNaira']}"
            if v_key not in direct_vouchers_seen:
                direct_vouchers_seen[v_key] = v

    direct_vouchers_sorted = sorted(
        direct_vouchers_seen.values(), key=lambda v: (-int(v["amountNaira"]), str(v["paymentDate"]))
    )[:max_vouchers]

    vendor_vouchers_seen: dict[str, dict[str, Any]] = {}
    for v in vendor_sample_pool:
        v_key = f"{v['paymentNo']}|{v['beneficiaryName']}|{v['amountNaira']}"
        if v_key not in vendor_vouchers_seen:
            vendor_vouchers_seen[v_key] = v
    vendor_vouchers_sorted = sorted(
        vendor_vouchers_seen.values(), key=lambda v: (-int(v["amountNaira"]), str(v["paymentDate"]))
    )[:max_vouchers]

    if direct_cnt > 0:
        gov_status = "DIRECT_TREASURY_VOUCHERS"
    elif len(awarded_rows) > 0 and vendor_mda_cnt_total > 0:
        gov_status = "VENDOR_MDA_PAYOUTS_RECORDED"
    else:
        gov_status = "NO_TREASURY_VOUCHER_MATCH"

    govspend_stage: dict[str, Any] = {
        "status": gov_status,
        "directVoucherCount": direct_cnt,
        "directPaidNaira": direct_amt,
        "directVouchers": direct_vouchers_sorted,
        "vendorMdaVoucherCount": vendor_mda_cnt_total if len(awarded_rows) > 0 else 0,
        "vendorMdaPaidNaira": vendor_mda_paid_total if len(awarded_rows) > 0 else 0,
        "vendorMdaVouchers": vendor_vouchers_sorted if (direct_cnt == 0 and len(awarded_rows) > 0) else [],
    }

    pop = classify_paid_on_paper(
        total_nocopo_disbursed_naira=total_nocopo_paid,
        awarded_contract_count=len(awarded_rows),
        direct_govspend_paid_naira=direct_amt,
        direct_govspend_voucher_count=direct_cnt,
        vendor_mda_govspend_paid_naira=govspend_stage["vendorMdaPaidNaira"],
        vendor_mda_govspend_voucher_count=govspend_stage["vendorMdaVoucherCount"],
    )
    return nocopo_stage, govspend_stage, pop


def build_project_lifecycle_index(
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    policy_path: str | Path = DEFAULT_POLICY_PATH,
    execution_path: str | Path = DEFAULT_EXECUTION_PATH,
    diffs_dir: str | Path = DEFAULT_DIFFS_DIR,
    sweep_path: str | Path = DEFAULT_SWEEP_PATH,
    leaderboard_path: str | Path = DEFAULT_LEADERBOARD_PATH,
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    write: bool = True,
) -> dict[str, Any]:
    """Build static-first `project_lifecycle_index.json` and 64 FNV-1a shards."""
    ds_dir = Path(datasets_dir)
    p_file = Path(policy_path)
    e_file = Path(execution_path)
    d_dir = Path(diffs_dir)
    s_file = Path(sweep_path)
    lb_file = Path(leaderboard_path)
    db_file = Path(fts_sqlite_path)

    leaderboard_map = _load_canonical_leaderboard(lb_file)
    mtef_by_year = _build_mtef_by_year(p_file)
    bir_by_year = _build_bir_by_year(e_file)
    diff_cycles, diff_by_year_code, diff_by_id, diff_by_year_mda_title, all_diff_items = _load_diff_indexes(d_dir)
    diff_cycles_set = set(diff_cycles)

    # Load NOCOPO & GovSpend from SQLite
    nocopo_by_record_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    nocopo_by_code: dict[str, list[dict[str, Any]]] = defaultdict(list)
    awarded_inverted_idx: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    relevant_contractor_keys: set[str] = set()

    gov_by_ben: dict[str, tuple[int, int]] = {}
    gov_by_mda_ben: dict[tuple[str, str], tuple[int, int]] = {}
    direct_by_code_acc: dict[str, dict[str, Any]] = {}
    vendor_mda_heaps: dict[tuple[str, str], list[tuple[int, int, dict[str, Any]]]] = defaultdict(list)

    if db_file.exists():
        conn = sqlite3.connect(str(db_file))
        try:
            has_noc = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
            ).fetchone()
            if has_noc:
                for row in conn.execute(
                    """
                    SELECT ocid, financial_year, stage, title, mda_name, norm_mda,
                           contractor_name, norm_contractor, bpp_contractor_id,
                           contract_award_naira, total_paid_naira, award_date,
                           procurement_method, budget_record_id, project_code,
                           match_type, confidence_score
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
                        award_date,
                        method,
                        b_rec_id,
                        proj_code,
                        m_type,
                        conf,
                    ) = row
                    stage_low = str(stage or "").strip().lower()
                    core = mda_core_key(mda_name or norm_mda or "")
                    ucode = is_unique_project_code(proj_code)
                    title_ergps = extract_ergp_codes(title)
                    ckey = canonical_contractor_key(norm_contractor or contractor_name)

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
                        "award_date": str(award_date or "").strip() or None,
                        "procurement_method": str(method or ""),
                        "unique_code": ucode,
                        "match_type": str(m_type or ""),
                        "confidence_score": float(conf or 0.0),
                    }

                    codes_for_row: set[str] = set()
                    if ucode:
                        codes_for_row.add(ucode)
                    for tc in title_ergps:
                        codes_for_row.add(tc)
                    for c_key in codes_for_row:
                        nocopo_by_code[c_key].append(rec)

                    b_id = str(b_rec_id or "").strip().upper()
                    if b_id and (
                        str(m_type or "") == "EXACT_ERGP_CODE"
                        or float(conf or 0.0) >= 0.78
                        or stage_low in AWARDED_STAGES
                    ):
                        nocopo_by_record_id[b_id].append(rec)

                    if stage_low in AWARDED_STAGES:
                        if ckey:
                            relevant_contractor_keys.add(ckey)
                        if core:
                            tokens = _distinctive_tokens(rec["title"])
                            if len(tokens) >= 4:
                                rec["tokens"] = tokens
                                for tok in tokens:
                                    awarded_inverted_idx[(core, tok)].append(rec)

            has_gov = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
            ).fetchone()
            if has_gov:
                gov_ben_acc: dict[str, list[int]] = {}
                gov_mda_acc: dict[tuple[str, str], list[int]] = {}
                seq = 0

                for pay_no, pay_date, fy, org_name, norm_mda, ben_name, norm_ben, amt, desc in conn.execute(
                    """
                    SELECT payment_no, payment_date, financial_year, organization_name, norm_mda,
                           beneficiary_name, norm_beneficiary, COALESCE(amount_naira, 0), description
                    FROM govspend_payments
                    WHERE COALESCE(amount_naira, 0) > 0
                    """
                ):
                    seq += 1
                    amt_i = int(round(float(amt)))
                    ckey = canonical_contractor_key(norm_ben or ben_name)
                    core = mda_core_key(org_name or norm_mda or "")

                    if ckey:
                        gb = gov_ben_acc.get(ckey)
                        if gb is None:
                            gov_ben_acc[ckey] = [1, amt_i]
                        else:
                            gb[0] += 1
                            gb[1] += amt_i

                        if core:
                            pair = (core, ckey)
                            gm = gov_mda_acc.get(pair)
                            if gm is None:
                                gov_mda_acc[pair] = [1, amt_i]
                            else:
                                gm[0] += 1
                                gm[1] += amt_i

                            if ckey in relevant_contractor_keys:
                                v_row = {
                                    "paymentNo": str(pay_no or ""),
                                    "paymentDate": str(pay_date or ""),
                                    "financialYear": int(fy) if fy is not None and str(fy).isdigit() else 0,
                                    "organizationName": str(org_name or ""),
                                    "beneficiaryName": str(ben_name or ""),
                                    "amountNaira": amt_i,
                                    "description": str(desc or "")[:200],
                                }
                                _push_top_k(vendor_mda_heaps[pair], v_row, amt_i, seq, 5)

                    desc_s = str(desc or "")
                    if "ERGP" in desc_s.upper():
                        ergp_hits = extract_ergp_codes(desc_s)
                        if ergp_hits:
                            v_row = {
                                "paymentNo": str(pay_no or ""),
                                "paymentDate": str(pay_date or ""),
                                "financialYear": int(fy) if fy is not None and str(fy).isdigit() else 0,
                                "organizationName": str(org_name or ""),
                                "beneficiaryName": str(ben_name or ""),
                                "amountNaira": amt_i,
                                "description": desc_s[:220],
                            }
                            for ec in ergp_hits:
                                acc = direct_by_code_acc.get(ec)
                                if acc is None:
                                    acc = {"count": 0, "totalNaira": 0, "heap": []}
                                    direct_by_code_acc[ec] = acc
                                acc["count"] += 1
                                acc["totalNaira"] += amt_i
                                _push_top_k(acc["heap"], v_row, amt_i, seq, 8)

                gov_by_ben = {k: (v[0], v[1]) for k, v in gov_ben_acc.items()}
                gov_by_mda_ben = {k: (v[0], v[1]) for k, v in gov_mda_acc.items()}
        finally:
            conn.close()

    direct_by_code: dict[str, dict[str, Any]] = {}
    for ec, acc in direct_by_code_acc.items():
        vouchers = [x[2] for x in sorted(acc["heap"], key=lambda t: (-t[0], -t[1]))]
        direct_by_code[ec] = {
            "count": acc["count"],
            "totalNaira": acc["totalNaira"],
            "vouchers": vouchers,
        }

    vendor_mda_samples: dict[tuple[str, str], list[dict[str, Any]]] = {
        pair: [x[2] for x in sorted(heap, key=lambda t: (-t[0], -t[1]))]
        for pair, heap in vendor_mda_heaps.items()
    }

    shards: list[dict[str, dict[str, Any]]] = [
        {"byRecordId": {}, "byCode": {}} for _ in range(64)
    ]

    seen_record_ids: set[str] = set()
    seen_unique_codes: set[str] = set()
    bir_matched_count = 0
    mtef_matched_count = 0
    paid_on_paper_count = 0
    direct_project_paid_count = 0
    vendor_mda_paid_count = 0
    nocopo_awarded_count = 0
    nocopo_disbursed_count = 0
    nocopo_planning_only_count = 0
    direct_govspend_ergp_count = 0
    bill_diff_linked_count = 0
    total_awarded_naira = 0
    total_nocopo_disbursed_naira = 0
    total_direct_govspend_naira = 0
    priority_heap: list[tuple[int, int, dict[str, Any]]] = []
    rec_seq = 0

    def _process_candidate_record(
        rec_id: str,
        fy: int,
        raw_code: str,
        title: str,
        agency: str,
        amount_naira: int,
        page: int,
        *,
        force_emit_if_linked: bool = True,
        allow_fuzzy_nocopo: bool = True,
    ) -> tuple[dict[str, Any] | None, dict[str, Any]]:
        nonlocal bir_matched_count, mtef_matched_count, paid_on_paper_count
        nonlocal direct_project_paid_count, vendor_mda_paid_count
        nonlocal nocopo_awarded_count, nocopo_disbursed_count, nocopo_planning_only_count
        nonlocal direct_govspend_ergp_count, bill_diff_linked_count
        nonlocal total_awarded_naira, total_nocopo_disbursed_naira, total_direct_govspend_naira
        nonlocal rec_seq

        rec_id_up = str(rec_id or "").strip().upper()
        core_mda = mda_core_key(agency)
        ucode = is_unique_project_code(raw_code)
        ucodes: list[str] = []
        if ucode:
            ucodes.append(ucode)
        for tc in extract_ergp_codes(title):
            if tc not in ucodes:
                ucodes.append(tc)

        bir_stage = match_bir_mda(bir_by_year.get(str(fy)), agency)
        bill_diff_stage = _resolve_bill_diff_stage(
            fy,
            rec_id_up,
            ucodes[0] if ucodes else "",
            title,
            core_mda,
            diff_cycles_set,
            diff_by_year_code,
            diff_by_id,
            diff_by_year_mda_title,
        )

        # Match NOCOPO
        matched_rows: list[dict[str, Any]] = []
        match_method = "NONE"
        confidence = 0.0

        code_hits: list[dict[str, Any]] = []
        for uc in ucodes:
            if uc in nocopo_by_code:
                code_hits.extend(nocopo_by_code[uc])

        if code_hits:
            matched_rows = code_hits
            match_method = "EXACT_ERGP_CODE"
            confidence = 1.0
        elif rec_id_up and rec_id_up in nocopo_by_record_id:
            matched_rows = nocopo_by_record_id[rec_id_up]
            top_hit = matched_rows[0]
            match_method = (
                "EXACT_ERGP_CODE"
                if top_hit.get("match_type") == "EXACT_ERGP_CODE"
                else "FUZZY_MDA_TITLE"
            )
            confidence = round(max(float(r.get("confidence_score") or 0.85) for r in matched_rows), 4)
        elif allow_fuzzy_nocopo and core_mda:
            fuzzy_rows, best_s = _match_fuzzy_candidates(
                title, core_mda, fy, fy, awarded_inverted_idx
            )
            if fuzzy_rows:
                matched_rows = fuzzy_rows
                match_method = "FUZZY_MDA_TITLE"
                confidence = best_s

        nocopo_stage, govspend_stage, pop = _aggregate_lifecycle_execution(
            matched_rows,
            match_method,
            confidence,
            core_mda,
            ucodes,
            gov_by_ben,
            gov_by_mda_ben,
            direct_by_code,
            vendor_mda_samples,
            leaderboard_map,
        )
        paid_priority, paid_tier, paid_reason, verified_disbursed = pop

        has_nocopo = nocopo_stage["awardedContractCount"] > 0 or nocopo_stage["planningCount"] > 0
        has_direct_gov = govspend_stage["directVoucherCount"] > 0
        has_bill_diff = bill_diff_stage["status"] not in ("NO_BILL_DIFF_CYCLE", "NOT_IN_ALTERED_DIFF")

        if bir_stage["status"] == "MATCHED_MDA":
            bir_matched_count += 1
        if mtef_by_year.get(str(fy), {}).get("status") == "EXACT_YEAR_MTEF":
            mtef_matched_count += 1

        entry: dict[str, Any] | None = None
        if force_emit_if_linked and (has_nocopo or has_direct_gov or has_bill_diff):
            if rec_id_up and rec_id_up not in seen_record_ids:
                seen_record_ids.add(rec_id_up)
                if ucodes:
                    seen_unique_codes.add(ucodes[0])

                if has_bill_diff:
                    bill_diff_linked_count += 1
                if nocopo_stage["awardedContractCount"] > 0:
                    nocopo_awarded_count += 1
                    total_awarded_naira += nocopo_stage["totalAwardedNaira"]
                    if nocopo_stage["totalNocopoDisbursedNaira"] > 0:
                        nocopo_disbursed_count += 1
                        total_nocopo_disbursed_naira += nocopo_stage["totalNocopoDisbursedNaira"]
                elif nocopo_stage["planningCount"] > 0:
                    nocopo_planning_only_count += 1

                if has_direct_gov:
                    direct_govspend_ergp_count += 1
                    total_direct_govspend_naira += govspend_stage["directPaidNaira"]

                if paid_priority:
                    paid_on_paper_count += 1
                    if paid_tier == "DIRECT_PROJECT_PAID":
                        direct_project_paid_count += 1
                        rec_seq += 1
                        summary_item = {
                            "recordId": rec_id_up,
                            "financialYear": fy,
                            "projectCode": raw_code or (ucodes[0] if ucodes else ""),
                            "projectName": title[:160],
                            "agency": agency,
                            "page": page,
                            "allocatedNaira": amount_naira,
                            "awardedNaira": nocopo_stage["totalAwardedNaira"],
                            "nocopoDisbursedNaira": nocopo_stage["totalNocopoDisbursedNaira"],
                            "directGovspendNaira": govspend_stage["directPaidNaira"],
                            "verifiedDisbursedNaira": verified_disbursed,
                            "contractorName": (
                                nocopo_stage["contractors"][0]["contractorName"]
                                if nocopo_stage["contractors"]
                                else (
                                    govspend_stage["directVouchers"][0]["beneficiaryName"]
                                    if govspend_stage["directVouchers"]
                                    else None
                                )
                            ),
                            "birReleasePct": bir_stage.get("releasePct"),
                            "billDiffStatus": bill_diff_stage["status"],
                        }
                        _push_top_k(priority_heap, summary_item, verified_disbursed, rec_seq, 60)
                    else:
                        vendor_mda_paid_count += 1

                entry = {
                    "recordId": rec_id_up,
                    "financialYear": fy,
                    "projectCode": raw_code or (ucodes[0] if ucodes else ""),
                    "projectName": title[:220],
                    "agency": agency,
                    "amountNaira": amount_naira,
                    "page": page,
                    "paidOnPaperPriority": paid_priority,
                    "paidOnPaperTier": paid_tier,
                    "paidOnPaperReason": paid_reason,
                    "verifiedDisbursedNaira": verified_disbursed,
                    "billDiff": bill_diff_stage,
                    "bir": bir_stage,
                    "nocopo": nocopo_stage,
                    "govspend": govspend_stage,
                }
                bucket = int(shard_bucket_for_key(rec_id_up))
                shards[bucket]["byRecordId"][rec_id_up] = entry

                for uc in ucodes:
                    cb = int(shard_bucket_for_key(uc))
                    existing_code = shards[cb]["byCode"].get(uc)
                    if existing_code is None or (
                        entry["verifiedDisbursedNaira"] > existing_code.get("verifiedDisbursedNaira", 0)
                        or nocopo_stage["awardedContractCount"] > existing_code.get("nocopo", {}).get("awardedContractCount", 0)
                    ):
                        shards[cb]["byCode"][uc] = {
                            "projectCode": uc,
                            "recordId": rec_id_up,
                            "financialYear": fy,
                            "paidOnPaperPriority": paid_priority,
                            "paidOnPaperTier": paid_tier,
                            "paidOnPaperReason": paid_reason,
                            "verifiedDisbursedNaira": verified_disbursed,
                            "billDiff": bill_diff_stage,
                            "nocopo": nocopo_stage,
                            "govspend": govspend_stage,
                        }

        return entry, {
            "birStage": bir_stage,
            "billDiffStage": bill_diff_stage,
            "nocopoStage": nocopo_stage,
            "govspendStage": govspend_stage,
            "paidPriority": paid_priority,
            "paidTier": paid_tier,
            "verifiedDisbursed": verified_disbursed,
        }

    # 1. Scan all enacted annual schedules (`public/datasets/*/projects.min.json`)
    year_dirs = sorted(
        (p for p in ds_dir.iterdir() if p.is_dir() and p.name.isdigit() and (p / "projects.min.json").exists()),
        key=lambda p: int(p.name),
    )
    for ydir in year_dirs:
        fy = int(ydir.name)
        items = json.loads((ydir / "projects.min.json").read_text(encoding="utf-8"))
        for it in items:
            rid = str(it.get("id") or "").strip()
            if not rid:
                continue
            raw_code = str(it.get("projectCode") or "").strip()
            title = str(it.get("projectName") or "").strip()
            agency = str(it.get("agency") or it.get("ministry") or "").strip()
            amt = int(round(float(it.get("amount") or 0)))
            pg = int(it.get("page") or 1)
            # Only scan fuzzy NOCOPO if agency exists; projects.min.json has ~559k items,
            # indexed inverted lookup makes fuzzy check O(tokens) fast.
            _process_candidate_record(
                rid, fy, raw_code, title, agency, amt, pg,
                force_emit_if_linked=True,
                allow_fuzzy_nocopo=True,
            )

    # 2. Ensure all Bill-vs-Act Diff items (including REMOVED_IN_ACT items absent from enacted JSON) are indexed
    for diff_it in all_diff_items:
        did = diff_it["id"]
        if did and did not in seen_record_ids:
            amt = diff_it["enactedAmountNaira"] or diff_it["proposedAmountNaira"]
            pg = int(diff_it["actPage"] or diff_it["billPage"] or 1)
            _process_candidate_record(
                did,
                diff_it["financialYear"],
                diff_it["projectCode"],
                diff_it["projectName"],
                diff_it["mdaName"],
                amt,
                pg,
                force_emit_if_linked=True,
                allow_fuzzy_nocopo=True,
            )

    # 3. Also ensure any unique NOCOPO or Direct GovSpend code not attached to a projects.min record is available under byCode
    all_raw_codes = set(nocopo_by_code.keys()) | set(direct_by_code.keys())
    for uc in sorted(all_raw_codes):
        if uc in seen_unique_codes:
            continue
        cb = int(shard_bucket_for_key(uc))
        if uc in shards[cb]["byCode"]:
            continue
        rows = nocopo_by_code.get(uc, [])
        sample_mda = rows[0].get("mda_name") if rows else ""
        sample_yr = rows[0].get("financial_year") if rows else 0
        nocopo_s, gov_s, pop = _aggregate_lifecycle_execution(
            rows,
            "EXACT_ERGP_CODE" if rows else "NONE",
            1.0 if rows else 0.0,
            mda_core_key(sample_mda or ""),
            [uc],
            gov_by_ben,
            gov_by_mda_ben,
            direct_by_code,
            vendor_mda_samples,
            leaderboard_map,
        )
        paid_priority, paid_tier, paid_reason, verified_disbursed = pop
        shards[cb]["byCode"][uc] = {
            "projectCode": uc,
            "recordId": None,
            "financialYear": int(sample_yr or 0),
            "paidOnPaperPriority": paid_priority,
            "paidOnPaperTier": paid_tier,
            "paidOnPaperReason": paid_reason,
            "verifiedDisbursedNaira": verified_disbursed,
            "billDiff": None,
            "nocopo": nocopo_s,
            "govspend": gov_s,
        }

    # 4. Build `scrutinyBadges` from `forensic_sweep_1999_2026.json`
    scrutiny_badges: dict[str, dict[str, Any]] = {}
    scrutiny_items_scanned = 0
    scrutiny_paid_ids: set[str] = set()

    if s_file.exists():
        sweep = json.loads(s_file.read_text(encoding="utf-8"))
        sweep_items: list[dict[str, Any]] = []
        pillars = sweep.get("pillars") or {}
        for p_val in pillars.values():
            if not isinstance(p_val, dict):
                continue
            for list_k in ("items", "withinYearClusters", "crossYearClusters", "clusters", "codes"):
                arr = p_val.get(list_k) or []
                if list_k == "items":
                    sweep_items.extend(arr)
                elif list_k in ("withinYearClusters", "crossYearClusters"):
                    for cl in arr:
                        sweep_items.extend(cl.get("items") or [])
                elif list_k == "clusters":
                    for cl in arr:
                        sweep_items.extend(cl.get("sampleItems") or [])
                elif list_k == "codes":
                    for cd in arr:
                        sweep_items.extend(cd.get("topItems") or [])

        seen_sweep_ids: set[str] = set()
        for sit in sweep_items:
            sid = str(sit.get("id") or "").strip().upper()
            fy = int(sit.get("financialYear") or 0)
            if not sid or not fy:
                continue
            badge_key = f"{fy}:{sid}"
            if badge_key in seen_sweep_ids:
                continue
            seen_sweep_ids.add(badge_key)
            scrutiny_items_scanned += 1

            raw_code = str(sit.get("projectCode") or "").strip()
            title = str(sit.get("projectName") or "").strip()
            agency = str(sit.get("agency") or "").strip()
            amt = int(round(float(sit.get("amount") or 0)))
            pg = int(sit.get("page") or 1)

            # Reuse already-sharded record if linked; otherwise synthesize lightweight view without inflating shards
            sb = int(shard_bucket_for_key(sid))
            sharded = shards[sb]["byRecordId"].get(sid)
            if sharded:
                noc = sharded["nocopo"]
                gov = sharded["govspend"]
                bd = sharded["billDiff"]
                bir = sharded["bir"]
                paid_p = sharded["paidOnPaperPriority"]
                paid_t = sharded["paidOnPaperTier"]
            else:
                _, diag = _process_candidate_record(
                    sid, fy, raw_code, title, agency, amt, pg,
                    force_emit_if_linked=False,
                    allow_fuzzy_nocopo=True,
                )
                noc = diag["nocopoStage"]
                gov = diag["govspendStage"]
                bd = diag["billDiffStage"]
                bir = diag["birStage"]
                paid_p = diag["paidPriority"]
                paid_t = diag["paidTier"]

            has_signal = (
                paid_p
                or noc["awardedContractCount"] > 0
                or noc["planningCount"] > 0
                or gov["directVoucherCount"] > 0
                or bd["status"] not in ("NO_BILL_DIFF_CYCLE", "NOT_IN_ALTERED_DIFF")
                or bir["status"] == "MATCHED_MDA"
            )
            if not has_signal:
                continue

            if paid_p:
                scrutiny_paid_ids.add(sid)

            badge = {
                "paidOnPaperPriority": paid_p,
                "paidOnPaperTier": paid_t,
                "nocopoStatus": noc["status"],
                "awardedNaira": noc["totalAwardedNaira"],
                "nocopoDisbursedNaira": noc["totalNocopoDisbursedNaira"],
                "directGovspendNaira": gov["directPaidNaira"],
                "vendorMdaPaidNaira": gov["vendorMdaPaidNaira"],
                "contractorName": noc["contractors"][0]["contractorName"] if noc["contractors"] else None,
                "billDiffStatus": bd["status"],
                "billDeltaPct": bd.get("deltaPct"),
                "birStatus": bir["status"],
                "birReleasePct": bir.get("releasePct"),
            }
            scrutiny_badges[sid] = badge
            uc = is_unique_project_code(raw_code)
            if uc and uc not in scrutiny_badges:
                scrutiny_badges[uc] = badge

    # 5. Enforce < 2.5 MB per shard before writing
    shards_dir = ds_dir / "project_lifecycle"
    max_shard_bytes = 0
    for idx, shard_payload in enumerate(shards):
        encoded = json.dumps(shard_payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(encoded) > MAX_SHARD_BYTES:
            for section in ("byRecordId", "byCode"):
                for rec in shard_payload[section].values():
                    if isinstance(rec.get("nocopo"), dict):
                        rec["nocopo"]["contracts"] = rec["nocopo"].get("contracts", [])[:5]
                        rec["nocopo"]["contractors"] = rec["nocopo"].get("contractors", [])[:5]
                    if isinstance(rec.get("govspend"), dict):
                        rec["govspend"]["directVouchers"] = rec["govspend"].get("directVouchers", [])[:4]
                        rec["govspend"]["vendorMdaVouchers"] = rec["govspend"].get("vendorMdaVouchers", [])[:3]
            encoded = json.dumps(shard_payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        if len(encoded) > max_shard_bytes:
            max_shard_bytes = len(encoded)
        if write:
            shards_dir.mkdir(parents=True, exist_ok=True)
            _atomic_write_json(shards_dir / f"{idx:02d}.json", shard_payload)

    priority_records = [x[2] for x in sorted(priority_heap, key=lambda t: (-t[0], -t[1]))]

    index_payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_PROJECT_LIFECYCLE",
        "shardCount": 64,
        "shardDir": "/datasets/project_lifecycle",
        "diffCyclesAvailable": diff_cycles,
        "summary": {
            "totalLinkedRecords": len(seen_record_ids),
            "uniqueLinkedCodes": len(seen_unique_codes),
            "paidOnPaperCount": paid_on_paper_count,
            "directProjectPaidCount": direct_project_paid_count,
            "vendorMdaPaidCount": vendor_mda_paid_count,
            "nocopoAwardedCount": nocopo_awarded_count,
            "nocopoDisbursedCount": nocopo_disbursed_count,
            "nocopoPlanningOnlyCount": nocopo_planning_only_count,
            "directGovspendErgpCount": direct_govspend_ergp_count,
            "billDiffLinkedCount": bill_diff_linked_count,
            "birMdaMatchedCount": bir_matched_count,
            "mtefMatchedCount": mtef_matched_count,
            "totalAwardedNaira": total_awarded_naira,
            "totalNocopoDisbursedNaira": total_nocopo_disbursed_naira,
            "totalDirectGovspendNaira": total_direct_govspend_naira,
            "scrutinyItemsScanned": scrutiny_items_scanned,
            "scrutinyBadgeCount": len(scrutiny_badges),
            "scrutinyPaidOnPaperCount": len(scrutiny_paid_ids),
            "maxShardBytes": max_shard_bytes,
        },
        "mtefByYear": mtef_by_year,
        "birByYear": bir_by_year,
        "priorityRecords": priority_records,
        "scrutinyBadges": scrutiny_badges,
    }

    if write:
        _atomic_write_json(ds_dir / "project_lifecycle_index.json", index_payload)

    return index_payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build Unified 5-Stage Project Lifecycle Timeline & Shards (P3-S2)."
    )
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    parser.add_argument("--policy", type=Path, default=DEFAULT_POLICY_PATH)
    parser.add_argument("--execution", type=Path, default=DEFAULT_EXECUTION_PATH)
    parser.add_argument("--diffs-dir", type=Path, default=DEFAULT_DIFFS_DIR)
    parser.add_argument("--sweep", type=Path, default=DEFAULT_SWEEP_PATH)
    parser.add_argument("--leaderboard", type=Path, default=DEFAULT_LEADERBOARD_PATH)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    args = parser.parse_args()

    res = build_project_lifecycle_index(
        datasets_dir=args.datasets_dir,
        policy_path=args.policy,
        execution_path=args.execution,
        diffs_dir=args.diffs_dir,
        sweep_path=args.sweep,
        leaderboard_path=args.leaderboard,
        fts_sqlite_path=args.sqlite,
        write=True,
    )
    idx_path = args.datasets_dir / "project_lifecycle_index.json"
    idx_kb = idx_path.stat().st_size / 1024.0 if idx_path.exists() else 0.0
    s = res["summary"]
    print(
        f"Project Lifecycle [{res['status']}]: linked={s['totalLinkedRecords']} "
        f"(paidOnPaper={s['paidOnPaperCount']}, directPaid={s['directProjectPaidCount']}, "
        f"vendorMdaPaid={s['vendorMdaPaidCount']}, nocopoAwarded={s['nocopoAwardedCount']}, "
        f"directGovErgp={s['directGovspendErgpCount']}, billDiff={s['billDiffLinkedCount']}) | "
        f"scrutinyBadges={s['scrutinyBadgeCount']} (paidOnPaper={s['scrutinyPaidOnPaperCount']}) | "
        f"index={idx_kb:.1f} KB | maxShard={s['maxShardBytes']/1024:.1f} KB"
    )


if __name__ == "__main__":
    main()
