"""Composite MDA Integrity Scorecard & Macro Credibility Tracker Builder (Phase 3 · Stage P3-S6).

Generates two 100% static offline datasets under `public/datasets/`:
  1. `mda_integrity_scorecards.json`
     Open-formula 5-pillar MDA accountability scorecard joining:
       - Pillar 1 (`paddingRestraint`, weight 20): `bill_act_diffs/*.json` (2017–2025 cycles)
       - Pillar 2 (`birCapitalExecution`, weight 20): `execution_tracker.json` (2009–2026 BIR)
       - Pillar 3 (`openBiddingShare`, weight 20): `nocopo_contracts` AWARDED stages ONLY
       - Pillar 4 (`vendorDiversification`, weight 20): `nocopo_contracts` AWARDED vendor HHI
       - Pillar 5 (`cashDiscipline`, weight 20): `govspend_payments` Dec Rush + thresholds + splits
     Missing/insufficient pillars carry `score: None` and are STRICTLY OMITTED from
     that MDA's active weight denominator — never scored as `0`.

  2. `macro_credibility_tracker.json`
     "Promise vs. Reality" 2009–2026 macro execution series & 5-President rollups joining:
       - MTEF/FSP & enacted budget macro assumptions (`policy_benchmarks.json`, `macro_narratives_summary.json`)
       - BIR macro budget performance (`execution_tracker.json`, with FY 2015 Dom+For Debt Service guard)
       - Realized CBN/DMO FX & Total Public Debt Stock (`debt_profile.json`)
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import statistics
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.follow_the_money_builder import (
    AWARDED_STAGES,
    _atomic_write_json,
)
from ingestion.indexers.govspend_forensics_builder import DEFAULT_THRESHOLD_TIERS
from ingestion.indexers.procurement_risk_builder import (
    classify_procurement_method,
    is_sandbox_or_test_procurement,
)
from ingestion.indexers.project_lifecycle_builder import (
    _build_bir_by_year,
    _build_mtef_by_year,
    canonical_contractor_key,
    classify_parent_ministry_families,
)
from ingestion.parsers.entity_normalizer import (
    clean_display_name,
    mda_core_key,
    normalize_mda_name,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"

_TRAILING_PUNCT_RE = re.compile(r"[\s\-–—:,;/]+$")
_EXTRA_MDA_SUFFIX_RE = re.compile(
    r"(?:\s*-\s*MOD(?:\s+HQTRS)?|\bMOD\s+HQTRS\b)",
    flags=re.IGNORECASE,
)
_NOISE_MDA_RE = re.compile(
    r"^(?:KM\s*\d|LOT\s+\d|PHASE\s+\d|UNSPECIFIED|UNKNOWN|N/?A|NONE|TOTAL|\d[\d\s\+\-\.]*$)",
    re.IGNORECASE,
)

# Presidential administration scopes aligned with src/data/presidentialTerms.ts
PRESIDENTIAL_ADMIN_SCOPES: list[dict[str, Any]] = [
    {
        "presidentId": "obasanjo",
        "presidentName": "Olusegun Obasanjo",
        "shortName": "Obasanjo",
        "party": "PDP",
        "tenureLabel": "1999–2007 (2 Terms)",
        "budgetYears": [1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006],
    },
    {
        "presidentId": "yaradua",
        "presidentName": "Umaru Musa Yar'Adua",
        "shortName": "Yar'Adua",
        "party": "PDP",
        "tenureLabel": "2007–2010 (1 Term)",
        "budgetYears": [2007, 2008, 2009, 2010],
    },
    {
        "presidentId": "jonathan",
        "presidentName": "Goodluck Ebele Jonathan",
        "shortName": "Jonathan",
        "party": "PDP",
        "tenureLabel": "2010–2015 (Term 2011–14)",
        "budgetYears": [2011, 2012, 2013, 2014],
    },
    {
        "presidentId": "buhari",
        "presidentName": "Muhammadu Buhari",
        "shortName": "Buhari",
        "party": "APC",
        "tenureLabel": "2015–2023 (2 Terms)",
        "budgetYears": [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
    },
    {
        "presidentId": "tinubu",
        "presidentName": "Bola Ahmed Tinubu",
        "shortName": "Tinubu",
        "party": "APC",
        "tenureLabel": "2023–Present (Term 1)",
        "budgetYears": [2023, 2024, 2025, 2026],
    },
]

PILLAR_DEFINITIONS: list[dict[str, Any]] = [
    {
        "key": "paddingRestraint",
        "label": "Legislative Padding Restraint",
        "shortLabel": "Padding",
        "weight": 20,
        "sourceLabel": "Executive Bill vs. Enacted Act Diffs (2017–2025)",
        "formula": "100 - min(100, positivePaddingNaira / max(auditedEnactedNaira, positivePaddingNaira) * 100)",
        "minSampleRule": "At least 1 matched Bill vs. Act cycle with positive proposed/enacted volume",
    },
    {
        "key": "birCapitalExecution",
        "label": "BIR Capital Execution",
        "shortLabel": "BIR Exec",
        "weight": 20,
        "sourceLabel": "Budget Implementation Reports (2009–2026)",
        "formula": "Mean annual (0.60 * min(release%, 100) + 0.40 * min(utilization%, 100)), falling back to single reported % when only release or utilization exists",
        "minSampleRule": "At least 1 verified BIR year with valid denominator (FY 2010–2011 zero-appropriated rows guarded)",
    },
    {
        "key": "openBiddingShare",
        "label": "Competitive Open Bidding",
        "shortLabel": "Open Bid",
        "weight": 20,
        "sourceLabel": "NOCOPO Awarded Contracts (award/contract/implementation)",
        "formula": "openBiddingAwardedNaira / methodKnownAwardedNaira * 100 (planning & tender stages strictly excluded)",
        "minSampleRule": "Minimum 3 awarded contracts with specified procurement method",
    },
    {
        "key": "vendorDiversification",
        "label": "Vendor Diversification (1 - HHI)",
        "shortLabel": "HHI Spread",
        "weight": 20,
        "sourceLabel": "NOCOPO Awarded Contracts (award/contract/implementation)",
        "formula": "(1 - sum((vendorAward / totalAward)^2)) * 100",
        "minSampleRule": "Minimum 3 priced awarded contracts with identified contractor names",
    },
    {
        "key": "cashDiscipline",
        "label": "Treasury Cash Discipline",
        "shortLabel": "Cash Disc.",
        "weight": 20,
        "sourceLabel": "GovSpend Open Treasury Vouchers (2018–2026)",
        "formula": "100 - (DecRushPenalty[<=40] + NearThresholdPenalty[<=30] + Rolling7DaySplitPenalty[<=30])",
        "minSampleRule": "Minimum 20 positive cash vouchers (Dec Rush computed only on full-year Dec 2019–2025 controls)",
    },
]

_REVERSE_TIERS = tuple(sorted(DEFAULT_THRESHOLD_TIERS, reverse=True))


def _canonical_mda_key(raw_mda: str | None) -> str:
    cleaned = _TRAILING_PUNCT_RE.sub("", str(raw_mda or "").strip())
    cleaned = _EXTRA_MDA_SUFFIX_RE.sub("", cleaned).strip()
    cleaned = _TRAILING_PUNCT_RE.sub("", cleaned)
    if not cleaned:
        return ""
    return mda_core_key(cleaned)


def _clean_mda_display_name(raw_mda: str | None) -> str:
    return clean_display_name(raw_mda).upper()


def _is_valid_mda_candidate(raw_mda: str | None, key: str) -> bool:
    if not key or len(key) < 3:
        return False
    if is_sandbox_or_test_procurement(raw_mda):
        return False
    cleaned = str(raw_mda or "").strip()
    if _NOISE_MDA_RE.match(cleaned) or _NOISE_MDA_RE.match(key):
        return False
    # Ignore pure code/numeric fragments
    if not re.search(r"[A-Z]{3,}", key):
        return False
    return True


def _pick_preferred_display_name(names_counter: dict[str, int], fallback_key: str) -> str:
    if not names_counter:
        return fallback_key

    def _rank(item: tuple[str, int]) -> tuple[int, int, int, int]:
        name, cnt = item
        up = name.upper()
        # Prefer full MINISTRY / COMMISSION / AGENCY names without HQTRS suffix truncation
        is_hq_suffix = 1 if ("HQTRS" in up or up.endswith(" -")) else 0
        has_institution_kw = 1 if re.search(r"\b(?:MINISTRY|COMMISSION|AGENCY|AUTHORITY|OFFICE|ADMINISTRATION|SERVICE|BUREAU|BOARD|INSTITUTE|UNIVERSITY|HOSPITAL|CORP)\b", up) else 0
        return (has_institution_kw, -is_hq_suffix, cnt, len(up))

    return max(names_counter.items(), key=_rank)[0]


def score_to_grade(score: float | None) -> str:
    if score is None:
        return "N/A"
    if score >= 80.0:
        return "A"
    if score >= 65.0:
        return "B"
    if score >= 50.0:
        return "C"
    if score >= 35.0:
        return "D"
    return "F"


def compute_composite_score(pillars: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Compute weighted composite score omitting uncovered (`score is None`) pillars from denominator."""
    total_expected = len(PILLAR_DEFINITIONS)
    weighted_sum = 0.0
    active_weight_sum = 0
    metrics_present = 0

    for pdef in PILLAR_DEFINITIONS:
        p = pillars.get(pdef["key"])
        if not p:
            continue
        sc = p.get("score")
        wt = int(p.get("weight", pdef["weight"]))
        if sc is not None and wt > 0:
            weighted_sum += float(sc) * wt
            active_weight_sum += wt
            metrics_present += 1

    composite = round(weighted_sum / active_weight_sum, 1) if active_weight_sum > 0 else None
    if metrics_present >= 5:
        tier = "FULL_5_PILLAR"
    elif metrics_present == 4:
        tier = "STRONG_4_PILLAR"
    elif metrics_present >= 2:
        tier = "PARTIAL_2_3_PILLAR"
    elif metrics_present == 1:
        tier = "SINGLE_PILLAR"
    else:
        tier = "UNSCORED"

    return {
        "compositeScore": composite,
        "grade": score_to_grade(composite),
        "metricsPresent": metrics_present,
        "totalExpectedMetrics": total_expected,
        "activeWeightSum": active_weight_sum,
        "coverageTier": tier,
    }


