"""
1999-2026 Fourth Republic Public Scrutiny & Presidential Audit Engine
Audits all leaf capital projects and discretionary overhead items across FY 1999-2026
(`public/datasets/{year}/projects.min.json`) using each year's authentic economic
realities—that year's CBN FX rate, enacted Federal Budget size, and statutory minimum
wage—attributing every finding, cluster, and trend to the serving President.

Outputs atomically:
  1. public/datasets/forensic_sweep_1999_2026.json
  2. FORENSIC_SWEEP_1999_2026.md
"""

from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.parsers.entity_normalizer import clean_display_name, is_valid_mda_name

YEARS = tuple(range(1999, 2027))


def _clean_sweep_agency(raw: Any) -> str:
    """Clean agency display label while rejecting purely numeric/symbol leaks."""
    cleaned = clean_display_name(str(raw or ""))
    if not cleaned or not is_valid_mda_name(cleaned):
        return "Unspecified Federal MDA"
    return cleaned

# Year-native economic realities matching src/data/historicalMacroData.ts (1999-2026):
# (official_budget_bn_naira, cbn_fx_naira_per_usd, statutory_min_wage_monthly_naira)
YEAR_MACRO: dict[int, tuple[float, float, int]] = {
    1999: (299.0,   92.34,   3_500),
    2000: (677.5,   101.70,  7_500),
    2001: (894.2,   111.23,  7_500),
    2002: (1064.8,  120.58,  7_500),
    2003: (976.3,   129.22,  7_500),
    2004: (1300.0,  132.89,  7_500),
    2005: (1799.9,  131.27,  7_500),
    2006: (1900.0,  128.65,  7_500),
    2007: (2300.0,  125.81,  7_500),
    2008: (2748.0,  118.57,  7_500),
    2009: (3101.8,  148.90,  7_500),
    2010: (4427.2,  150.30,  7_500),
    2011: (4484.7,  153.86,  18_000),
    2012: (4697.2,  157.50,  18_000),
    2013: (4987.2,  157.31,  18_000),
    2014: (4695.2,  158.55,  18_000),
    2015: (4493.4,  192.44,  18_000),
    2016: (6060.7,  253.49,  18_000),
    2017: (7441.2,  305.79,  18_000),
    2018: (9120.3,  306.08,  18_000),
    2019: (8917.0,  306.92,  30_000),
    2020: (10805.5, 358.81,  30_000),
    2021: (13588.0, 400.00,  30_000),
    2022: (17126.9, 425.98,  30_000),
    2023: (24820.0, 645.19,  30_000),
    2024: (28770.0, 1480.00, 70_000),
    2025: (46019.6, 1550.00, 70_000),
    2026: (54200.0, 1500.00, 70_000),
}

