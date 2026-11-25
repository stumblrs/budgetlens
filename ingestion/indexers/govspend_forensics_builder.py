"""GovSpend Treasury Cash Forensics Builder (Phase 3 · Stage P3-S4).

Analyzes all 467k+ Open Treasury disbursement vouchers (`govspend_payments` in
`backend/data/external_ledger_fts.sqlite`):
  1. December Spending Rush & Calendar Seasonality (flagging partial 2018 & 2026 years)
  2. Near-Threshold Clustering `[0.90*T, T)` beneath ₦5M, ₦10M, ₦50M, ₦100M + Rolling 7-Day Splits
  3. Cash-Level Benford's Law First-Digit (`1–9`) & First-Two-Digit (`10–99`) MAD (amounts >= ₦1,000; MDA N >= 500)

Writes compact static `public/datasets/govspend_forensics.json` (< 1.5 MB).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.follow_the_money_builder import _atomic_write_json
from ingestion.indexers.project_lifecycle_builder import canonical_contractor_key
from ingestion.indexers.statistical_forensics_builder import (
    BENFORD_EXPECTED_PROBS,
    chi_square_p_value_df8,
    extract_leading_digit,
)
from ingestion.parsers.entity_normalizer import clean_display_name

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"

DEFAULT_THRESHOLD_TIERS = (5_000_000, 10_000_000, 50_000_000, 100_000_000)

BENFORD_2D_EXPECTED: dict[int, float] = {
    d: math.log10(1.0 + 1.0 / d) for d in range(10, 100)
}

MONTH_NAMES = {
    "01": "Jan",
    "02": "Feb",
    "03": "Mar",
    "04": "Apr",
    "05": "May",
    "06": "Jun",
    "07": "Jul",
    "08": "Aug",
    "09": "Sep",
    "10": "Oct",
    "11": "Nov",
    "12": "Dec",
}


def extract_leading_two_digits(amount: float | int) -> int | None:
    """Extract first two significant decimal digits (10-99) for positive amounts."""
    if not isinstance(amount, (int, float)) or isinstance(amount, bool):
        return None
    if not math.isfinite(amount) or amount <= 0:
        return None
    s = f"{amount:.6f}"
    digits = [ch for ch in s if ch.isdigit()]
    # Strip leading zeros
    idx = 0
    while idx < len(digits) and digits[idx] == "0":
        idx += 1
    if idx >= len(digits):
        return None
    rem = digits[idx:]
    if len(rem) < 2:
        val = int(rem[0]) * 10
    else:
        val = int(rem[0] + rem[1])
    return val if 10 <= val <= 99 else None


def classify_benford_band(mad: float, n: int) -> str:
    if n < 30:
        return "INSUFFICIENT_SAMPLE"
    if mad <= 0.006:
        return "CLOSE_CONFORMITY"
    if mad <= 0.012:
        return "ACCEPTABLE"
    if mad <= 0.015:
        return "MARGINAL"
    return "NON_CONFORMITY"


def classify_benford_2d_band(mad2d: float, n: int) -> str:
    if n < 100:
        return "INSUFFICIENT_SAMPLE"
    if mad2d <= 0.0012:
        return "CLOSE_CONFORMITY"
    if mad2d <= 0.0018:
        return "ACCEPTABLE"
    if mad2d <= 0.0022:
        return "MARGINAL"
    return "NON_CONFORMITY"


def _compute_benford_1d(counts: list[int]) -> dict[str, Any]:
    total = sum(counts)
    if total == 0:
        return {
            "validCount": 0,
            "meanAbsoluteDeviation": 0.0,
            "chiSquareStat": 0.0,
            "chiSquarePValue": 1.0,
            "conformityBand": "INSUFFICIENT_SAMPLE",
            "digits": [],
        }

    mad_sum = 0.0
    chi2 = 0.0
    digits_out: list[dict[str, Any]] = []
    for d in range(1, 10):
        obs = counts[d]
        obs_p = obs / total
        exp_p = BENFORD_EXPECTED_PROBS[d]
        exp_cnt = exp_p * total
        mad_sum += abs(obs_p - exp_p)
        if exp_cnt > 0:
            chi2 += ((obs - exp_cnt) ** 2) / exp_cnt
        se = math.sqrt((exp_p * (1.0 - exp_p)) / total)
        z = (obs_p - exp_p) / se if se > 0 else 0.0
        digits_out.append(
            {
                "digit": d,
                "actualCount": obs,
                "actualPct": round(obs_p * 100.0, 2),
                "expectedPct": round(exp_p * 100.0, 2),
                "deviationPct": round((obs_p - exp_p) * 100.0, 2),
                "zScore": round(z, 2),
            }
        )

    mad = mad_sum / 9.0
    return {
        "validCount": total,
        "meanAbsoluteDeviation": round(mad, 5),
        "chiSquareStat": round(chi2, 2),
        "chiSquarePValue": round(chi_square_p_value_df8(chi2), 6),
        "conformityBand": classify_benford_band(mad, total),
        "digits": digits_out,
    }


_MONTH_WORD_GROUP = r"(?:JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:T|TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)"
_SHORT_PAYROLL_CODE_GROUP = r"(?:SAL(?:ARY|ARIES)?|PE|NRA|PEN(?:SION)?|NHIS|ALLCE)"
_SHORT_MYC_RE = re.compile(
    rf"^{_MONTH_WORD_GROUP}[\s/\-]*\d{{2,4}}[\s/\-]*{_SHORT_PAYROLL_CODE_GROUP}$",
    flags=re.IGNORECASE,
)
_SHORT_MCY_RE = re.compile(
    rf"^{_MONTH_WORD_GROUP}[\s/\-]*{_SHORT_PAYROLL_CODE_GROUP}[\s/\-]*\d{{2,4}}$",
    flags=re.IGNORECASE,
)
_SHORT_EXACT_PAYROLL_RE = re.compile(
    r"^(?:SAL|SALARY|SALARIES|PENSION|PENSIONS|PAYROLL|NHIS|FAAC|NRA|NON[\s\-]?REG(?:ULAR)?)(?:[\s/\-]+\d{2,4})?$",
    flags=re.IGNORECASE,
)

_PAYROLL_BENEFICIARY_RE = re.compile(
    r"(?:"
    r"\bIPPIS\b|"
    r"\bFINANCE\s+CORPS\b|"
    r"\bPERSONNEL\s+ACCOUNT\b|"
    r"\b(?:NIGERIAN\s+(?:AIR\s*FORCE|NAVY|ARMY)|NDA\s+CBN|FMF\s+PMO|DEFENCE|MOD)\s+CAPITAL\s+ACCOUNT\b|"
    r"\b(?:MILITARY\s+PENSION|PENSION\s+COMMISSION|PENSION\s+BOARD|PENSION\s+MANAGERS|PENSION\s+LIMITED|PENCOM)\b|"
    r"\b(?:NHIS|NSITF|FAAC|STATUTORY\s+ALLOCATION|STATUTORY\s+TRANSFER)\b|"
    r"^PENSION$"
    r")",
    flags=re.IGNORECASE,
)

_PAYROLL_DESC_RE = re.compile(
    r"(?:"
    r"\b(?:IPPIS|SALARY|SALARIES|PAYROLL|PENSION|PENSIONS|NHIS|NSITF|FAAC|PENCOM)\b|"
    r"\bSTATUTORY\s+(?:ALLOCATION|TRANSFER|DEDUCTION)\b|"
    r"\b(?:TROOPS\s+)?NON[\s\-]?REG(?:ULAR)?\s*(?:ALLCE|ALLOWANCE)\b|"
    r"\bPERSONNEL\s+(?:COST|EMOLUMENT|ALLOWANCE)\b"
    r")",
    flags=re.IGNORECASE,
)


def is_abbreviated_payroll_description(description: str | None) -> bool:
    """Detect short (<12 char) monthly salary/allowance codes (e.g. 'MAY 19 SAL', 'FEB 2024 PE').

    Leaves genuinely uninformative short strings ('None', '43788', '0', '') unexempted.
    """
    text = re.sub(r"\s+", " ", str(description or "").strip())
    if not text or len(text) >= 16:
        return False
    return bool(
        _SHORT_MYC_RE.fullmatch(text)
        or _SHORT_MCY_RE.fullmatch(text)
        or _SHORT_EXACT_PAYROLL_RE.fullmatch(text)
    )


def is_payroll_or_statutory_voucher(beneficiary: str | None, description: str | None) -> bool:
    """Return True for IPPIS payroll, military/police finance corps tranches, pensions, or FAAC/NHIS transfers."""
    ben = re.sub(r"\s+", " ", str(beneficiary or "").strip())
    if ben and _PAYROLL_BENEFICIARY_RE.search(ben):
        return True
    desc = re.sub(r"\s+", " ", str(description or "").strip())
    if not desc:
        return False
    if is_abbreviated_payroll_description(desc):
        return True
    return bool(_PAYROLL_DESC_RE.search(desc))


def _format_tier_label(t: int) -> str:
    if t >= 1_000_000:
        return f"₦{t // 1_000_000}M"
    return f"₦{t:,}"


def build_govspend_forensics(
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    threshold_tiers: tuple[int, ...] = DEFAULT_THRESHOLD_TIERS,
    min_mda_benford_n: int = 500,
    write: bool = True,
) -> dict[str, Any]:
    """Build static `govspend_forensics.json` from `govspend_payments`."""
    db_file = Path(fts_sqlite_path)
    ds_dir = Path(datasets_dir)

    if not db_file.exists():
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_LEDGER_DB",
            "headline": {},
            "decemberRush": {},
            "thresholdSplitting": {},
            "benfordCash": {},
        }
        if write:
            _atomic_write_json(ds_dir / "govspend_forensics.json", payload)
        return payload

    conn = sqlite3.connect(str(db_file))
    try:
        has_gov = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
        ).fetchone()
        if not has_gov:
            rows_iter = []
        else:
            rows_iter = conn.execute(
                """
                SELECT payment_date, financial_year, organization_name,
                       beneficiary_name, norm_beneficiary, COALESCE(amount_naira, 0), description
                FROM govspend_payments
                WHERE COALESCE(amount_naira, 0) > 0
                """
            )

        total_vouchers = 0
        total_naira = 0
        payroll_statutory_voucher_count = 0
        payroll_statutory_naira = 0
        exempted_short_payroll_count = 0
        exempted_short_payroll_naira = 0
        min_date: str | None = None
        max_date: str | None = None

        # Seasonality accumulators
        ym_acc: dict[str, list[int]] = {}
        yr_month_acc: dict[int, dict[str, list[int]]] = defaultdict(dict)
        cal_2019_2025: dict[str, list[int]] = {f"{m:02d}": [0, 0] for m in range(1, 13)}
        mda_season_2019_2025: dict[str, dict[str, Any]] = {}

        # Threshold tiers [0.90*T, T)
        tier_bands = [(t, int(round(0.90 * t)), _format_tier_label(t)) for t in threshold_tiers]
        tier_acc: dict[int, dict[str, Any]] = {
            t: {"count": 0, "totalNaira": 0, "mdas": defaultdict(lambda: [0, 0])}
            for t, _, _ in tier_bands
        }

        # Rolling 7-day split clusters: group candidate rows by (org_norm, ben_key)
        pair_txs: dict[tuple[str, str], list[tuple[int, str, str, str, int, str, bool]]] = defaultdict(list)

        # Benford accumulators (amounts >= ₦1,000)
        ben_1d_counts = [0] * 10
        ben_2d_counts = [0] * 100
        ben_valid_count = 0
        mda_ben_acc: dict[str, dict[str, Any]] = {}

        # Phase 4 (CP-3): Opaque & Discretionary Cash Categories
        disc_specs = (
            ("OPAQUE_BLANK_DESCRIPTION", "Opaque / Blank Description (< 12 chars)"),
            ("STAFF_ADVANCE_IMPREST_REFUND", "Personal / Staff Cash Advance, Imprest & Refund"),
            ("CONSULTANCY_LEGAL_SENSITIZATION", "Consultancy, Legal Fees, Sensitization & Advocacy"),
            ("LUXURY_SUV_MOTOR_VEHICLES", "Motor Vehicles, SUVs, Prado, Land Cruiser & Hilux"),
            ("ESTACODE_FOREIGN_TRAVEL_DTA", "Estacode, Foreign Travel, DTA & Air Tickets"),
            ("WELFARE_HONORARIUM_SITTING_REFRESHMENT", "Welfare, Honorarium, Sitting Allowance & Refreshments"),
        )
        disc_acc: dict[str, dict[str, Any]] = {
            key: {
                "key": key,
                "label": lbl,
                "voucherCount": 0,
                "totalNaira": 0,
                "mdas": defaultdict(lambda: [0, 0]),
                "topVouchers": [],
                "commercialVoucherCount": 0,
                "commercialTotalNaira": 0,
                "commercialMdas": defaultdict(lambda: [0, 0]),
                "commercialTopVouchers": [],
            }
            for key, lbl in disc_specs
        }

        for p_date_raw, fy_raw, org_raw, ben_raw, norm_ben_raw, amt_raw, desc_raw in rows_iter:
            amt = int(round(float(amt_raw or 0)))
            if amt <= 0:
                continue
            total_vouchers += 1
            total_naira += amt

            p_date = str(p_date_raw or "").strip()
            org_name = clean_display_name(org_raw) or "Unspecified MDA"
            ben_name = str(ben_raw or "").strip() or "Unspecified Beneficiary"
            desc = str(desc_raw or "").strip()
            is_payroll = is_payroll_or_statutory_voucher(ben_name, desc)
            if is_payroll:
                payroll_statutory_voucher_count += 1
                payroll_statutory_naira += amt

            if len(p_date) >= 10 and p_date[4] == "-" and p_date[7] == "-":
                if min_date is None or p_date < min_date:
                    min_date = p_date
                if max_date is None or p_date > max_date:
                    max_date = p_date

                ym = p_date[:7]
                mm = p_date[5:7]
                fy = int(fy_raw) if fy_raw is not None and str(fy_raw).isdigit() else int(p_date[:4])

                ym_entry = ym_acc.get(ym)
                if ym_entry is None:
                    ym_acc[ym] = [1, amt]
                else:
                    ym_entry[0] += 1
                    ym_entry[1] += amt

                yr_m = yr_month_acc[fy].get(mm)
                if yr_m is None:
                    yr_month_acc[fy][mm] = [1, amt]
                else:
                    yr_m[0] += 1
                    yr_m[1] += amt

                if 2019 <= fy <= 2025 and mm in cal_2019_2025:
                    cal_2019_2025[mm][0] += 1
                    cal_2019_2025[mm][1] += amt

                    ms = mda_season_2019_2025.get(org_name)
                    if ms is None:
                        ms = {
                            "totalNaira": 0,
                            "decNaira": 0,
                            "decCount": 0,
                            "janNovNaira": 0,
                            "months": set(),
                        }
                        mda_season_2019_2025[org_name] = ms
                    ms["totalNaira"] += amt
                    ms["months"].add(ym)
                    if mm == "12":
                        ms["decNaira"] += amt
                        ms["decCount"] += 1
                    else:
                        ms["janNovNaira"] += amt

                # Store for rolling 7-day split detection
                try:
                    ord_day = date.fromisoformat(p_date[:10]).toordinal()
                except ValueError:
                    ord_day = 0
                if ord_day > 0:
                    ckey = canonical_contractor_key(norm_ben_raw or ben_name)
                    if ckey:
                        pair_txs[(org_name.upper(), ckey)].append(
                            (ord_day, p_date[:10], org_name, ben_name, amt, desc, is_payroll)
                        )

            # Near-threshold bands [0.90*T, T)
            for t, lo, _ in tier_bands:
                if lo <= amt < t:
                    ta = tier_acc[t]
                    ta["count"] += 1
                    ta["totalNaira"] += amt
                    ta_m = ta["mdas"][org_name]
                    ta_m[0] += 1
                    ta_m[1] += amt

            # Cash-level Benford (>= ₦1,000)
            if amt >= 1_000:
                d1 = extract_leading_digit(amt)
                d2 = extract_leading_two_digits(amt)
                if d1 is not None:
                    ben_valid_count += 1
                    ben_1d_counts[d1] += 1
                    if d2 is not None:
                        ben_2d_counts[d2] += 1

                    mb = mda_ben_acc.get(org_name)
                    if mb is None:
                        mb = {"counts": [0] * 10, "totalNaira": 0, "n": 0}
                        mda_ben_acc[org_name] = mb
                    mb["counts"][d1] += 1
                    mb["totalNaira"] += amt
                    mb["n"] += 1

            # Phase 4 (CP-3): Opaque & Discretionary Cash Classification
            desc_low = desc.lower()
            matched_disc_keys: list[str] = []
            if len(desc) < 12:
                if is_abbreviated_payroll_description(desc):
                    exempted_short_payroll_count += 1
                    exempted_short_payroll_naira += amt
                else:
                    matched_disc_keys.append("OPAQUE_BLANK_DESCRIPTION")
            if any(w in desc_low for w in ("advance", "imprest", "refund")):
                matched_disc_keys.append("STAFF_ADVANCE_IMPREST_REFUND")
            if any(w in desc_low for w in ("consultancy", "legal fee", "sensitization", "advocacy")):
                matched_disc_keys.append("CONSULTANCY_LEGAL_SENSITIZATION")
            if any(w in desc_low for w in ("hilux", "prado", "land cruiser", "suv", "motor vehicle")):
                matched_disc_keys.append("LUXURY_SUV_MOTOR_VEHICLES")
            if any(w in desc_low for w in ("estacode", "dta", "duty tour", "international travel", "air ticket")):
                matched_disc_keys.append("ESTACODE_FOREIGN_TRAVEL_DTA")
            if any(w in desc_low for w in ("welfare", "honorarium", "sitting allowance", "refreshment")):
                matched_disc_keys.append("WELFARE_HONORARIUM_SITTING_REFRESHMENT")

            for d_key in matched_disc_keys:
                da = disc_acc[d_key]
                da["voucherCount"] += 1
                da["totalNaira"] += amt
                dm = da["mdas"][org_name]
                dm[0] += 1
                dm[1] += amt
                v_row = {
                    "paymentDate": p_date[:10],
                    "organizationName": org_name,
                    "beneficiaryName": ben_name,
                    "amountNaira": amt,
                    "description": desc[:160],
                    "isPayrollOrStatutory": is_payroll,
                }
                tv = da["topVouchers"]
                if len(tv) < 25 or amt > tv[-1]["amountNaira"]:
                    tv.append(v_row)
                    tv.sort(key=lambda x: -x["amountNaira"])
                    if len(tv) > 25:
                        tv.pop()
                if not is_payroll:
                    da["commercialVoucherCount"] += 1
                    da["commercialTotalNaira"] += amt
                    cm = da["commercialMdas"][org_name]
                    cm[0] += 1
                    cm[1] += amt
                    ctv = da["commercialTopVouchers"]
                    if len(ctv) < 20 or amt > ctv[-1]["amountNaira"]:
                        ctv.append(dict(v_row))
                        ctv.sort(key=lambda x: -x["amountNaira"])
                        if len(ctv) > 20:
                            ctv.pop()
    finally:
        conn.close()

    # 1. Finalize Seasonality & December Rush
    monthly_totals = [
        {
            "yearMonth": ym,
            "financialYear": int(ym[:4]),
            "month": ym[5:7],
            "voucherCount": vals[0],
            "totalNaira": vals[1],
        }
        for ym, vals in sorted(ym_acc.items())
    ]

    cal_total_2019_2025 = sum(v[1] for v in cal_2019_2025.values())
    calendar_profile = [
        {
            "month": m,
            "label": MONTH_NAMES[m],
            "voucherCount": cal_2019_2025[m][0],
            "totalNaira": cal_2019_2025[m][1],
            "sharePct": round((cal_2019_2025[m][1] / cal_total_2019_2025) * 100.0, 2)
            if cal_total_2019_2025 > 0
            else 0.0,
        }
        for m in sorted(cal_2019_2025.keys())
    ]

    yearly_rush = []
    complete_dec_total = 0
    complete_dec_count = 0
    complete_jan_nov_total = 0
    complete_years_count = 0

    for fy in sorted(yr_month_acc.keys()):
        m_map = yr_month_acc[fy]
        months_covered = len(m_map)
        # Boundary years (2018 starting Sep, 2026 ending Jun) or years missing December / <= 6 months are partial controls
        is_partial = fy in (2018, 2026) or months_covered <= 6 or ("12" not in m_map)
        yr_tot = sum(v[1] for v in m_map.values())
        dec_cnt, dec_amt = m_map.get("12", [0, 0])
        jan_nov_amt = yr_tot - dec_amt
        jan_nov_months = sum(1 for k in m_map if k != "12")
        jan_nov_avg = round(jan_nov_amt / jan_nov_months) if jan_nov_months > 0 else 0
        dec_share = round((dec_amt / yr_tot) * 100.0, 2) if yr_tot > 0 else 0.0
        rush_ratio = (
            round(dec_amt / jan_nov_avg, 2)
            if (not is_partial and jan_nov_avg > 0 and dec_amt > 0)
            else None
        )
        if not is_partial:
            complete_years_count += 1
            complete_dec_total += dec_amt
            complete_dec_count += dec_cnt
            complete_jan_nov_total += jan_nov_amt

        yearly_rush.append(
            {
                "financialYear": fy,
                "monthsCovered": months_covered,
                "isPartialYear": is_partial,
                "partialReason": "PARTIAL_YEAR_CONTROL" if is_partial else "FULL_CALENDAR_YEAR",
                "totalNaira": yr_tot,
                "janNovAvgMonthlyNaira": jan_nov_avg,
                "decemberVoucherCount": dec_cnt,
                "decemberNaira": dec_amt,
                "decemberSharePct": dec_share,
                "decemberRushRatio": rush_ratio,
            }
        )

    overall_complete_rush_ratio = (
        round((complete_dec_total / complete_years_count) / (complete_jan_nov_total / (11 * complete_years_count)), 2)
        if complete_years_count > 0 and complete_jan_nov_total > 0
        else None
    )

    top_dec_mdas = []
    for org, ms in mda_season_2019_2025.items():
        if ms["totalNaira"] < 5_000_000_000 or ms["decNaira"] <= 0 or ms["janNovNaira"] <= 0:
            continue
        jan_nov_months_active = max(1, len([m for m in ms["months"] if not m.endswith("-12")]))
        dec_months_active = max(1, len([m for m in ms["months"] if m.endswith("-12")]))
        jan_nov_avg_mo = ms["janNovNaira"] / jan_nov_months_active
        dec_avg_mo = ms["decNaira"] / dec_months_active
        ratio = round(dec_avg_mo / jan_nov_avg_mo, 2) if jan_nov_avg_mo > 0 else 0.0
        dec_share = round((ms["decNaira"] / ms["totalNaira"]) * 100.0, 2)
        if ratio >= 1.8:
            top_dec_mdas.append(
                {
                    "organizationName": org,
                    "totalNaira": ms["totalNaira"],
                    "decemberNaira": ms["decNaira"],
                    "decemberVoucherCount": ms["decCount"],
                    "janNovAvgMonthlyNaira": round(jan_nov_avg_mo),
                    "decemberSharePct": dec_share,
                    "decemberRushRatio": ratio,
                }
            )
    top_dec_mdas.sort(key=lambda x: (-x["decemberNaira"], -x["decemberRushRatio"]))

    # 2. Finalize Near-Threshold Tiers & Rolling 7-Day Split Clusters
    tiers_out = []
    total_near_threshold_count = 0
    total_near_threshold_naira = 0
    for t, lo, lbl in tier_bands:
        ta = tier_acc[t]
        total_near_threshold_count += ta["count"]
        total_near_threshold_naira += ta["totalNaira"]
        top_t_mdas = [
            {"organizationName": m, "voucherCount": v[0], "totalNaira": v[1]}
            for m, v in sorted(ta["mdas"].items(), key=lambda kv: (-kv[1][1], -kv[1][0]))[:5]
        ]
        tiers_out.append(
            {
                "tierCeilingNaira": t,
                "tierLabel": lbl,
                "bandMinNaira": lo,
                "bandMaxNaira": t,
                "voucherCount": ta["count"],
                "totalNaira": ta["totalNaira"],
                "shareOfValidCountPct": round((ta["count"] / total_vouchers) * 100.0, 2) if total_vouchers > 0 else 0.0,
                "topMdas": top_t_mdas,
            }
        )

    # Rolling 7-day MDA x Beneficiary split clusters (>= 3 vouchers in <= 6 day span)
    rolling_clusters: list[dict[str, Any]] = []
    commercial_rolling_clusters: list[dict[str, Any]] = []
    rolling_total_naira = 0
    commercial_rolling_total_naira = 0
    payroll_rolling_cluster_count = 0
    payroll_rolling_total_naira = 0
    for (_org_u, _ckey), txs in pair_txs.items():
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
                win = txs[i : j + 1]
                win_tot = sum(x[4] for x in win)
                max_single = max(x[4] for x in win)
                cluster_is_payroll = is_payroll_or_statutory_voucher(win[0][3], win[0][5]) or (
                    sum(1 for x in win if x[6]) * 2 >= len(win)
                )
                cluster_obj = {
                    "startDate": win[0][1],
                    "endDate": win[-1][1],
                    "organizationName": win[0][2],
                    "beneficiaryName": win[0][3],
                    "voucherCount": win_len,
                    "totalNaira": win_tot,
                    "maxSingleVoucherNaira": max_single,
                    "sampleDescription": win[0][5][:160],
                    "isPayrollOrStatutory": cluster_is_payroll,
                }
                rolling_total_naira += win_tot
                rolling_clusters.append(cluster_obj)
                if cluster_is_payroll:
                    payroll_rolling_cluster_count += 1
                    payroll_rolling_total_naira += win_tot
                else:
                    commercial_rolling_total_naira += win_tot
                    commercial_rolling_clusters.append(cluster_obj)
                i = j + 1
            else:
                i += 1

    rolling_clusters.sort(key=lambda c: (-c["totalNaira"], -c["voucherCount"]))
    commercial_rolling_clusters.sort(key=lambda c: (-c["totalNaira"], -c["voucherCount"]))

    # 3. Finalize Cash Benford (1st digit, 2nd digit, MDA N >= 500)
    ben_1d = _compute_benford_1d(ben_1d_counts)
    mad2d_sum = 0.0
    digits_2d: list[dict[str, Any]] = []
    if ben_valid_count > 0:
        for d2 in range(10, 100):
            obs = ben_2d_counts[d2]
            obs_p = obs / ben_valid_count
            exp_p = BENFORD_2D_EXPECTED[d2]
            mad2d_sum += abs(obs_p - exp_p)
            se = math.sqrt((exp_p * (1.0 - exp_p)) / ben_valid_count)
            z = (obs_p - exp_p) / se if se > 0 else 0.0
            digits_2d.append(
                {
                    "prefix": d2,
                    "actualCount": obs,
                    "actualPct": round(obs_p * 100.0, 3),
                    "expectedPct": round(exp_p * 100.0, 3),
                    "deviationPct": round((obs_p - exp_p) * 100.0, 3),
                    "zScore": round(z, 2),
                }
            )
    mad2d = mad2d_sum / 90.0
    top_2d_spikes = sorted(
        digits_2d, key=lambda x: (-x["deviationPct"], -x["zScore"])
    )[:15]

    mda_ben_list = []
    for org_name, mb in mda_ben_acc.items():
        if mb["n"] < min_mda_benford_n:
            continue
        res_m = _compute_benford_1d(mb["counts"])
        peak = max(res_m["digits"], key=lambda d: d["deviationPct"])
        mda_ben_list.append(
            {
                "organizationName": org_name,
                "validCount": res_m["validCount"],
                "totalNaira": mb["totalNaira"],
                "mad": res_m["meanAbsoluteDeviation"],
                "chiSquareStat": res_m["chiSquareStat"],
                "chiSquarePValue": res_m["chiSquarePValue"],
                "conformityBand": res_m["conformityBand"],
                "peakDigit": peak["digit"],
                "peakDigitDeviationPct": peak["deviationPct"],
            }
        )
    mda_ben_list.sort(key=lambda x: (-x["mad"], -x["totalNaira"]))

    disc_categories_out = []
    disc_total_vouchers = 0
    disc_total_naira = 0
    disc_commercial_vouchers = 0
    disc_commercial_naira = 0
    for d_key, _ in disc_specs:
        da = disc_acc[d_key]
        disc_total_vouchers += da["voucherCount"]
        disc_total_naira += da["totalNaira"]
        disc_commercial_vouchers += da["commercialVoucherCount"]
        disc_commercial_naira += da["commercialTotalNaira"]
        top_d_mdas = [
            {"organizationName": m, "voucherCount": vals[0], "totalNaira": vals[1]}
            for m, vals in sorted(da["mdas"].items(), key=lambda kv: (-kv[1][1], -kv[1][0]))[:5]
        ]
        top_c_mdas = [
            {"organizationName": m, "voucherCount": vals[0], "totalNaira": vals[1]}
            for m, vals in sorted(da["commercialMdas"].items(), key=lambda kv: (-kv[1][1], -kv[1][0]))[:5]
        ]
        disc_categories_out.append(
            {
                "key": d_key,
                "label": da["label"],
                "voucherCount": da["voucherCount"],
                "totalNaira": da["totalNaira"],
                "topMdas": top_d_mdas,
                "topVouchers": da["topVouchers"][:15],
                "commercialVoucherCount": da["commercialVoucherCount"],
                "commercialTotalNaira": da["commercialTotalNaira"],
                "commercialTopMdas": top_c_mdas,
                "commercialTopVouchers": da["commercialTopVouchers"][:15],
            }
        )

    payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_GOVSPEND_FORENSICS",
        "headline": {
            "totalVouchers": total_vouchers,
            "totalNaira": total_naira,
            "minDate": min_date,
            "maxDate": max_date,
            "completeYearsCount": complete_years_count,
            "december2019To2025Vouchers": complete_dec_count,
            "december2019To2025Naira": complete_dec_total,
            "decemberRushRatio2019To2025": overall_complete_rush_ratio,
            "nearThresholdVoucherCount": total_near_threshold_count,
            "nearThresholdNaira": total_near_threshold_naira,
            "rolling7DayClusterCount": len(rolling_clusters),
            "rolling7DayClusterNaira": rolling_total_naira,
            "commercialRolling7DayClusterCount": len(commercial_rolling_clusters),
            "commercialRolling7DayClusterNaira": commercial_rolling_total_naira,
            "payrollRolling7DayClusterCount": payroll_rolling_cluster_count,
            "payrollRolling7DayClusterNaira": payroll_rolling_total_naira,
            "payrollStatutoryVoucherCount": payroll_statutory_voucher_count,
            "payrollStatutoryNaira": payroll_statutory_naira,
            "exemptedShortPayrollCount": exempted_short_payroll_count,
            "exemptedShortPayrollNaira": exempted_short_payroll_naira,
            "benfordValidCount": ben_valid_count,
            "benford1DMad": ben_1d["meanAbsoluteDeviation"],
            "benford1DBand": ben_1d["conformityBand"],
            "benford2DMad": round(mad2d, 5),
            "benford2DBand": classify_benford_2d_band(mad2d, ben_valid_count),
            "eligibleBenfordMdaCount": len(mda_ben_list),
            "discretionaryOpaqueVoucherCount": disc_total_vouchers,
            "discretionaryOpaqueNaira": disc_total_naira,
            "commercialOpaqueVoucherCount": disc_commercial_vouchers,
            "commercialOpaqueNaira": disc_commercial_naira,
        },
        "decemberRush": {
            "calendarProfile2019To2025": calendar_profile,
            "yearlyRush": yearly_rush,
            "monthlyTotals": monthly_totals,
            "topDecemberRushMdas": top_dec_mdas[:30],
        },
        "thresholdSplitting": {
            "tiers": tiers_out,
            "rolling7DayClusterCount": len(rolling_clusters),
            "rolling7DayClusterNaira": rolling_total_naira,
            "commercialRolling7DayClusterCount": len(commercial_rolling_clusters),
            "commercialRolling7DayClusterNaira": commercial_rolling_total_naira,
            "payrollRolling7DayClusterCount": payroll_rolling_cluster_count,
            "payrollRolling7DayClusterNaira": payroll_rolling_total_naira,
            "topRolling7DayClusters": rolling_clusters[:40],
            "topCommercialRolling7DayClusters": commercial_rolling_clusters[:40],
        },
        "benfordCash": {
            "minAmountNaira": 1_000,
            "minMdaSampleSize": min_mda_benford_n,
            "firstDigit": ben_1d,
            "secondDigitMad": round(mad2d, 5),
            "secondDigitBand": classify_benford_2d_band(mad2d, ben_valid_count),
            "top2DigitSpikes": top_2d_spikes,
            "topFlaggedMdas": mda_ben_list[:30],
        },
        "discretionaryAndOpaqueAudit": {
            "totalFlaggedVouchers": disc_total_vouchers,
            "totalFlaggedNaira": disc_total_naira,
            "commercialFlaggedVouchers": disc_commercial_vouchers,
            "commercialFlaggedNaira": disc_commercial_naira,
            "exemptedShortPayrollCount": exempted_short_payroll_count,
            "exemptedShortPayrollNaira": exempted_short_payroll_naira,
            "categories": disc_categories_out,
        },
    }

    if write:
        out_gf = ds_dir / "govspend_forensics.json"
        _atomic_write_json(out_gf, payload)
        try:
            from ingestion.checkpoints.phase4_checkpoint import record_phase4_checkpoint

            record_phase4_checkpoint(
                checkpoint_id="CP-3",
                stage="P4-S3",
                title="N2.44T Opaque, Blank-Description & Discretionary Cash Forensics",
                output_files=[out_gf],
                metrics=payload["headline"],
            )
        except Exception:
            pass

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build December Rush, Threshold-Splitting & GovSpend Benford Forensics (P3-S4)."
    )
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    args = parser.parse_args()

    res = build_govspend_forensics(
        fts_sqlite_path=args.sqlite,
        datasets_dir=args.datasets_dir,
        write=True,
    )
    out_path = args.datasets_dir / "govspend_forensics.json"
    size_kb = out_path.stat().st_size / 1024.0 if out_path.exists() else 0.0
    h = res["headline"]
    print(
        f"GovSpend Forensics [{res['status']}]: vouchers={h['totalVouchers']} (NGN {h['totalNaira']/1e12:.2f}T) "
        f"| Dec2019-25=NGN {h['december2019To2025Naira']/1e12:.2f}T (rush={h['decemberRushRatio2019To2025']}x) "
        f"| nearThresh={h['nearThresholdVoucherCount']} (NGN {h['nearThresholdNaira']/1e9:.2f}B) "
        f"| splits7d={h['rolling7DayClusterCount']} | Benford1D MAD={h['benford1DMad']} ({h['benford1DBand']}) "
        f"| 2D MAD={h['benford2DMad']} ({h['benford2DBand']}) | file={size_kb:.1f} KB"
    )


if __name__ == "__main__":
    main()