def _collect_padding_restraint(diffs_dir: Path) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, int]]]:
    """Aggregate Bill vs. Act legislative padding per canonical MDA across all cycles."""
    name_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    # Per (key, fy): track item-level totals and topPaddedMdas totals
    by_key_fy: dict[str, dict[int, dict[str, int]]] = defaultdict(dict)

    if not diffs_dir.exists():
        return {}, name_counts

    for jf in sorted(diffs_dir.glob("*.json")):
        if jf.name == "index.json" or not jf.stem.isdigit():
            continue
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:
            continue
        fy = int(data.get("financialYear") or jf.stem)

        for it in data.get("items") or []:
            raw_mda = str(it.get("mdaName") or "").strip()
            key = _canonical_mda_key(raw_mda)
            if not _is_valid_mda_candidate(raw_mda, key):
                continue
            disp = _clean_mda_display_name(raw_mda)
            name_counts[key][disp] += 1

            bucket = by_key_fy[key].get(fy)
            if bucket is None:
                bucket = {
                    "enactedNaira": 0,
                    "proposedNaira": 0,
                    "positivePaddingNaira": 0,
                    "insertionsNaira": 0,
                    "inflatedNaira": 0,
                    "cutNaira": 0,
                    "alteredCount": 0,
                }
                by_key_fy[key][fy] = bucket

            enacted = int(round(float(it.get("enactedAmountNaira") or 0)))
            proposed = int(round(float(it.get("proposedAmountNaira") or 0)))
            delta = int(round(float(it.get("deltaNaira") or 0)))
            status = str(it.get("status") or "")

            bucket["enactedNaira"] += max(0, enacted)
            bucket["proposedNaira"] += max(0, proposed)
            if status in ("INSERTED_BY_NASS", "INFLATED_BY_NASS") and delta > 0:
                bucket["positivePaddingNaira"] += delta
                bucket["alteredCount"] += 1
                if status == "INSERTED_BY_NASS":
                    bucket["insertionsNaira"] += delta
                else:
                    bucket["inflatedNaira"] += delta
            elif status in ("CUT_BY_NASS", "REMOVED_BY_NASS") and delta < 0:
                bucket["cutNaira"] += abs(delta)

        # Merge full-cycle topPaddedMdas summary when it exceeds the 1600-item sample slice
        for tm in data.get("topPaddedMdas") or []:
            raw_mda = str(tm.get("mdaName") or "").strip()
            key = _canonical_mda_key(raw_mda)
            if not _is_valid_mda_candidate(raw_mda, key):
                continue
            disp = _clean_mda_display_name(raw_mda)
            name_counts[key][disp] += 5

            bucket = by_key_fy[key].get(fy)
            if bucket is None:
                bucket = {
                    "enactedNaira": 0,
                    "proposedNaira": 0,
                    "positivePaddingNaira": 0,
                    "insertionsNaira": 0,
                    "inflatedNaira": 0,
                    "cutNaira": 0,
                    "alteredCount": 0,
                }
                by_key_fy[key][fy] = bucket

            tot_pos = int(round(float(tm.get("totalPositivePaddingNaira") or 0)))
            ins = int(round(float(tm.get("insertionsNaira") or 0)))
            inf = int(round(float(tm.get("inflatedDeltaNaira") or 0)))
            cut = int(round(float(tm.get("cutDeltaNaira") or 0)))
            alt = int(round(float(tm.get("alteredCount") or 0)))

            if tot_pos > bucket["positivePaddingNaira"]:
                bucket["positivePaddingNaira"] = tot_pos
                bucket["insertionsNaira"] = max(bucket["insertionsNaira"], ins)
                bucket["inflatedNaira"] = max(bucket["inflatedNaira"], inf)
            bucket["cutNaira"] = max(bucket["cutNaira"], cut)
            bucket["alteredCount"] = max(bucket["alteredCount"], alt)

    out: dict[str, dict[str, Any]] = {}
    for key, fy_map in by_key_fy.items():
        enacted_sum = sum(v["enactedNaira"] for v in fy_map.values())
        proposed_sum = sum(v["proposedNaira"] for v in fy_map.values())
        pos_pad = sum(v["positivePaddingNaira"] for v in fy_map.values())
        ins_sum = sum(v["insertionsNaira"] for v in fy_map.values())
        inf_sum = sum(v["inflatedNaira"] for v in fy_map.values())
        cut_sum = sum(v["cutNaira"] for v in fy_map.values())
        alt_sum = sum(v["alteredCount"] for v in fy_map.values())
        cycles = sorted(fy_map.keys())
        denom = max(enacted_sum, pos_pad)
        if not cycles or denom <= 0:
            continue
        pad_share = round(min(100.0, (pos_pad / denom) * 100.0), 1)
        sc = round(max(0.0, min(100.0, 100.0 - pad_share)), 1)
        out[key] = {
            "score": sc,
            "weight": 20,
            "status": "SCORED",
            "positivePaddingNaira": pos_pad,
            "insertionsNaira": ins_sum,
            "inflatedNaira": inf_sum,
            "cutNaira": cut_sum,
            "auditedEnactedNaira": enacted_sum,
            "auditedProposedNaira": proposed_sum,
            "paddingSharePct": pad_share,
            "alteredItemCount": alt_sum,
            "cyclesCovered": cycles,
        }
    return out, name_counts