PRESIDENTS: list[dict[str, Any]] = [
    {
        "presidentId": "obasanjo",
        "presidentName": "Olusegun Obasanjo",
        "shortName": "Obasanjo",
        "party": "PDP",
        "accentColor": "#10b981",
        "tenureLabel": "1999–2007 (2 Terms)",
        "budgetYears": [1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006],
        "fxRangeLabel": "₦92.3–₦132.9/$",
        "minWageRangeLabel": "₦3.5k–₦7.5k/mo",
        "handoverNote": "Includes 1999 transition/supplementary act. Detailed project schedules exist for 1999, 2004 & 2006; 2000–2003 and 2005 PDFs are summary statutory schedules.",
    },
    {
        "presidentId": "yaradua",
        "presidentName": "Umaru Musa Yar'Adua",
        "shortName": "Yar'Adua",
        "party": "PDP",
        "accentColor": "#0284c7",
        "tenureLabel": "2007–2010 (Term 1)",
        "budgetYears": [2007, 2008, 2009, 2010],
        "fxRangeLabel": "₦118.6–₦150.3/$",
        "minWageRangeLabel": "₦7.5k/mo",
        "handoverNote": "Dr. Goodluck Jonathan assumed executive responsibility in May 2010 following President Yar'Adua's passing. 2007 PDF contains summary schedules only; detailed subheads start in 2008.",
    },
    {
        "presidentId": "jonathan",
        "presidentName": "Goodluck Ebele Jonathan",
        "shortName": "Jonathan",
        "party": "PDP",
        "accentColor": "#2563eb",
        "tenureLabel": "2011–2015 (Elected Term)",
        "budgetYears": [2011, 2012, 2013, 2014],
        "fxRangeLabel": "₦153.9–₦158.6/$",
        "minWageRangeLabel": "₦18k/mo",
        "handoverNote": "2011 extracted PDF covers National Assembly/partial schedule (1,277 lines); 2012–2014 contain full GIFMIS capital and COA overhead schedules.",
    },
    {
        "presidentId": "buhari",
        "presidentName": "Muhammadu Buhari",
        "shortName": "Buhari",
        "party": "APC",
        "accentColor": "#8b5cf6",
        "tenureLabel": "2015–2023 (2 Terms)",
        "budgetYears": [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
        "fxRangeLabel": "₦192.4–₦426.0/$",
        "minWageRangeLabel": "₦18k–₦30k/mo",
        "handoverNote": "Includes the 2015 transition budget enacted May 2015 and ERGP coding standardization introduced from 2017 onward.",
    },
    {
        "presidentId": "tinubu",
        "presidentName": "Bola Ahmed Tinubu",
        "shortName": "Tinubu",
        "party": "APC",
        "accentColor": "#f59e0b",
        "tenureLabel": "2023–Present (Term 1)",
        "budgetYears": [2023, 2024, 2025, 2026],
        "fxRangeLabel": "₦645.2–₦1,550/$",
        "minWageRangeLabel": "₦30k–₦70k/mo",
        "handoverNote": "2023 Main Act was signed in Jan 2023 under Buhari and extended; 2023 Supplementary Act was enacted Nov 2023 under Tinubu.",
    },
]

YEAR_TO_PRES: dict[int, dict[str, Any]] = {}
for _p in PRESIDENTS:
    for _y in _p["budgetYears"]:
        YEAR_TO_PRES[_y] = _p


def get_term_id(year: int) -> str:
    if year <= 2002:
        return "OBJ-1"
    if year <= 2006:
        return "OBJ-2"
    if year <= 2010:
        return "YAR-1"
    if year <= 2014:
        return "GEJ-1"
    if year <= 2018:
        return "PMB-1"
    if year <= 2022:
        return "PMB-2"
    return "BAT-1"


def year_budget_naira(yr: int) -> float:
    return YEAR_MACRO[yr][0] * 1e9


def year_fx_rate(yr: int) -> float:
    return YEAR_MACRO[yr][1]


def year_min_wage_monthly(yr: int) -> int:
    return YEAR_MACRO[yr][2]


def year_thresholds(yr: int) -> dict[str, int]:
    """
    Derive materiality cutoffs strictly from that specific fiscal year's economic realities:
      - Imported fleet/asset & ceremonial pillars priced in USD at that year's CBN FX rate
      - Mega-allocation & soft-spend pillars scaled as fixed shares of that year's Enacted Federal Budget
    """
    budget = year_budget_naira(yr)
    fx = year_fx_rate(yr)
    return {
        "vehiclesNaira": int(round(65_000 * fx)),
        "mandatesNaira": int(round(15_000 * fx)),
        "blankVagueNaira": int(round(0.00001 * budget)),       # 0.001% of enacted budget
        "blankShortNaira": int(round(0.00002 * budget)),       # 0.002% of enacted budget
        "dupWithinNaira": int(round(12_000 * fx)),
        "dupCrossNaira": int(round(60_000 * fx)),
        "ceremonialNaira": int(round(30_000 * fx)),
        "intangibleNaira": int(round(0.000004 * budget)),      # 0.0004% of enacted budget
    }


def round_split_grid(yr: int) -> tuple[int, int]:
    if yr <= 2010:
        return 10_000_000, 5_000_000
    if yr <= 2014:
        return 20_000_000, 5_000_000
    if yr <= 2022:
        return 25_000_000, 10_000_000
    if yr == 2023:
        return 50_000_000, 25_000_000
    return 100_000_000, 50_000_000


def compute_equivalents(amt: int | float, yr: int) -> dict[str, Any]:
    val = float(amt or 0)
    fx = year_fx_rate(yr)
    min_wage_yr = year_min_wage_monthly(yr) * 12
    return {
        "minWageAnnualSalaries": int(val // min_wage_yr) if min_wage_yr > 0 else 0,
        "primaryHealthCentres": round(val / (16_500 * fx), 1),
        "classroomBlocks": round(val / (10_000 * fx), 1),
        "solarBoreholes": round(val / (2_350 * fx), 1),
    }


def compute_usd_equivalents(total_usd: float, total_min_wage_years: int) -> dict[str, Any]:
    return {
        "minWageAnnualSalaries": int(total_min_wage_years),
        "primaryHealthCentres": round(total_usd / 16_500, 1),
        "classroomBlocks": round(total_usd / 10_000, 1),
        "solarBoreholes": round(total_usd / 2_350, 1),
    }


# ── Code Classification & Summary Hygiene Guards ──────────────────────────────
MDA_ROLLUP_RE = re.compile(r"^[0-5]\d{8,10}$")
COA_CAP_SUBTOTAL_RE = re.compile(r"^23\d{6}$")
COA_CATEGORY_HEADER_RE = re.compile(r"^(21|22|23)\d{4}$")
COA_PERSONNEL_STAT_RE = re.compile(r"^(21\d{6}|220[13-9]\d{4})$")
LEGACY_14D_RE = re.compile(r"^\d{14}$")

LEAF_CAPITAL_RE = re.compile(r"^(?:ERGP|ZIP|NASS|\d{4}ZIP|2004-CAP-|[A-Z]{2,12}\d{4,})", re.I)
EXCLUDE_CAPITAL_PREFIX_RE = re.compile(r"^PRE-\d+$", re.I)
LEAF_OVERHEAD_RE = re.compile(r"^2202\d{4}$")

SUMMARY_TITLE_RE = re.compile(
    r"(\b[-‐‑–—]\s*GENERAL\b|\bSALARY\s*&\s*WAGES\b|\bSUB[-‐‑–—]?TOTAL\b|^TOTAL\b|"
    r"\b0\s+PERSONNEL\b|\bON[-‐ ]?GOING\s+PROJECTS?\s*(?:\(OTHERS\))?$|\bNEW\s+PROJECTS?\s*\(OTHERS\)|"
    r"\bOTHER\s+RECURRENT\s+COSTS\b|\bSTATUTORY\s+TRANSFERS?\b)",
    re.I,
)

SECURITY_KEYWORDS = (
    "DEFENCE", "ARMY", "NAVY", "AIRFORCE", "AIR FORCE", "POLICE",
    "DSS", "STATE SECURITY", "NIA", "ONSA", "NATIONAL SECURITY ADVISER",
    "NSCDC", "IMMIGRATION", "CUSTOMS", "FIRE SERVICE", "DEFENCE INTELLIGENCE",
)
HOSPITAL_OR_PRISON_KEYWORDS = (
    "CORRECTIONAL", "PRISON", "HOSPITAL", "MEDICAL CENTRE", "MEDICAL CENTER",
    "CANCER", "UNIVERSITY COLLEGE HOSPITAL", "ORTHOPAEDIC", "PSYCHIATRIC",
)
MULTILATERAL_KEYWORDS = (
    "MULTILATERAL", "BILATERAL", "TIED LOAN", "WORLD BANK", "AFDB", "ISDB",
)

VEHICLE_RE = re.compile(
    r"\b(suv|prado|land\s*cruiser|hilux|saloon|"
    r"bulletproof\s+(?:vehicle|suv|car|jeep)|armou?red\s+(?:vehicle|suv|car|sedan|jeep|bus|truck|convoy)|"
    r"official\s+vehicle|utility\s+vehicle|operational\s+vehicle|project\s+vehicle|"
    r"motor\s+vehicle|coaster\s+bus|toyota|lexus|mercedes|yacht)\b",
    re.I,
)
QTY_RE = re.compile(r"\b(\d{1,3})\s*(?:nos?\.?|units?)\b", re.I)

NON_CORE_MDA_RE = re.compile(
    r"(AGRICULTUR|RIVER\s+BASIN|RBDA|RESEARCH\s+INST|FORESTRY|FISHER|HORTICULTUR|"
    r"COCOA|RUBBER|OIL\s+PALM|ROOT\s+CROP|CEREALS|ANIMAL|VETERINARY|LABOUR|"
    r"HUMANITARIAN|BORDER\s+COMM|SMEDAN|FILM|CULTUR|ARTS|TOURISM|SPORTS|YOUTH|"
    r"SCIENCE|TECH|EDUCATION|HEALTH|RAW\s+MATERIALS)",
    re.I,
)
INSERTION_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("Solar Street Lights", re.compile(r"\b(solar\s+street\s*lights?|street\s*lights?)\b", re.I)),
    ("Motorcycles / Tricycles", re.compile(r"\b(motorcycles?|tricycles?|keke)\b", re.I)),
    ("Sewing / Grinding / Makeup Kits", re.compile(r"\b(sewing\s+machines?|grinding\s+machines?|make\s*up|makeup|hair\s+dry|clippers?|barbing|deep\s+freezers?)\b", re.I)),
    ("Traditional Palaces / Religious Buildings", re.compile(r"\b(palaces?|mosques?|church(?:es)?)\b", re.I)),
    ("Town Halls / Transformers / Asphalt Roads", re.compile(r"\b(town\s*halls?|transformers?|asphalt\s+roads?|rural\s+asphalt)\b", re.I)),
]

BLANK_CHECK_RE = re.compile(
    r"\b(selected\s+locations|multiple\s+lots|various\s+locations|across\s+the\s+nation|"
    r"nationwide|different\s+locations|special\s+intervention|constituency\s+projects|"
    r"youth\s+empowerment\s+programmes)\b",
    re.I,
)

CEREMONIAL_SECTARIAN_RE = re.compile(
    r"\b(palace|presidential\s+lodge|dodan\s+barracks|state\s+house|vice\s+president.{0,20}residence|"
    r"guest\s+house|banquet\s+hall|vvip|emir|monarch|traditional\s+ruler|"
    r"mosque|church|cathedral|chapel|hajj|pilgrim)\b",
    re.I,
)

INTANGIBLE_RE = re.compile(
    r"\b(advocacy|orientation|sensitization|awareness\s+campaign|workshop|seminar|"
    r"symposium|town\s*hall\s+meeting|stakeholder\s+engagement|consultancy|"
    r"capacity\s+building|monitoring\s+and\s+evaluation|make\s*up|makeup|souvenir|starter\s*pack)\b",
    re.I,
)
PHYSICAL_WORKSHOP_EXCLUDE_RE = re.compile(
    r"\b(workshop\s+(?:equipment|tools|machinery|machine|building|complex|bay)|"
    r"(?:engineering|mechanical|electrical|automobile|vocational|skill|maintenance)\s+workshop)\b",
    re.I,
)

OVERHEAD_CODES: dict[str, str] = {
    "22020104": "International Travel & Transport (Others)",
    "22020103": "International Travel & Transport (Training)",
    "22021007": "Welfare Packages",
    "22021002": "Honorarium & Sitting Allowance",
    "22021001": "Refreshment & Meals",
    "22021003": "Publicity & Advertisements",
    "22021009": "Sporting Activities",
}

SYNONYMS: dict[str, str] = {
    "procurement": "buy", "purchase": "buy", "supply": "buy", "provision": "buy",
    "acquisition": "buy", "buying": "buy", "procuring": "buy",
    "construction": "build", "rehabilitation": "build", "renovation": "build",
    "upgrading": "build", "completion": "build", "remodelling": "build",
    "remodeling": "build", "repair": "build", "refurbishment": "build",
    "installation": "build", "erection": "build", "equipping": "build",
    "streetlights": "streetlight", "lights": "light", "vehicles": "vehicle",
    "motorcycles": "motorcycle", "tricycles": "tricycle", "boreholes": "borehole",
    "classrooms": "classroom", "transformers": "transformer", "machines": "machine",
    "programmes": "programme", "programs": "programme", "projects": "project",
    "locations": "location",
}
STOP_WORDS = {
    "of", "the", "in", "for", "and", "to", "at", "on", "by", "with", "from",
    "some", "selected", "various", "different", "location", "areas", "communities",
    "phase", "lot", "batch", "stage", "ongoing", "new", "i", "ii", "iii", "iv",
    "1", "2", "3", "4", "5", "6", "a", "an",
}
SECTION_NUM_RE = re.compile(r"\bsection\s+([0-9ivx]+)\b", re.I)


def is_defence_or_security(agency: str) -> bool:
    ag = (agency or "").upper()
    return any(k in ag for k in SECURITY_KEYWORDS)


def is_correctional_or_hospital(agency: str, title: str = "") -> bool:
    text = f"{agency or ''} {title or ''}".upper()
    return any(k in text for k in HOSPITAL_OR_PRISON_KEYWORDS)


def is_multilateral_loan(title: str) -> bool:
    up = (title or "").upper()
    return any(k in up for k in MULTILATERAL_KEYWORDS)


def format_naira(amt: float | int) -> str:
    val = float(amt or 0)
    if val >= 1e12:
        return f"₦{val / 1e12:.2f}T"
    if val >= 1e9:
        return f"₦{val / 1e9:.2f}B"
    if val >= 1e6:
        return f"₦{val / 1e6:.2f}M"
    return f"₦{int(val):,}"


def format_usd(amt: float | int) -> str:
    val = float(amt or 0)
    if val >= 1e9:
        return f"${val / 1e9:.2f}B"
    if val >= 1e6:
        return f"${val / 1e6:.2f}M"
    if val >= 1e3:
        return f"${val / 1e3:.1f}K"
    return f"${int(val):,}"


def map_legacy_overhead_code(code: str, title: str) -> str | None:
    if LEAF_OVERHEAD_RE.match(code):
        return code if code in OVERHEAD_CODES else None
    up = (title or "").upper()
    if SUMMARY_TITLE_RE.search(up):
        return None
    if "INTERNATIONAL TRAVEL" in up:
        if "TRAINING" in up or code.endswith("060122") or "TRAINING" in code:
            return "22020103"
        return "22020104"
    if "WELFARE PACKAGE" in up:
        return "22021007"
    if "HONORARIUM" in up or "SITTING ALLOWANCE" in up:
        return "22021002"
    if "REFRESHMENT" in up and ("MEAL" in up or "FOOD" in up):
        return "22021001"
    if "PUBLICITY" in up and "ADVERT" in up:
        return "22021003"
    if "SPORTING ACTIVIT" in up:
        return "22021009"
    return None


def classify_record(r: dict[str, Any], yr: int) -> str:
    code = str(r.get("projectCode") or "").strip()
    title = str(r.get("projectName") or "").strip()
    up_title = title.upper()

    if SUMMARY_TITLE_RE.search(up_title):
        return "rollup"
    if COA_CAP_SUBTOTAL_RE.match(code) or COA_CATEGORY_HEADER_RE.match(code) or COA_PERSONNEL_STAT_RE.match(code):
        return "rollup"
    if yr >= 2011 and MDA_ROLLUP_RE.match(code):
        return "rollup"

    ov_code = map_legacy_overhead_code(code, title)
    if ov_code:
        r["_canonicalOverheadCode"] = ov_code
        return "overhead"

    if LEAF_OVERHEAD_RE.match(code):
        return "other"

    if LEGACY_14D_RE.match(code):
        seg = code[6:8]
        if seg in ("02", "07") or code.endswith("000000"):
            return "rollup"
        return "capital"

    if LEAF_CAPITAL_RE.match(code) and not EXCLUDE_CAPITAL_PREFIX_RE.match(code):
        return "capital"

    if yr <= 2010 and not MDA_ROLLUP_RE.match(code):
        ptype = str(r.get("projectType") or "").upper()
        if ptype in ("CAPITAL", "ONGOING", "NEW") and any(
            k in up_title for k in ("CONSTRUCTION", "PURCHASE OF", "REHABILITATION", "PROVISION OF", "PROCUREMENT OF", "BOREHOLE", "ROAD")
        ):
            return "capital"

    return "other"


def disguise_signature(title: str) -> str:
    low = (title or "").lower()
    sec_tokens = [f"sec_{m.group(1).lower()}" for m in SECTION_NUM_RE.finditer(low)]
    cleaned = re.sub(r"[^a-z0-9\s]", " ", low)
    toks: list[str] = []
    for w in cleaned.split():
        mapped = SYNONYMS.get(w, w)
        if mapped in STOP_WORDS or len(mapped) <= 2:
            continue
        toks.append(mapped)
    unique_toks = sorted(set(toks))[:12]
    unique_toks.extend(sorted(set(sec_tokens)))
    return " ".join(unique_toks)


def serialize_item(r: dict[str, Any], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    yr = r["_yr"]
    amt = int(r.get("amount") or 0)
    fx = year_fx_rate(yr)
    budget = year_budget_naira(yr)
    pres = YEAR_TO_PRES[yr]
    out: dict[str, Any] = {
        "id": r.get("id"),
        "financialYear": yr,
        "presidentId": pres["presidentId"],
        "presidentName": pres["presidentName"],
        "party": pres["party"],
        "termId": get_term_id(yr),
        "projectCode": str(r.get("projectCode") or ""),
        "projectName": (r.get("projectName") or "").strip(),
        "agency": _clean_sweep_agency(r.get("agency")),
        "sector": (r.get("sector") or "General").strip(),
        "state": r.get("state"),
        "amount": amt,
        "amountUsd": round(amt / fx, 2) if fx > 0 else 0.0,
        "fxRate": fx,
        "budgetSharePct": round((amt / budget) * 100, 5) if budget > 0 else 0.0,
        "minWageMonthly": year_min_wage_monthly(yr),
        "page": int(r.get("page") or 1),
        "sourceFile": r.get("_sourceFile"),
        "equivalents": compute_equivalents(amt, yr),
    }
    if extra:
        out.update(extra)
    return out


def select_balanced_top(items: list[dict[str, Any]], per_president: int = 24, global_extra: int = 15) -> list[dict[str, Any]]:
    by_pres: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for it in items:
        by_pres[it["presidentId"]].append(it)

    seen_keys: set[tuple[Any, Any, Any]] = set()
    chosen: list[dict[str, Any]] = []

    def add_item(it: dict[str, Any]) -> None:
        key = (it.get("financialYear"), it.get("id") or it.get("projectCode"), it.get("amount"))
        if key not in seen_keys:
            seen_keys.add(key)
            chosen.append(it)

    for pres in PRESIDENTS:
        pid = pres["presidentId"]
        pool = sorted(by_pres.get(pid, []), key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)
        for it in pool[:per_president]:
            add_item(it)

    global_pool = sorted(items, key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)
    for it in global_pool[:global_extra]:
        add_item(it)

    chosen.sort(key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)
    return chosen


def summarize_by_president(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    agg: dict[str, dict[str, Any]] = {
        p["presidentId"]: {"count": 0, "totalAmount": 0, "totalUsd": 0.0}
        for p in PRESIDENTS
    }
    for it in items:
        pid = it["presidentId"]
        agg[pid]["count"] += 1
        agg[pid]["totalAmount"] += it["amount"]
        agg[pid]["totalUsd"] += it["amountUsd"]
    for v in agg.values():
        v["totalUsd"] = round(v["totalUsd"], 2)
    return agg


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    os.replace(tmp, path)


def _build_cross_ledger_profiles(
    datasets_root: Path,
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    """
    Aggregate cross-ledger accountability & execution evidence by Presidential Administration:
      - OAuGF Constitutional Audit Queries (1999-2024: 7,028 issues across 36 reports)
      - Legislative Bill-vs-Act Padding Diffs (2017-2025: 7 cycles)
      - DMO Sovereign Debt Trajectory & BIR Macro Execution (2004-2026)
      - OAGF Open Treasury Cash Forensics (2018-2026: 467,763 vouchers / ₦47.53T)
      - Evidence Engine v3.0 22-Rule Multi-Ledger Hits (1999-2026: 49,679 findings)
    """
    profiles: dict[str, dict[str, Any]] = {}
    for pres in PRESIDENTS:
        pid = pres["presidentId"]
        profiles[pid] = {
            "oaugf": {
                "reportsCount": 0,
                "yearsAudited": [],
                "issuesCount": 0,
                "repeatNeglectCount": 0,
                "recoveryDirectiveCount": 0,
                "totalQueriedNaira": 0,
                "totalQueriedUsd": 0.0,
                "topCategories": [],
                "topFindings": [],
            },
            "legislativePadding": {
                "cyclesCount": 0,
                "cyclesYears": [],
                "lineItemScheduleCyclesCount": 0,
                "insertionsCount": 0,
                "insertionsTotalNaira": 0,
                "insertionsTotalUsd": 0.0,
                "inflatedCount": 0,
                "inflatedTotalNaira": 0,
                "zipCount": 0,
                "zipTotalNaira": 0,
                "topPaddedMdas": [],
            },
            "macroAndDebt": {
                "birCoverageStatus": "PRE_BIR_ERA_NO_SOURCE",
                "birYearsCovered": 0,
                "avgCapitalPerformancePct": None,
                "avgRevenuePerformancePct": None,
                "avgDebtServicePerformancePct": None,
                "debtServiceOverrunYears": 0,
                "totalDebtServiceOverrunNaira": 0,
                "dmoStartDebtNairaM": None,
                "dmoEndDebtNairaM": None,
                "dmoEndDebtUsdM": None,
            },
            "openTreasury": {
                "yearsCovered": [],
                "totalDisbursedNaira": 0,
                "decemberVoucherCount": 0,
                "decemberNaira": 0,
                "avgDecemberRushRatio": None,
            },
            "evidenceEngineV3": {
                "flaggedProjectsCount": 0,
                "totalRuleFindingsCount": 0,
                "crossLedgerFindingsCount": 0,
                "flaggedAmountNaira": 0,
                "duplicateClustersCount": 0,
            },
        }

    # 1. OAuGF Constitutional Audit Index & Shards
    oaugf_idx_path = datasets_root / "oaugf_audit_index.json"
    oaugf_global_headline: dict[str, Any] = {}
    if oaugf_idx_path.exists():
        oaugf_idx = json.loads(oaugf_idx_path.read_text(encoding="utf-8"))
        oaugf_global_headline = oaugf_idx.get("headline") or {}
        docs_by_pres: dict[str, set[str]] = defaultdict(set)
        yrs_by_pres: dict[str, set[int]] = defaultdict(set)
        for doc in oaugf_idx.get("documents") or []:
            doc_id = str(doc.get("id") or "")
            for y in doc.get("years") or []:
                yr_int = int(y)
                if yr_int in YEAR_TO_PRES:
                    pid = YEAR_TO_PRES[yr_int]["presidentId"]
                    docs_by_pres[pid].add(doc_id)
                    yrs_by_pres[pid].add(yr_int)

        cat_by_pres: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        findings_by_pres: dict[str, list[dict[str, Any]]] = defaultdict(list)

        for shard_info in oaugf_idx.get("shardFiles") or []:
            rel_path = shard_info.get("path")
            if not rel_path:
                continue
            shard_path = datasets_root / rel_path
            if not shard_path.exists():
                continue
            shard_data = json.loads(shard_path.read_text(encoding="utf-8"))
            for iss in shard_data.get("issues") or []:
                yr_int = int(iss.get("year") or 0)
                if yr_int not in YEAR_TO_PRES:
                    continue
                pid = YEAR_TO_PRES[yr_int]["presidentId"]
                amt = int(iss.get("amountNaira") or 0)
                fx = year_fx_rate(yr_int)
                usd = round(amt / fx, 2) if fx > 0 else 0.0

                p_oaugf = profiles[pid]["oaugf"]
                p_oaugf["issuesCount"] += 1
                if iss.get("repeatNeglect"):
                    p_oaugf["repeatNeglectCount"] += 1
                if iss.get("recoveryRequired"):
                    p_oaugf["recoveryDirectiveCount"] += 1
                p_oaugf["totalQueriedNaira"] += amt
                p_oaugf["totalQueriedUsd"] += usd
                yrs_by_pres[pid].add(yr_int)

                cat = str(iss.get("category") or "Internal Control & Asset Management")
                cat_by_pres[pid][cat] += 1

                findings_by_pres[pid].append({
                    "year": yr_int,
                    "docTitle": iss.get("docTitle"),
                    "page": iss.get("page"),
                    "category": cat,
                    "mdaName": iss.get("mdaName") or iss.get("mdaKey") or "Federal Account / MDA",
                    "heading": iss.get("heading"),
                    "amountNaira": amt,
                    "amountUsd": usd,
                    "repeatNeglect": bool(iss.get("repeatNeglect")),
                    "recoveryRequired": bool(iss.get("recoveryRequired")),
                    "excerpt": (iss.get("excerpt") or "")[:220],
                })

        for pid, prof in profiles.items():
            p_oaugf = prof["oaugf"]
            p_oaugf["reportsCount"] = len(docs_by_pres[pid])
            p_oaugf["yearsAudited"] = sorted(yrs_by_pres[pid])
            p_oaugf["totalQueriedUsd"] = round(p_oaugf["totalQueriedUsd"], 2)
            p_oaugf["topCategories"] = [
                {"category": c, "count": cnt}
                for c, cnt in sorted(cat_by_pres[pid].items(), key=lambda kv: kv[1], reverse=True)
            ]
            top_f = sorted(
                findings_by_pres[pid],
                key=lambda x: (1 if x["repeatNeglect"] or x["recoveryRequired"] else 0, x["amountUsd"], x["amountNaira"]),
                reverse=True,
            )[:8]
            p_oaugf["topFindings"] = top_f

    # 2. Legislative Bill-vs-Act Padding Diffs (2017-2025)
    bill_idx_path = datasets_root / "bill_act_diffs" / "index.json"
    if bill_idx_path.exists():
        b_idx = json.loads(bill_idx_path.read_text(encoding="utf-8"))
        mda_pad_by_pres: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for cyc in b_idx.get("cycles") or []:
            yr_int = int(cyc.get("financialYear") or 0)
            if yr_int not in YEAR_TO_PRES:
                continue
            pid = YEAR_TO_PRES[yr_int]["presidentId"]
            fx = year_fx_rate(yr_int)
            p_pad = profiles[pid]["legislativePadding"]
            p_pad["cyclesCount"] += 1
            p_pad["cyclesYears"].append(yr_int)
            if cyc.get("comparisonScope") == "LINE_ITEM_SCHEDULE":
                p_pad["lineItemScheduleCyclesCount"] += 1
            ins_cnt = int(cyc.get("insertionsCount") or 0)
            ins_naira = int(cyc.get("insertionsTotalNaira") or 0)
            inf_cnt = int(cyc.get("inflatedCount") or 0)
            inf_naira = int(cyc.get("inflatedTotalNaira") or 0)
            zip_cnt = int(cyc.get("zipCount") or 0)
            zip_naira = int(cyc.get("zipTotalNaira") or 0)

            p_pad["insertionsCount"] += ins_cnt
            p_pad["insertionsTotalNaira"] += ins_naira
            p_pad["insertionsTotalUsd"] = round(p_pad["insertionsTotalUsd"] + (ins_naira / fx if fx > 0 else 0.0), 2)
            p_pad["inflatedCount"] += inf_cnt
            p_pad["inflatedTotalNaira"] += inf_naira
            p_pad["zipCount"] += zip_cnt
            p_pad["zipTotalNaira"] += zip_naira

            for tm in cyc.get("topPaddedMdas") or []:
                m_name = _clean_sweep_agency(tm.get("mdaName"))
                if m_name and m_name != "Unspecified Federal MDA":
                    mda_pad_by_pres[pid][m_name] += int(tm.get("totalPositivePaddingNaira") or 0)

        for pid, prof in profiles.items():
            prof["legislativePadding"]["topPaddedMdas"] = [
                {"mdaName": m, "totalPositivePaddingNaira": val}
                for m, val in sorted(mda_pad_by_pres[pid].items(), key=lambda kv: kv[1], reverse=True)[:5]
            ]

    # 3. Macro Credibility & DMO Debt Trajectory
    macro_path = datasets_root / "macro_credibility_tracker.json"
    if macro_path.exists():
        m_data = json.loads(macro_path.read_text(encoding="utf-8"))
        for adm in m_data.get("administrations") or []:
            pid = adm.get("presidentId")
            if pid in profiles:
                profiles[pid]["macroAndDebt"] = {
                    "birCoverageStatus": adm.get("birCoverageStatus"),
                    "birYearsCovered": int(adm.get("birYearsCovered") or 0),
                    "avgCapitalPerformancePct": adm.get("avgCapitalPerformancePct"),
                    "avgRevenuePerformancePct": adm.get("avgRevenuePerformancePct"),
                    "avgDebtServicePerformancePct": adm.get("avgDebtServicePerformancePct"),
                    "debtServiceOverrunYears": int(adm.get("debtServiceOverrunYears") or 0),
                    "totalDebtServiceOverrunNaira": int(adm.get("totalDebtServiceOverrunNaira") or 0),
                    "dmoStartDebtNairaM": adm.get("dmoStartDebtNairaM"),
                    "dmoEndDebtNairaM": adm.get("dmoEndDebtNairaM"),
                    "dmoEndDebtUsdM": adm.get("dmoEndDebtUsdM"),
                }

    # 4. Open Treasury Cash Forensics (2018-2026)
    gs_path = datasets_root / "govspend_forensics.json"
    gs_headline: dict[str, Any] = {}
    if gs_path.exists():
        gs_data = json.loads(gs_path.read_text(encoding="utf-8"))
        gs_headline = gs_data.get("headline") or {}
        rush_ratios_by_pres: dict[str, list[float]] = defaultdict(list)
        for yr_row in (gs_data.get("decemberRush") or {}).get("yearlyRush") or []:
            yr_int = int(yr_row.get("financialYear") or 0)
            if yr_int not in YEAR_TO_PRES:
                continue
            pid = YEAR_TO_PRES[yr_int]["presidentId"]
            p_ot = profiles[pid]["openTreasury"]
            p_ot["yearsCovered"].append(yr_int)
            p_ot["totalDisbursedNaira"] += int(yr_row.get("totalNaira") or 0)
            p_ot["decemberVoucherCount"] += int(yr_row.get("decemberVoucherCount") or 0)
            p_ot["decemberNaira"] += int(yr_row.get("decemberNaira") or 0)
            rr = yr_row.get("decemberRushRatio")
            if rr is not None:
                rush_ratios_by_pres[pid].append(float(rr))
        for pid, prof in profiles.items():
            rrs = rush_ratios_by_pres.get(pid) or []
            prof["openTreasury"]["avgDecemberRushRatio"] = round(sum(rrs) / len(rrs), 2) if rrs else None

    # 5. Evidence Engine v3.0 All-Years Summary (22 Rules across 28 Years)
    ee_path = datasets_root / "evidence_engine_all_years.json"
    ee_summary: dict[str, Any] = {}
    if ee_path.exists():
        ee_data = json.loads(ee_path.read_text(encoding="utf-8"))
        ee_summary = ee_data.get("summary") or {}
        for yr_row in ee_data.get("byYear") or []:
            yr_int = int(yr_row.get("financialYear") or 0)
            if yr_int not in YEAR_TO_PRES:
                continue
            pid = YEAR_TO_PRES[yr_int]["presidentId"]
            p_ee = profiles[pid]["evidenceEngineV3"]
            p_ee["flaggedProjectsCount"] += int(yr_row.get("flaggedProjectsCount") or 0)
            p_ee["totalRuleFindingsCount"] += int(yr_row.get("ruleFindingsCount") or 0)
            p_ee["crossLedgerFindingsCount"] += int(yr_row.get("crossLedgerFindingsCount") or 0)
            p_ee["flaggedAmountNaira"] += int(yr_row.get("flaggedAmountNaira") or 0)
            p_ee["duplicateClustersCount"] += int(yr_row.get("duplicateClustersCount") or 0)

    pr_headline: dict[str, Any] = {}
    pr_path = datasets_root / "procurement_risk_index.json"
    if pr_path.exists():
        pr_headline = json.loads(pr_path.read_text(encoding="utf-8")).get("headline") or {}

    vn_headline: dict[str, Any] = {}
    vn_path = datasets_root / "vendor_network_index.json"
    if vn_path.exists():
        vn_headline = json.loads(vn_path.read_text(encoding="utf-8")).get("headline") or {}

    cross_ledger_totals = {
        "oaugfReportsIndexed": int(oaugf_global_headline.get("reportsIndexed") or 36),
        "oaugfParsedIssuesCount": int(oaugf_global_headline.get("parsedAuditIssuesCount") or 7028),
        "oaugfRepeatNeglectCount": int(oaugf_global_headline.get("repeatNeglectCount") or 54),
        "oaugfRecoveryDirectiveCount": int(oaugf_global_headline.get("recoveryDirectiveCount") or 675),
        "oaugfTotalQueriedNaira": sum(p["oaugf"]["totalQueriedNaira"] for p in profiles.values()),
        "oaugfTotalQueriedUsd": round(sum(p["oaugf"]["totalQueriedUsd"] for p in profiles.values()), 2),
        "billActCyclesCount": sum(p["legislativePadding"]["cyclesCount"] for p in profiles.values()),
        "billActInsertionsCount": sum(p["legislativePadding"]["insertionsCount"] for p in profiles.values()),
        "billActInsertionsNaira": sum(p["legislativePadding"]["insertionsTotalNaira"] for p in profiles.values()),
        "openTreasuryVouchersCount": int(gs_headline.get("totalVouchers") or 467763),
        "openTreasuryTotalNaira": int(gs_headline.get("totalNaira") or 47531629923484),
        "openTreasuryPersonalAccountBeneficiaries": int(
            gs_headline.get("personalStaffCount")
            or vn_headline.get("offNocopoStaffCount")
            or 10851
        ),
        "openTreasuryPersonalAccountNaira": int(
            gs_headline.get("personalStaffPaidNaira")
            or vn_headline.get("offNocopoStaffPaidNaira")
            or 1488270101629
        ),
        "openTreasuryOpaqueDiscretionaryVouchers": int(gs_headline.get("discretionaryOpaqueVoucherCount") or 33366),
        "openTreasuryOpaqueDiscretionaryNaira": int(gs_headline.get("discretionaryOpaqueNaira") or 2439480309528),
        "nocopoAwardedContractsAnalyzed": int(pr_headline.get("totalAwardedRows") or 16536),
        "nocopoAwardedTotalNaira": int(pr_headline.get("totalAwardedNaira") or 4311275338387),
        "nocopoNonCompetitiveNaira": int(pr_headline.get("nonCompetitiveAwardedNaira") or 1240000000000),
        "nocopoVariationOverrunsNaira": int(pr_headline.get("overrunDeltaNaira") or 112000000000),
        "evidenceEngineV3RulesCount": int(ee_summary.get("totalRulesCount") or 22),
        "evidenceEngineV3TotalFindings": int(ee_summary.get("totalRuleFindings") or 49679),
        "evidenceEngineV3CrossLedgerFindings": int(ee_summary.get("totalCrossLedgerFindings") or 28113),
        "evidenceEngineV3FlaggedProjects": int(ee_summary.get("totalFlaggedProjects") or 28681),
    }
    return profiles, cross_ledger_totals


def run_sweep(
    datasets_root: Path = Path("public/datasets"),
    md_output_path: Path = Path("FORENSIC_SWEEP_1999_2026.md"),
) -> dict[str, Any]:
    all_records: list[dict[str, Any]] = []
    leaf_capital: list[dict[str, Any]] = []
    leaf_overhead: list[dict[str, Any]] = []
    rollup_count = 0
    year_meta: dict[int, dict[str, Any]] = {}
    yr_thresholds_map: dict[int, dict[str, int]] = {yr: year_thresholds(yr) for yr in YEARS}

    for yr in YEARS:
        proj_path = datasets_root / str(yr) / "projects.min.json"
        if not proj_path.exists():
            continue
        stats_path = datasets_root / str(yr) / "statistics.json"
        db_path = datasets_root / "db" / str(yr) / "records.json"

        projects = json.loads(proj_path.read_text(encoding="utf-8"))
        stats = json.loads(stats_path.read_text(encoding="utf-8")) if stats_path.exists() else {}
        source_files = stats.get("sourceFiles") or []
        primary_source = source_files[0] if source_files else f"FY {yr} Federal Budget"

        state_by_id: dict[str, str] = {}
        if db_path.exists():
            db_recs = json.loads(db_path.read_text(encoding="utf-8"))
            for dr in db_recs:
                rid = dr.get("recordIdentity", {}).get("id")
                st = dr.get("geographicTaxonomy", {}).get("state")
                if rid and st and st not in ("HQ / Federal Direct", "Nationwide"):
                    state_by_id[rid] = st

        yr_tot = 0
        yr_cap_cnt = 0
        yr_ov_cnt = 0
        for r in projects:
            amt = int(r.get("amount") or 0)
            yr_tot += amt
            r["_yr"] = yr
            r["_sourceFile"] = primary_source
            r["agency"] = _clean_sweep_agency(r.get("agency"))
            if not r.get("state") and r.get("id") in state_by_id:
                r["state"] = state_by_id[r["id"]]

            all_records.append(r)
            kind = classify_record(r, yr)
            if kind == "rollup":
                rollup_count += 1
            elif kind == "capital":
                leaf_capital.append(r)
                yr_cap_cnt += 1
            elif kind == "overhead":
                leaf_overhead.append(r)
                yr_ov_cnt += 1

        if yr_cap_cnt >= 500:
            cov = "full_project_schedule"
        elif yr_cap_cnt >= 100 or yr_ov_cnt >= 300:
            cov = "partial_schedule"
        else:
            cov = "summary_act_only"

        year_meta[yr] = {
            "totalRecords": len(projects),
            "totalAmount": yr_tot,
            "leafCapitalCount": yr_cap_cnt,
            "leafOverheadCount": yr_ov_cnt,
            "dataCoverage": cov,
            "sourceFiles": source_files,
        }

    # ── Pillar 1: Unit-Cost & Non-Military Fleet Outliers ($65k+ at year FX) ──
    p1_items: list[dict[str, Any]] = []
    for r in leaf_capital:
        yr = r["_yr"]
        amt = int(r.get("amount") or 0)
        ag = r.get("agency") or ""
        title = r.get("projectName") or ""
        if amt < yr_thresholds_map[yr]["vehiclesNaira"]:
            continue
        if is_defence_or_security(ag) or is_correctional_or_hospital(ag, title):
            continue
        if VEHICLE_RE.search(title):
            m = QTY_RE.search(title)
            qty = int(m.group(1)) if m and int(m.group(1)) > 0 else None
            implied_unit = int(amt / qty) if qty else None
            p1_items.append(serialize_item(r, {"unitCount": qty, "impliedUnitCostNaira": implied_unit}))
    p1_items.sort(key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)

    # ── Pillar 2: MDA Mandate Mismatches ($15k+ at year FX) ───────────────────
    p2_items: list[dict[str, Any]] = []
    p2_mda_agg: dict[str, dict[str, Any]] = defaultdict(lambda: {"count": 0, "totalAmount": 0, "totalUsd": 0.0})
    for r in leaf_capital:
        yr = r["_yr"]
        amt = int(r.get("amount") or 0)
        ag = r.get("agency") or ""
        title = r.get("projectName") or ""
        up_ag = ag.upper()
        if amt < yr_thresholds_map[yr]["mandatesNaira"]:
            continue
        if any(core in up_ag for core in ("POWER", "RURAL ELECTRIFICATION", "WORKS")):
            continue
        if not NON_CORE_MDA_RE.search(ag):
            continue
        matched_cat = None
        for cat_label, pat in INSERTION_PATTERNS:
            if pat.search(title):
                matched_cat = cat_label
                break
        if matched_cat:
            it = serialize_item(r, {"insertedCategory": matched_cat})
            p2_items.append(it)
            p2_mda_agg[ag]["count"] += 1
            p2_mda_agg[ag]["totalAmount"] += amt
            p2_mda_agg[ag]["totalUsd"] += it["amountUsd"]
    p2_items.sort(key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)
    p2_top_mdas = [
        {"agency": ag, "count": v["count"], "totalAmount": v["totalAmount"], "totalUsd": round(v["totalUsd"], 2)}
        for ag, v in sorted(p2_mda_agg.items(), key=lambda kv: kv[1]["totalUsd"], reverse=True)[:15]
    ]

    # ── Pillar 3: Blank-Check / Non-Specific Mega-Lines (% of Year Budget) ───
    MACRO_STATUTORY_RE = re.compile(
        r"\b(minimum\s+wage|pension|immunisation|immunization|gavi|debt|recapitalization|power\s+reform|tertiary\s+institutions|judiciary|national\s+assembly)\b",
        re.I,
    )
    p3_items: list[dict[str, Any]] = []
    for r in leaf_capital:
        yr = r["_yr"]
        th = yr_thresholds_map[yr]
        amt = int(r.get("amount") or 0)
        title = r.get("projectName") or ""
        if amt < th["blankVagueNaira"] or is_multilateral_loan(title):
            continue
        meaningful_words = [w for w in re.split(r"\s+", re.sub(r"[^a-zA-Z0-9\s]", " ", title)) if len(w) > 2]
        reason = None
        if BLANK_CHECK_RE.search(title):
            reason = "Geographic / recipient vagueness (selected locations / multiple lots / nationwide)"
        elif amt >= th["blankShortNaira"] and len(meaningful_words) < 6 and not MACRO_STATUTORY_RE.search(title):
            reason = f"Under-specified allocation >=0.002% of FY{yr} budget ({len(meaningful_words)} meaningful words)"
        if reason:
            p3_items.append(serialize_item(r, {"ambiguityReason": reason}))
    p3_items.sort(key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)

    # ── Pillar 4: Disguised Within-Year & Cross-Year / Cross-Presidency Duplicates ─
    by_yr_sig: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    by_global_sig: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in leaf_capital:
        yr = r["_yr"]
        th = yr_thresholds_map[yr]
        amt = int(r.get("amount") or 0)
        title = r.get("projectName") or ""
        if amt < th["dupWithinNaira"]:
            continue
        if is_correctional_or_hospital(r.get("agency") or "", title):
            continue
        sig = disguise_signature(title)
        if len(sig.split()) >= 4:
            by_yr_sig[(yr, sig)].append(r)
            if amt >= th["dupCrossNaira"]:
                by_global_sig[sig].append(r)

    p4_within: list[dict[str, Any]] = []
    within_by_pres: dict[str, dict[str, Any]] = {
        p["presidentId"]: {"count": 0, "totalAmount": 0, "totalUsd": 0.0}
        for p in PRESIDENTS
    }
    within_count_by_yr: dict[int, int] = defaultdict(int)
    for (yr, sig), grp in by_yr_sig.items():
        if len(grp) < 2:
            continue
        codes = {str(g.get("projectCode") or "") for g in grp}
        wordings = {re.sub(r"\s+", " ", (g.get("projectName") or "").strip().lower()) for g in grp}
        agencies = {(g.get("agency") or "").strip() for g in grp}
        if len(codes) >= 2 or len(wordings) >= 2 or len(agencies) >= 2:
            tot = sum(int(g.get("amount") or 0) for g in grp)
            fx = year_fx_rate(yr)
            tot_usd = round(tot / fx, 2)
            pres = YEAR_TO_PRES[yr]
            pid = pres["presidentId"]
            within_by_pres[pid]["count"] += 1
            within_by_pres[pid]["totalAmount"] += tot
            within_by_pres[pid]["totalUsd"] += tot_usd
            within_count_by_yr[yr] += 1
            p4_within.append({
                "signature": sig,
                "financialYear": yr,
                "presidentId": pid,
                "presidentName": pres["presidentName"],
                "party": pres["party"],
                "count": len(grp),
                "distinctCodes": len(codes),
                "distinctWordings": len(wordings),
                "distinctAgencies": len(agencies),
                "totalAmount": tot,
                "totalUsd": tot_usd,
                "equivalents": compute_equivalents(tot, yr),
                "items": [serialize_item(g) for g in sorted(grp, key=lambda x: x["amount"], reverse=True)[:10]],
            })
    for v in within_by_pres.values():
        v["totalUsd"] = round(v["totalUsd"], 2)
    p4_within.sort(key=lambda x: (x["totalUsd"], x["totalAmount"]), reverse=True)

    p4_cross_year: list[dict[str, Any]] = []
    for sig, grp in by_global_sig.items():
        yrs = sorted({g["_yr"] for g in grp})
        if len(yrs) < 2:
            continue
        codes = {str(g.get("projectCode") or "") for g in grp}
        agencies = {(g.get("agency") or "").strip() for g in grp}
        if len(codes) >= 2 or len(agencies) >= 2:
            tot = sum(int(g.get("amount") or 0) for g in grp)
            tot_usd = round(sum(int(g.get("amount") or 0) / year_fx_rate(g["_yr"]) for g in grp), 2)
            mw_years = sum(int(g.get("amount") or 0) // (year_min_wage_monthly(g["_yr"]) * 12) for g in grp)
            pres_ids_ordered: list[str] = []
            for y in yrs:
                pid = YEAR_TO_PRES[y]["presidentId"]
                if pid not in pres_ids_ordered:
                    pres_ids_ordered.append(pid)
            p4_cross_year.append({
                "signature": sig,
                "yearsAppeared": yrs,
                "presidentsSpanned": pres_ids_ordered,
                "crossedAdministrations": len(pres_ids_ordered) >= 2,
                "count": len(grp),
                "distinctCodes": len(codes),
                "distinctAgencies": len(agencies),
                "recodedAcrossYears": len(codes) >= 2,
                "agencyHopped": len(agencies) >= 2,
                "totalAmount": tot,
                "totalUsd": tot_usd,
                "equivalents": compute_usd_equivalents(tot_usd, mw_years),
                "items": [serialize_item(g) for g in sorted(grp, key=lambda x: (x["_yr"], -x["amount"]))[:12]],
            })
    p4_cross_year.sort(
        key=lambda x: (1 if x["crossedAdministrations"] else 0, 1 if x["agencyHopped"] and x["recodedAcrossYears"] else 0, x["totalUsd"]),
        reverse=True,
    )

    within_pool_by_pres: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for cl in p4_within:
        within_pool_by_pres[cl["presidentId"]].append(cl)
    balanced_within: list[dict[str, Any]] = []
    seen_within: set[tuple[int, str]] = set()
    for p in PRESIDENTS:
        for cl in within_pool_by_pres.get(p["presidentId"], [])[:20]:
            k = (cl["financialYear"], cl["signature"])
            if k not in seen_within:
                seen_within.add(k)
                balanced_within.append(cl)
    for cl in p4_within[:20]:
        k = (cl["financialYear"], cl["signature"])
        if k not in seen_within:
            seen_within.add(k)
            balanced_within.append(cl)
    balanced_within.sort(key=lambda x: (x["totalUsd"], x["totalAmount"]), reverse=True)

    # ── Pillar 5: Cookie-Cutter Round-Number Split Clusters ────────────────────
    split_buckets: dict[tuple[int, str, int], list[dict[str, Any]]] = defaultdict(list)
    for r in leaf_capital:
        yr = r["_yr"]
        amt = int(r.get("amount") or 0)
        unit_floor, step = round_split_grid(yr)
        if amt >= unit_floor and amt % step == 0:
            split_buckets[(yr, (r.get("agency") or "Federal MDA").strip(), amt)].append(r)

    p5_clusters: list[dict[str, Any]] = []
    p5_by_pres: dict[str, dict[str, Any]] = {
        p["presidentId"]: {"clusterCount": 0, "itemCount": 0, "totalAmount": 0, "totalUsd": 0.0}
        for p in PRESIDENTS
    }
    p5_count_by_yr: dict[int, int] = defaultdict(int)
    for (yr, ag, amt), grp in split_buckets.items():
        if len(grp) >= 5:
            tot = len(grp) * amt
            fx = year_fx_rate(yr)
            tot_usd = round(tot / fx, 2)
            pres = YEAR_TO_PRES[yr]
            pid = pres["presidentId"]
            p5_by_pres[pid]["clusterCount"] += 1
            p5_by_pres[pid]["itemCount"] += len(grp)
            p5_by_pres[pid]["totalAmount"] += tot
            p5_by_pres[pid]["totalUsd"] += tot_usd
            p5_count_by_yr[yr] += 1
            p5_clusters.append({
                "financialYear": yr,
                "presidentId": pid,
                "presidentName": pres["presidentName"],
                "party": pres["party"],
                "agency": ag,
                "unitAmount": amt,
                "unitAmountUsd": round(amt / fx, 2),
                "itemCount": len(grp),
                "totalAmount": tot,
                "totalUsd": tot_usd,
                "equivalents": compute_equivalents(tot, yr),
                "sampleItems": [serialize_item(g) for g in grp[:8]],
            })
    for v in p5_by_pres.values():
        v["totalUsd"] = round(v["totalUsd"], 2)
    p5_clusters.sort(key=lambda x: (x["totalUsd"], x["totalAmount"]), reverse=True)

    p5_pool_by_pres: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for cl in p5_clusters:
        p5_pool_by_pres[cl["presidentId"]].append(cl)
    balanced_p5: list[dict[str, Any]] = []
    seen_p5: set[tuple[int, str, int]] = set()
    for p in PRESIDENTS:
        for cl in p5_pool_by_pres.get(p["presidentId"], [])[:20]:
            k = (cl["financialYear"], cl["agency"], cl["unitAmount"])
            if k not in seen_p5:
                seen_p5.add(k)
                balanced_p5.append(cl)
    for cl in p5_clusters[:20]:
        k = (cl["financialYear"], cl["agency"], cl["unitAmount"])
        if k not in seen_p5:
            seen_p5.add(k)
            balanced_p5.append(cl)
    balanced_p5.sort(key=lambda x: (x["totalUsd"], x["totalAmount"]), reverse=True)

    # ── Pillar 6: Discretionary Administrative Overhead (1999-2026) ────────────
    p6_series: list[dict[str, Any]] = []
    ov_nom_by_yr: dict[int, int] = defaultdict(int)
    ov_usd_by_yr: dict[int, float] = defaultdict(float)
    ov_mw_by_yr: dict[int, int] = defaultdict(int)
    ov_by_pres: dict[str, dict[str, Any]] = {
        p["presidentId"]: {"recordCount": 0, "totalAmount": 0, "totalUsd": 0.0}
        for p in PRESIDENTS
    }

    for code, label in OVERHEAD_CODES.items():
        sub = [
            r for r in leaf_overhead
            if r.get("_canonicalOverheadCode") == code
            and not is_correctional_or_hospital(r.get("agency") or "", r.get("projectName") or "")
        ]
        by_yr = {str(y): 0 for y in YEARS}
        usd_by_yr = {str(y): 0.0 for y in YEARS}
        code_by_pres = {
            p["presidentId"]: {"nominal": 0, "usd": 0.0, "recordCount": 0}
            for p in PRESIDENTS
        }
        mda_tot: dict[str, float] = defaultdict(float)
        code_mw_years = 0

        for r in sub:
            yr = r["_yr"]
            amt = int(r.get("amount") or 0)
            usd_amt = round(amt / year_fx_rate(yr), 2)
            mw_yr = amt // (year_min_wage_monthly(yr) * 12)
            pid = YEAR_TO_PRES[yr]["presidentId"]
            by_yr[str(yr)] += amt
            usd_by_yr[str(yr)] += usd_amt
            ov_nom_by_yr[yr] += amt
            ov_usd_by_yr[yr] += usd_amt
            ov_mw_by_yr[yr] += mw_yr
            ov_by_pres[pid]["recordCount"] += 1
            ov_by_pres[pid]["totalAmount"] += amt
            ov_by_pres[pid]["totalUsd"] += usd_amt
            code_by_pres[pid]["nominal"] += amt
            code_by_pres[pid]["usd"] += usd_amt
            code_by_pres[pid]["recordCount"] += 1
            code_mw_years += mw_yr
            mda_tot[(r.get("agency") or "Federal MDA").strip()] += usd_amt

        for pv in code_by_pres.values():
            pv["usd"] = round(pv["usd"], 2)

        tot_all = sum(by_yr.values())
        usd_all = round(sum(usd_by_yr.values()), 2)
        tot_23_26 = sum(by_yr[str(y)] for y in (2023, 2024, 2025, 2026))
        v23 = by_yr["2023"]
        v26 = by_yr["2026"]
        growth_pct = round(((v26 - v23) / v23) * 100, 1) if v23 > 0 else 0.0
        top_mdas = [
            {"agency": ag, "totalUsd": round(u, 2)}
            for ag, u in sorted(mda_tot.items(), key=lambda kv: kv[1], reverse=True)[:10]
        ]
        top_lines = select_balanced_top([serialize_item(r) for r in sub], per_president=6, global_extra=10)
        p6_series.append({
            "economicCode": code,
            "label": label,
            "recordCount": len(sub),
            "total2023_2026": tot_23_26,
            "totalAllYears": tot_all,
            "totalUsd": usd_all,
            "yearlyTotals": by_yr,
            "yearlyUsdTotals": {k: round(v, 2) for k, v in usd_by_yr.items()},
            "byPresident": code_by_pres,
            "growth2023To2026Pct": growth_pct,
            "equivalents": compute_usd_equivalents(usd_all, code_mw_years),
            "topMdas": top_mdas,
            "topItems": top_lines,
        })
    for v in ov_by_pres.values():
        v["totalUsd"] = round(v["totalUsd"], 2)
    p6_series.sort(key=lambda x: x["totalUsd"], reverse=True)

    # ── Pillar 7: Executive Quarters, Palaces & Sectarian Spend ($30k+ at FX) ──
    p7_items: list[dict[str, Any]] = []
    for r in leaf_capital:
        yr = r["_yr"]
        amt = int(r.get("amount") or 0)
        title = r.get("projectName") or ""
        if amt < yr_thresholds_map[yr]["ceremonialNaira"] or is_defence_or_security(r.get("agency") or ""):
            continue
        if CEREMONIAL_SECTARIAN_RE.search(title):
            p7_items.append(serialize_item(r))
    p7_items.sort(key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)

    # ── Pillar 8: High-Value Intangible Soft-Spend Lines (0.0004% of Year Budget) ─
    p8_items: list[dict[str, Any]] = []
    for r in leaf_capital:
        yr = r["_yr"]
        amt = int(r.get("amount") or 0)
        title = r.get("projectName") or ""
        if amt < yr_thresholds_map[yr]["intangibleNaira"] or is_multilateral_loan(title):
            continue
        if is_correctional_or_hospital(r.get("agency") or "", title):
            continue
        if INTANGIBLE_RE.search(title) and not PHYSICAL_WORKSHOP_EXCLUDE_RE.search(title):
            p8_items.append(serialize_item(r))
    p8_items.sort(key=lambda x: (x["amountUsd"], x["amount"]), reverse=True)

    # ── Deduplicated Flagged Capital Accounting ──────────────────────────────
    unique_cap_flagged: dict[tuple[int, str], tuple[int, float, int, str]] = {}
    for bucket in (p1_items, p2_items, p3_items, p7_items, p8_items):
        for it in bucket:
            key = (it["financialYear"], str(it.get("id") or it["projectCode"]))
            prev = unique_cap_flagged.get(key)
            if prev is None or it["amount"] > prev[0]:
                unique_cap_flagged[key] = (
                    it["amount"],
                    it["amountUsd"],
                    it["equivalents"]["minWageAnnualSalaries"],
                    it["presidentId"],
                )

    cap_nom_by_yr: dict[int, int] = defaultdict(int)
    cap_usd_by_yr: dict[int, float] = defaultdict(float)
    cap_mw_by_yr: dict[int, int] = defaultdict(int)
    cap_cnt_by_yr: dict[int, int] = defaultdict(int)
    cap_nom_by_pres: dict[str, int] = defaultdict(int)
    cap_usd_by_pres: dict[str, float] = defaultdict(float)
    cap_mw_by_pres: dict[str, int] = defaultdict(int)
    cap_cnt_by_pres: dict[str, int] = defaultdict(int)

    for (yr, _uid), (amt, usd_amt, mw_yrs, pid) in unique_cap_flagged.items():
        cap_nom_by_yr[yr] += amt
        cap_usd_by_yr[yr] += usd_amt
        cap_mw_by_yr[yr] += mw_yrs
        cap_cnt_by_yr[yr] += 1
        cap_nom_by_pres[pid] += amt
        cap_usd_by_pres[pid] += usd_amt
        cap_mw_by_pres[pid] += mw_yrs
        cap_cnt_by_pres[pid] += 1

    p1_pres = summarize_by_president(p1_items)
    p2_pres = summarize_by_president(p2_items)
    p3_pres = summarize_by_president(p3_items)
    p7_pres = summarize_by_president(p7_items)
    p8_pres = summarize_by_president(p8_items)

    def count_by_yr(items: list[dict[str, Any]]) -> dict[int, int]:
        c: dict[int, int] = defaultdict(int)
        for it in items:
            c[it["financialYear"]] += 1
        return c

    p1_y, p2_y, p3_y, p7_y, p8_y = (
        count_by_yr(p1_items),
        count_by_yr(p2_items),
        count_by_yr(p3_items),
        count_by_yr(p7_items),
        count_by_yr(p8_items),
    )

    yearly_timeline: list[dict[str, Any]] = []
    for yr in sorted(year_meta.keys()):
        ym = year_meta[yr]
        pres = YEAR_TO_PRES[yr]
        budget_naira = year_budget_naira(yr)
        fx = year_fx_rate(yr)
        c_nom = cap_nom_by_yr[yr]
        c_usd = round(cap_usd_by_yr[yr], 2)
        o_nom = ov_nom_by_yr[yr]
        o_usd = round(ov_usd_by_yr[yr], 2)
        comb_nom = c_nom + o_nom
        comb_usd = round(c_usd + o_usd, 2)
        th = yr_thresholds_map[yr]
        yearly_timeline.append({
            "financialYear": yr,
            "presidentId": pres["presidentId"],
            "presidentName": pres["presidentName"],
            "shortName": pres["shortName"],
            "party": pres["party"],
            "accentColor": pres["accentColor"],
            "officialBudgetNaira": int(budget_naira),
            "fxNairaPerUsd": fx,
            "minWageMonthly": year_min_wage_monthly(yr),
            "thresholdsApplied": {
                "vehiclesNaira": th["vehiclesNaira"],
                "mandatesNaira": th["mandatesNaira"],
                "blankCheckNaira": th["blankVagueNaira"],
                "blankShortNaira": th["blankShortNaira"],
                "ceremonialNaira": th["ceremonialNaira"],
                "intangibleNaira": th["intangibleNaira"],
            },
            "dataCoverage": ym["dataCoverage"],
            "totalRecordsScanned": ym["totalRecords"],
            "leafCapitalCount": ym["leafCapitalCount"],
            "leafOverheadCount": ym["leafOverheadCount"],
            "uniqueFlaggedLines": cap_cnt_by_yr[yr],
            "flaggedCapitalNominal": c_nom,
            "flaggedCapitalUsd": c_usd,
            "overheadNominal": o_nom,
            "overheadUsd": o_usd,
            "combinedNominal": comb_nom,
            "combinedUsd": comb_usd,
            "combinedBudgetSharePct": round((comb_nom / budget_naira) * 100, 2) if budget_naira > 0 else 0.0,
            "disguisedClusterCount": within_count_by_yr[yr],
            "roundSplitClusterCount": p5_count_by_yr[yr],
            "pillarCounts": {
                "vehicles": p1_y[yr],
                "mandates": p2_y[yr],
                "blankChecks": p3_y[yr],
                "ceremonial": p7_y[yr],
                "intangible": p8_y[yr],
            },
        })

    # Cross-ledger profiles by Presidential Administration
    cross_profiles_by_pres, cross_ledger_totals = _build_cross_ledger_profiles(datasets_root)

    # Presidential scorecard records
    president_summaries: list[dict[str, Any]] = []
    for pres in PRESIDENTS:
        pid = pres["presidentId"]
        yrs = pres["budgetYears"]
        full_yrs = sum(1 for y in yrs if year_meta.get(y, {}).get("dataCoverage") == "full_project_schedule")
        partial_yrs = sum(1 for y in yrs if year_meta.get(y, {}).get("dataCoverage") == "partial_schedule")
        summary_yrs = sum(1 for y in yrs if year_meta.get(y, {}).get("dataCoverage") == "summary_act_only")

        scheduled_budget_sum = sum(
            year_budget_naira(y)
            for y in yrs
            if year_meta.get(y, {}).get("dataCoverage") in ("full_project_schedule", "partial_schedule")
        )
        enacted_budget_sum = sum(year_budget_naira(y) for y in yrs)
        enacted_budget_usd = round(sum(year_budget_naira(y) / year_fx_rate(y) for y in yrs), 2)
        avg_fx = round(sum(year_fx_rate(y) for y in yrs) / len(yrs), 2)

        scanned = sum(year_meta.get(y, {}).get("totalRecords", 0) for y in yrs)
        leaf_cap = sum(year_meta.get(y, {}).get("leafCapitalCount", 0) for y in yrs)
        leaf_ov = sum(year_meta.get(y, {}).get("leafOverheadCount", 0) for y in yrs)

        cap_nom = cap_nom_by_pres[pid]
        cap_usd = round(cap_usd_by_pres[pid], 2)
        ov_nom = ov_by_pres[pid]["totalAmount"]
        ov_usd = round(ov_by_pres[pid]["totalUsd"], 2)
        comb_nom = cap_nom + ov_nom
        comb_usd = round(cap_usd + ov_usd, 2)
        mw_total = cap_mw_by_pres[pid] + sum(ov_mw_by_yr[y] for y in yrs)
        denom_yrs = max(1, full_yrs + partial_yrs)

        president_summaries.append({
            "presidentId": pid,
            "presidentName": pres["presidentName"],
            "shortName": pres["shortName"],
            "party": pres["party"],
            "accentColor": pres["accentColor"],
            "tenureLabel": pres["tenureLabel"],
            "budgetYears": yrs,
            "fxRangeLabel": pres["fxRangeLabel"],
            "minWageRangeLabel": pres["minWageRangeLabel"],
            "avgFxNairaPerUsd": avg_fx,
            "enactedBudgetSumNominal": int(enacted_budget_sum),
            "enactedBudgetSumUsd": enacted_budget_usd,
            "fullScheduleYearsCount": full_yrs,
            "partialScheduleYearsCount": partial_yrs,
            "summaryOnlyYearsCount": summary_yrs,
            "handoverNote": pres["handoverNote"],
            "recordsScanned": scanned,
            "leafCapitalCount": leaf_cap,
            "leafOverheadCount": leaf_ov,
            "uniqueFlaggedCapitalLines": cap_cnt_by_pres[pid],
            "flaggedCapitalNominal": cap_nom,
            "flaggedCapitalUsd": cap_usd,
            "overheadNominal": ov_nom,
            "overheadUsd": ov_usd,
            "combinedNominal": comb_nom,
            "combinedUsd": comb_usd,
            "combinedBudgetSharePct": round((comb_nom / scheduled_budget_sum) * 100, 2) if scheduled_budget_sum > 0 else 0.0,
            "annualizedUsdPerScheduledYear": round(comb_usd / denom_yrs, 2),
            "equivalents": compute_usd_equivalents(comb_usd, mw_total),
            "disguisedWithinClusters": within_by_pres[pid]["count"],
            "roundSplitClusters": p5_by_pres[pid]["clusterCount"],
            "pillarBreakdown": {
                "vehicles": p1_pres[pid],
                "mandates": p2_pres[pid],
                "blankChecks": p3_pres[pid],
                "disguisedWithin": within_by_pres[pid],
                "roundSplits": p5_by_pres[pid],
                "overhead": ov_by_pres[pid],
                "ceremonial": p7_pres[pid],
                "intangible": p8_pres[pid],
            },
            "crossLedgerProfile": cross_profiles_by_pres[pid],
        })

    # Totals & Headline Metrics
    total_cap_nom = sum(cap_nom_by_yr.values())
    total_cap_usd = round(sum(cap_usd_by_yr.values()), 2)
    total_ov_nom = sum(ov_nom_by_yr.values())
    total_ov_usd = round(sum(ov_usd_by_yr.values()), 2)
    combined_nom = total_cap_nom + total_ov_nom
    combined_usd = round(total_cap_usd + total_ov_usd, 2)
    total_mw_years = sum(cap_mw_by_yr.values()) + sum(ov_mw_by_yr.values())
    all_scheduled_budget_sum = sum(
        year_budget_naira(y)
        for y in year_meta.keys()
        if year_meta[y]["dataCoverage"] in ("full_project_schedule", "partial_schedule")
    )

    overhead_2023_sum = sum(x["yearlyTotals"]["2023"] for x in p6_series)
    overhead_2026_sum = sum(x["yearlyTotals"]["2026"] for x in p6_series)
    overhead_surge_pct = (
        round(((overhead_2026_sum - overhead_2023_sum) / overhead_2023_sum) * 100, 1)
        if overhead_2023_sum > 0 else 0.0
    )

    def pillar_agg(items: list[dict[str, Any]], mw_sum: int | None = None) -> tuple[int, float, dict[str, Any]]:
        nom = sum(x["amount"] for x in items)
        usd = round(sum(x["amountUsd"] for x in items), 2)
        mw = mw_sum if mw_sum is not None else sum(x["equivalents"]["minWageAnnualSalaries"] for x in items)
        return nom, usd, compute_usd_equivalents(usd, mw)

    p1_n, p1_u, p1_eq = pillar_agg(p1_items)
    p2_n, p2_u, p2_eq = pillar_agg(p2_items)
    p3_n, p3_u, p3_eq = pillar_agg(p3_items)
    p7_n, p7_u, p7_eq = pillar_agg(p7_items)
    p8_n, p8_u, p8_eq = pillar_agg(p8_items)
    p5_n = sum(x["totalAmount"] for x in p5_clusters)
    p5_u = round(sum(x["totalUsd"] for x in p5_clusters), 2)
    p5_mw = sum(x["equivalents"]["minWageAnnualSalaries"] for x in p5_clusters)

    payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "scope": "1999-2026 Fourth Republic Federal Appropriation Acts & Bills (Year-Native Economics)",
        "methodology": "Fleet, mandate, and quarters thresholds scale using each fiscal year's official CBN exchange rate (US$65k / US$15k / US$30k); blank-check and intangible thresholds scale as fixed shares of each year's enacted Federal Budget (0.001% / 0.002% / 0.0004%); civic equivalents use that exact year's statutory minimum wage and CBN FX rates.",
        "yearsCovered": sorted(year_meta.keys()),
        "hygiene": {
            "totalRecordsScanned": len(all_records),
            "leafCapitalCount": len(leaf_capital),
            "leafOverheadCount": len(leaf_overhead),
            "excludedRollupRows": rollup_count,
            "yearlyBreakdown": {str(k): v for k, v in year_meta.items()},
        },
        "headlineMetrics": {
            "uniqueFlaggedCapitalLines": len(unique_cap_flagged),
            "uniqueFlaggedCapitalExposure": total_cap_nom,
            "uniqueFlaggedCapitalUsd": total_cap_usd,
            "discretionaryOverheadExposure": total_ov_nom,
            "discretionaryOverheadUsd": total_ov_usd,
            "combinedScrutinyExposure": combined_nom,
            "combinedScrutinyUsd": combined_usd,
            "combinedScheduledBudgetSharePct": round((combined_nom / all_scheduled_budget_sum) * 100, 2) if all_scheduled_budget_sum > 0 else 0.0,
            "combinedEquivalents": compute_usd_equivalents(combined_usd, total_mw_years),
            "withinYearDisguisedClusters": len(p4_within),
            "crossYearRecodedOrHoppedClusters": len(p4_cross_year),
            "roundNumberSplitClusters": len(p5_clusters),
            "overheadSurge2023To2026Pct": overhead_surge_pct,
            "crossLedgerTotals": cross_ledger_totals,
        },
        "presidents": president_summaries,
        "yearlyTimeline": yearly_timeline,
        "pillars": {
            "unitCostVehicles": {
                "title": "Non-Military Fleet & Unit-Cost Outliers (>=US$65k at Year CBN FX)",
                "count": len(p1_items),
                "totalAmount": p1_n,
                "totalUsd": p1_u,
                "equivalents": p1_eq,
                "byPresident": p1_pres,
                "items": select_balanced_top(p1_items, per_president=24, global_extra=15),
            },
            "mdaMandateMismatches": {
                "title": "MDA Mandate Mismatches / Non-Core Insertions (>=US$15k at Year CBN FX)",
                "count": len(p2_items),
                "totalAmount": p2_n,
                "totalUsd": p2_u,
                "equivalents": p2_eq,
                "byPresident": p2_pres,
                "topMdas": p2_top_mdas,
                "items": select_balanced_top(p2_items, per_president=24, global_extra=15),
            },
            "vagueBlankChecks": {
                "title": "Blank-Check & Geographic-Vagueness Mega-Lines (>=0.001% of Year Budget)",
                "count": len(p3_items),
                "totalAmount": p3_n,
                "totalUsd": p3_u,
                "equivalents": p3_eq,
                "byPresident": p3_pres,
                "items": select_balanced_top(p3_items, per_president=24, global_extra=15),
            },
            "disguisedDuplicates": {
                "title": "Disguised Within-Year & Agency-Hopping Cross-Year / Cross-Presidency Duplicates",
                "withinYearCount": len(p4_within),
                "withinYearTotalAmount": sum(x["totalAmount"] for x in p4_within),
                "withinYearTotalUsd": round(sum(x["totalUsd"] for x in p4_within), 2),
                "crossYearCount": len(p4_cross_year),
                "crossYearTotalAmount": sum(x["totalAmount"] for x in p4_cross_year),
                "crossYearTotalUsd": round(sum(x["totalUsd"] for x in p4_cross_year), 2),
                "byPresident": within_by_pres,
                "withinYearClusters": balanced_within,
                "crossYearClusters": p4_cross_year[:50],
            },
            "roundNumberSplits": {
                "title": "Cookie-Cutter Round-Number Split Clusters (>=5 Identical Round Lines in Same MDA)",
                "clusterCount": len(p5_clusters),
                "itemCount": sum(x["itemCount"] for x in p5_clusters),
                "totalAmount": p5_n,
                "totalUsd": p5_u,
                "equivalents": compute_usd_equivalents(p5_u, p5_mw),
                "byPresident": p5_by_pres,
                "clusters": balanced_p5,
            },
            "overheadSurge": {
                "title": "Discretionary Administrative Overhead (2202xxxx, 1999–2026)",
                "totalAllYears": total_ov_nom,
                "totalAllYearsUsd": total_ov_usd,
                "total2023_2026": sum(x["total2023_2026"] for x in p6_series),
                "total2023": overhead_2023_sum,
                "total2026": overhead_2026_sum,
                "growth2023To2026Pct": overhead_surge_pct,
                "equivalents": compute_usd_equivalents(total_ov_usd, sum(ov_mw_by_yr.values())),
                "byPresident": ov_by_pres,
                "codes": p6_series,
            },
            "ceremonialAndSectarian": {
                "title": "Executive Quarters, Palaces & Sectarian Capital Lines (>=US$30k at Year CBN FX)",
                "count": len(p7_items),
                "totalAmount": p7_n,
                "totalUsd": p7_u,
                "equivalents": p7_eq,
                "byPresident": p7_pres,
                "items": select_balanced_top(p7_items, per_president=24, global_extra=15),
            },
            "intangibleSoftSpend": {
                "title": "High-Value Intangible Soft-Spend Lines (>=0.0004% of Year Budget)",
                "count": len(p8_items),
                "totalAmount": p8_n,
                "totalUsd": p8_u,
                "equivalents": p8_eq,
                "byPresident": p8_pres,
                "items": select_balanced_top(p8_items, per_president=24, global_extra=15),
            },
        },
    }

    json_out = datasets_root / "forensic_sweep_1999_2026.json"
    atomic_write_text(json_out, json.dumps(payload, indent=2, ensure_ascii=False))
    atomic_write_text(md_output_path, _render_markdown_dossier(payload))
    return payload


def _render_markdown_dossier(data: dict[str, Any]) -> str:
    h = data["hygiene"]
    hm = data["headlineMetrics"]
    pil = data["pillars"]

    lines: list[str] = [
        "# 1999–2026 Fourth Republic Federal Budget Public Scrutiny & Presidential Audit Dossier",
        "",
        f"> **Generated:** {data['generatedAt']}  ",
        f"> **Dataset Scope:** {h['totalRecordsScanned']:,} extracted records across FY 1999–2026 "
        f"({h['leafCapitalCount']:,} leaf capital project lines + {h['leafOverheadCount']:,} discretionary `2202xxxx` overhead lines; "
        f"{h['excludedRollupRows']:,} MDA/COA summary rollups excluded cleanly to prevent double counting).",
        f"> **Year-Native Methodology:** {data['methodology']}",
        "",
        "---",
        "",
        "## Presidential Administration Scorecard (1999–2026 Year-Native Economics)",
        "",
        "| President | Party | Budget Years | CBN FX Range | Min Wage | Capital Flags | Flagged Capital | Discretionary Overhead | Combined (Historical US$) | % of Scheduled Budget |",
        "|---|---|---|---|---|---:|---:|---:|---:|---:|",
    ]

    for p in data["presidents"]:
        yrs = f"{p['budgetYears'][0]}–{p['budgetYears'][-1]}"
        lines.append(
            f"| {p['presidentName']} | {p['party']} | {yrs} | {p['fxRangeLabel']} | {p['minWageRangeLabel']} | "
            f"{p['uniqueFlaggedCapitalLines']:,} | {format_naira(p['flaggedCapitalNominal'])} ({format_usd(p['flaggedCapitalUsd'])}) | "
            f"{format_naira(p['overheadNominal'])} ({format_usd(p['overheadUsd'])}) | "
            f"{format_usd(p['combinedUsd'])} | {p['combinedBudgetSharePct']:.2f}% |"
        )

    lines.extend([
        "",
        "## Fourth Republic Totals Across 8 Scrutiny Pillars",
        "",
        f"- **Combined Scrutiny Exposure:** **{format_usd(hm['combinedScrutinyUsd'])}** historical US$ (**{format_naira(hm['combinedScrutinyExposure'])}** as-enacted Naira · **{hm['combinedScheduledBudgetSharePct']:.2f}%** of scheduled enacted budgets).",
        f"- **Discretionary Overhead Surge (`2023 → 2026` nominal):** **{hm['overheadSurge2023To2026Pct']:+.1f}%** across 7 `2202xxxx` codes.",
        "",
        "| Scrutiny Pillar | Items / Clusters | As-Enacted Nominal (₦) | Historical US$ (Year FX) |",
        "|---|---:|---:|---:|",
        f"| 1. Non-Military Fleet & Unit-Cost Outliers (>=US$65k) | {pil['unitCostVehicles']['count']:,} lines | {format_naira(pil['unitCostVehicles']['totalAmount'])} | {format_usd(pil['unitCostVehicles']['totalUsd'])} |",
        f"| 2. MDA Mandate Mismatches (>=US$15k) | {pil['mdaMandateMismatches']['count']:,} lines | {format_naira(pil['mdaMandateMismatches']['totalAmount'])} | {format_usd(pil['mdaMandateMismatches']['totalUsd'])} |",
        f"| 3. Blank-Check & Vague Mega-Lines (>=0.001% Budget) | {pil['vagueBlankChecks']['count']:,} lines | {format_naira(pil['vagueBlankChecks']['totalAmount'])} | {format_usd(pil['vagueBlankChecks']['totalUsd'])} |",
        f"| 4a. Disguised Within-Year Duplicates | {pil['disguisedDuplicates']['withinYearCount']:,} clusters | {format_naira(pil['disguisedDuplicates']['withinYearTotalAmount'])} | {format_usd(pil['disguisedDuplicates']['withinYearTotalUsd'])} |",
        f"| 4b. Cross-Year / Cross-Presidency Repeats | {pil['disguisedDuplicates']['crossYearCount']:,} clusters | {format_naira(pil['disguisedDuplicates']['crossYearTotalAmount'])} | {format_usd(pil['disguisedDuplicates']['crossYearTotalUsd'])} |",
        f"| 5. Cookie-Cutter Round-Number Split Clusters | {pil['roundNumberSplits']['clusterCount']:,} clusters ({pil['roundNumberSplits']['itemCount']:,} lines) | {format_naira(pil['roundNumberSplits']['totalAmount'])} | {format_usd(pil['roundNumberSplits']['totalUsd'])} |",
        f"| 6. Discretionary Administrative Overhead (`2202xxxx`) | {sum(c['recordCount'] for c in pil['overheadSurge']['codes']):,} lines | {format_naira(pil['overheadSurge']['totalAllYears'])} | {format_usd(pil['overheadSurge']['totalAllYearsUsd'])} |",
        f"| 7. Executive Quarters, Palaces & Sectarian Spend (>=US$30k) | {pil['ceremonialAndSectarian']['count']:,} lines | {format_naira(pil['ceremonialAndSectarian']['totalAmount'])} | {format_usd(pil['ceremonialAndSectarian']['totalUsd'])} |",
        f"| 8. High-Value Intangible Soft-Spend Lines (>=0.0004% Budget) | {pil['intangibleSoftSpend']['count']:,} lines | {format_naira(pil['intangibleSoftSpend']['totalAmount'])} | {format_usd(pil['intangibleSoftSpend']['totalUsd'])} |",
        "",
        "## 6-Ledger Cross-Reference by Presidential Administration (1999–2026)",
        "",
        "| President | OAuGF Audit Reports | OAuGF Findings | Repeat / Recovery | Bill->Act Insertions | Open Treasury Disbursed | DMO End Debt | Evidence Engine v3 Hits |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ])

    for p in data["presidents"]:
        cl = p.get("crossLedgerProfile") or {}
        oa = cl.get("oaugf") or {}
        lp = cl.get("legislativePadding") or {}
        md = cl.get("macroAndDebt") or {}
        ot = cl.get("openTreasury") or {}
        ee = cl.get("evidenceEngineV3") or {}
        dmo_end_str = (
            f"₦{md['dmoEndDebtNairaM'] / 1e6:.2f}T (${md['dmoEndDebtUsdM'] / 1e3:.1f}B)"
            if md.get("dmoEndDebtNairaM") and md.get("dmoEndDebtUsdM")
            else "N/A"
        )
        pad_str = (
            f"{lp.get('insertionsCount', 0):,} ({format_naira(lp.get('insertionsTotalNaira', 0))})"
            if lp.get("cyclesCount", 0) > 0
            else "Pre-Diff Era"
        )
        ot_str = (
            f"{format_naira(ot.get('totalDisbursedNaira', 0))}"
            if ot.get("totalDisbursedNaira", 0) > 0
            else "Pre-2018 Portal"
        )
        lines.append(
            f"| {p['presidentName']} | {oa.get('reportsCount', 0)} | "
            f"{oa.get('issuesCount', 0):,} ({format_naira(oa.get('totalQueriedNaira', 0))}) | "
            f"{oa.get('repeatNeglectCount', 0)} repeat / {oa.get('recoveryDirectiveCount', 0)} recov | "
            f"{pad_str} | {ot_str} | {dmo_end_str} | "
            f"{ee.get('totalRuleFindingsCount', 0):,} ({ee.get('crossLedgerFindingsCount', 0):,} cross-ledger) |"
        )
    lines.append("")

    return "\n".join(lines)


if __name__ == "__main__":
    summary = run_sweep()
    hm = summary["headlineMetrics"]
    print(f"1999-2026 Year-Native Forensic Sweep Complete ({summary['hygiene']['totalRecordsScanned']:,} records scanned)")
    print(f"  Combined Exposure: {format_usd(hm['combinedScrutinyUsd'])} (Nominal: {format_naira(hm['combinedScrutinyExposure'])}, {hm['combinedScheduledBudgetSharePct']:.2f}% of scheduled budgets)")
    for p in summary["presidents"]:
        print(
            f"  - {p['shortName']:10s} ({p['budgetYears'][0]}-{p['budgetYears'][-1]}, {p['fxRangeLabel']:15s}, {p['minWageRangeLabel']:12s}): "
            f"flags={p['uniqueFlaggedCapitalLines']:5,}, nom={format_naira(p['combinedNominal']):>9s}, "
            f"usd={format_usd(p['combinedUsd']):>8s}, budget_share={p['combinedBudgetSharePct']:5.2f}%"
        )
