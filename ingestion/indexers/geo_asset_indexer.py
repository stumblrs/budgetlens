"""
Geo-Intelligence & Physical Asset Inventory Indexer (1999-2026)
Scans all published `public/datasets/{year}/projects.min.json` datasets using the
fixed word-boundary `GeoTaxonomy` (37 states + 774 LGAs), aligned v2.0 forensic rules,
and strict physical-asset regexes to atomically build:
  1. public/datasets/asset_inventory_index.json
  2. public/datasets/geo_intelligence_index.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.enrichers.geo_taxonomy import CANONICAL_STATES, STATES_TO_ZONE, GeoTaxonomy

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
AWARDED_STAGES_SQL = "('award', 'contract', 'implementation')"
GENERIC_ERGP_RE = re.compile(r"^(?:ERGP|ZIP|NASS|P-\d{4}-\d+)$", re.I)

MDA_ROLLUP_RE = re.compile(r"^[0-5]\d{8,9}$")
COA_OH_PERS_RE = re.compile(r"^(21|22)\d{4,6}$")
LEAF_CAP_RE = re.compile(r"^(ERGP|ZIP|NASS)", re.I)

# Strictly positive price index relative to 2023 = 1.0 (matching historicalMacroData.ts)
ASSET_INFLATION_FROM_2023: dict[int, float] = {
    1999: 0.085, 2000: 0.091, 2001: 0.108, 2002: 0.122, 2003: 0.139,
    2004: 0.160, 2005: 0.189, 2006: 0.204, 2007: 0.215, 2008: 0.240,
    2009: 0.270, 2010: 0.307, 2011: 0.340, 2012: 0.382, 2013: 0.414,
    2014: 0.448, 2015: 0.488, 2016: 0.565, 2017: 0.658, 2018: 0.738,
    2019: 0.822, 2020: 0.931, 2021: 0.720, 2022: 0.850, 2023: 1.000,
    2024: 1.320, 2025: 1.620, 2026: 1.850,
}

# NPC demographic baseline (millions -> exact integer) matching GeoMapWidget.tsx
ZONE_POPULATIONS: dict[str, int] = {
    "North West": 36_000_000,
    "North East": 26_000_000,
    "North Central": 29_000_000,
    "South West": 38_000_000,
    "South East": 22_000_000,
    "South South": 24_000_000,
}

# ── Physical Asset Definitions & Guards ───────────────────────────────────────
ASSET_EXCLUSION_RE = re.compile(
    r"\b(fuel\s+cost|lubricant|maintenance\s+of|repairs?\s+of|servicing|insurance|"
    r"water\s+charges|electricity\s+charges|software\s+acquisition|agribusiness|"
    r"small\s+business|business\s+dev|business\s+support|business\s+grant)\b",
    re.I,
)

QTY_SUFFIX_RE = re.compile(r"\b(\d{1,4})\s*(?:nos?\.?|units?|pcs|pieces|sets?|blocks?)\b", re.I)
QTY_PREFIX_RE = re.compile(
    r"(?:procurement|purchase|supply|provision|acquisition|drilling|construction|installation)\s+of\s+(\d{1,4})\b"
    r"(?!\s*(?:-?seater|-?in-?1|kva|kw|mw|watt|watts|km|m\b|mm|gb|tb|hp|ton|litre|model|bedroom|storey))",
    re.I,
)

ASSET_CATALOG: list[dict[str, Any]] = [
    {
        "itemKey": "hilux_pickups",
        "label": "Hilux & Pickup Vans",
        "categoryGroup": "Vehicles & Mobility",
        "lifespanYears": 5,
        "baseUnitPrice2023": 45_000_000,
        "pattern": re.compile(r"\b(hilux|pick[-\s]?up|double\s+cab|utility\s+vehicle|operational\s+vehicle)\b", re.I),
    },
    {
        "itemKey": "suv_saloons",
        "label": "SUVs & Executive Saloons",
        "categoryGroup": "Vehicles & Mobility",
        "lifespanYears": 5,
        "baseUnitPrice2023": 75_000_000,
        "pattern": re.compile(r"\b(suvs?|land\s*cruiser|prado|fortuner|pajero|official\s+vehicle|executive\s+vehicle|jeep|saloon\s+car)\b", re.I),
    },
    {
        "itemKey": "staff_buses",
        "label": "Staff Buses & Coasters",
        "categoryGroup": "Vehicles & Mobility",
        "lifespanYears": 6,
        "baseUnitPrice2023": 55_000_000,
        "pattern": re.compile(r"\b(coaster|staff\s+bus(?:es)?|mini\s+bus(?:es)?|school\s+bus(?:es)?|passeng?er\s+bus(?:es)?|18[-\s]?seater|30[-\s]?seater|\bbus(?:es)?\b)\b", re.I),
    },
    {
        "itemKey": "motorcycles_tricycles",
        "label": "Motorcycles & Tricycles",
        "categoryGroup": "Vehicles & Mobility",
        "lifespanYears": 3,
        "baseUnitPrice2023": 1_800_000,
        "pattern": re.compile(r"\b(motorcycles?|tricycles?|keke\s*napep)\b", re.I),
    },
    {
        "itemKey": "ambulances",
        "label": "Ambulances & Mobile Clinics",
        "categoryGroup": "Healthcare & Mobility",
        "lifespanYears": 6,
        "baseUnitPrice2023": 50_000_000,
        "pattern": re.compile(r"\b(ambulances?|mobile\s+clinic|medical\s+vehicle)\b", re.I),
    },
    {
        "itemKey": "computers_laptops",
        "label": "Computers & Laptops",
        "categoryGroup": "Office Technology",
        "lifespanYears": 4,
        "baseUnitPrice2023": 950_000,
        "pattern": re.compile(r"\b(computers?|laptops?|desktops?|workstations?|ict\s+equipment)\b", re.I),
    },
    {
        "itemKey": "photocopiers_printers",
        "label": "Photocopiers, Printers & Scanners",
        "categoryGroup": "Office Technology",
        "lifespanYears": 4,
        "baseUnitPrice2023": 2_800_000,
        "pattern": re.compile(r"\b(photocop(?:y|ier|iers)|printers?|scanners?|shredders?)\b", re.I),
    },
    {
        "itemKey": "generators",
        "label": "Generators & Generating Sets",
        "categoryGroup": "Power & Energy",
        "lifespanYears": 8,
        "baseUnitPrice2023": 22_000_000,
        "pattern": re.compile(r"\b(generators?|generating\s+sets?|power\s+plant|soundproof\s+gen)\b", re.I),
    },
    {
        "itemKey": "solar_systems",
        "label": "Solar Streetlights & Mini-Grids",
        "categoryGroup": "Power & Energy",
        "lifespanYears": 8,
        "baseUnitPrice2023": 600_000,
        "pattern": re.compile(r"\b(solar\s+street\s*lights?|solar\s+lights?|solar\s+mini[-\s]?grid|solar\s+panels?|inverters?)\b", re.I),
    },
    {
        "itemKey": "transformers",
        "label": "Electrical Transformers",
        "categoryGroup": "Power & Energy",
        "lifespanYears": 15,
        "baseUnitPrice2023": 18_000_000,
        "pattern": re.compile(r"\b(transformers?|500kva|300kva)\b", re.I),
    },
    {
        "itemKey": "boreholes",
        "label": "Boreholes & Water Schemes",
        "categoryGroup": "Water Infrastructure",
        "lifespanYears": 7,
        "baseUnitPrice2023": 6_500_000,
        "pattern": re.compile(r"\b(boreholes?|solar\s+boreholes?|water\s+schemes?)\b", re.I),
    },
    {
        "itemKey": "classrooms",
        "label": "Classrooms & School Blocks",
        "categoryGroup": "Education Infrastructure",
        "lifespanYears": 15,
        "baseUnitPrice2023": 15_000_000,
        "pattern": re.compile(r"\b(blocks?\s+of\s+classrooms?|classrooms?)\b", re.I),
    },
]

# ── Aligned Forensic Rule Evaluation for Geo-Intelligence ─────────────────────
SECURITY_TERMS = (
    "DEFENCE", "ARMY", "NAVY", "AIRFORCE", "AIR FORCE", "POLICE",
    "DSS", "STATE SECURITY", "NIA", "ONSA", "NATIONAL SECURITY ADVISER",
    "NSCDC", "IMMIGRATION", "CUSTOMS", "FIRE SERVICE",
)
MULTILATERAL_TERMS = ("MULTILATERAL", "BILATERAL", "TIED LOAN", "WORLD BANK", "AFDB", "ISDB")
NON_CORE_MDA_RE = re.compile(
    r"(AGRICULTUR|RIVER\s+BASIN|RBDA|RESEARCH\s+INST|FORESTRY|FISHER|HORTICULTUR|"
    r"LABOUR|HUMANITARIAN|FILM|CULTUR|ARTS|TOURISM|SPORTS|YOUTH|SCIENCE|TECH|EDUCATION|RAW\s+MATERIALS)",
    re.I,
)
INSERTION_RE = re.compile(
    r"\b(solar\s+street\s*light|street\s*light|motorcycle|tricycle|keke|sewing\s+machine|"
    r"grinding\s+machine|make\s*up|makeup|palace|mosque|church|town\s*hall|asphalt\s+road)\b",
    re.I,
)
VAGUE_RE = re.compile(
    r"\b(selected\s+locations|multiple\s+lots|various\s+locations|across\s+the\s+nation|"
    r"nationwide|different\s+locations|special\s+intervention|constituency\s+projects)\b",
    re.I,
)
VEH_RE = re.compile(r"\b(suv|prado|land\s*cruiser|hilux|saloon|official\s+vehicle|utility\s+vehicle|project\s+vehicle|coaster\s+bus)\b", re.I)
CEREMONIAL_RE = re.compile(r"\b(palace|presidential\s+lodge|dodan\s+barracks|guest\s+house|mosque|church|hajj|pilgrim|make\s*up|makeup)\b", re.I)
SOFT_RE = re.compile(r"\b(advocacy|sensitization|workshop|seminar|consultancy|capacity\s+building|starter\s*pack)\b", re.I)


def evaluate_forensic_flag(title: str, amount: int, agency: str, code: str) -> str | None:
    """Returns concise forensic rule reason if line item triggers high-confidence criteria, else None."""
    if amount < 25_000_000 or not LEAF_CAP_RE.match(code):
        return None
    up_ag = (agency or "").upper()
    up_ti = (title or "").upper()
    is_sec = any(k in up_ag for k in SECURITY_TERMS)
    is_loan = any(k in up_ti for k in MULTILATERAL_TERMS)

    if (
        "POWER" not in up_ag
        and "WORKS" not in up_ag
        and "RURAL ELECTRIFICATION" not in up_ag
        and NON_CORE_MDA_RE.search(up_ag)
        and INSERTION_RE.search(title)
    ):
        return "MDA Mandate Mismatch (non-core insertion)"
    if amount >= 100_000_000 and not is_sec and VEH_RE.search(title):
        return "Non-Military Vehicle / Executive Fleet Outlay"
    if amount >= 500_000_000 and not is_loan and VAGUE_RE.search(title):
        return "Blank-Check / Selected-Locations Allocation"
    if amount >= 50_000_000 and not is_sec and CEREMONIAL_RE.search(title):
        return "Executive Quarters / Palace / Sectarian Spend"
    if amount >= 200_000_000 and not is_loan and SOFT_RE.search(title):
        return "High-Value Intangible Advocacy / Workshop / Consultancy"
    if amount >= 5_000_000_000:
        return "Mega Capital Allocation (>=₦5B)"
    return None


def parse_verbatim_qty(title: str) -> int | None:
    m = QTY_SUFFIX_RE.search(title)
    if m:
        v = int(m.group(1))
        if 0 < v < 50_000:
            return v
    m2 = QTY_PREFIX_RE.search(title)
    if m2:
        v = int(m2.group(1))
        if 0 < v < 50_000:
            return v
    return None


def atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _new_exec_state_bucket() -> dict[str, int]:
    return {
        "contractedCount": 0,
        "contractedNaira": 0,
        "nocopoPaidNaira": 0,
        "govspendVoucherCount": 0,
        "govspendDisbursedNaira": 0,
    }


def _collect_execution_layers(
    fts_sqlite_path: Path | None,
    budget_id_to_state: dict[str, str],
    ergp_to_state: dict[str, str],
) -> dict[str, Any]:
    """Stream awarded NOCOPO contracts and GovSpend disbursements into state/zone buckets."""
    yr_state: dict[int, dict[str, dict[str, int]]] = defaultdict(
        lambda: defaultdict(_new_exec_state_bucket)
    )
    yr_summary: dict[int, dict[str, int]] = defaultdict(
        lambda: {
            "nocopoAwardedCount": 0,
            "nocopoAwardedNaira": 0,
            "nocopoGeoMatchedCount": 0,
            "nocopoGeoMatchedNaira": 0,
            "nocopoHqNationwideCount": 0,
            "nocopoHqNationwideNaira": 0,
            "govspendVoucherCount": 0,
            "govspendDisbursedNaira": 0,
            "govspendGeoMatchedCount": 0,
            "govspendGeoMatchedNaira": 0,
            "govspendHqNationwideCount": 0,
            "govspendHqNationwideNaira": 0,
        }
    )
    cum_state: dict[str, dict[str, Any]] = {
        st: {
            **_new_exec_state_bucket(),
            "displayName": "FCT Abuja" if st == "Federal Capital Territory" else st,
            "zone": STATES_TO_ZONE[st],
            "_vendors": defaultdict(lambda: [0, 0]),
        }
        for st in CANONICAL_STATES
    }
    cum_zone: dict[str, dict[str, int]] = {z: _new_exec_state_bucket() for z in ZONE_POPULATIONS}

    summary_out: dict[str, Any] = {
        "nocopoYearsCovered": [],
        "nocopoTotalAwardedCount": 0,
        "nocopoTotalAwardedNaira": 0,
        "nocopoPlanningExcludedCount": 0,
        "nocopoGeoMatchedCount": 0,
        "nocopoGeoMatchedNaira": 0,
        "nocopoGeoMatchedPct": 0.0,
        "nocopoHqNationwideCount": 0,
        "nocopoHqNationwideNaira": 0,
        "govspendYearsCovered": [],
        "govspendTotalVoucherCount": 0,
        "govspendTotalDisbursedNaira": 0,
        "govspendGeoMatchedCount": 0,
        "govspendGeoMatchedNaira": 0,
        "govspendGeoMatchedPct": 0.0,
        "govspendHqNationwideCount": 0,
        "govspendHqNationwideNaira": 0,
        "cumulativeByZone": cum_zone,
        "cumulativeByState": {},
    }

    if not fts_sqlite_path or not fts_sqlite_path.exists():
        return {"summary": summary_out, "yrState": yr_state, "yrSummary": yr_summary}

    conn = sqlite3.connect(str(fts_sqlite_path))
    try:
        has_nocopo = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
        ).fetchone()
        if has_nocopo:
            planning_excluded = int(
                conn.execute(
                    "SELECT COUNT(*) FROM nocopo_contracts WHERE LOWER(COALESCE(stage, '')) IN ('planning', 'tender')"
                ).fetchone()[0]
                or 0
            )
            summary_out["nocopoPlanningExcludedCount"] = planning_excluded

            noc_years: set[int] = set()
            cursor = conn.execute(
                f"""
                SELECT financial_year, title, mda_name, contractor_name,
                       COALESCE(contract_award_naira, 0), COALESCE(total_paid_naira, 0),
                       budget_record_id, project_code
                FROM nocopo_contracts
                WHERE LOWER(COALESCE(stage, '')) IN {AWARDED_STAGES_SQL}
                """
            )
            for fy_raw, title_raw, mda_raw, vendor_raw, award_raw, paid_raw, brid_raw, pcode_raw in cursor:
                fy = int(fy_raw or 0)
                amt = max(0, int(round(float(award_raw or 0))))
                paid = max(0, int(round(float(paid_raw or 0))))
                title = str(title_raw or "")
                mda = str(mda_raw or "")
                brid = str(brid_raw or "").strip().upper()
                pcode = str(pcode_raw or "").strip().upper()

                linked_st = budget_id_to_state.get(brid) or ergp_to_state.get(pcode)
                zone, st, _ = GeoTaxonomy.detect_execution_location(
                    title, mda, linked_budget_state=linked_st, source_kind="nocopo"
                )

                summary_out["nocopoTotalAwardedCount"] += 1
                summary_out["nocopoTotalAwardedNaira"] += amt
                if fy > 0:
                    noc_years.add(fy)
                    ys = yr_summary[fy]
                    ys["nocopoAwardedCount"] += 1
                    ys["nocopoAwardedNaira"] += amt

                if st in cum_state:
                    summary_out["nocopoGeoMatchedCount"] += 1
                    summary_out["nocopoGeoMatchedNaira"] += amt
                    cs = cum_state[st]
                    cs["contractedCount"] += 1
                    cs["contractedNaira"] += amt
                    cs["nocopoPaidNaira"] += paid
                    vendor = re.sub(r"\s+", " ", str(vendor_raw or "").strip().upper())
                    if vendor and amt > 0:
                        cs["_vendors"][vendor][0] += amt
                        cs["_vendors"][vendor][1] += 1
                    if zone in cum_zone:
                        cum_zone[zone]["contractedCount"] += 1
                        cum_zone[zone]["contractedNaira"] += amt
                        cum_zone[zone]["nocopoPaidNaira"] += paid
                    if fy > 0:
                        ys["nocopoGeoMatchedCount"] += 1
                        ys["nocopoGeoMatchedNaira"] += amt
                        sb = yr_state[fy][st]
                        sb["contractedCount"] += 1
                        sb["contractedNaira"] += amt
                        sb["nocopoPaidNaira"] += paid
                else:
                    summary_out["nocopoHqNationwideCount"] += 1
                    summary_out["nocopoHqNationwideNaira"] += amt
                    if fy > 0:
                        ys["nocopoHqNationwideCount"] += 1
                        ys["nocopoHqNationwideNaira"] += amt

            summary_out["nocopoYearsCovered"] = sorted(noc_years)
            tot_noc = summary_out["nocopoTotalAwardedNaira"]
            summary_out["nocopoGeoMatchedPct"] = (
                round((summary_out["nocopoGeoMatchedNaira"] / tot_noc) * 100.0, 1)
                if tot_noc > 0
                else 0.0
            )

        has_gov = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
        ).fetchone()
        if has_gov:
            gov_years: set[int] = set()
            cursor = conn.execute(
                """
                SELECT financial_year, payment_date, organization_name,
                       COALESCE(amount_naira, 0), description
                FROM govspend_payments
                WHERE COALESCE(amount_naira, 0) > 0
                """
            )
            for fy_raw, pdate_raw, org_raw, amt_raw, desc_raw in cursor:
                amt = int(round(float(amt_raw or 0)))
                if amt <= 0:
                    continue
                pdate = str(pdate_raw or "")
                fy = int(fy_raw) if fy_raw else (int(pdate[:4]) if len(pdate) >= 4 and pdate[:4].isdigit() else 0)
                zone, st, _ = GeoTaxonomy.detect_execution_location(
                    str(desc_raw or ""),
                    str(org_raw or ""),
                    linked_budget_state=None,
                    source_kind="govspend",
                )

                summary_out["govspendTotalVoucherCount"] += 1
                summary_out["govspendTotalDisbursedNaira"] += amt
                if fy > 0:
                    gov_years.add(fy)
                    ys = yr_summary[fy]
                    ys["govspendVoucherCount"] += 1
                    ys["govspendDisbursedNaira"] += amt

                if st in cum_state:
                    summary_out["govspendGeoMatchedCount"] += 1
                    summary_out["govspendGeoMatchedNaira"] += amt
                    cs = cum_state[st]
                    cs["govspendVoucherCount"] += 1
                    cs["govspendDisbursedNaira"] += amt
                    if zone in cum_zone:
                        cum_zone[zone]["govspendVoucherCount"] += 1
                        cum_zone[zone]["govspendDisbursedNaira"] += amt
                    if fy > 0:
                        ys["govspendGeoMatchedCount"] += 1
                        ys["govspendGeoMatchedNaira"] += amt
                        sb = yr_state[fy][st]
                        sb["govspendVoucherCount"] += 1
                        sb["govspendDisbursedNaira"] += amt
                else:
                    summary_out["govspendHqNationwideCount"] += 1
                    summary_out["govspendHqNationwideNaira"] += amt
                    if fy > 0:
                        ys["govspendHqNationwideCount"] += 1
                        ys["govspendHqNationwideNaira"] += amt

            summary_out["govspendYearsCovered"] = sorted(gov_years)
            tot_gov = summary_out["govspendTotalDisbursedNaira"]
            summary_out["govspendGeoMatchedPct"] = (
                round((summary_out["govspendGeoMatchedNaira"] / tot_gov) * 100.0, 1)
                if tot_gov > 0
                else 0.0
            )
    finally:
        conn.close()

    cum_state_clean: dict[str, Any] = {}
    for st, cs in cum_state.items():
        top_v = sorted(cs.pop("_vendors").items(), key=lambda kv: (-kv[1][0], -kv[1][1]))[:3]
        cs["topContractors"] = [
            {"name": k, "awardedNaira": v[0], "count": v[1]} for k, v in top_v
        ]
        cum_state_clean[st] = cs
    summary_out["cumulativeByState"] = cum_state_clean

    return {"summary": summary_out, "yrState": yr_state, "yrSummary": yr_summary}


def build_indexes(
    datasets_root: Path = DEFAULT_DATASETS_DIR,
    fts_sqlite_path: Path | None = DEFAULT_FTS_SQLITE,
) -> tuple[dict[str, Any], dict[str, Any]]:
    years = sorted(int(d.name) for d in datasets_root.iterdir() if d.is_dir() and d.name.isdigit())

    # ── Asset Inventory accumulators ──────────────────────────────────────────
    asset_ledger: dict[str, dict[str, Any]] = {}
    for cfg in ASSET_CATALOG:
        asset_ledger[cfg["itemKey"]] = {
            "itemKey": cfg["itemKey"],
            "label": cfg["label"],
            "categoryGroup": cfg["categoryGroup"],
            "lifespanYears": cfg["lifespanYears"],
            "baseUnitPrice2023": cfg["baseUnitPrice2023"],
            "totalSpendNaira": 0,
            "totalLineCount": 0,
            "verbatimQuantity": 0,
            "verbatimRecordCount": 0,
            "estimatedQuantity": 0,
            "estimatedRecordCount": 0,
            "byYear": {},
            "_records": [],
        }

    # (normalized_mda, itemKey) -> { year -> { spend, verbatimQty, count, items } }
    mda_repeat_map: dict[tuple[str, str], dict[int, dict[str, Any]]] = defaultdict(dict)

    # ── Geo-Intelligence accumulators ─────────────────────────────────────────
    geo_years: dict[str, Any] = {}
    prev_state_totals: dict[str, int] = {}
    budget_id_to_state: dict[str, str] = {}
    ergp_to_state: dict[str, str] = {}

    for yr in years:
        proj_file = datasets_root / str(yr) / "projects.min.json"
        if not proj_file.exists():
            continue
        records = json.loads(proj_file.read_text(encoding="utf-8"))
        infl = ASSET_INFLATION_FROM_2023.get(yr, 1.0)

        # Year accumulators for Geo-Intelligence
        zone_acc: dict[str, dict[str, Any]] = {
            z: {
                "name": z,
                "amountNaira": 0,
                "projectCount": 0,
                "flaggedCount": 0,
                "flaggedAmountNaira": 0,
                "population": ZONE_POPULATIONS[z],
                "mdaTotals": defaultdict(int),
                "topProjects": [],
            }
            for z in ZONE_POPULATIONS.keys()
        }
        state_acc: dict[str, dict[str, Any]] = {
            st: {
                "name": st,
                "displayName": "FCT Abuja" if st == "Federal Capital Territory" else st,
                "zone": STATES_TO_ZONE[st],
                "amountNaira": 0,
                "projectCount": 0,
                "flaggedCount": 0,
                "flaggedAmountNaira": 0,
                "mdaTotals": defaultdict(int),
                "primaryFlaggedItem": None,
                "largestItem": None,
                "topProjects": [],
                "lgaMap": {},
                "lgaMappedCount": 0,
                "unmappedLgaCount": 0,
            }
            for st in CANONICAL_STATES
        }

        total_leaf_items = 0
        total_leaf_amount = 0
        geo_tagged_items = 0
        geo_tagged_amount = 0
        hq_items = 0
        hq_amount = 0
        flagged_total = 0

        for r in records:
            code = str(r.get("projectCode") or "").strip()
            if MDA_ROLLUP_RE.match(code):
                continue

            amt = int(r.get("amount") or 0)
            if amt <= 0:
                continue

            title = (r.get("projectName") or "").strip()
            if not title:
                continue
            agency = (r.get("agency") or "Federal MDA").strip()
            sector = (r.get("sector") or "General").strip()
            page = int(r.get("page") or 1)
            rid = str(r.get("id") or code)

            total_leaf_items += 1
            total_leaf_amount += amt

            # 1. Geo-tagging + forensic flag evaluation
            zone, state, lga = GeoTaxonomy.detect_from_record(title, agency)
            reason = evaluate_forensic_flag(title, amt, agency, code)
            is_flagged = reason is not None
            if is_flagged:
                flagged_total += 1

            if state == "HQ / Federal Direct" or state not in state_acc:
                hq_items += 1
                hq_amount += amt
            else:
                if rid:
                    budget_id_to_state[rid.upper()] = state
                if code and not GENERIC_ERGP_RE.match(code) and len(code) >= 7:
                    ergp_to_state.setdefault(code.upper(), state)
                geo_tagged_items += 1
                geo_tagged_amount += amt
                sa = state_acc[state]
                sa["amountNaira"] += amt
                sa["projectCount"] += 1
                sa["mdaTotals"][agency] += amt
                if is_flagged:
                    sa["flaggedCount"] += 1
                    sa["flaggedAmountNaira"] += amt

                proj_stub = {
                    "id": rid,
                    "projectCode": code or rid,
                    "projectName": title,
                    "agency": agency,
                    "state": state,
                    "lga": lga,
                    "amount": amt,
                    "page": page,
                    "financialYear": yr,
                    "sector": sector,
                    "isFlagged": is_flagged,
                    "ruleReason": reason,
                }
                if sa["largestItem"] is None or amt > sa["largestItem"]["amount"]:
                    sa["largestItem"] = proj_stub
                if is_flagged and (sa["primaryFlaggedItem"] is None or amt > sa["primaryFlaggedItem"]["amount"]):
                    sa["primaryFlaggedItem"] = proj_stub
                sa["topProjects"].append(proj_stub)

                if lga != "Unmapped LGA":
                    sa["lgaMappedCount"] += 1
                    le = sa["lgaMap"].get(lga)
                    if le is None:
                        sa["lgaMap"][lga] = {
                            "lgaName": lga,
                            "projectCount": 1,
                            "amountNaira": amt,
                            "flaggedCount": 1 if is_flagged else 0,
                            "topProjectTitle": title,
                            "topProjectCode": code or rid,
                            "topProjectAmount": amt,
                            "topProjectPage": page,
                            "topProjectAgency": agency,
                        }
                    else:
                        le["projectCount"] += 1
                        le["amountNaira"] += amt
                        if is_flagged:
                            le["flaggedCount"] += 1
                        if amt > le["topProjectAmount"]:
                            le["topProjectTitle"] = title
                            le["topProjectCode"] = code or rid
                            le["topProjectAmount"] = amt
                            le["topProjectPage"] = page
                            le["topProjectAgency"] = agency
                else:
                    sa["unmappedLgaCount"] += 1

                if zone in zone_acc:
                    za = zone_acc[zone]
                    za["amountNaira"] += amt
                    za["projectCount"] += 1
                    za["mdaTotals"][agency] += amt
                    if is_flagged:
                        za["flaggedCount"] += 1
                        za["flaggedAmountNaira"] += amt
                    za["topProjects"].append(proj_stub)

            # 2. Physical Asset Inventory (capital items only, excluding maintenance/fuel/business)
            if COA_OH_PERS_RE.match(code) or ASSET_EXCLUSION_RE.search(title):
                continue

            for cfg in ASSET_CATALOG:
                if cfg["pattern"].search(title):
                    key = cfg["itemKey"]
                    entry = asset_ledger[key]
                    vqty = parse_verbatim_qty(title)
                    if vqty is not None:
                        qty = vqty
                        is_est = False
                        implied_unit = int(round(amt / vqty))
                        entry["verbatimQuantity"] += vqty
                        entry["verbatimRecordCount"] += 1
                    else:
                        adj_unit = cfg["baseUnitPrice2023"] * infl
                        qty = max(1, int(round(amt / adj_unit)))
                        is_est = True
                        implied_unit = None
                        entry["estimatedQuantity"] += qty
                        entry["estimatedRecordCount"] += 1

                    entry["totalSpendNaira"] += amt
                    entry["totalLineCount"] += 1
                    yb = entry["byYear"].setdefault(
                        str(yr),
                        {"year": yr, "spendNaira": 0, "lineCount": 0, "verbatimQty": 0, "estimatedQty": 0},
                    )
                    yb["spendNaira"] += amt
                    yb["lineCount"] += 1
                    if is_est:
                        yb["estimatedQty"] += qty
                    else:
                        yb["verbatimQty"] += qty

                    entry["_records"].append({
                        "id": rid,
                        "financialYear": yr,
                        "projectCode": code or rid,
                        "projectName": title,
                        "agency": agency,
                        "sector": sector,
                        "state": state if state != "HQ / Federal Direct" else None,
                        "amount": amt,
                        "page": page,
                        "verbatimQty": vqty,
                        "estimatedQty": qty if is_est else None,
                        "impliedUnitCostNaira": implied_unit,
                    })

                    # Multi-year repeat procurement tracking (exclude generic ministry HQ if blank)
                    if agency and agency != "Federal MDA":
                        norm_mda = re.sub(r"\s+", " ", agency.upper()).strip()
                        yr_slot = mda_repeat_map[(norm_mda, key)].setdefault(
                            yr,
                            {"spendNaira": 0, "count": 0, "verbatimQty": 0, "items": []},
                        )
                        yr_slot["spendNaira"] += amt
                        yr_slot["count"] += 1
                        if vqty:
                            yr_slot["verbatimQty"] += vqty
                        yr_slot["items"].append({
                            "id": rid,
                            "financialYear": yr,
                            "projectCode": code or rid,
                            "projectName": title,
                            "agency": agency,
                            "amount": amt,
                            "page": page,
                            "verbatimQty": vqty,
                        })

        # Finalize Zone & State payloads for `yr`
        zones_out: dict[str, Any] = {}
        for z_name, za in zone_acc.items():
            top_mda = max(za["mdaTotals"].items(), key=lambda kv: kv[1], default=("None Tagged", 0))
            state_shares = sorted(
                [
                    {
                        "state": st,
                        "displayName": state_acc[st]["displayName"],
                        "amountNaira": state_acc[st]["amountNaira"],
                        "projectCount": state_acc[st]["projectCount"],
                        "flaggedCount": state_acc[st]["flaggedCount"],
                    }
                    for st in CANONICAL_STATES
                    if state_acc[st]["zone"] == z_name
                ],
                key=lambda x: x["amountNaira"],
                reverse=True,
            )
            za["topProjects"].sort(key=lambda x: x["amount"], reverse=True)
            zones_out[z_name] = {
                "name": z_name,
                "amountNaira": za["amountNaira"],
                "projectCount": za["projectCount"],
                "flaggedCount": za["flaggedCount"],
                "flaggedAmountNaira": za["flaggedAmountNaira"],
                "population": za["population"],
                "perCapitaNaira": round(za["amountNaira"] / za["population"], 2) if za["population"] > 0 else 0,
                "topMinistry": top_mda[0],
                "topMinistryAmountNaira": top_mda[1],
                "stateShares": state_shares,
                "topProjects": za["topProjects"][:5],
            }

        states_out: dict[str, Any] = {}
        new_prev_totals: dict[str, int] = {}
        for st, sa in state_acc.items():
            amt_now = sa["amountNaira"]
            new_prev_totals[st] = amt_now
            amt_prev = prev_state_totals.get(st, 0)
            yoy_pct = round(((amt_now - amt_prev) / amt_prev) * 100, 1) if amt_prev > 0 else None

            cnt = sa["projectCount"]
            fl = sa["flaggedCount"]
            fl_share = round((fl / cnt) * 100, 1) if cnt > 0 else 0.0
            if fl >= 25 or (cnt >= 10 and fl_share >= 15.0) or sa["flaggedAmountNaira"] >= 25_000_000_000:
                score = "High"
            elif fl >= 8 or (cnt >= 5 and fl_share >= 7.0) or sa["flaggedAmountNaira"] >= 5_000_000_000:
                score = "Medium"
            elif fl >= 1:
                score = "Low"
            else:
                score = "None"

            top_mda = max(sa["mdaTotals"].items(), key=lambda kv: kv[1], default=("None Tagged", 0))
            sa["topProjects"].sort(key=lambda x: x["amount"], reverse=True)
            lga_list = sorted(sa["lgaMap"].values(), key=lambda x: x["amountNaira"], reverse=True)[:25]

            states_out[st] = {
                "name": st,
                "displayName": sa["displayName"],
                "zone": sa["zone"],
                "amountNaira": amt_now,
                "projectCount": cnt,
                "flaggedCount": fl,
                "flaggedAmountNaira": sa["flaggedAmountNaira"],
                "flaggedSharePct": fl_share,
                "anomalyScore": score,
                "yoyDeltaPct": yoy_pct,
                "priorYear": yr - 1 if amt_prev > 0 else None,
                "topMinistry": top_mda[0],
                "topMinistryAmountNaira": top_mda[1],
                "primaryItem": sa["primaryFlaggedItem"] or sa["largestItem"],
                "topProjects": sa["topProjects"][:6],
                "lgaMappedCount": sa["lgaMappedCount"],
                "unmappedLgaCount": sa["unmappedLgaCount"],
                "lgaBreakdown": lga_list,
            }
        prev_state_totals = new_prev_totals

        geo_years[str(yr)] = {
            "financialYear": yr,
            "summary": {
                "totalLeafItems": total_leaf_items,
                "totalBudgetNaira": total_leaf_amount,
                "geoTaggedItems": geo_tagged_items,
                "geoTaggedAmountNaira": geo_tagged_amount,
                "federalHqItems": hq_items,
                "federalHqAmountNaira": hq_amount,
                "geoCoveragePct": round((geo_tagged_amount / total_leaf_amount) * 100, 1) if total_leaf_amount > 0 else 0.0,
                "flaggedItemsTotal": flagged_total,
            },
            "zones": zones_out,
            "states": states_out,
        }

    # Finalize Asset Inventory payload
    cfg_by_key = {c["itemKey"]: c for c in ASSET_CATALOG}
    categories_out: list[dict[str, Any]] = []
    for key, entry in asset_ledger.items():
        recs = sorted(entry.pop("_records"), key=lambda x: x["amount"], reverse=True)
        entry["topRecords"] = recs[:45]
        v_cnt = entry["verbatimRecordCount"]
        v_qty = entry["verbatimQuantity"]
        v_spend = sum(r["amount"] for r in recs if r["verbatimQty"])
        entry["avgVerbatimUnitCostNaira"] = int(round(v_spend / v_qty)) if v_qty > 0 else None
        entry["byYear"] = dict(sorted(entry["byYear"].items()))
        categories_out.append(entry)
    categories_out.sort(key=lambda x: x["totalSpendNaira"], reverse=True)

    # Multi-year repeat procurement / antiquity alerts
    repeat_alerts: list[dict[str, Any]] = []
    for (mda_name, key), yr_dict in mda_repeat_map.items():
        yrs_active = sorted(yr_dict.keys())
        if len(yrs_active) < 2:
            continue
        cfg = cfg_by_key[key]
        lifespan = cfg["lifespanYears"]
        # Trigger if consecutive or repeated procurements fall inside the asset's usable lifespan window
        within_lifespan = any((yrs_active[i + 1] - yrs_active[i]) < lifespan for i in range(len(yrs_active) - 1))
        if not within_lifespan:
            continue
        total_spend = sum(v["spendNaira"] for v in yr_dict.values())
        if total_spend < 100_000_000:
            continue
        alloc_count = sum(v["count"] for v in yr_dict.values())
        vqty_sum = sum(v["verbatimQty"] for v in yr_dict.values())
        flat_items = []
        for y in reversed(yrs_active):
            flat_items.extend(yr_dict[y]["items"])
        flat_items.sort(key=lambda x: x["amount"], reverse=True)
        repeat_alerts.append({
            "mdaName": mda_name,
            "assetCategory": key,
            "categoryLabel": cfg["label"],
            "lifespanYears": lifespan,
            "yearsActive": yrs_active,
            "allocationCount": alloc_count,
            "totalSpendNaira": total_spend,
            "verbatimTotalUnits": vqty_sum,
            "wasteRisk": "HIGH" if (len(yrs_active) >= 3 or total_spend >= 1_000_000_000) else "MEDIUM",
            "records": flat_items[:10],
        })
    repeat_alerts.sort(key=lambda x: x["totalSpendNaira"], reverse=True)

    # Join NOCOPO Awarded & GovSpend Cash Execution Layers across 36 States + FCT
    exec_layers = _collect_execution_layers(
        Path(fts_sqlite_path) if fts_sqlite_path else None,
        budget_id_to_state,
        ergp_to_state,
    )
    yr_exec_states = exec_layers["yrState"]
    yr_exec_summary = exec_layers["yrSummary"]

    for yr_str, g_yr in geo_years.items():
        yr_int = int(yr_str)
        st_exec_map = yr_exec_states.get(yr_int, {})
        ys = yr_exec_summary.get(yr_int)

        noc_tot = ys["nocopoAwardedNaira"] if ys else 0
        noc_geo = ys["nocopoGeoMatchedNaira"] if ys else 0
        gov_tot = ys["govspendDisbursedNaira"] if ys else 0
        gov_geo = ys["govspendGeoMatchedNaira"] if ys else 0
        g_yr["summary"]["execution"] = {
            "nocopoAwardedCount": ys["nocopoAwardedCount"] if ys else 0,
            "nocopoGeoMatchedCount": ys["nocopoGeoMatchedCount"] if ys else 0,
            "nocopoGeoMatchedNaira": noc_geo,
            "nocopoHqNationwideNaira": ys["nocopoHqNationwideNaira"] if ys else 0,
            "nocopoGeoMatchedPct": round((noc_geo / noc_tot) * 100.0, 1) if noc_tot > 0 else 0.0,
            "govspendVoucherCount": ys["govspendVoucherCount"] if ys else 0,
            "govspendGeoMatchedCount": ys["govspendGeoMatchedCount"] if ys else 0,
            "govspendGeoMatchedNaira": gov_geo,
            "govspendHqNationwideNaira": ys["govspendHqNationwideNaira"] if ys else 0,
            "govspendGeoMatchedPct": round((gov_geo / gov_tot) * 100.0, 1) if gov_tot > 0 else 0.0,
        }

        for st_name, st_entry in g_yr["states"].items():
            eb = st_exec_map.get(st_name) or _new_exec_state_bucket()
            st_entry["contractedCount"] = eb["contractedCount"]
            st_entry["contractedNaira"] = eb["contractedNaira"]
            st_entry["nocopoPaidNaira"] = eb["nocopoPaidNaira"]
            st_entry["govspendVoucherCount"] = eb["govspendVoucherCount"]
            st_entry["govspendDisbursedNaira"] = eb["govspendDisbursedNaira"]

        for z_entry in g_yr["zones"].values():
            z_contracted_cnt = 0
            z_contracted = 0
            z_noc_paid = 0
            z_gov_cnt = 0
            z_gov_paid = 0
            for sh in z_entry.get("stateShares") or []:
                eb = st_exec_map.get(sh["state"]) or _new_exec_state_bucket()
                sh["contractedCount"] = eb["contractedCount"]
                sh["contractedNaira"] = eb["contractedNaira"]
                sh["nocopoPaidNaira"] = eb["nocopoPaidNaira"]
                sh["govspendVoucherCount"] = eb["govspendVoucherCount"]
                sh["govspendDisbursedNaira"] = eb["govspendDisbursedNaira"]
                z_contracted_cnt += eb["contractedCount"]
                z_contracted += eb["contractedNaira"]
                z_noc_paid += eb["nocopoPaidNaira"]
                z_gov_cnt += eb["govspendVoucherCount"]
                z_gov_paid += eb["govspendDisbursedNaira"]
            z_entry["contractedCount"] = z_contracted_cnt
            z_entry["contractedNaira"] = z_contracted
            z_entry["nocopoPaidNaira"] = z_noc_paid
            z_entry["govspendVoucherCount"] = z_gov_cnt
            z_entry["govspendDisbursedNaira"] = z_gov_paid

    asset_payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "yearsCovered": years,
        "categories": categories_out,
        "repeatAlerts": repeat_alerts[:120],
    }

    geo_payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "yearsCovered": years,
        "executionSummary": exec_layers["summary"],
        "years": geo_years,
    }

    atomic_write_json(datasets_root / "asset_inventory_index.json", asset_payload)
    atomic_write_json(datasets_root / "geo_intelligence_index.json", geo_payload)
    return asset_payload, geo_payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build 36-State + FCT Geo & Physical Asset Indexes")
    parser.add_argument("--datasets-dir", default=str(DEFAULT_DATASETS_DIR))
    parser.add_argument("--fts-sqlite", default=str(DEFAULT_FTS_SQLITE))
    args = parser.parse_args()

    asset_p, geo_p = build_indexes(
        datasets_root=Path(args.datasets_dir),
        fts_sqlite_path=Path(args.fts_sqlite),
    )
    es = geo_p["executionSummary"]
    print(f"Indexed {len(geo_p['yearsCovered'])} years ({geo_p['yearsCovered'][0]}-{geo_p['yearsCovered'][-1]})")
    print(
        f"  NOCOPO Awarded: {es['nocopoGeoMatchedCount']:,}/{es['nocopoTotalAwardedCount']:,} geo-tagged "
        f"({es['nocopoGeoMatchedPct']}% of N{es['nocopoTotalAwardedNaira']/1e12:.2f}T) | "
        f"HQ/Nationwide=N{es['nocopoHqNationwideNaira']/1e12:.2f}T | Planning excluded={es['nocopoPlanningExcludedCount']:,}"
    )
    print(
        f"  GovSpend Paid: {es['govspendGeoMatchedCount']:,}/{es['govspendTotalVoucherCount']:,} geo-tagged "
        f"({es['govspendGeoMatchedPct']}% of N{es['govspendTotalDisbursedNaira']/1e12:.2f}T) | "
        f"HQ/Nationwide=N{es['govspendHqNationwideNaira']/1e12:.2f}T"
    )
    top_exec_states = sorted(
        es["cumulativeByState"].items(),
        key=lambda kv: (-kv[1]["govspendDisbursedNaira"], -kv[1]["contractedNaira"]),
    )[:8]
    for st_name, sb in top_exec_states:
        print(
            f"    {sb['displayName']:18s} | Contracted=N{sb['contractedNaira']/1e9:7.1f}B ({sb['contractedCount']:,}) | "
            f"GovSpend=N{sb['govspendDisbursedNaira']/1e9:7.1f}B ({sb['govspendVoucherCount']:,})"
        )