def _score_bir_execution_for_mda(
    bir_by_year: dict[str, dict[str, Any]],
    mda_key: str,
    display_name: str,
    parent_families: list[str],
) -> dict[str, Any]:
    """Match an MDA to verified BIR MDA rows without ever turning missing denominations into 0%."""
    if not bir_by_year:
        return {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"}

    norm_q = normalize_mda_name(display_name)
    year_scores: list[float] = []
    rel_vals: list[float] = []
    util_vals: list[float] = []
    years_covered: list[int] = []
    matched_labels: list[str] = []
    exact_years = 0
    family_years = 0
    overspend_years = 0

    for fy_str in sorted(bir_by_year.keys()):
        yr_entry = bir_by_year[fy_str]
        mdas = yr_entry.get("mdaBreakdown") or []
        if not mdas:
            continue

        matched_row: dict[str, Any] | None = None
        is_exact = False
        for m in mdas:
            if (norm_q and m.get("normMda") == norm_q) or (mda_key and m.get("coreKey") == mda_key):
                matched_row = m
                is_exact = True
                break

        if matched_row is None and parent_families:
            best_row: dict[str, Any] | None = None
            best_rank = -1
            for qf in parent_families:
                for m in mdas:
                    m_fams = m.get("families") or []
                    if qf in m_fams:
                        rank = 2 if len(m_fams) == 1 else 1
                        if rank > best_rank:
                            best_rank = rank
                            best_row = m
            matched_row = best_row

        if matched_row is None:
            continue

        app = int(matched_row.get("appropriatedNaira") or 0)
        rel = int(matched_row.get("releasedNaira") or 0)
        util = matched_row.get("utilizedNaira")
        rel_pct = matched_row.get("releasePct")
        util_pct = matched_row.get("utilizationPct")

        # FY 2010–2011 denominator guard: appropriated == 0 with released > 0 -> release % unknown
        if app <= 0 and rel > 0:
            rel_pct = None
        if util is None or int(util) <= 0:
            if util_pct is not None and float(util_pct) == 0.0 and rel <= 0:
                util_pct = None

        parts: list[tuple[float, float]] = []
        if rel_pct is not None:
            r_val = float(rel_pct)
            rel_vals.append(r_val)
            parts.append((0.60, max(0.0, min(100.0, r_val))))
            if r_val > 100.0 or matched_row.get("overspendVirement"):
                overspend_years += 1
        elif matched_row.get("overspendVirement"):
            overspend_years += 1

        if util_pct is not None:
            u_val = float(util_pct)
            util_vals.append(u_val)
            parts.append((0.40, max(0.0, min(100.0, u_val))))

        if not parts:
            continue

        wt_tot = sum(w for w, _ in parts)
        yr_score = sum(w * v for w, v in parts) / wt_tot
        year_scores.append(yr_score)
        years_covered.append(int(yr_str := fy_str))
        _ = yr_str
        if is_exact:
            exact_years += 1
        else:
            family_years += 1
        lbl = str(matched_row.get("mdaName") or "").strip()
        if lbl and lbl not in matched_labels and len(matched_labels) < 4:
            matched_labels.append(lbl)

    if not year_scores:
        return {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"}

    match_scope = (
        "EXACT_MDA"
        if exact_years > 0 and family_years == 0
        else "EXACT_AND_PARENT_FAMILY"
        if exact_years > 0
        else "PARENT_MINISTRY_FAMILY"
    )
    return {
        "score": round(sum(year_scores) / len(year_scores), 1),
        "weight": 20,
        "status": "SCORED",
        "avgReleasePct": round(sum(rel_vals) / len(rel_vals), 1) if rel_vals else None,
        "avgUtilizationPct": round(sum(util_vals) / len(util_vals), 1) if util_vals else None,
        "yearsCovered": years_covered,
        "yearsCount": len(years_covered),
        "matchScope": match_scope,
        "matchedBirLabels": matched_labels,
        "overspendYears": overspend_years,
    }


def _collect_nocopo_pillars(
    conn: sqlite3.Connection | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, int]], int, int, int]:
    """Stream NOCOPO awarded contracts ONLY (`planning`/`tender` and sandbox rows excluded)."""
    open_out: dict[str, dict[str, Any]] = {}
    hhi_out: dict[str, dict[str, Any]] = {}
    name_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    awarded_rows_total = 0
    planning_excluded = 0
    sandbox_excluded = 0

    if conn is None:
        return open_out, hhi_out, name_counts, awarded_rows_total, planning_excluded, sandbox_excluded

    has_nocopo = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
    ).fetchone()
    if not has_nocopo:
        return open_out, hhi_out, name_counts, awarded_rows_total, planning_excluded, sandbox_excluded

    planning_excluded = int(
        conn.execute(
            "SELECT COUNT(*) FROM nocopo_contracts WHERE LOWER(COALESCE(stage, '')) IN ('planning', 'tender')"
        ).fetchone()[0]
        or 0
    )

    stage_list = ",".join(f"'{s}'" for s in sorted(AWARDED_STAGES))
    cursor = conn.execute(
        f"""
        SELECT ocid, title, mda_name, norm_mda, contractor_name, norm_contractor,
               COALESCE(contract_award_naira, 0), procurement_method
        FROM nocopo_contracts
        WHERE LOWER(COALESCE(stage, '')) IN ({stage_list})
        """
    )

    acc: dict[str, dict[str, Any]] = {}
    for ocid, title_raw, mda_raw, norm_mda_raw, c_raw, norm_c_raw, award_raw, method_raw in cursor:
        src_mda = str(mda_raw or norm_mda_raw or "").strip()
        if is_sandbox_or_test_procurement(src_mda, title_raw, ocid):
            sandbox_excluded += 1
            continue
        awarded_rows_total += 1
        key = _canonical_mda_key(src_mda)
        if not _is_valid_mda_candidate(src_mda, key):
            continue
        disp = _clean_mda_display_name(src_mda)
        name_counts[key][disp] += 1

        entry = acc.get(key)
        if entry is None:
            entry = {
                "awardedCount": 0,
                "totalAwardedNaira": 0,
                "methodKnownCount": 0,
                "pricedKnownAwardedNaira": 0,
                "openCount": 0,
                "openAwardedNaira": 0,
                "nonCompCount": 0,
                "minorQuotCount": 0,
                "pricedVendorAwards": 0,
                "pricedAwardedTotal": 0,
                "vendorAwards": defaultdict(int),
                "vendorDisplay": {},
            }
            acc[key] = entry

        amt = int(round(float(award_raw or 0)))
        if amt < 0:
            amt = 0
        entry["awardedCount"] += 1
        entry["totalAwardedNaira"] += amt

        m_cat = classify_procurement_method(method_raw)
        if m_cat != "UNSPECIFIED":
            entry["methodKnownCount"] += 1
            entry["pricedKnownAwardedNaira"] += amt
            if m_cat == "COMPETITIVE_OPEN":
                entry["openCount"] += 1
                entry["openAwardedNaira"] += amt
            elif m_cat == "NON_COMPETITIVE":
                entry["nonCompCount"] += 1
            elif m_cat == "MINOR_QUOTATION":
                entry["minorQuotCount"] += 1

        ckey = canonical_contractor_key(norm_c_raw or c_raw)
        if ckey and amt > 0:
            entry["pricedVendorAwards"] += 1
            entry["pricedAwardedTotal"] += amt
            entry["vendorAwards"][ckey] += amt
            if ckey not in entry["vendorDisplay"]:
                entry["vendorDisplay"][ckey] = str(c_raw or ckey).strip()

    for key, e in acc.items():
        if e["methodKnownCount"] >= 3:
            open_val_pct = (
                round((e["openAwardedNaira"] / e["pricedKnownAwardedNaira"]) * 100.0, 1)
                if e["pricedKnownAwardedNaira"] > 0
                else round((e["openCount"] / e["methodKnownCount"]) * 100.0, 1)
            )
            open_cnt_pct = round((e["openCount"] / e["methodKnownCount"]) * 100.0, 1)
            open_out[key] = {
                "score": round(max(0.0, min(100.0, open_val_pct)), 1),
                "weight": 20,
                "status": "SCORED",
                "awardedCount": e["awardedCount"],
                "methodKnownCount": e["methodKnownCount"],
                "openBiddingCount": e["openCount"],
                "nonCompetitiveCount": e["nonCompCount"],
                "minorQuotationCount": e["minorQuotCount"],
                "totalAwardedNaira": e["totalAwardedNaira"],
                "openBiddingCountSharePct": open_cnt_pct,
                "openBiddingValueSharePct": open_val_pct,
            }
        elif e["awardedCount"] > 0:
            open_out[key] = {
                "score": None,
                "weight": 20,
                "status": "INSUFFICIENT_SAMPLE",
                "awardedCount": e["awardedCount"],
                "methodKnownCount": e["methodKnownCount"],
                "totalAwardedNaira": e["totalAwardedNaira"],
            }

        if e["pricedVendorAwards"] >= 3 and e["pricedAwardedTotal"] > 0:
            tot = e["pricedAwardedTotal"]
            hhi = sum((v / tot) ** 2 for v in e["vendorAwards"].values())
            top_ckey, top_amt = max(e["vendorAwards"].items(), key=lambda kv: kv[1])
            div_score = round(max(0.0, min(100.0, (1.0 - hhi) * 100.0)), 1)
            hhi_out[key] = {
                "score": div_score,
                "weight": 20,
                "status": "SCORED",
                "hhiPoints": round(hhi * 10000),
                "distinctVendors": len(e["vendorAwards"]),
                "topVendorName": e["vendorDisplay"].get(top_ckey, top_ckey),
                "topVendorSharePct": round((top_amt / tot) * 100.0, 1),
                "pricedAwardedCount": e["pricedVendorAwards"],
                "totalAwardedNaira": tot,
            }
        elif e["awardedCount"] > 0:
            hhi_out[key] = {
                "score": None,
                "weight": 20,
                "status": "INSUFFICIENT_SAMPLE",
                "pricedAwardedCount": e["pricedVendorAwards"],
                "distinctVendors": len(e["vendorAwards"]),
                "totalAwardedNaira": e["pricedAwardedTotal"],
            }

    return open_out, hhi_out, name_counts, awarded_rows_total, planning_excluded, sandbox_excluded


