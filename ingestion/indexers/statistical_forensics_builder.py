"""Statistical Forensics Precomputation Builder (1999-2026).

Precomputes four investigative statistical forensics modules across all ingested
Federal Appropriation schedules (`public/datasets/db/<year>/records.json`):
  1. Benford's Law First-Digit MAD & Pearson Chi-Square (df=8) + Flagged MDAs
  2. Cross-Year Durable Capital Premature Replacement Alerts (1999-2026)
  3. Virement, Service-Wide Vote, Contingency & Emergency Fund Tracking
  4. Coordinated & Cross-MDA Duplicate Ring Clustering (separating capital vs. boilerplate)

Emits `public/datasets/statistical_forensics_1999_2026.json` atomically.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE_DIR = PROJECT_ROOT / "public" / "datasets"

BENFORD_EXPECTED_PROBS: dict[int, float] = {
    d: math.log10(1.0 + 1.0 / d) for d in range(1, 10)
}

ASSET_CATEGORY_META: dict[str, dict[str, Any]] = {
    "vehicles_mobility": {"label": "Vehicles & Official Fleets", "lifespan": 5},
    "office_tech": {"label": "ICT, Laptops & Office Equipment", "lifespan": 4},
    "water_boreholes": {"label": "Boreholes & Water Supply Works", "lifespan": 7},
    "power_utilities": {"label": "Generators, Solar & Power Grids", "lifespan": 8},
    "healthcare": {"label": "Hospital & Medical Equipment", "lifespan": 8},
    "education": {"label": "School Infrastructure & Learning Gear", "lifespan": 10},
    "road_infrastructure": {"label": "Roads, Bridges & Heavy Civil Works", "lifespan": 15},
}

GENERIC_MDA_EXACT = {
    "",
    "general federal",
    "unknown mda",
    "unknown",
    "federal government",
    "unspecified",
    "n/a",
    "na",
    "none",
    "federal mda",
    "ministry / mda",
    "total",
    "sub-total",
    "subtotal",
}

ROUTINE_CONSUMABLE_RE = re.compile(
    r"\b("
    r"stationer\w*|consumables?|maintenance|repairs?|fuelling|fuel|lubricants?|"
    r"insurance|training|workshops?|seminars?|conferences?|consultanc\w*|internet|"
    r"telephone|electricity|water rates?|cleaning|security services?|allowances?|"
    r"honorari\w*|sitting|refreshments?|monitoring|evaluation|supervision|"
    r"retainer\w*|subscriptions?|rent|hire|lease|printing|publicity|adverts?|"
    r"advertisements?|audit fees?|drugs?\s*&\s*medical|bank charges|postages?|uniforms?"
    r")\b",
    re.IGNORECASE,
)

BOILERPLATE_OVERHEAD_RE = re.compile(
    r"("
    r"local travel|international travel|office stationeries|computer consumables|"
    r"electricity charges|telephone charges|bank charges|postages & courier|"
    r"publicity & advertisements|security services|cleaning & fumigation|"
    r"maintenance of office|maintenance of motor|training - local|welfare packages|"
    r"water rates|motor vehicle fuel cost|internet access charges|uniforms & other clothing|"
    r"honorarium|refreshment & meals|drugs & medical supplies|miscellaneous"
    r")",
    re.IGNORECASE,
)

DURABLE_ACTION_RE = re.compile(
    r"\b(purchase|procurement|supply|acquisition|construction|rehabilitation|equipping|installation)\b",
    re.IGNORECASE,
)

DURABLE_CATEGORY_RULES: list[tuple[str, re.Pattern[str]]] = [
    (
        "vehicles_mobility",
        re.compile(
            r"\b(suvs?|prado|land\s*cruiser|hilux|pick-?up|operational vehicles?|utility vehicles?|official vehicles?|staff bus(?:es)?|coaster bus(?:es)?|ambulance(?:s)?|patrol vehicles?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "office_tech",
        re.compile(
            r"\b(laptops?|desktops?|computers?|servers?|photocopiers?|printers?|scanners?|ict equipment|ict infrastructure)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "power_utilities",
        re.compile(
            r"\b(generators?|generating sets?|transformers?|solar street\s*lights?|solar mini[- ]?grids?|inverters?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "water_boreholes",
        re.compile(
            r"\b(motorized boreholes?|solar boreholes?|boreholes?|water treatment plants?)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "healthcare",
        re.compile(
            r"\b(medical equipment|diagnostic equipment|hospital equipment|mri|ct scan|x-ray|primary healthcare cent(?:re|er)s?)\b",
            re.IGNORECASE,
        ),
    ),
]

VIREMENT_RULES: list[tuple[str, str, tuple[str, ...]]] = [
    ("SERVICE_WIDE_VOTE", "Service-Wide & Margin Votes", ("service wide", "service-wide", "margin for increase")),
    ("SUPPLEMENTARY_VIREMENT", "Supplementary & Virement Lines", ("virement", "reallocation", "supplementary", "off-budget", "capital supplementation")),
    ("CONTINGENCY_RESERVE", "Contingency & Unforeseen Reserves", ("contingency", "unforeseen", "reserve fund")),
    ("SPECIAL_EMERGENCY", "Special & Emergency Interventions", ("special intervention", "emergency injection", "emergency intervention", "emergency relief", "emergency")),
]


def _format_naira(amt: float | int) -> str:
    val = float(amt or 0)
    if val >= 1e12:
        return f"₦{val / 1e12:.2f} Trillion"
    if val >= 1e9:
        return f"₦{val / 1e9:.2f} Billion"
    if val >= 1e6:
        return f"₦{val / 1e6:.2f} Million"
    return f"₦{round(val):,}"


def extract_leading_digit(amount: float | int) -> int | None:
    """Extracts the first significant decimal digit (1-9) of a positive Naira amount."""
    if not isinstance(amount, (int, float)) or isinstance(amount, bool):
        return None
    if not math.isfinite(amount) or amount <= 0:
        return None
    mantissa = str(amount).split("e")[0].split("E")[0]
    for ch in mantissa:
        if "1" <= ch <= "9":
            return int(ch)
    return None


def chi_square_p_value_df8(chi_square: float) -> float:
    """
    Exact survival function P(Chi2_8 >= x) for 8 degrees of freedom (k/2 = 4 integer):
    SF(x) = exp(-x/2) * (1 + u + u^2/2! + u^3/3!) where u = x/2.
    """
    if not math.isfinite(chi_square) or chi_square <= 0.0:
        return 1.0
    u = chi_square / 2.0
    if u > 700.0:
        return 0.0
    poly = 1.0 + u + (u * u) / 2.0 + (u * u * u) / 6.0
    p = math.exp(-u) * poly
    return max(0.0, min(1.0, p))


def classify_benford_conformity(mad: float, valid_record_count: int) -> tuple[str, str]:
    """Classifies Benford Mean Absolute Deviation using Nigrini MAD bands with low-N guard."""
    if valid_record_count < 30:
        return "INSUFFICIENT_SAMPLE", "INSUFFICIENT_SAMPLE"
    if mad <= 0.006:
        return "CLOSE_CONFORMITY", "HIGH_INTEGRITY"
    if mad <= 0.012:
        return "ACCEPTABLE", "HIGH_INTEGRITY"
    if mad <= 0.015:
        return "MARGINAL", "MODERATE_RISK"
    return "NON_CONFORMITY", "HIGH_ANOMALY_RISK"


def is_valid_mda_name(name: str | None) -> bool:
    """Rejects parser artifacts, km markers, numeric fragments, and generic labels."""
    if not name or not isinstance(name, str):
        return False
    cleaned = re.sub(r"\s+", " ", name).strip()
    if len(cleaned) < 4 or len(cleaned) > 90:
        return False
    lower = cleaned.lower()
    if lower in GENERIC_MDA_EXACT:
        return False
    if re.match(r"^[\d,.\s₦$+\-/()]+$", cleaned):
        return False
    if re.match(r"^KM\s*\d+", cleaned, re.IGNORECASE):
        return False
    if "CONSTITUENCY IN " in cleaned.upper() or "DESIGN, DEVELOPMENT AND PERFORMANCE" in cleaned.upper():
        return False
    if not re.search(r"[A-Za-z]{3,}", cleaned):
        return False
    return True


def normalize_mda_name(name: str) -> str:
    """Normalizes MDA labels across decades (strips HQTRS suffixes & punctuation)."""
    cleaned = re.sub(r"\s+", " ", name).strip()
    cleaned = re.sub(r"\s*[-–]\s*HQTRS\.?$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+HQTRS\.?$", "", cleaned, flags=re.IGNORECASE)
    return cleaned.upper()


def compute_benford_metrics(
    amounts: list[float | int],
    financial_year: int,
    mda_pairs: list[tuple[str, float | int]] | None = None,
) -> dict[str, Any]:
    """Computes full Benford MAD, Chi-Square (df=8), p-value, Z-scores & Top Flagged MDAs."""
    counts = {d: 0 for d in range(1, 10)}
    n = 0
    for amt in amounts:
        d = extract_leading_digit(amt)
        if d is not None:
            counts[d] += 1
            n += 1

    mad = 0.0
    chi2 = 0.0
    breakdown: list[dict[str, Any]] = []

    for d in range(1, 10):
        pe = BENFORD_EXPECTED_PROBS[d]
        actual_count = counts[d]
        po = (actual_count / n) if n > 0 else 0.0
        actual_pct = po * 100.0
        expected_pct = pe * 100.0
        deviation_pct = actual_pct - expected_pct

        if n > 0:
            mad += abs(po - pe)
            expected_count = n * pe
            chi2 += ((actual_count - expected_count) ** 2) / expected_count
            sigma = math.sqrt((pe * (1.0 - pe)) / n)
            diff = po - pe
            abs_adj = max(0.0, abs(diff) - (0.5 / n))
            z_score = (abs_adj / sigma) * (1.0 if diff >= 0 else -1.0) if sigma > 0 else 0.0
        else:
            z_score = 0.0

        status = "Normal"
        if n >= 30 and abs(z_score) >= 1.96:
            status = "Abnormally High" if deviation_pct > 0 else "Abnormally Low"

        breakdown.append(
            {
                "digit": d,
                "actualCount": actual_count,
                "actualPct": round(actual_pct, 2),
                "expectedPct": round(expected_pct, 2),
                "deviationPct": round(deviation_pct, 2),
                "zScore": round(z_score, 2),
                "status": status,
            }
        )

    mad = (mad / 9.0) if n > 0 else 0.0
    p_val = chi_square_p_value_df8(chi2) if n > 0 else 1.0
    conformity_band, audit_rating = classify_benford_conformity(mad, n)
    integrity_score = 0 if n < 30 else max(0, min(100, round(100.0 * math.exp(-26.0 * mad))))

    flagged_mdas: list[dict[str, Any]] = []
    if mda_pairs:
        by_mda: dict[str, list[float | int]] = defaultdict(list)
        for mda_name, amt in mda_pairs:
            if is_valid_mda_name(mda_name) and extract_leading_digit(amt) is not None:
                by_mda[re.sub(r"\s+", " ", mda_name).strip()].append(amt)

        for mda_name, m_amts in by_mda.items():
            if len(m_amts) < 50:
                continue
            sub = compute_benford_metrics(m_amts, financial_year, mda_pairs=None)
            top_row = max(sub["breakdown"], key=lambda b: abs(b["zScore"]))
            flagged_mdas.append(
                {
                    "mdaName": mda_name,
                    "recordCount": sub["validRecordCount"],
                    "mad": sub["meanAbsoluteDeviation"],
                    "chiSquareStat": sub["chiSquareStat"],
                    "chiSquarePValue": sub["chiSquarePValue"],
                    "conformityBand": sub["conformityBand"],
                    "topSuspiciousDigit": top_row["digit"],
                    "topDigitDeviationPct": top_row["deviationPct"],
                    "totalAmountNaira": int(sum(float(x) for x in m_amts)),
                }
            )
        flagged_mdas.sort(key=lambda m: (-m["mad"], -m["totalAmountNaira"]))
        flagged_mdas = flagged_mdas[:20]

    return {
        "financialYear": financial_year,
        "validRecordCount": n,
        "meanAbsoluteDeviation": round(mad, 6),
        "chiSquareStat": round(chi2, 3),
        "chiSquarePValue": round(p_val, 6),
        "conformityBand": conformity_band,
        "auditRating": audit_rating,
        "benfordIntegrityScore": integrity_score,
        "breakdown": breakdown,
        "flaggedMdas": flagged_mdas,
    }


def classify_virement_category(project_name: str, spending_type: str = "") -> str | None:
    """Classifies a budget line into one of four off-budget / virement risk buckets."""
    combined = f"{project_name or ''} {spending_type or ''}".lower()
    for key, _label, keywords in VIREMENT_RULES:
        if any(kw in combined for kw in keywords):
            return key
    return None


def is_boilerplate_overhead_title(title: str, spending_type: str = "") -> bool:
    """Distinguishes routine recurring COA overhead lines from capital project duplication."""
    if str(spending_type or "").upper() != "CAPITAL":
        return True
    return bool(BOILERPLATE_OVERHEAD_RE.search(title or ""))


def _compact_record_summary(rec: dict[str, Any], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    ident = rec.get("recordIdentity") or {}
    mda = rec.get("mdaGovernanceTaxonomy") or {}
    prov = rec.get("sourceProvenance") or {}
    out: dict[str, Any] = {
        "id": ident.get("id") or "",
        "projectCode": ident.get("projectCode") or "",
        "projectName": ident.get("verbatimProjectName") or "",
        "agency": mda.get("mdaName") or "Federal MDA",
        "amount": int(ident.get("amountNaira") or 0),
        "page": int(prov.get("pdfPage") or 1),
        "financialYear": int(ident.get("financialYear") or 0),
        "spendingType": ident.get("spendingType") or "CAPITAL",
        "sourceFilename": prov.get("sourceFilename") or "",
    }
    if extra:
        out.update(extra)
    return out


def compute_year_virements(records: list[dict[str, Any]], financial_year: int) -> dict[str, Any]:
    buckets: dict[str, dict[str, Any]] = {
        key: {"key": key, "label": label, "count": 0, "totalNaira": 0}
        for key, label, _kw in VIREMENT_RULES
    }
    matched_records: list[dict[str, Any]] = []
    total_naira = 0

    for rec in records:
        ident = rec.get("recordIdentity") or {}
        title = ident.get("verbatimProjectName") or ""
        stype = ident.get("spendingType") or ""
        cat_key = classify_virement_category(title, stype)
        if not cat_key:
            continue
        amt = int(ident.get("amountNaira") or 0)
        total_naira += amt
        buckets[cat_key]["count"] += 1
        buckets[cat_key]["totalNaira"] += amt
        matched_records.append((amt, rec, cat_key))

    matched_records.sort(key=lambda item: item[0], reverse=True)
    top_records = [
        _compact_record_summary(rec, {"categoryKey": cat_key})
        for _amt, rec, cat_key in matched_records[:80]
    ]

    return {
        "financialYear": financial_year,
        "virementRecordCount": len(matched_records),
        "totalNaira": total_naira,
        "totalNairaFormatted": _format_naira(total_naira),
        "categoryBreakdown": [buckets[key] for key, _l, _k in VIREMENT_RULES],
        "topRecords": top_records,
    }


def compute_year_duplicate_rings(records: list[dict[str, Any]], financial_year: int) -> dict[str, Any]:
    by_norm_title: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for rec in records:
        ident = rec.get("recordIdentity") or {}
        title = str(ident.get("verbatimProjectName") or "")
        norm_key = re.sub(r"[^a-z0-9]", "", title.lower())
        if len(norm_key) < 10:
            continue
        by_norm_title[norm_key].append(rec)

    capital_rings: list[dict[str, Any]] = []
    boilerplate_rings: list[dict[str, Any]] = []
    cross_mda_count = 0
    total_exposure = 0

    for norm_key, dupes in by_norm_title.items():
        if len(dupes) < 2:
            continue
        first_ident = dupes[0].get("recordIdentity") or {}
        sample_title = str(first_ident.get("verbatimProjectName") or "")
        has_capital = any(
            str((r.get("recordIdentity") or {}).get("spendingType") or "").upper() == "CAPITAL"
            for r in dupes
        )
        is_boilerplate = (not has_capital) or is_boilerplate_overhead_title(sample_title, "CAPITAL")

        ring_total = sum(int((r.get("recordIdentity") or {}).get("amountNaira") or 0) for r in dupes)
        mdas = sorted(
            {
                re.sub(r"\s+", " ", str((r.get("mdaGovernanceTaxonomy") or {}).get("mdaName") or "")).strip()
                for r in dupes
                if is_valid_mda_name(str((r.get("mdaGovernanceTaxonomy") or {}).get("mdaName") or ""))
            }
        )
        is_cross_mda = len(mdas) >= 2
        if not is_boilerplate:
            total_exposure += ring_total
            if is_cross_mda:
                cross_mda_count += 1

        dupes_sorted = sorted(
            dupes,
            key=lambda r: int((r.get("recordIdentity") or {}).get("amountNaira") or 0),
            reverse=True,
        )
        capped_mdas = mdas[:25] if is_boilerplate else mdas[:40]
        compact_samples = [
            {k: v for k, v in _compact_record_summary(r).items() if k != "projectName"}
            for r in dupes_sorted[:5]
        ]
        cluster = {
            "clusterId": f"RING-{financial_year}-{norm_key[:10].upper()}",
            "normalizedTitle": sample_title,
            "itemCount": len(dupes),
            "totalNaira": ring_total,
            "totalNairaFormatted": _format_naira(ring_total),
            "mdasInvolved": capped_mdas,
            "isCrossMda": is_cross_mda,
            "isBoilerplateOverhead": is_boilerplate,
            "sampleRecords": compact_samples,
        }
        if is_boilerplate:
            boilerplate_rings.append(cluster)
        else:
            capital_rings.append(cluster)

    capital_rings.sort(key=lambda c: (not c["isCrossMda"], -c["totalNaira"], -c["itemCount"]))
    boilerplate_rings.sort(key=lambda c: (-c["totalNaira"], -c["itemCount"]))

    return {
        "financialYear": financial_year,
        "totalRings": len(capital_rings),
        "crossMdaRingsCount": cross_mda_count,
        "boilerplateRingsCount": len(boilerplate_rings),
        "totalExposureNaira": total_exposure,
        "topRings": capital_rings[:35],
        "boilerplateSampleRings": boilerplate_rings[:8],
    }


def _extract_durable_asset_categories(rec: dict[str, Any]) -> list[tuple[str, int]]:
    """
    Identifies durable physical asset purchases (`(category_key, qty)`), strictly excluding
    routine consumables, maintenance, fuel, training, and sub-1M overhead entries.
    """
    ident = rec.get("recordIdentity") or {}
    if str(ident.get("spendingType") or "").upper() != "CAPITAL":
        return []
    amt = int(ident.get("amountNaira") or 0)
    if amt < 1_000_000:
        return []
    title = str(ident.get("verbatimProjectName") or "")
    if not title or ROUTINE_CONSUMABLE_RE.search(title):
        return []

    categories: dict[str, int] = {}
    for tok in rec.get("assetTokens") or []:
        cat = str(tok.get("category") or "")
        if cat in ASSET_CATEGORY_META:
            qty = int(tok.get("quantity") or 1)
            categories[cat] = max(categories.get(cat, 0), max(1, qty))

    if not categories and DURABLE_ACTION_RE.search(title):
        for cat_key, pat in DURABLE_CATEGORY_RULES:
            if pat.search(title):
                categories[cat_key] = 1

    return list(categories.items())


def compute_premature_replacement_alerts(
    records_by_year: dict[int, list[dict[str, Any]]],
    max_alerts: int = 150,
) -> list[dict[str, Any]]:
    """
    Scans 1999-2026 durable capital acquisitions per (normalized MDA, asset category) and finds
    repeated acquisitions occurring strictly inside the asset category's usable lifespan window.
    """
    grouped: dict[tuple[str, str], dict[int, list[tuple[dict[str, Any], int]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    display_name_for_norm: dict[str, str] = {}

    for yr in sorted(records_by_year.keys()):
        for rec in records_by_year[yr]:
            raw_mda = str((rec.get("mdaGovernanceTaxonomy") or {}).get("mdaName") or "")
            if not is_valid_mda_name(raw_mda):
                continue
            norm_mda = normalize_mda_name(raw_mda)
            display_name_for_norm.setdefault(norm_mda, re.sub(r"\s+", " ", raw_mda).strip())
            for cat_key, qty in _extract_durable_asset_categories(rec):
                grouped[(norm_mda, cat_key)][yr].append((rec, qty))

    alerts: list[dict[str, Any]] = []
    for (norm_mda, cat_key), year_bucket in grouped.items():
        years = sorted(year_bucket.keys())
        if len(years) < 2:
            continue

        meta = ASSET_CATEGORY_META[cat_key]
        lifespan = int(meta["lifespan"])

        # Find the most recent contiguous cluster of years fitting inside `< lifespan`
        best_window: list[int] = []
        for idx_end in range(len(years) - 1, 0, -1):
            y_end = years[idx_end]
            window = [y for y in years[: idx_end + 1] if (y_end - y) < lifespan]
            if len(window) >= 2:
                best_window = window
                break

        if not best_window:
            continue

        min_gap = min(best_window[i + 1] - best_window[i] for i in range(len(best_window) - 1))
        recs_with_qty = [pair for y in best_window for pair in year_bucket[y]]
        total_spent = sum(
            int((r.get("recordIdentity") or {}).get("amountNaira") or 0)
            for r, _q in recs_with_qty
        )
        total_qty = sum(q for _r, q in recs_with_qty)
        earliest_yr = best_window[0]
        latest_yr = best_window[-1]
        waste_risk = "HIGH" if (len(best_window) >= 3 or total_spent >= 500_000_000) else "MEDIUM"
        display_mda = display_name_for_norm.get(norm_mda, norm_mda)

        sorted_recs = sorted(
            [r for r, _q in recs_with_qty],
            key=lambda r: int((r.get("recordIdentity") or {}).get("amountNaira") or 0),
            reverse=True,
        )

        alerts.append(
            {
                "mdaName": display_mda,
                "normalizedMdaName": norm_mda,
                "assetCategory": cat_key,
                "assetCategoryLabel": meta["label"],
                "recentAllocationsCount": len(recs_with_qty),
                "totalSpentNaira": total_spent,
                "totalSpentFormatted": _format_naira(total_spent),
                "yearsActive": best_window,
                "minGapYears": min_gap,
                "antiquityLifespanYears": lifespan,
                "earliestAcquisitionYear": earliest_yr,
                "latestAcquisitionYear": latest_yr,
                "activeInventoryTally": total_qty,
                "wasteRisk": waste_risk,
                "reason": (
                    f"{display_mda} budgeted {len(recs_with_qty)} durable {meta['label'].lower()} acquisitions "
                    f"across {len(best_window)} fiscal cycles ({', '.join(map(str, best_window))}) "
                    f"within a {latest_yr - earliest_yr}-year span — below the {lifespan}-year usable lifespan benchmark."
                ),
                "sampleRecords": [_compact_record_summary(r) for r in sorted_recs[:10]],
            }
        )

    alerts.sort(key=lambda a: (a["wasteRisk"] != "HIGH", -a["totalSpentNaira"], -len(a["yearsActive"])))
    return alerts[:max_alerts]


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


def _load_coverage_tiers(base_dir: Path) -> dict[int, str]:
    tiers: dict[int, str] = {}
    audit_path = base_dir / "coverage_audit.json"
    if audit_path.exists():
        try:
            data = json.loads(audit_path.read_text(encoding="utf-8"))
            for k, v in (data.get("years") or {}).items():
                if str(k).isdigit() and v.get("coverage_tier"):
                    tiers[int(k)] = str(v["coverage_tier"])
        except Exception:
            pass
    reg_path = base_dir / "registry.json"
    if reg_path.exists():
        try:
            reg = json.loads(reg_path.read_text(encoding="utf-8"))
            for doc in reg.get("documents") or []:
                yr = doc.get("financial_year") or doc.get("financialYear")
                if yr and doc.get("coverage_tier") and int(yr) not in tiers:
                    tiers[int(yr)] = str(doc["coverage_tier"])
        except Exception:
            pass
    return tiers


def build_statistical_forensics(
    base_dir: str | Path = DEFAULT_BASE_DIR,
    write: bool = True,
) -> dict[str, Any]:
    """Precomputes all 4 Statistical Forensics modules across ingested fiscal years."""
    ds_dir = Path(base_dir)
    db_dir = ds_dir / "db"
    coverage_tiers = _load_coverage_tiers(ds_dir)

    records_by_year: dict[int, list[dict[str, Any]]] = {}
    by_year: dict[str, dict[str, Any]] = {}
    benford_trend: list[dict[str, Any]] = []

    total_records = 0
    non_conforming_years = 0
    marginal_years = 0
    insufficient_years = 0
    total_virement_naira = 0
    total_cross_mda_rings = 0

    if db_dir.exists():
        year_dirs = sorted(
            (d for d in db_dir.iterdir() if d.is_dir() and d.name.isdigit()),
            key=lambda d: int(d.name),
        )
        for ydir in year_dirs:
            yr = int(ydir.name)
            rec_path = ydir / "records.json"
            if not rec_path.exists():
                continue
            raw = json.loads(rec_path.read_text(encoding="utf-8"))
            recs = raw if isinstance(raw, list) else raw.get("records", [])
            records_by_year[yr] = recs
            total_records += len(recs)

            amounts = [float((r.get("recordIdentity") or {}).get("amountNaira") or 0) for r in recs]
            mda_pairs = [
                (
                    str((r.get("mdaGovernanceTaxonomy") or {}).get("mdaName") or ""),
                    float((r.get("recordIdentity") or {}).get("amountNaira") or 0),
                )
                for r in recs
            ]
            benford = compute_benford_metrics(amounts, yr, mda_pairs=mda_pairs)
            virements = compute_year_virements(recs, yr)
            dup_rings = compute_year_duplicate_rings(recs, yr)

            band = benford["conformityBand"]
            if band == "NON_CONFORMITY":
                non_conforming_years += 1
            elif band == "MARGINAL":
                marginal_years += 1
            elif band == "INSUFFICIENT_SAMPLE":
                insufficient_years += 1

            total_virement_naira += int(virements["totalNaira"])
            total_cross_mda_rings += int(dup_rings["crossMdaRingsCount"])

            benford_trend.append(
                {
                    "financialYear": yr,
                    "validRecordCount": benford["validRecordCount"],
                    "meanAbsoluteDeviation": benford["meanAbsoluteDeviation"],
                    "chiSquareStat": benford["chiSquareStat"],
                    "chiSquarePValue": benford["chiSquarePValue"],
                    "conformityBand": band,
                    "auditRating": benford["auditRating"],
                    "benfordIntegrityScore": benford["benfordIntegrityScore"],
                    "coverageTier": coverage_tiers.get(yr, "FULL_SCHEDULE"),
                }
            )
            by_year[str(yr)] = {
                "benford": benford,
                "virements": virements,
                "duplicateRings": dup_rings,
            }

    premature_alerts = compute_premature_replacement_alerts(records_by_year)
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "yearsCovered": sorted(records_by_year.keys()),
        "summary": {
            "totalRecordsAnalyzed": total_records,
            "nonConformingYearsCount": non_conforming_years,
            "marginalYearsCount": marginal_years,
            "insufficientSampleYearsCount": insufficient_years,
            "totalPrematureAlerts": len(premature_alerts),
            "totalVirementExposureNaira": total_virement_naira,
            "totalCrossMdaRings": total_cross_mda_rings,
        },
        "benfordTrend": benford_trend,
        "prematureReplacementAlerts": premature_alerts,
        "byYear": by_year,
    }

    if write:
        _atomic_write_json(ds_dir / "statistical_forensics_1999_2026.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 1999-2026 Statistical Forensics dataset")
    parser.add_argument("--base-dir", type=str, default=str(DEFAULT_BASE_DIR))
    args = parser.parse_args()

    out = build_statistical_forensics(base_dir=args.base_dir, write=True)
    out_file = Path(args.base_dir) / "statistical_forensics_1999_2026.json"
    size_mb = out_file.stat().st_size / (1024 * 1024)
    summary = out["summary"]
    print(
        f"Statistical Forensics complete: {len(out['yearsCovered'])} years | "
        f"{summary['totalRecordsAnalyzed']:,} records | "
        f"prematureAlerts={summary['totalPrematureAlerts']} | "
        f"crossMdaRings={summary['totalCrossMdaRings']} | size={size_mb:.2f} MB"
    )
    for row in out["benfordTrend"]:
        print(
            f"  FY {row['financialYear']}: N={row['validRecordCount']:>6,} | "
            f"MAD={row['meanAbsoluteDeviation']:.5f} | "
            f"Chi2={row['chiSquareStat']:>8.2f} (p={row['chiSquarePValue']:.4f}) | "
            f"{row['conformityBand']}"
        )


if __name__ == "__main__":
    main()