def _collect_cash_discipline(
    conn: sqlite3.Connection | None,
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, int]]]:
    """Stream govspend_payments and score cash discipline per canonical MDA."""
    out: dict[str, dict[str, Any]] = {}
    name_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    if conn is None:
        return out, name_counts

    has_gov = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
    ).fetchone()
    if not has_gov:
        return out, name_counts

    tier_bands = [(t, int(round(0.90 * t))) for t in DEFAULT_THRESHOLD_TIERS]
    acc: dict[str, dict[str, Any]] = {}
    pair_txs: dict[tuple[str, str], list[tuple[int, int]]] = defaultdict(list)

    cursor = conn.execute(
        """
        SELECT payment_date, financial_year, organization_name, norm_mda,
               beneficiary_name, norm_beneficiary, COALESCE(amount_naira, 0)
        FROM govspend_payments
        WHERE COALESCE(amount_naira, 0) > 0
        """
    )

    for p_date_raw, fy_raw, org_raw, norm_mda_raw, ben_raw, norm_ben_raw, amt_raw in cursor:
        amt = int(round(float(amt_raw or 0)))
        if amt <= 0:
            continue
        p_date = str(p_date_raw or "").strip()
        if len(p_date) < 10 or p_date[4] != "-" or p_date[7] != "-":
            continue
        try:
            ord_day = date.fromisoformat(p_date[:10]).toordinal()
        except ValueError:
            continue

        src_mda = str(org_raw or norm_mda_raw or "").strip()
        key = _canonical_mda_key(src_mda)
        if not _is_valid_mda_candidate(src_mda, key):
            continue
        disp = _clean_mda_display_name(src_mda)
        name_counts[key][disp] += 1

        entry = acc.get(key)
        if entry is None:
            entry = {
                "voucherCount": 0,
                "totalDisbursedNaira": 0,
                "nearThresholdCount": 0,
                "nearThresholdNaira": 0,
                "fyMonths": defaultdict(lambda: {"months": set(), "dec": 0, "nonDec": 0}),
            }
            acc[key] = entry

        entry["voucherCount"] += 1
        entry["totalDisbursedNaira"] += amt

        if any(lo <= amt < t for t, lo in tier_bands):
            entry["nearThresholdCount"] += 1
            entry["nearThresholdNaira"] += amt

        mm = p_date[5:7]
        fy = int(fy_raw) if fy_raw is not None and str(fy_raw).isdigit() else int(p_date[:4])
        # Exclude partial boundary years (2018 Sep–Dec, 2026 Jan–Jun) from Dec Rush denominator
        if 2019 <= fy <= 2025:
            fym = entry["fyMonths"][fy]
            fym["months"].add(mm)
            if mm == "12":
                fym["dec"] += amt
            else:
                fym["nonDec"] += amt

        ckey = canonical_contractor_key(norm_ben_raw or ben_raw)
        if ckey:
            pair_txs[(key, ckey)].append((ord_day, amt))

    split_stats: dict[str, list[int]] = defaultdict(lambda: [0, 0])  # [clusters, splitVouchers]
    for (mda_key, _ckey), txs in pair_txs.items():
        if len(txs) < 3:
            continue
        txs.sort(key=lambda x: x[0])
        i = 0
        n_tx = len(txs)
        while i < n_tx:
            j = i
            while j + 1 < n_tx and (txs[j + 1][0] - txs[i][0]) <= 6:
                j += 1
            win_len = j - i + 1
            if win_len >= 3:
                win_amts = [txs[k][1] for k in range(i, j + 1)]
                win_tot = sum(win_amts)
                win_max = max(win_amts)
                if any(win_max < tier <= win_tot for tier in _REVERSE_TIERS):
                    split_stats[mda_key][0] += 1
                    split_stats[mda_key][1] += win_len
                    i = j + 1
                    continue
            i += 1

    for key, e in acc.items():
        v_cnt = e["voucherCount"]
        if v_cnt < 20:
            out[key] = {
                "score": None,
                "weight": 20,
                "status": "INSUFFICIENT_SAMPLE",
                "voucherCount": v_cnt,
                "totalDisbursedNaira": e["totalDisbursedNaira"],
            }
            continue

        # Qualifying full-year December controls (2019–2025 with Dec + >= 3 non-Dec months)
        qual_dec = 0
        qual_non_dec = 0
        qual_non_dec_months = 0
        for fy, fym in e["fyMonths"].items():
            _ = fy
            non_dec_months = len(fym["months"] - {"12"})
            if "12" in fym["months"] and non_dec_months >= 3 and fym["nonDec"] > 0:
                qual_dec += fym["dec"]
                qual_non_dec += fym["nonDec"]
                qual_non_dec_months += non_dec_months

        if qual_dec > 0 and qual_non_dec > 0 and qual_non_dec_months > 0:
            avg_non_dec = qual_non_dec / qual_non_dec_months
            dec_ratio = round(qual_dec / avg_non_dec, 2) if avg_non_dec > 0 else None
        else:
            dec_ratio = None

        dec_penalty = (
            min(40.0, max(0.0, (dec_ratio - 1.5) * 10.0))
            if dec_ratio is not None
            else 0.0
        )

        near_cnt = e["nearThresholdCount"]
        near_pct = round((near_cnt / v_cnt) * 100.0, 2)
        near_penalty = min(30.0, near_pct * 2.0)

        sp_clusters, sp_vouchers = split_stats.get(key, [0, 0])
        sp_pct = round((sp_vouchers / v_cnt) * 100.0, 2)
        split_penalty = min(30.0, sp_pct * 1.5)

        total_penalty = dec_penalty + near_penalty + split_penalty
        score = round(max(0.0, min(100.0, 100.0 - total_penalty)), 1)

        out[key] = {
            "score": score,
            "weight": 20,
            "status": "SCORED",
            "voucherCount": v_cnt,
            "totalDisbursedNaira": e["totalDisbursedNaira"],
            "decRushRatio": dec_ratio,
            "nearThresholdCount": near_cnt,
            "nearThresholdPct": near_pct,
            "splitClusterCount": sp_clusters,
            "splitVoucherCount": sp_vouchers,
            "splitVoucherPct": sp_pct,
            "decPenalty": round(dec_penalty, 1),
            "nearPenalty": round(near_penalty, 1),
            "splitPenalty": round(split_penalty, 1),
        }

    return out, name_counts


def build_mda_scorecards(
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    max_mdas: int = 250,
    write: bool = True,
) -> dict[str, Any]:
    """Build open-formula 5-pillar MDA Integrity Scorecards (`mda_integrity_scorecards.json`)."""
    ds_dir = Path(datasets_dir)
    db_file = Path(fts_sqlite_path)

    padding_map, pad_names = _collect_padding_restraint(ds_dir / "bill_act_diffs")
    bir_by_year = _build_bir_by_year(ds_dir / "execution_tracker.json")

    conn = sqlite3.connect(str(db_file)) if db_file.exists() else None
    try:
        open_map, hhi_map, noc_names, awarded_rows, planning_excluded, sandbox_excluded = _collect_nocopo_pillars(conn)
        cash_map, gov_names = _collect_cash_discipline(conn)
    finally:
        if conn is not None:
            conn.close()

    all_keys = sorted(
        set(padding_map.keys())
        | set(open_map.keys())
        | set(hhi_map.keys())
        | set(cash_map.keys())
    )

    merged_names: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for src in (pad_names, noc_names, gov_names):
        for k, cnts in src.items():
            for nm, c in cnts.items():
                merged_names[k][nm] += c

    rows: list[dict[str, Any]] = []
    for key in all_keys:
        disp = _pick_preferred_display_name(merged_names.get(key, {}), key)
        if not _is_valid_mda_candidate(disp, key):
            continue
        fams = classify_parent_ministry_families(disp)
        if not fams:
            fams = classify_parent_ministry_families(key)

        pad_p = padding_map.get(key, {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"})
        bir_p = _score_bir_execution_for_mda(bir_by_year, key, disp, fams)
        open_p = open_map.get(key, {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"})
        hhi_p = hhi_map.get(key, {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"})
        cash_p = cash_map.get(key, {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"})

        pillars = {
            "paddingRestraint": pad_p,
            "birCapitalExecution": bir_p,
            "openBiddingShare": open_p,
            "vendorDiversification": hhi_p,
            "cashDiscipline": cash_p,
        }
        comp = compute_composite_score(pillars)
        if comp["metricsPresent"] == 0:
            continue

        exposure_naira = (
            int(cash_p.get("totalDisbursedNaira") or 0)
            + int(open_p.get("totalAwardedNaira") or 0)
            + int(pad_p.get("auditedEnactedNaira") or 0)
        )

        rows.append(
            {
                "mdaKey": key,
                "mdaName": disp,
                "parentFamilies": fams,
                "compositeScore": comp["compositeScore"],
                "grade": comp["grade"],
                "metricsPresent": comp["metricsPresent"],
                "totalExpectedMetrics": comp["totalExpectedMetrics"],
                "activeWeightSum": comp["activeWeightSum"],
                "coverageTier": comp["coverageTier"],
                "totalTrackedExposureNaira": exposure_naira,
                "pillars": pillars,
            }
        )

    rows.sort(
        key=lambda r: (
            -r["metricsPresent"],
            -r["totalTrackedExposureNaira"],
            r["mdaName"],
        )
    )
    bounded = rows[:max_mdas]

    # Stable rank ordering by metricsPresent DESC, compositeScore ASC (highest scrutiny priority) or DESC?
    # Keep deterministic index sorted by (-metricsPresent, -(compositeScore or 0), -totalTrackedExposureNaira)
    bounded.sort(
        key=lambda r: (
            -r["metricsPresent"],
            -(r["compositeScore"] if r["compositeScore"] is not None else -1.0),
            -r["totalTrackedExposureNaira"],
        )
    )
    for idx, r in enumerate(bounded, start=1):
        r["rank"] = idx

    scored_vals = [float(r["compositeScore"]) for r in bounded if r["compositeScore"] is not None]
    grade_dist = {g: 0 for g in ("A", "B", "C", "D", "F")}
    for r in bounded:
        g = r["grade"]
        if g in grade_dist:
            grade_dist[g] += 1

    payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "READY" if bounded else "NO_SOURCE_DATA",
        "formulaVersion": "OPEN_5_PILLAR_V1",
        "pillarDefinitions": PILLAR_DEFINITIONS,
        "headline": {
            "totalCandidateMdas": len(rows),
            "totalScoredMdas": len(bounded),
            "full5PillarCount": sum(1 for r in bounded if r["metricsPresent"] == 5),
            "strong4PlusPillarCount": sum(1 for r in bounded if r["metricsPresent"] >= 4),
            "medianCompositeScore": round(statistics.median(scored_vals), 1) if scored_vals else None,
            "meanCompositeScore": round(sum(scored_vals) / len(scored_vals), 1) if scored_vals else None,
            "gradeDistribution": grade_dist,
            "awardedContractsAnalyzed": awarded_rows,
            "planningContractsExcluded": planning_excluded,
            "sandboxContractsExcluded": sandbox_excluded,
        },
        "mdas": bounded,
    }

    if write:
        _atomic_write_json(ds_dir / "mda_integrity_scorecards.json", payload)
    return payload


def _extract_bir_macro_metrics(yr_entry: dict[str, Any]) -> dict[str, Any]:
    """Extract Revenue, Capital, and Debt Service macro execution rows with FY 2009/2015 guards."""
    rev_row: dict[str, Any] | None = None
    cap_row: dict[str, Any] | None = None
    dom_debt: dict[str, Any] | None = None
    for_debt: dict[str, Any] | None = None
    sub_debt: dict[str, Any] | None = None

    for r in yr_entry.get("macroRows") or []:
        lbl = str(r.get("label") or "").strip().lower()
        if "aggregate federal government revenue" in lbl:
            rev_row = r
        elif ("capital expenditure (total / releases)" in lbl or "aggregate capital expenditure" in lbl) and "goe" not in lbl:
            cap_row = r
        elif lbl == "domestic debt service":
            dom_debt = r
        elif lbl == "foreign debt service":
            for_debt = r
        elif "debt service / recurrent debt" in lbl or lbl == "2 debt service":
            sub_debt = r

    debt_budget: int | None = None
    debt_actual: int | None = None
    debt_pct: float | None = None
    debt_derived = False

    dom_act = int(round(float(dom_debt.get("actualNaira") or 0))) if dom_debt else 0
    for_act = int(round(float(for_debt.get("actualNaira") or 0))) if for_debt else 0
    dom_bgt = int(round(float(dom_debt.get("budgetNaira") or 0))) if dom_debt else 0
    for_bgt = int(round(float(for_debt.get("budgetNaira") or 0))) if for_debt else 0

    sub_act = int(round(float(sub_debt.get("actualNaira") or 0))) if sub_debt else 0
    sub_bgt = int(round(float(sub_debt.get("budgetNaira") or 0))) if sub_debt else 0

    # Guard FY 2009 (missing sub-total) and FY 2015 (OCR truncated sub-total 60.38B vs Dom 996.80B)
    if (dom_debt or for_debt) and (
        sub_debt is None or sub_act < max(dom_act, for_act)
    ):
        if dom_bgt + for_bgt > 0:
            debt_budget = dom_bgt + for_bgt
            debt_actual = dom_act + for_act
            debt_pct = round((debt_actual / debt_budget) * 100.0, 2)
            debt_derived = True
    elif sub_debt is not None and sub_bgt > 0:
        debt_budget = sub_bgt
        debt_actual = sub_act
        pct_raw = sub_debt.get("performancePct")
        debt_pct = round(float(pct_raw), 2) if pct_raw is not None else round((sub_act / sub_bgt) * 100.0, 2)
        debt_derived = bool(sub_debt.get("derivedFromComponents"))

    rev_bgt = int(round(float(rev_row.get("budgetNaira") or 0))) if rev_row else None
    rev_act = int(round(float(rev_row.get("actualNaira") or 0))) if rev_row else None
    rev_pct = (
        round(float(rev_row["performancePct"]), 2)
        if rev_row and rev_row.get("performancePct") is not None
        else None
    )

    cap_bgt = int(round(float(cap_row.get("budgetNaira") or 0))) if cap_row else None
    cap_act = int(round(float(cap_row.get("actualNaira") or 0))) if cap_row else None
    cap_pct = (
        round(float(cap_row["performancePct"]), 2)
        if cap_row and cap_row.get("performancePct") is not None
        else None
    )

    debt_overrun_flag = bool(debt_pct is not None and debt_pct > 100.0)
    debt_overrun_naira = (
        max(0, debt_actual - debt_budget)
        if (debt_actual is not None and debt_budget is not None)
        else 0
    )
    debt_to_rev_pct = (
        round((debt_actual / rev_act) * 100.0, 1)
        if (debt_actual and rev_act and rev_act > 0)
        else None
    )
    cap_vs_debt_gap = (
        round(debt_pct - cap_pct, 1)
        if (debt_pct is not None and cap_pct is not None)
        else None
    )

    return {
        "revenueBudgetNaira": rev_bgt,
        "revenueActualNaira": rev_act,
        "revenuePerformancePct": rev_pct,
        "capitalBudgetNaira": cap_bgt,
        "capitalActualNaira": cap_act,
        "capitalPerformancePct": cap_pct,
        "debtServiceBudgetNaira": debt_budget,
        "debtServiceActualNaira": debt_actual,
        "debtServicePerformancePct": debt_pct,
        "debtServiceDerivedFromComponents": debt_derived,
        "debtServiceOverrunFlag": debt_overrun_flag,
        "debtServiceOverrunNaira": debt_overrun_naira,
        "debtServiceToRevenuePct": debt_to_rev_pct,
        "capitalVsDebtServiceGapPct": cap_vs_debt_gap,
    }


def _year_to_president(fy: int) -> dict[str, Any]:
    for adm in PRESIDENTIAL_ADMIN_SCOPES:
        if fy in adm["budgetYears"]:
            return adm
    return PRESIDENTIAL_ADMIN_SCOPES[-1]


def build_macro_credibility_tracker(
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    write: bool = True,
) -> dict[str, Any]:
    """Build 'Promise vs. Reality' 2009–2026 Macro Credibility & Admin Rollups (`macro_credibility_tracker.json`)."""
    ds_dir = Path(datasets_dir)
    exec_path = ds_dir / "execution_tracker.json"
    policy_path = ds_dir / "policy_benchmarks.json"
    debt_path = ds_dir / "debt_profile.json"
    narr_path = ds_dir / "macro_narratives_summary.json"

    exec_data = json.loads(exec_path.read_text(encoding="utf-8")) if exec_path.exists() else {"years": []}
    mtef_map = _build_mtef_by_year(policy_path) if policy_path.exists() else {}

    narr_map: dict[int, dict[str, Any]] = {}
    if narr_path.exists():
        try:
            ndata = json.loads(narr_path.read_text(encoding="utf-8"))
            for item in ndata.get("narratives") or []:
                fy = item.get("financialYear")
                if isinstance(fy, int):
                    narr_map[fy] = item.get("macroeconomicFramework") or {}
        except Exception:
            pass

    debt_map: dict[int, dict[str, Any]] = {}
    if debt_path.exists():
        try:
            ddata = json.loads(debt_path.read_text(encoding="utf-8"))
            for row in ddata.get("yearlyDebt") or []:
                fy = row.get("financialYear")
                if isinstance(fy, int):
                    debt_map[fy] = row
        except Exception:
            pass

    exec_by_year: dict[int, dict[str, Any]] = {}
    for y in exec_data.get("years") or []:
        if y.get("status") != "VERIFIED_BIR_SOURCE":
            continue
        fy = y.get("financialYear")
        if isinstance(fy, int):
            exec_by_year[fy] = y

    all_years = sorted(y for y in exec_by_year.keys() if 2009 <= y <= 2026)
    yearly_series: list[dict[str, Any]] = []

    for fy in all_years:
        y_entry = exec_by_year[fy]
        adm = _year_to_president(fy)
        bir_metrics = _extract_bir_macro_metrics(y_entry)

        mtef = mtef_map.get(str(fy), {})
        narr = narr_map.get(fy, {})

        mtef_oil = mtef.get("oilPriceUsdPerBbl")
        if mtef_oil is None:
            mtef_oil = narr.get("benchmarkOilPriceUSD")
        mtef_prod = mtef.get("oilProductionMbpd")
        if mtef_prod is None:
            mtef_prod = narr.get("oilProductionMBPD")
        mtef_gdp = mtef.get("gdpGrowthPct") if mtef.get("gdpGrowthPct") is not None else narr.get("gdpGrowthRatePct")
        mtef_inf = mtef.get("inflationPct") if mtef.get("inflationPct") is not None else narr.get("inflationRatePct")

        mtef_fx_raw = mtef.get("exchangeRateNairaPerUsd")
        narr_fx = narr.get("exchangeRateNairaPerUSD")
        fx_source = "NONE"
        mtef_fx: float | None = None

        # Guard calendar-year header collision in MTEF OCR (e.g. FY 2026 extracted 2024.0)
        is_calendar_collision = (
            mtef_fx_raw is not None
            and 2018.0 <= float(mtef_fx_raw) <= 2030.0
            and float(mtef_fx_raw) == float(int(mtef_fx_raw))
            and narr_fx is not None
        )
        if mtef_fx_raw is not None and not is_calendar_collision:
            mtef_fx = round(float(mtef_fx_raw), 2)
            fx_source = "MTEF_FSP_PDF"
        elif narr_fx is not None:
            mtef_fx = round(float(narr_fx), 2)
            fx_source = "ENACTED_BUDGET_FRAMEWORK"

        dmo = debt_map.get(fy, {})
        cbn_fx = dmo.get("cbnFxRate")
        tot_debt_naira_m = dmo.get("totalDebtNairaM")
        tot_debt_usd_m = dmo.get("totalDebtUsdM")
        if cbn_fx is not None and float(cbn_fx) > 0:
            realized_fx = round(float(cbn_fx), 2)
            fx_basis = "DMO_EXPLICIT_CBN_FX"
        elif tot_debt_naira_m and tot_debt_usd_m and float(tot_debt_usd_m) > 0:
            realized_fx = round(float(tot_debt_naira_m) / float(tot_debt_usd_m), 2)
            fx_basis = "DMO_IMPLIED_FX"
        else:
            realized_fx = None
            fx_basis = "NO_DMO_FX"

        fx_slippage = (
            round(((realized_fx - mtef_fx) / mtef_fx) * 100.0, 1)
            if (realized_fx is not None and mtef_fx is not None and mtef_fx > 0)
            else None
        )

        q_cov = y_entry.get("quarterCovered")
        is_partial_yr = bool(q_cov and str(q_cov).upper() != "Q4")

        yearly_series.append(
            {
                "financialYear": fy,
                "presidentId": adm["presidentId"],
                "presidentName": adm["presidentName"],
                "shortName": adm["shortName"],
                "party": adm["party"],
                "quarterCovered": q_cov,
                "reportPeriodLabel": y_entry.get("reportPeriodLabel"),
                "isPartialYearReport": is_partial_yr,
                "overallReleasePct": y_entry.get("overallReleasePct"),
                "overallUtilizationPct": y_entry.get("overallUtilizationPct"),
                "mtef": {
                    "oilPriceUsdPerBbl": mtef_oil,
                    "oilProductionMbpd": mtef_prod,
                    "exchangeRateNairaPerUsd": mtef_fx,
                    "gdpGrowthPct": mtef_gdp,
                    "inflationPct": mtef_inf,
                    "fxAssumptionSource": fx_source,
                    "docTitle": mtef.get("docTitle") or mtef.get("coveringDocTitle"),
                },
                "realized": {
                    "cbnFxRateNairaPerUsd": realized_fx,
                    "fxBasis": fx_basis,
                    "fxSlippagePct": fx_slippage,
                    "totalDebtNairaM": tot_debt_naira_m,
                    "totalDebtUsdM": tot_debt_usd_m,
                    "dmoAsAt": dmo.get("asAt"),
                },
                "bir": bir_metrics,
            }
        )

    # Administration Rollups (all 5 Fourth Republic presidencies, omitting nulls from averages)
    year_row_map = {r["financialYear"]: r for r in yearly_series}
    admin_rollups: list[dict[str, Any]] = []

    for adm in PRESIDENTIAL_ADMIN_SCOPES:
        yrs = adm["budgetYears"]
        matched_rows = [year_row_map[y] for y in yrs if y in year_row_map]
        dmo_rows = [(y, debt_map[y]) for y in yrs if y in debt_map and debt_map[y].get("totalDebtNairaM")]

        start_debt_m = dmo_rows[0][1]["totalDebtNairaM"] if dmo_rows else None
        end_debt_m = dmo_rows[-1][1]["totalDebtNairaM"] if dmo_rows else None
        end_debt_usd_m = dmo_rows[-1][1].get("totalDebtUsdM") if dmo_rows else None

        if not matched_rows:
            admin_rollups.append(
                {
                    "presidentId": adm["presidentId"],
                    "presidentName": adm["presidentName"],
                    "shortName": adm["shortName"],
                    "party": adm["party"],
                    "tenureLabel": adm["tenureLabel"],
                    "budgetYears": yrs,
                    "birCoverageStatus": "PRE_BIR_ERA_NO_SOURCE",
                    "birYearsCovered": 0,
                    "birYearsList": [],
                    "birCapitalYearsCount": 0,
                    "birRevenueYearsCount": 0,
                    "birDebtYearsCount": 0,
                    "avgCapitalPerformancePct": None,
                    "avgRevenuePerformancePct": None,
                    "avgDebtServicePerformancePct": None,
                    "avgDebtServiceToRevenuePct": None,
                    "avgFxSlippagePct": None,
                    "debtServiceOverrunYears": 0,
                    "totalDebtServiceOverrunNaira": 0,
                    "dmoStartDebtNairaM": start_debt_m,
                    "dmoEndDebtNairaM": end_debt_m,
                    "dmoEndDebtUsdM": end_debt_usd_m,
                    "partialYearNotes": [],
                }
            )
            continue

        cap_vals = [r["bir"]["capitalPerformancePct"] for r in matched_rows if r["bir"]["capitalPerformancePct"] is not None]
        rev_vals = [r["bir"]["revenuePerformancePct"] for r in matched_rows if r["bir"]["revenuePerformancePct"] is not None]
        debt_vals = [r["bir"]["debtServicePerformancePct"] for r in matched_rows if r["bir"]["debtServicePerformancePct"] is not None]
        ds_rev_vals = [r["bir"]["debtServiceToRevenuePct"] for r in matched_rows if r["bir"]["debtServiceToRevenuePct"] is not None]
        fx_slip_vals = [r["realized"]["fxSlippagePct"] for r in matched_rows if r["realized"]["fxSlippagePct"] is not None]
        overrun_yrs = [r["financialYear"] for r in matched_rows if r["bir"]["debtServiceOverrunFlag"]]
        tot_overrun_naira = sum(int(r["bir"]["debtServiceOverrunNaira"] or 0) for r in matched_rows)
        partial_notes = [
            f"FY {r['financialYear']} ({r.get('reportPeriodLabel') or r.get('quarterCovered')})"
            for r in matched_rows
            if r.get("isPartialYearReport")
        ]

        admin_rollups.append(
            {
                "presidentId": adm["presidentId"],
                "presidentName": adm["presidentName"],
                "shortName": adm["shortName"],
                "party": adm["party"],
                "tenureLabel": adm["tenureLabel"],
                "budgetYears": yrs,
                "birCoverageStatus": "VERIFIED_BIR_SERIES",
                "birYearsCovered": len(matched_rows),
                "birYearsList": [r["financialYear"] for r in matched_rows],
                "birCapitalYearsCount": len(cap_vals),
                "birRevenueYearsCount": len(rev_vals),
                "birDebtYearsCount": len(debt_vals),
                "avgCapitalPerformancePct": round(sum(cap_vals) / len(cap_vals), 1) if cap_vals else None,
                "avgRevenuePerformancePct": round(sum(rev_vals) / len(rev_vals), 1) if rev_vals else None,
                "avgDebtServicePerformancePct": round(sum(debt_vals) / len(debt_vals), 1) if debt_vals else None,
                "avgDebtServiceToRevenuePct": round(sum(ds_rev_vals) / len(ds_rev_vals), 1) if ds_rev_vals else None,
                "avgFxSlippagePct": round(sum(fx_slip_vals) / len(fx_slip_vals), 1) if fx_slip_vals else None,
                "debtServiceOverrunYears": len(overrun_yrs),
                "debtServiceOverrunYearsList": overrun_yrs,
                "totalDebtServiceOverrunNaira": tot_overrun_naira,
                "dmoStartDebtNairaM": start_debt_m,
                "dmoEndDebtNairaM": end_debt_m,
                "dmoEndDebtUsdM": end_debt_usd_m,
                "partialYearNotes": partial_notes,
            }
        )

    all_caps = [r["bir"]["capitalPerformancePct"] for r in yearly_series if r["bir"]["capitalPerformancePct"] is not None]
    all_revs = [r["bir"]["revenuePerformancePct"] for r in yearly_series if r["bir"]["revenuePerformancePct"] is not None]
    all_debts = [r["bir"]["debtServicePerformancePct"] for r in yearly_series if r["bir"]["debtServicePerformancePct"] is not None]
    all_overrun_yrs = [r["financialYear"] for r in yearly_series if r["bir"]["debtServiceOverrunFlag"]]

    payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "READY" if yearly_series else "NO_SOURCE_DATA",
        "headline": {
            "birYearsCount": len(yearly_series),
            "yearRange": f"{yearly_series[0]['financialYear']}–{yearly_series[-1]['financialYear']}" if yearly_series else "",
            "meanCapitalPerformancePct": round(sum(all_caps) / len(all_caps), 1) if all_caps else None,
            "meanRevenuePerformancePct": round(sum(all_revs) / len(all_revs), 1) if all_revs else None,
            "meanDebtServicePerformancePct": round(sum(all_debts) / len(all_debts), 1) if all_debts else None,
            "debtServiceOverrunYearsCount": len(all_overrun_yrs),
            "debtServiceOverrunYears": all_overrun_yrs,
            "cumulativeDebtServiceOverrunNaira": sum(int(r["bir"]["debtServiceOverrunNaira"] or 0) for r in yearly_series),
            "partialYearReports": [
                {"financialYear": r["financialYear"], "label": r.get("reportPeriodLabel") or r.get("quarterCovered")}
                for r in yearly_series
                if r.get("isPartialYearReport")
            ],
        },
        "administrations": admin_rollups,
        "yearlySeries": yearly_series,
    }

    if write:
        _atomic_write_json(ds_dir / "macro_credibility_tracker.json", payload)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build P3-S6 MDA Scorecard & Macro Credibility datasets")
    parser.add_argument("--fts-sqlite", default=str(DEFAULT_FTS_SQLITE))
    parser.add_argument("--datasets-dir", default=str(DEFAULT_DATASETS_DIR))
    args = parser.parse_args()

    scorecards = build_mda_scorecards(
        fts_sqlite_path=args.fts_sqlite,
        datasets_dir=args.datasets_dir,
        write=True,
    )
    macro = build_macro_credibility_tracker(
        datasets_dir=args.datasets_dir,
        write=True,
    )

    sc_bytes = (Path(args.datasets_dir) / "mda_integrity_scorecards.json").stat().st_size
    mc_bytes = (Path(args.datasets_dir) / "macro_credibility_tracker.json").stat().st_size
    print(
        f"[MDA Scorecards] mdas={scorecards['headline']['totalScoredMdas']}/"
        f"{scorecards['headline']['totalCandidateMdas']}, "
        f"5-pillar={scorecards['headline']['full5PillarCount']}, "
        f"4+-pillar={scorecards['headline']['strong4PlusPillarCount']}, "
        f"median={scorecards['headline']['medianCompositeScore']}, "
        f"size={sc_bytes / 1024:.1f} KB"
    )
    print(
        f"[Macro Credibility] years={macro['headline']['birYearsCount']} ({macro['headline']['yearRange']}), "
        f"overrun_yrs={macro['headline']['debtServiceOverrunYearsCount']}, "
        f"mean_cap={macro['headline']['meanCapitalPerformancePct']}%, "
        f"mean_debt={macro['headline']['meanDebtServicePerformancePct']}%, "
        f"size={mc_bytes / 1024:.1f} KB"
    )


if __name__ == "__main__":
    main()
