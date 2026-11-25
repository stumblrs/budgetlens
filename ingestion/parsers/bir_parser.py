"""Budget Implementation Report (BIR) & OAGF Capital Releases Parser.

Parses official performance & warrant-release PDFs (`source_pdfs/2016/Total Capital and
Capital Releases.pdf`, `source_pdfs/2023/2023 Budget Performance.pdf`), Budget Office
Quarterly Budget Implementation Report (BIR) PDFs under `bir_pdfs/<year>/`, plus any
standardized drop-in OAGF CSVs under `bir_pdfs/<year>/` into `public/datasets/execution_tracker.json`.

Strict Zero-Fabrication Policy:
Years without text-extractable BIR/OAGF release files or containing only embedded image
tables/scanned pages are flagged explicitly without synthetic release or utilization figures.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sqlite3
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

from ingestion.parsers.entity_normalizer import clean_display_name
from ingestion.parsers.ocr_engine import (
    _clean_ocr_numeric_token,
    is_ocr_available,
    ocr_pdf_pages,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_ROOT = PROJECT_ROOT / "source_pdfs"
DEFAULT_BIR_ROOT = PROJECT_ROOT / "bir_pdfs"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"

NUM_LINE_RE = re.compile(r"^\(?[\d,]+(?:\.\d+)?\)?$")
MONEY_TOKEN_RE = re.compile(r"^\(?-?[\d,]+(?:\.\d+)?\)?%?$")

PERIOD_LABELS = {
    "Q4": "Q4 Full-Year",
    "Q3": "Q3 YTD",
    "Q2": "Q2 Half-Year YTD",
    "Q1": "Q1 YTD",
}


def sha256_file(path: Path) -> str:
    """Compute prefixed SHA-256 checksum for a file."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def _parse_int_amount(raw: str) -> int:
    cleaned = re.sub(r"[^\d.]", "", str(raw or ""))
    if not cleaned:
        return 0
    try:
        return int(round(float(cleaned)))
    except ValueError:
        return 0


def _parse_float_token(raw: str) -> float | None:
    """Parse numeric table token such as '1,234.56', '(45.10)', '-137.91', or '-'."""
    s = str(raw or "").strip()
    if not s or s in {"-", "—", "–", "nil", "n/a", "N/A"}:
        return None
    if s.endswith("%"):
        return None
    neg = False
    if s.startswith("(") and s.endswith(")"):
        neg = True
        s = s[1:-1].strip()
    elif s.startswith("-"):
        neg = True
        s = s[1:].strip()
    s = s.replace(",", "").replace(" ", "")
    if not re.fullmatch(r"\d+(?:\.\d+)?", s):
        return None
    val = float(s)
    return -val if neg else val


def classify_bir_filename(filename: str) -> tuple[str, int, bool]:
    """Return `(quarter, priority_score, is_excluded)` for a BIR filename."""
    lower = Path(filename).name.lower()
    if any(ex in lower for ex in ("unity-schools", "unity_schools", "macroeconomics")):
        return ("Q4", -1, True)
    if "consolidated" in lower and "fourth" in lower:
        return ("Q4", 45, False)
    if "fourth" in lower or "q4" in lower:
        return ("Q4", 40, False)
    if "consolidated" in lower:
        return ("Q4", 38, False)
    if "third" in lower or "q3" in lower:
        return ("Q3", 30, False)
    if any(k in lower for k in ("second", "half", "mid-year", "mid_year", "q2")):
        return ("Q2", 20, False)
    if "first" in lower or "q1" in lower:
        return ("Q1", 10, False)
    # Untagged annual file e.g. 2012-budget-implementation-report.pdf
    return ("Q4", 35, False)


def is_scanned_pdf(pdf_path: Path) -> bool:
    """Return True if sampled initial pages contain < 50 extractable characters/page."""
    try:
        doc = fitz.open(str(pdf_path))
    except Exception:
        return True
    try:
        sample_n = min(len(doc), 10)
        if sample_n == 0:
            return True
        chars = sum(len(doc[i].get_text("text").strip()) for i in range(sample_n))
        return (chars / sample_n) < 50.0
    finally:
        doc.close()


# ------------------------------------------------------------------
# Low-level PyMuPDF word-coordinate row grouping
# ------------------------------------------------------------------


def _should_merge_word_pair(left_txt: str, right_txt: str, gap: float, left_x0: float = 0.0) -> bool:
    """Decide whether two adjacent words on a table row belong to the same token."""
    if gap < -1.0:
        return False
    # Split number pieces e.g. "1" + ",810.66" or "2,265,209." + "6"
    if re.fullmatch(r"\(?-?\d[\d,]*\.?", left_txt) and re.fullmatch(
        r"(?:,\d+(?:\.\d+)?|\.\d+)\)?%?", right_txt
    ) and gap <= 12.0:
        return True
    # OCR comma-dropped thousands split e.g. "6" + "637.58" or "2" + "155.32" (in numeric columns)
    if (
        left_x0 >= 140.0
        and re.fullmatch(r"\(?-?\d{1,3}", left_txt)
        and re.fullmatch(r"\d{3}(?:,\d{3})*(?:\.\d+)?\)?%?", right_txt)
        and gap <= 6.5
    ):
        return True
    if left_txt in {"-", "("} and re.fullmatch(r"\d[\d,]*(?:\.\d+)?\)?", right_txt) and gap <= 6.0:
        return True
    if re.fullmatch(r"\(?-?\d[\d,]*\.\d+", left_txt) and right_txt in {")", "%"} and gap <= 4.0:
        return True
    # Spaced-out letters in headers like "U t i l i z a t i o n" (single-char tokens only)
    if len(left_txt) == 1 and left_txt.isalpha() and len(right_txt) == 1 and right_txt.isalpha() and gap <= 3.5:
        return True
    if len(left_txt) >= 1 and left_txt.isalpha() and len(right_txt) == 1 and right_txt.isalpha() and gap <= 0.8:
        return True
    return False


def _build_word_rows_from_raw(
    raw_words: list[Any],
    y_tol: float = 3.8,
    *,
    is_ocr: bool = False,
) -> list[tuple[float, list[dict[str, Any]]]]:
    """Group coordinate word boxes `[x0, y0, x1, y1, text]` into sorted horizontal rows."""
    if not raw_words:
        return []
    sorted_words = sorted(raw_words, key=lambda w: ((w[1] + w[3]) / 2.0, w[0]))
    bands: list[list[Any]] = []
    band_ys: list[float] = []
    for w in sorted_words:
        yc = (float(w[1]) + float(w[3])) / 2.0
        if not bands or abs(yc - band_ys[-1]) > y_tol:
            bands.append([w])
            band_ys.append(yc)
        else:
            bands[-1].append(w)
            band_ys[-1] = sum((float(item[1]) + float(item[3])) / 2.0 for item in bands[-1]) / len(bands[-1])

    result: list[tuple[float, list[dict[str, Any]]]] = []
    for band_y, band in zip(band_ys, bands):
        band.sort(key=lambda w: float(w[0]))
        merged: list[dict[str, Any]] = []
        for w in band:
            word_txt = _clean_ocr_numeric_token(str(w[4])) if is_ocr else str(w[4])
            if not word_txt:
                continue
            tok = {
                "x0": float(w[0]),
                "x1": float(w[2]),
                "xm": (float(w[0]) + float(w[2])) / 2.0,
                "text": word_txt,
            }
            if merged:
                prev = merged[-1]
                gap = tok["x0"] - prev["x1"]
                if _should_merge_word_pair(prev["text"], tok["text"], gap, prev["x0"]):
                    sep = "" if (len(prev["text"]) == 1 and gap <= 3.0) or re.match(r"^[,\.\)\%]", tok["text"]) or prev["text"] in {"-", "("} else ""
                    prev["text"] = f"{prev['text']}{sep}{tok['text']}"
                    prev["x1"] = max(prev["x1"], tok["x1"])
                    prev["xm"] = (prev["x0"] + prev["x1"]) / 2.0
                    continue
            merged.append(tok)
        result.append((band_y, merged))
    return result


def _extract_word_rows(page: fitz.Page, y_tol: float = 3.8) -> list[tuple[float, list[dict[str, Any]]]]:
    """Group PyMuPDF words into sorted horizontal rows with merged numeric fragments."""
    return _build_word_rows_from_raw(page.get_text("words"), y_tol=y_tol, is_ocr=False)


def _find_big_image_table_pages(doc: fitz.Document) -> list[int]:
    """Return 0-based page indices likely containing embedded raster table images."""
    hits: list[int] = []
    start_idx = min(len(doc), 10)
    for idx in range(start_idx, len(doc)):
        pg = doc[idx]
        low = pg.get_text("text").lower()
        if "table of contents" in low or "list of tables" in low:
            continue
        if len(pg.get_text("words")) >= 180:
            continue
        for im in pg.get_images(full=True):
            for r in pg.get_image_rects(im[0]):
                if r.width >= 250 and r.height >= 180:
                    hits.append(idx)
                    break
            else:
                continue
            break
    return hits


# ------------------------------------------------------------------
# Macro Fiscal Expenditure & Revenue Table Extractor (Table 3.9 / 7 / 8)
# ------------------------------------------------------------------

_MACRO_CANONICAL_RULES: list[tuple[str, re.Pattern[str], re.Pattern[str] | None]] = [
    (
        "Aggregate Federal Government Revenue / Total Inflow",
        re.compile(r"\b(aggregate\s+federal\s+government\s+revenue|total\s+fgn\s+revenue|fgn\s+retained\s+revenue|retained\s+revenue|t?otal\s+inflow|amount\s+available\s+for\s+fgn\s+budget)\b", re.I),
        re.compile(r"independent|exchange\s+rate|goes\s+retained|special", re.I),
    ),
    (
        "Personnel Cost (MDAs)",
        re.compile(r"\bpersonnel\s+costs?\s*(?:\(mdas?\)|mdas?|,\s*pension)?\b", re.I),
        re.compile(r"\(goes\)|pension\s+redemption|\bgoes\b", re.I),
    ),
    (
        "Overhead Cost (MDAs)",
        re.compile(r"\boverhead\s+costs?\b", re.I),
        re.compile(r"\(goes\)|pension|\bgoes\b", re.I),
    ),
    (
        "Recurrent Non-Debt Expenditure (Sub-Total)",
        re.compile(r"\bs?ub[-\s]*tota[li]\s*\(?non[-\s]*debt", re.I),
        None,
    ),
    (
        "Domestic Debt Service",
        re.compile(r"\bdomestic\s+debts?\b", re.I),
        re.compile(r"deficit|financing|borrowing", re.I),
    ),
    (
        "Foreign Debt Service",
        re.compile(r"\bforeign\s+debts?\b", re.I),
        re.compile(r"deficit|financing|borrowing", re.I),
    ),
    (
        "Debt Service / Recurrent Debt (Sub-Total)",
        re.compile(r"\b(s?ub[-\s]*(?:tota[li]|debt)\s*\(?debt|total\s+debts?(?:\s+service)?)\b", re.I),
        re.compile(r"domestic|foreign", re.I),
    ),
    (
        "Total Recurrent Expenditure",
        re.compile(r"\b(total\s*\(?debt\s*&\s*non[-\s]*debt\s*recurrent|total\s+recurrent\s+expenditure|s?ub[-\s]*tota[li]\s*\(?recurrent)\b", re.I),
        re.compile(r"non[-\s]*debt\s*\)", re.I),
    ),
    (
        "Capital Expenditure (Total / Releases)",
        re.compile(r"\b(t?otal\s+capital(?:\s+expenditure)?|s?ub[-\s]*tota[li]\s*\(?capital\)?|capital\s+vote)\b", re.I),
        re.compile(r"goes|supplementation|2018\s+in|2017\s+in|2019\s+in|2024\s+in|2025\s+in|special\s+intervention|multilateral|grants|development\s+levy|tetfund|exclusive\s+of\s+transfers", re.I),
    ),
    (
        "Statutory Transfers",
        re.compile(r"\b(statutory\s+transfers|s?ub[-\s]*tota[li]\s*\(?transfers?\)?)\b", re.I),
        re.compile(r"deficit|capital\s+expenditure\s+in\s+statutory", re.I),
    ),
    (
        "Total FGN Expenditure (Excl. GOEs & Project-Tied Loans)",
        re.compile(r"\b(fgn\s+expenditure\s*\(excl|total\s+fgn\s+expenditure\s*\(excl|total\s+fgn\s+budg(?:et)?\s*\(excl|total\b.*\bfgn\b.*\bbudg(?:et)?\b.*excl)", re.I),
        None,
    ),
    (
        "Aggregate Federal Government Expenditure",
        re.compile(r"\b(aggregate\s+fgn\s+expenditure|total\s+actual\s+expenditure|total\s+fgn\s+budg(?:et)?|total\s+expenditure\b)\b", re.I),
        re.compile(r"excl\.?\s*goes|excluding\s+goes|excl\.?\s*geos|deficit|loans\)\s+fgn", re.I),
    ),
]


def _canonical_macro_label(label: str) -> str | None:
    clean = re.sub(r"\s+", " ", label).strip()
    if len(clean) < 4:
        return None
    for canon, pat, excl in _MACRO_CANONICAL_RULES:
        if pat.search(clean):
            if excl and excl.search(clean):
                continue
            return canon
    return None


def _cluster_x_positions(xs: list[float], tol: float = 16.0) -> list[float]:
    if not xs:
        return []
    sx = sorted(xs)
    clusters: list[list[float]] = [[sx[0]]]
    for x in sx[1:]:
        if x - clusters[-1][-1] <= tol:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    return [sum(c) / len(c) for c in clusters]


def _pick_macro_columns(
    rows: list[tuple[float, list[dict[str, Any]]]],
    year: int,
    quarter: str,
) -> tuple[float, float, float, float, int]:
    """Infer `(budget_x, actual_x, variance_x0, first_num_x0, unit_multiplier)` for a macro table page."""
    variance_x0 = 9999.0
    actual_section_x = 9999.0
    header_annual_xs: list[float] = []
    header_half_xs: list[float] = []
    header_quarterly_xs: list[float] = []
    header_first_q_xs: list[float] = []
    header_third_q_xs: list[float] = []
    header_3qrts_xs: list[float] = []
    unit_mult = 1_000_000_000

    header_top_idx = 0
    header_num_x0s: list[float] = []
    unit_mult = 1_000_000_000
    for idx, (_, tokens) in enumerate(rows[:30]):
        joined = " ".join(t["text"] for t in tokens).lower()
        if any(k in joined for k in ("table ", "items", "fiscal items", "fgn budget expenditure", "summary of budget")):
            header_top_idx = max(header_top_idx, idx)
        if ("million" in joined or "n'm" in joined or "₦m" in joined) and "billion" not in joined:
            unit_mult = 1_000_000

    header_slice = rows[max(0, header_top_idx - 2) : min(len(rows), header_top_idx + 14)]
    for _, tokens in header_slice:
        for i, tok in enumerate(tokens):
            up = tok["text"].upper()
            if up.startswith("VARIANCE") or up == "DIFF":
                variance_x0 = min(variance_x0, tok["x0"])
            if up == "ACTUAL" and tok["x0"] >= 180 and tok["x0"] < variance_x0 - 20 and actual_section_x == 9999.0:
                next_up = tokens[i + 1]["text"].upper() if i + 1 < len(tokens) else ""
                if next_up not in {"VS", "V"}:
                    actual_section_x = tok["x0"]
            if up in {"BUDGET", "ANNUAL", "QUARTERLY", "HALF", "HALFYEAR", "3QRTS", "3QRT", "N'BN", "N'BNS", "₦B", "N'M", "₦M"} and tok["x0"] >= 110.0:
                header_num_x0s.append(tok["x0"])
            if up == "ANNUAL":
                header_annual_xs.append(tok["xm"])
            if up.startswith(("3QRT", "3RDQ")):
                header_3qrts_xs.append(tok["xm"])
            if up == "HALF" and i + 1 < len(tokens) and tokens[i + 1]["text"].upper().startswith("YEAR"):
                xm = (tok["x0"] + tokens[i + 1]["x1"]) / 2.0
                header_half_xs.append(xm)
            elif up == "HALFYEAR":
                header_half_xs.append(tok["xm"])
            if up == "QUARTERLY":
                header_quarterly_xs.append(tok["xm"])
            if up == "FIRST":
                header_first_q_xs.append(tok["xm"])
            if up == "THIRD":
                header_third_q_xs.append(tok["xm"])

    # Fallback variance boundary when explicit VARIANCE header word is omitted (e.g. 2020 Q1 / 2021 Q3)
    if variance_x0 == 9999.0:
        for _, tokens in header_slice:
            for tok in tokens:
                up = tok["text"].upper()
                if (up == "VS" or up.startswith("VSQUARTER") or up.startswith("ACTUALVS")) and tok["x0"] >= 380.0:
                    variance_x0 = min(variance_x0, tok["x0"] - 42.0)
                elif tok["text"] == "%" and tok["x0"] >= 380.0:
                    variance_x0 = min(variance_x0, tok["x0"] - 48.0)

    min_num_x0 = max(105.0, min(header_num_x0s) - 18.0) if header_num_x0s else 115.0

    # Gather numeric X coordinates right of serial/label margin and left of variance_x0
    body_num_xs: list[float] = []
    label_end_xs: list[float] = []
    for _, tokens in rows:
        label_tokens = [t["text"] for t in tokens if t["x0"] < min_num_x0 + 40]
        row_text = " ".join(label_tokens)
        if not any(ch.isalpha() for ch in row_text):
            continue
        if _canonical_macro_label(" ".join(t["text"] for t in tokens if _parse_float_token(t["text"]) is None)) is None:
            continue
        row_nums = [
            t
            for t in tokens
            if t["x0"] >= min_num_x0 and t["x0"] < variance_x0 - 8 and _parse_float_token(t["text"]) is not None
        ]
        if len(row_nums) >= 2:
            for rn in row_nums:
                body_num_xs.append(rn["xm"])
            label_end_xs.append(min(rn["x0"] for rn in row_nums))

    col_centers = _cluster_x_positions(body_num_xs, tol=16.0)
    first_num_x0 = min(label_end_xs) if label_end_xs else (col_centers[0] - 12.0 if col_centers else 150.0)
    if col_centers:
        first_num_x0 = min(first_num_x0, col_centers[0] - 8.0)
    if len(col_centers) < 2:
        return (0.0, 0.0, variance_x0, first_num_x0, unit_mult)

    budget_xs = [x for x in header_annual_xs if x < actual_section_x - 15]
    actual_annual_xs = [x for x in header_annual_xs if actual_section_x - 25 <= x < variance_x0 - 8]
    actual_half_xs = [x for x in header_half_xs if actual_section_x - 25 <= x < variance_x0 - 8]
    budget_half_xs = [x for x in header_half_xs if x < actual_section_x - 15]

    budget_x = col_centers[0]
    actual_x = col_centers[1]

    if quarter == "Q2" and len(col_centers) >= 6:
        budget_x = min(col_centers, key=lambda c: abs(c - budget_half_xs[0])) if budget_half_xs else col_centers[2]
        actual_x = min(col_centers, key=lambda c: abs(c - actual_half_xs[0])) if actual_half_xs else col_centers[5]
    elif quarter == "Q1":
        q_bud = [x for x in header_quarterly_xs if x < actual_section_x - 15]
        q_act = [x for x in header_first_q_xs if actual_section_x - 25 <= x < variance_x0 - 8]
        if q_bud and q_act:
            budget_x = min(col_centers, key=lambda c: abs(c - q_bud[0]))
            actual_x = min(col_centers, key=lambda c: abs(c - max(q_act)))
        elif len(col_centers) >= 5:
            budget_x = col_centers[2]
            actual_x = col_centers[4]
    elif quarter == "Q3" and len(col_centers) >= 7:
        budget_x = min(col_centers, key=lambda c: abs(c - budget_xs[0])) if budget_xs else col_centers[2]
        q3_act_hdrs = [x for x in header_3qrts_xs if x >= 400.0 and x < variance_x0 - 8]
        if q3_act_hdrs:
            actual_x = min(col_centers, key=lambda c: abs(c - max(q3_act_hdrs)))
        else:
            actual_x = col_centers[6]
    elif len(col_centers) >= 7:
        # Standard Q4 FGN Fiscal Account table: [Annual Budget, Quarterly, Q1, Q2, Q3, Q4, Annual Actual, ...]
        budget_x = min(col_centers, key=lambda c: abs(c - min(budget_xs))) if budget_xs else col_centers[0]
        actual_x = min(col_centers, key=lambda c: abs(c - min(actual_annual_xs))) if actual_annual_xs else col_centers[6]
    elif len(col_centers) >= 2:
        # Compact Annual Budget vs Annual Actual (e.g. 2009 Table 6)
        budget_x = col_centers[0]
        actual_x = col_centers[1]

    return (budget_x, actual_x, variance_x0, first_num_x0, unit_mult)


def apply_macro_integrity_guards(
    macro_rows: list[dict[str, Any]],
    year: int,
    quarter: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Enforce Debt Service Dom+For <= Sub-Total invariant and record verifiable integrity warnings."""
    _ = quarter
    guarded = [dict(r) for r in macro_rows]
    warnings: list[str] = []

    dom_debt = next((r for r in guarded if str(r.get("label") or "").strip().lower() == "domestic debt service"), None)
    for_debt = next((r for r in guarded if str(r.get("label") or "").strip().lower() == "foreign debt service"), None)
    sub_debt = next(
        (r for r in guarded if "debt service / recurrent debt" in str(r.get("label") or "").strip().lower()),
        None,
    )

    dom_act = int(round(float(dom_debt.get("actualNaira") or 0))) if dom_debt else 0
    for_act = int(round(float(for_debt.get("actualNaira") or 0))) if for_debt else 0
    dom_bgt = int(round(float(dom_debt.get("budgetNaira") or 0))) if dom_debt else 0
    for_bgt = int(round(float(for_debt.get("budgetNaira") or 0))) if for_debt else 0

    if sub_debt is not None and (dom_debt is not None or for_debt is not None):
        orig_act = int(round(float(sub_debt.get("actualNaira") or 0)))
        sub_bgt = int(round(float(sub_debt.get("budgetNaira") or 0))) or (dom_bgt + for_bgt)
        if orig_act < max(dom_act, for_act):
            reconciled_act = dom_act + for_act
            sub_debt["rawExtractedActualNaira"] = orig_act
            sub_debt["actualNaira"] = reconciled_act
            sub_debt["performancePct"] = round((reconciled_act / sub_bgt) * 100, 2) if sub_bgt > 0 else 0.0
            sub_debt["derivedFromComponents"] = True
            warn_msg = (
                f"FY {year} Debt Service sub-total extracted at ₦{orig_act / 1e9:.2f}B fell below component debt service "
                f"(Domestic ₦{dom_act / 1e9:.2f}B + Foreign ₦{for_act / 1e9:.2f}B); reconciled to ₦{reconciled_act / 1e9:.2f}B."
            )
            sub_debt["macroIntegrityWarning"] = warn_msg
            warnings.append(warn_msg)

    return guarded, warnings


def _parse_macro_page_rows(
    rows: list[tuple[float, list[dict[str, Any]]]],
    year: int,
    quarter: str,
    *,
    omission_warnings: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Parse macro fiscal revenue/expenditure rows from pre-grouped table rows."""
    budget_x, actual_x, variance_x0, first_num_x0, unit_mult = _pick_macro_columns(rows, year, quarter)
    if budget_x <= 0 or actual_x <= 0 or abs(budget_x - actual_x) < 10:
        return []

    extracted: list[dict[str, Any]] = []
    omitted_raw: list[tuple[str, float]] = []
    seen_labels: set[str] = set()
    raw_magnitude_samples: list[float] = []
    pending_prefix = ""

    for _, tokens in rows:
        row_str = " ".join(t["text"] for t in tokens)
        upper_row = row_str.upper()
        if "FINANCING ITEM" in upper_row or upper_row.startswith("C FINANCING"):
            break

        num_tokens = [
            t
            for t in tokens
            if t["x0"] >= first_num_x0 - 10
            and t["x0"] < variance_x0 - 8
            and _parse_float_token(t["text"]) is not None
        ]
        # Derive label strictly left of numeric columns
        cutoff_x = first_num_x0 - 6
        label_tokens = [t["text"] for t in tokens if t["x0"] < cutoff_x]
        # Strip leading serial numbers e.g. "2" "A"
        while label_tokens and (re.fullmatch(r"\d{1,2}", label_tokens[0]) or label_tokens[0] in {"A", "B", "C", "D", "E", "F"}):
            label_tokens.pop(0)
        label_text = " ".join(label_tokens).strip()

        if not num_tokens:
            if label_text and any(k in label_text.lower() for k in ("exclusive of", "total ", "aggregate ")):
                pending_prefix = label_text
            else:
                pending_prefix = ""
            continue

        if pending_prefix:
            combined = f"{pending_prefix} {label_text}".strip()
            pending_prefix = ""
        else:
            combined = label_text
            pending_prefix = ""

        canon = _canonical_macro_label(combined)
        if not canon or canon in seen_labels:
            continue

        # Closest numeric token to budget_x and actual_x within 36pt
        b_tok = min(num_tokens, key=lambda n: abs(n["xm"] - budget_x))
        a_tok = min(num_tokens, key=lambda n: abs(n["xm"] - actual_x))
        if abs(b_tok["xm"] - budget_x) > 36.0 and abs(a_tok["xm"] - actual_x) > 36.0:
            continue

        b_val = _parse_float_token(b_tok["text"]) if abs(b_tok["xm"] - budget_x) <= 36.0 else None
        a_val = _parse_float_token(a_tok["text"]) if abs(a_tok["xm"] - actual_x) <= 36.0 else None
        if b_val is None and a_val is None:
            continue

        # Prevent fabricated 0.0% outturns when source PDF splits/omits the actual column cell
        if b_val is not None and a_val is None:
            omitted_raw.append((canon, max(0.0, b_val)))
            continue

        b_num = max(0.0, b_val or 0.0)
        a_num = max(0.0, a_val or 0.0)
        if b_num == 0.0 and a_num == 0.0:
            continue

        pct = round((a_num / b_num) * 100, 2) if b_num > 0 else 0.0
        if pct < 0.0 or pct > 500.0:
            continue

        raw_magnitude_samples.extend(v for v in (b_num, a_num) if v > 0)
        seen_labels.add(canon)
        extracted.append(
            {
                "label": canon,
                "_rawBudget": b_num,
                "_rawActual": a_num,
                "performancePct": pct,
            }
        )

    if len(extracted) >= 3:
        explicit_billions = any(
            any(k in " ".join(t["text"] for t in r_toks).lower() for k in ("billion", "n'bn", "n'bns", "n’bn"))
            for _, r_toks in rows[:8]
        )
        # Magnitude guard: 2009 etc. print almost all rows in N' Millions (> 100,000 median)
        if raw_magnitude_samples:
            med_val = statistics.median(raw_magnitude_samples)
            if (not explicit_billions and med_val > 100_000) or med_val > 250_000:
                unit_mult = 1_000_000
        if omission_warnings is not None and omitted_raw:
            for c_lbl, raw_b in omitted_raw:
                b_naira = int(round(raw_b * unit_mult))
                omission_warnings.append(
                    f"FY {year} {c_lbl}: Budget ₦{b_naira / 1e9:.2f}B had no aligned actual cell in source BIR PDF "
                    "(merged/omitted column); omitted to prevent false 0.0% outturn."
                )
        return [
            {
                "label": r["label"],
                "budgetNaira": int(round(r["_rawBudget"] * unit_mult)),
                "actualNaira": int(round(r["_rawActual"] * unit_mult)),
                "performancePct": r["performancePct"],
            }
            for r in extracted
        ]
    return []


def _extract_macro_table_from_pdf(
    doc: fitz.Document,
    year: int,
    quarter: str,
    *,
    pdf_path: Path | None = None,
    ocr_pages: dict[int, dict[str, Any]] | None = None,
    enable_ocr: bool = True,
    omission_warnings: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[int]]:
    """Extract macro fiscal rows natively, falling back to RapidOCR on embedded image tables."""
    candidate_pages: list[int] = []
    image_only_pages: list[int] = []

    for idx in range(min(len(doc), 10), len(doc)):
        txt = doc[idx].get_text("text")
        low = txt.lower()
        if "list of tables" in low or "table of contents" in low:
            continue
        is_macro_heading = any(
            k in low
            for k in (
                "expenditure and fiscal account",
                "fgn budget expenditure",
                "summary of budget expenditure",
                "table 3.9",
                "table 3.7",
            )
        )
        if not is_macro_heading:
            continue
        has_fiscal_lines = any(k in low for k in ("personnel", "overhead", "debt", "capital", "revenue", "inflow"))
        words_count = len(doc[idx].get_text("words"))
        imgs_count = len(doc[idx].get_images())
        if has_fiscal_lines and len(txt.strip()) >= 1000 and words_count >= 120:
            candidate_pages.append(idx)
        elif imgs_count >= 1 and words_count < 120:
            image_only_pages.append(idx + 1)

    for pno in candidate_pages:
        rows = _extract_word_rows(doc[pno])
        page_omissions: list[str] = []
        macro_rows = _parse_macro_page_rows(rows, year, quarter, omission_warnings=page_omissions)
        if macro_rows:
            if omission_warnings is not None:
                omission_warnings.extend(page_omissions)
            return macro_rows, image_only_pages

    # OCR fallback for image-embedded macro tables and full-scanned BIR PDFs
    if enable_ocr and (ocr_pages is not None or (pdf_path is not None and is_ocr_available())):
        ocr_map = ocr_pages
        if ocr_map is None and pdf_path is not None:
            ocr_candidates = sorted(
                {p - 1 for p in image_only_pages} | set(_find_big_image_table_pages(doc))
            )
            if ocr_candidates:
                ocr_map = ocr_pdf_pages(pdf_path, page_indices=ocr_candidates, dpi=220, verbose=True)

        if ocr_map:
            start_idx = min(len(doc), 10)
            for pno_1based in sorted(ocr_map.keys()):
                if pno_1based - 1 < start_idx:
                    continue
                payload = ocr_map[pno_1based]
                combined_low = f"{doc[pno_1based - 1].get_text('text')}\n{payload.get('text', '')}".lower()
                if "list of tables" in combined_low or "table of contents" in combined_low:
                    continue
                is_macro_heading = any(
                    k in combined_low
                    for k in (
                        "expenditure and fiscal account",
                        "fgn budget expenditure",
                        "summary of budget expenditure",
                        "fiscal account",
                        "table 3.9",
                        "table 3.8",
                        "table 3.7",
                    )
                )
                has_fiscal_lines = any(
                    k in combined_low
                    for k in ("personnel", "overhead", "debt", "capital", "revenue", "inflow", "recurrent")
                )
                if not (is_macro_heading and has_fiscal_lines):
                    continue
                rows = _build_word_rows_from_raw(payload.get("words", []), y_tol=5.5, is_ocr=True)
                page_omissions = []
                macro_rows = [
                    r for r in _parse_macro_page_rows(rows, year, quarter, omission_warnings=page_omissions)
                    if 0.0 <= r["performancePct"] <= 250.0
                ]
                if len(macro_rows) >= 3 and any(
                    100_000_000_000 <= max(r["budgetNaira"], r["actualNaira"]) <= 200_000_000_000_000
                    for r in macro_rows
                ):
                    if omission_warnings is not None:
                        omission_warnings.extend(page_omissions)
                    remaining_img_pages = [p for p in image_only_pages if p != pno_1based]
                    return macro_rows, remaining_img_pages

    return [], image_only_pages


# ------------------------------------------------------------------
# MDA Capital Budget Utilization Extractor (Table 3.10 / Table 3.8 / Table 8)
# ------------------------------------------------------------------


def _parse_mda_page_rows(rows: list[tuple[float, list[dict[str, Any]]]], pno: int) -> list[dict[str, Any]]:
    """Parse MDA capital appropriation, release, cash-backed, and utilization rows."""
    table_caption_idx = None
    for idx, (_, tokens) in enumerate(rows):
        low = " ".join(t["text"] for t in tokens).lower()
        if (
            re.match(r"^(?:table|appendix)\s+[\d\.]+:", low)
            and any(k in low for k in ("utilization", "utilisation", "sample of mda", "capital budget"))
            and "below is" not in low
        ):
            table_caption_idx = idx
            break

    header_start_idx = None
    if table_caption_idx is not None:
        header_start_idx = table_caption_idx + 1
    else:
        for idx, (_, tokens) in enumerate(rows):
            if tokens and tokens[0]["x0"] < 140.0 and tokens[0]["text"].strip().upper() in {"MDA", "MINISTRY"}:
                header_start_idx = idx
                break
    if header_start_idx is None or header_start_idx >= len(rows):
        return []

    # Collect column header text strictly before the first numeric data row
    header_lines: list[str] = []
    body_start_idx = header_start_idx
    for idx in range(header_start_idx, min(len(rows), header_start_idx + 8)):
        _, tokens = rows[idx]
        big_cnt = sum(1 for t in tokens if (_parse_float_token(t["text"]) or 0.0) >= 500.0)
        row_txt = " ".join(t["text"] for t in tokens).lower()
        if big_cnt >= 2:
            body_start_idx = idx
            break
        header_lines.append(row_txt)
        body_start_idx = idx + 1

    header_text_all = " ".join(header_lines)
    header_before_pct = re.split(r"%\s*of|precentage|percentage", header_text_all)[0]
    is_warrant_layout = "warrant" in header_text_all
    has_appropriation_col = (
        ("annual" in header_text_all and "appropriation" in header_text_all)
        or ("appropriation" in header_before_pct and ("released" in header_text_all or "cash" in header_text_all))
    ) and not is_warrant_layout

    parsed_rows: list[dict[str, Any]] = []
    max_raw_val = 0.0
    pending_mda: list[str] = []

    _header_skip_terms = (
        "annual appropriation",
        "total amount",
        "cash backed",
        "cash-backed",
        "as % of",
        "percentage of",
        "precentage of",
        "utiization",
        "utilization",
        "utilisation",
        "releases",
        "appropriation",
        "backed",
        "as at ",
        "n'bn",
        "=n=",
        "mda",
    )
    _bad_label_terms = (
        "utilization",
        "utiization",
        "utilisation",
        "releases",
        "appropriation",
        "period.",
        "%",
        "precentage",
        "percentage",
    )

    for idx in range(body_start_idx, len(rows)):
        _, tokens = rows[idx]
        full_line = " ".join(t["text"] for t in tokens).strip()
        low_line = full_line.lower()
        if any(stop in low_line for stop in ("source:", "figure ", "chart ", "total average", "overall average", "please note")):
            if parsed_rows:
                break
            pending_mda.clear()
            continue
        if any(hdr in low_line for hdr in _header_skip_terms):
            pending_mda.clear()
            continue

        # Split tokens into MDA text tokens and numeric column values
        parsed_nums: list[tuple[float, float]] = []
        text_parts: list[str] = []
        first_num_seen = False
        for tok in tokens:
            val = _parse_float_token(tok["text"])
            if val is not None:
                first_num_seen = True
                parsed_nums.append((tok["xm"], abs(val)))
            elif tok["text"] in {"-", "—"} and first_num_seen:
                parsed_nums.append((tok["xm"], 0.0))
            elif not first_num_seen:
                text_parts.append(tok["text"])

        label = " ".join(text_parts).strip()
        if label and not parsed_nums:
            low_lbl = label.lower()
            if (
                len(label) <= 45
                and "%" not in label
                and not low_lbl.startswith(("table", "appendix"))
                and not any(bad in low_lbl for bad in _bad_label_terms)
                and not (label.endswith(".") and len(label.split()) >= 4)
            ):
                pending_mda.append(label)
            else:
                pending_mda.clear()
            continue

        if not parsed_nums:
            continue

        money_vals = [v for _, v in parsed_nums if v >= 500.0 or v == 0.0]
        pct_vals = [v for _, v in parsed_nums if 0.0 < v < 500.0]

        big_money = [v for _, v in parsed_nums if v >= 500.0]
        if len(big_money) < 2:
            continue

        if pending_mda:
            label = " ".join([*pending_mda, label]).strip()
            pending_mda.clear()
        elif not label:
            continue

        label_clean = re.sub(r"\s+", " ", label).strip(" :-")
        low_clean = label_clean.lower()
        if (
            not label_clean
            or "TOTAL" in label_clean.upper()
            or "AVERAGE" in label_clean.upper()
            or any(bad in low_clean for bad in _bad_label_terms)
        ):
            continue

        max_raw_val = max(max_raw_val, max(big_money))

        if is_warrant_layout and len(big_money) >= 4:
            appropriated = 0.0
            released, cash_backed, utilized = big_money[-3], big_money[-2], big_money[-1]
        elif not has_appropriation_col:
            appropriated = 0.0
            released = big_money[0]
            cash_backed = big_money[1] if len(big_money) >= 2 else released
            utilized = big_money[-1]
        else:
            appropriated = money_vals[0] if money_vals else big_money[0]
            slots = money_vals[:4]
            if len(slots) < 4:
                slots = (slots + [0.0] * 4)[:4]
            appropriated, released, cash_backed, utilized = slots[0], slots[1], slots[2], slots[3]
            if appropriated == 0.0 and len(big_money) >= 3:
                appropriated, released, cash_backed = big_money[0], big_money[1], big_money[2]
                utilized = big_money[3] if len(big_money) >= 4 else 0.0

        parsed_rows.append(
            {
                "mdaName": clean_display_name(label_clean) or label_clean,
                "_app": appropriated,
                "_rel": released,
                "_cb": cash_backed,
                "_util": utilized,
                "_pcts": pct_vals,
                "page": pno + 1,
            }
        )

    if len(parsed_rows) >= 3:
        scale = 1_000_000 if max_raw_val < 1_000_000 else 1
        items: list[dict[str, Any]] = []
        for sn, r in enumerate(parsed_rows, 1):
            app_n = int(round(r["_app"] * scale))
            rel_n = int(round(r["_rel"] * scale))
            cb_n = int(round(r["_cb"] * scale))
            util_n = int(round(r["_util"] * scale))
            rel_pct = round((rel_n / app_n) * 100, 2) if app_n > 0 else 0.0
            util_pct = round((util_n / cb_n) * 100, 2) if cb_n > 0 else (round((util_n / rel_n) * 100, 2) if rel_n > 0 else 0.0)
            overspend = rel_n > app_n and app_n > 0
            items.append(
                {
                    "sn": sn,
                    "mdaName": r["mdaName"],
                    "appropriatedNaira": app_n,
                    "releasedNaira": rel_n,
                    "cashBackedNaira": cb_n,
                    "utilizedNaira": util_n,
                    "releasePct": rel_pct,
                    "utilizationPct": util_pct,
                    "overspendVirement": overspend,
                    "page": r["page"],
                }
            )
        return sorted(items, key=lambda x: -max(x["appropriatedNaira"], x["releasedNaira"]))

    return []


def _extract_mda_utilization_from_pdf(
    doc: fitz.Document,
    year: int,
    *,
    pdf_path: Path | None = None,
    ocr_pages: dict[int, dict[str, Any]] | None = None,
    enable_ocr: bool = True,
) -> list[dict[str, Any]]:
    """Extract MDA capital appropriation, release, cash-backed, and utilization rows."""
    candidate_pages: list[int] = []
    for idx in range(min(len(doc), 10), len(doc)):
        txt = doc[idx].get_text("text")
        low = txt.lower()
        if "list of tables" in low or "table of contents" in low:
            continue
        if (
            ("capital budget utilization" in low or "sample of mdas" in low or "table 3.10" in low or "table 3.8" in low)
            and ("utilization" in low or "utilisation" in low)
            and ("released" in low or "cash" in low or "appropriation" in low)
            and len(txt.strip()) >= 400
        ):
            candidate_pages.append(idx)

    for pno in candidate_pages:
        rows = _extract_word_rows(doc[pno], y_tol=4.0)
        items = _parse_mda_page_rows(rows, pno)
        if items:
            return items

    if enable_ocr and (ocr_pages is not None or (pdf_path is not None and is_ocr_available())):
        ocr_map = ocr_pages
        if ocr_map is None and pdf_path is not None:
            ocr_candidates = _find_big_image_table_pages(doc)
            if ocr_candidates:
                ocr_map = ocr_pdf_pages(pdf_path, page_indices=ocr_candidates, dpi=220, verbose=True)

        if ocr_map:
            start_idx = min(len(doc), 10)
            for pno_1based in sorted(ocr_map.keys()):
                if pno_1based - 1 < start_idx:
                    continue
                payload = ocr_map[pno_1based]
                combined_low = f"{doc[pno_1based - 1].get_text('text')}\n{payload.get('text', '')}".lower()
                if "list of tables" in combined_low or "table of contents" in combined_low:
                    continue
                if not (
                    ("capital budget" in combined_low or "sample of mda" in combined_low or "table 3.10" in combined_low or "table 3.8" in combined_low)
                    and ("utilization" in combined_low or "utilisation" in combined_low or "utiization" in combined_low)
                    and ("released" in combined_low or "cash" in combined_low or "appropriation" in combined_low)
                ):
                    continue
                rows = _build_word_rows_from_raw(payload.get("words", []), y_tol=5.5, is_ocr=True)
                items = _parse_mda_page_rows(rows, pno_1based - 1)
                if items and 1_000_000_000 <= max(max(x["appropriatedNaira"], x["releasedNaira"]) for x in items) <= 50_000_000_000_000:
                    return items

    return []


def parse_bir_pdf(
    pdf_path: Path,
    year: int,
    quarter: str,
    *,
    ocr_pages: dict[int, dict[str, Any]] | None = None,
    enable_ocr: bool = True,
) -> dict[str, Any] | None:
    """Parse a Budget Office Quarterly BIR PDF into macro fiscal + MDA utilization records."""
    doc = fitz.open(str(pdf_path))
    omission_warnings: list[str] = []
    try:
        macro_rows, image_macro_pages = _extract_macro_table_from_pdf(
            doc,
            year,
            quarter,
            pdf_path=pdf_path,
            ocr_pages=ocr_pages,
            enable_ocr=enable_ocr,
            omission_warnings=omission_warnings,
        )
        mda_items = _extract_mda_utilization_from_pdf(
            doc, year, pdf_path=pdf_path, ocr_pages=ocr_pages, enable_ocr=enable_ocr
        )
    finally:
        doc.close()

    macro_rows, debt_warnings = apply_macro_integrity_guards(macro_rows, year, quarter)
    macro_warnings = omission_warnings + debt_warnings

    if not macro_rows and not mda_items:
        return None

    # Guard unreported capital utilization in quarterly BIR schedules (avoid false 0.0%)
    for item in mda_items:
        rel_n = int(item.get("releasedNaira") or 0)
        util_n = item.get("utilizedNaira")
        u_pct = item.get("utilizationPct")
        if util_n == 0 and rel_n > 0 and (u_pct is None or u_pct == 0.0):
            item["utilizedNaira"] = None
            item["utilizationPct"] = None

    # Choose headline totals from Total Expenditure row -> Revenue row -> MDA sums
    headline_row = next(
        (r for r in macro_rows if "Aggregate Federal Government Expenditure" in r["label"]),
        None,
    ) or next(
        (r for r in macro_rows if "Total FGN Expenditure" in r["label"]),
        None,
    ) or next(
        (r for r in macro_rows if "Revenue" in r["label"]),
        None,
    )

    if headline_row is not None:
        total_app = headline_row["budgetNaira"]
        total_rel = headline_row["actualNaira"]
        overall_rel_pct = headline_row["performancePct"]
    elif macro_rows:
        total_app = macro_rows[0]["budgetNaira"]
        total_rel = macro_rows[0]["actualNaira"]
        overall_rel_pct = macro_rows[0]["performancePct"]
    else:
        sum_app = sum(x["appropriatedNaira"] for x in mda_items)
        sum_rel = sum(x["releasedNaira"] for x in mda_items)
        if sum_app > 0:
            total_app = sum_app
            total_rel = sum_rel
            overall_rel_pct = round((sum_rel / sum_app) * 100, 2)
        else:
            # e.g., 2010 / 2011 sample MDAs report Released & Utilized without Appropriation
            total_app = sum_rel
            total_rel = sum(x["utilizedNaira"] or 0 for x in mda_items)
            overall_rel_pct = round((total_rel / total_app) * 100, 2) if total_app > 0 else 0.0

    util_vals = [x["utilizedNaira"] for x in mda_items if x.get("utilizedNaira") is not None]
    total_util = sum(util_vals) if util_vals else None
    cb_sum = sum(x.get("cashBackedNaira") or x.get("releasedNaira") or 0 for x in mda_items)
    if total_util is not None and total_util <= 0 and cb_sum > 0:
        total_util = None
    overall_util_pct = round((total_util / cb_sum) * 100, 2) if total_util is not None and cb_sum > 0 else None

    if macro_rows and mda_items:
        granularity = "COMBINED_MACRO_AND_MDA"
    elif mda_items:
        granularity = "MDA_CAPITAL_RELEASES"
    else:
        granularity = "MACRO_FISCAL_PERFORMANCE"

    period_label = PERIOD_LABELS.get(quarter, f"{quarter} YTD")
    is_partial_year = quarter != "Q4"
    out_obj: dict[str, Any] = {
        "financialYear": year,
        "status": "VERIFIED_BIR_SOURCE",
        "quarterCovered": quarter,
        "isPartialYear": is_partial_year,
        "reportPeriodLabel": period_label,
        "reportTitle": f"FY {year} Budget Implementation Report ({period_label})",
        "sourceFile": pdf_path.name,
        "sha256": sha256_file(pdf_path),
        "granularity": granularity,
        "mdaCount": len(mda_items),
        "totalAppropriatedNaira": total_app,
        "totalReleasedNaira": total_rel,
        "totalUtilizedNaira": total_util,
        "overallReleasePct": overall_rel_pct,
        "overallUtilizationPct": overall_util_pct,
        "imageMacroTablePages": image_macro_pages,
        "mdaBreakdown": mda_items,
        "macroRows": macro_rows,
    }
    if is_partial_year:
        out_obj["coverageNote"] = (
            f"Partial-year ({period_label}) Budget Implementation Report; full-year Q4 outturn not published in the available BIR drop."
        )
    if macro_warnings:
        out_obj["macroIntegrityWarnings"] = macro_warnings
    return out_obj


# ------------------------------------------------------------------
# Legacy Seed PDF & Drop-in CSV Parsers (Preserved)
# ------------------------------------------------------------------


def parse_2016_capital_releases_pdf(pdf_path: Path) -> dict[str, Any]:
    """Parses `Total Capital and Capital Releases.pdf` MDA Warrant + AIE release rows."""
    doc = fitz.open(str(pdf_path))
    items: list[dict[str, Any]] = []
    seen_sn: set[int] = set()

    for page_idx, page in enumerate(doc):
        lines = [l.strip() for l in page.get_text("text").splitlines() if l.strip()]
        i = 0
        while i < len(lines):
            line = lines[i]
            if re.fullmatch(r"\d{1,3}", line):
                sn = int(line)
                if 1 <= sn <= 999 and sn not in seen_sn and i + 1 < len(lines):
                    mda_parts: list[str] = []
                    j = i + 1
                    while j < len(lines) and not NUM_LINE_RE.match(lines[j]):
                        if re.fullmatch(r"\d{1,3}", lines[j]) and int(lines[j]) == sn + 1:
                            break
                        if lines[j].upper() in {"S/N", "MDA", "2016 APPROPRIATION", "TOTAL RELEASE", "(WARRANT + AIE)"}:
                            j += 1
                            continue
                        mda_parts.append(lines[j])
                        j += 1

                    nums: list[int] = []
                    while j < len(lines) and NUM_LINE_RE.match(lines[j]) and len(nums) < 2:
                        val = _parse_int_amount(lines[j])
                        nums.append(val)
                        j += 1

                    mda_name = re.sub(r"\s+", " ", " ".join(mda_parts)).strip()
                    if mda_name and nums and "TOTAL" not in mda_name.upper():
                        appropriated = nums[0]
                        released = nums[1] if len(nums) >= 2 else 0
                        overspend = released > appropriated and appropriated > 0
                        rel_pct = round((released / appropriated) * 100, 2) if appropriated > 0 else 0.0
                        seen_sn.add(sn)
                        items.append(
                            {
                                "sn": sn,
                                "mdaName": clean_display_name(mda_name) or mda_name,
                                "appropriatedNaira": appropriated,
                                "releasedNaira": released,
                                "cashBackedNaira": released,
                                "utilizedNaira": None,
                                "releasePct": rel_pct,
                                "utilizationPct": None,
                                "overspendVirement": overspend,
                                "page": page_idx + 1,
                            }
                        )
                        i = j
                        continue
            i += 1

    doc.close()
    total_app = sum(x["appropriatedNaira"] for x in items)
    total_rel = sum(x["releasedNaira"] for x in items)
    return {
        "financialYear": 2016,
        "status": "VERIFIED_BIR_SOURCE",
        "quarterCovered": "Q4",
        "reportPeriodLabel": "Q4 Full-Year (OAGF Schedule)",
        "reportTitle": "2016 Total Capital Appropriation vs. Warrant + AIE Releases (OAGF Reconciliation)",
        "sourceFile": pdf_path.name,
        "sha256": sha256_file(pdf_path),
        "granularity": "MDA_CAPITAL_RELEASES",
        "mdaCount": len(items),
        "totalAppropriatedNaira": total_app,
        "totalReleasedNaira": total_rel,
        "totalUtilizedNaira": None,
        "overallReleasePct": round((total_rel / total_app) * 100, 2) if total_app > 0 else 0.0,
        "overallUtilizationPct": None,
        "mdaBreakdown": sorted(items, key=lambda x: -x["appropriatedNaira"]),
        "macroRows": [],
    }


def parse_2023_budget_performance_pdf(pdf_path: Path) -> dict[str, Any]:
    """Parses `2023 Budget Performance.pdf` macro fiscal revenue/expenditure performance table."""
    doc = fitz.open(str(pdf_path))
    full_lines: list[str] = []
    for page in doc:
        full_lines.extend(l.strip() for l in page.get_text("text").splitlines() if l.strip())
    doc.close()

    macro_rows: list[dict[str, Any]] = []
    seen_labels: set[str] = set()
    i = 0
    while i < len(full_lines):
        line = full_lines[i]
        upper = line.upper()
        if any(
            kw in upper
            for kw in (
                "AGGREGATE FEDERAL GOVERNMENT",
                "FEDERAL RETAINED REVENUES",
                "TOTAL EXPENDITURE",
                "CAPITAL EXPENDITURE",
                "RECURRENT",
                "DEBT SERVICE",
                "PERSONNEL",
            )
        ) and not any(skip in upper for skip in ("BILLIONS OF", "PRO RATA")):
            label_parts = [line]
            j = i + 1
            while j < len(full_lines) and not re.search(r"\d", full_lines[j]) and len(label_parts) < 3:
                if full_lines[j] in {"(", ")"}:
                    break
                label_parts.append(full_lines[j])
                j += 1
            label = re.sub(r"\s+", " ", " ".join(label_parts)).strip()
            nums: list[float] = []
            k = j
            while k < min(len(full_lines), j + 12) and len(nums) < 3:
                tok = full_lines[k].replace("(", "").replace(")", "").replace(",", "").strip()
                if re.fullmatch(r"\d+(?:\.\d+)?", tok):
                    nums.append(float(tok))
                k += 1
            if label and len(nums) >= 2 and label not in seen_labels:
                seen_labels.add(label)
                budget_naira = int(round(nums[0] * 1_000_000_000))
                actual_val = nums[2] if len(nums) >= 3 else nums[1]
                actual_naira = int(round(actual_val * 1_000_000_000))
                macro_rows.append(
                    {
                        "label": label,
                        "budgetNaira": budget_naira,
                        "actualNaira": actual_naira,
                        "performancePct": round((actual_naira / budget_naira) * 100, 2) if budget_naira > 0 else 0.0,
                    }
                )
        i += 1

    macro_rows, macro_warnings = apply_macro_integrity_guards(macro_rows, 2023, "Q4")

    return {
        "financialYear": 2023,
        "status": "VERIFIED_BIR_SOURCE",
        "quarterCovered": "Q4",
        "isPartialYear": False,
        "reportPeriodLabel": "Q4 Full-Year",
        "reportTitle": "2023 Federal Government Fiscal Performance Summary (Jan–Dec)",
        "sourceFile": pdf_path.name,
        "sha256": sha256_file(pdf_path),
        "granularity": "MACRO_FISCAL_PERFORMANCE",
        "mdaCount": 0,
        "totalAppropriatedNaira": macro_rows[0]["budgetNaira"] if macro_rows else 0,
        "totalReleasedNaira": macro_rows[0]["actualNaira"] if macro_rows else 0,
        "totalUtilizedNaira": None,
        "overallReleasePct": macro_rows[0]["performancePct"] if macro_rows else 0.0,
        "overallUtilizationPct": None,
        "mdaBreakdown": [],
        "macroRows": macro_rows,
        **({"macroIntegrityWarnings": macro_warnings} if macro_warnings else {}),
    }


def parse_oagf_csv(csv_path: Path, year: int) -> dict[str, Any]:
    """Parses standardized drop-in OAGF / BIR CSV (`mdaName,appropriatedNaira,releasedNaira,utilizedNaira`)."""
    items: list[dict[str, Any]] = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for idx, row in enumerate(reader, 1):
            mda = str(row.get("mdaName") or row.get("mda") or "").strip()
            if not mda:
                continue
            app = _parse_int_amount(row.get("appropriatedNaira") or row.get("appropriated") or "0")
            rel = _parse_int_amount(row.get("releasedNaira") or row.get("released") or "0")
            util_raw = row.get("utilizedNaira") or row.get("utilized")
            util = _parse_int_amount(util_raw) if util_raw not in (None, "") else None
            items.append(
                {
                    "sn": idx,
                    "mdaName": clean_display_name(mda) or mda,
                    "appropriatedNaira": app,
                    "releasedNaira": rel,
                    "cashBackedNaira": rel,
                    "utilizedNaira": util,
                    "releasePct": round((rel / app) * 100, 2) if app > 0 else 0.0,
                    "utilizationPct": round((util / rel) * 100, 2) if util is not None and rel > 0 else None,
                    "overspendVirement": rel > app and app > 0,
                    "page": 1,
                }
            )

    total_app = sum(x["appropriatedNaira"] for x in items)
    total_rel = sum(x["releasedNaira"] for x in items)
    util_vals = [x["utilizedNaira"] for x in items if x["utilizedNaira"] is not None]
    total_util = sum(util_vals) if util_vals else None
    return {
        "financialYear": year,
        "status": "VERIFIED_BIR_SOURCE",
        "quarterCovered": "Q4",
        "reportPeriodLabel": "Q4 Full-Year (OAGF CSV)",
        "reportTitle": f"FY {year} OAGF / BIR Execution Release Schedule ({csv_path.name})",
        "sourceFile": csv_path.name,
        "sha256": sha256_file(csv_path),
        "granularity": "MDA_CAPITAL_RELEASES",
        "mdaCount": len(items),
        "totalAppropriatedNaira": total_app,
        "totalReleasedNaira": total_rel,
        "totalUtilizedNaira": total_util,
        "overallReleasePct": round((total_rel / total_app) * 100, 2) if total_app > 0 else 0.0,
        "overallUtilizationPct": round((total_util / total_rel) * 100, 2) if total_util is not None and total_rel > 0 else None,
        "mdaBreakdown": sorted(items, key=lambda x: -x["appropriatedNaira"]),
        "macroRows": [],
    }


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


def _chunk_ocr_text(text: str, *, chunk_size: int = 1200, overlap: int = 150) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text or "").strip()
    if len(cleaned) < 60:
        return []
    if len(cleaned) <= chunk_size:
        return [cleaned]
    chunks: list[str] = []
    start = 0
    step = max(200, chunk_size - overlap)
    while start < len(cleaned):
        piece = cleaned[start : start + chunk_size].strip()
        if len(piece) >= 60:
            chunks.append(piece)
        if start + chunk_size >= len(cleaned):
            break
        start += step
    return chunks


def _write_bir_ocr_sqlite(db_path: Path, chunk_rows: list[tuple[Any, ...]]) -> None:
    """Write OCR-recovered BIR text chunks into `bir_ocr_chunks`/`bir_ocr_fts` without altering other tables."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("DROP TABLE IF EXISTS bir_ocr_fts;")
        conn.execute("DROP TABLE IF EXISTS bir_ocr_chunks;")
        conn.execute(
            """
            CREATE TABLE bir_ocr_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_file TEXT NOT NULL,
                financial_year INTEGER NOT NULL,
                page_number INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                chunk_text TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE bir_ocr_fts USING fts5(
                doc_file,
                chunk_text,
                content='bir_ocr_chunks',
                content_rowid='id',
                tokenize='porter unicode61'
            )
            """
        )
        if chunk_rows:
            conn.executemany(
                """
                INSERT INTO bir_ocr_chunks (
                    doc_file, financial_year, page_number, chunk_index, sha256, chunk_text
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                chunk_rows,
            )
            conn.execute("INSERT INTO bir_ocr_fts(bir_ocr_fts) VALUES('rebuild');")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bir_ocr_year ON bir_ocr_chunks(financial_year);")
        conn.commit()
    finally:
        conn.close()


def build_execution_tracker(
    source_root: str | Path = DEFAULT_SOURCE_ROOT,
    bir_root: str | Path = DEFAULT_BIR_ROOT,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    write: bool = True,
    fts_sqlite_path: str | Path | None = DEFAULT_FTS_SQLITE,
    enable_ocr: bool = True,
) -> dict[str, Any]:
    """Build `execution_tracker.json` combining seed PDFs, BIR PDFs (`2009-2026`), and OAGF CSVs."""
    src = Path(source_root)
    bir = Path(bir_root)
    ds = Path(datasets_dir)

    reports_by_year: dict[int, dict[str, Any]] = {}
    scanned_skipped: list[dict[str, Any]] = []
    ocr_recovered: list[dict[str, Any]] = []
    image_table_notes: list[dict[str, Any]] = []
    bir_ocr_chunk_rows: list[tuple[Any, ...]] = []

    p2016 = src / "2016" / "Total Capital and Capital Releases.pdf"
    if p2016.exists():
        reports_by_year[2016] = parse_2016_capital_releases_pdf(p2016)

    p2023 = src / "2023" / "2023 Budget Performance.pdf"
    if p2023.exists():
        reports_by_year[2023] = parse_2023_budget_performance_pdf(p2023)

    if bir.exists():
        ocr_ready = enable_ocr and is_ocr_available()
        for ydir in sorted(d for d in bir.iterdir() if d.is_dir() and d.name.isdigit()):
            yr = int(ydir.name)

            # CSV overrides take highest priority when user drops an explicit OAGF CSV
            csv_files = sorted(ydir.glob("*.csv"))
            if csv_files:
                reports_by_year[yr] = parse_oagf_csv(csv_files[0], yr)
                continue

            # Rank candidate BIR PDFs by quarter priority; OCR all scanned BIR PDFs when enabled
            ranked: list[tuple[int, str, Path, dict[int, dict[str, Any]] | None]] = []
            for pdf_file in sorted(ydir.glob("*.pdf")):
                quarter, prio, excluded = classify_bir_filename(pdf_file.name)
                if is_scanned_pdf(pdf_file):
                    if ocr_ready:
                        ocr_pages = ocr_pdf_pages(
                            pdf_file,
                            dpi=180,
                            appendix_after_page=80,
                            appendix_dpi=140,
                            verbose=True,
                        )
                        file_sha = sha256_file(pdf_file)
                        chars_extracted = sum(
                            len(str(v.get("text") or "").strip()) for v in ocr_pages.values()
                        )
                        for pno, pdata in sorted(ocr_pages.items()):
                            for c_idx, chunk in enumerate(_chunk_ocr_text(str(pdata.get("text") or ""))):
                                bir_ocr_chunk_rows.append(
                                    (pdf_file.name, yr, pno, c_idx, file_sha, chunk)
                                )
                        ocr_recovered.append(
                            {
                                "financialYear": yr,
                                "file": pdf_file.name,
                                "pageCount": len(ocr_pages),
                                "charsExtracted": chars_extracted,
                                "sha256": file_sha,
                                "status": "OCR_RECOVERED_SPECIALTY" if excluded else "OCR_RECOVERED",
                            }
                        )
                        if not excluded:
                            ranked.append((prio, quarter, pdf_file, ocr_pages))
                    else:
                        scanned_skipped.append(
                            {
                                "financialYear": yr,
                                "file": pdf_file.name,
                                "status": "OCR_PENDING_SPECIALTY" if excluded else "OCR_PENDING",
                            }
                        )
                    continue

                if not excluded:
                    ranked.append((prio, quarter, pdf_file, None))

            ranked.sort(key=lambda item: (-item[0], item[2].name))

            for _, quarter, pdf_file, pre_ocr in ranked:
                parsed = parse_bir_pdf(
                    pdf_file, yr, quarter, ocr_pages=pre_ocr, enable_ocr=enable_ocr
                )
                if parsed is None:
                    image_table_notes.append(
                        {
                            "financialYear": yr,
                            "file": pdf_file.name,
                            "note": "No macro or MDA capital utilization table matched sanity rules.",
                        }
                    )
                    continue

                if parsed.get("imageMacroTablePages"):
                    image_table_notes.append(
                        {
                            "financialYear": yr,
                            "file": pdf_file.name,
                            "pages": parsed["imageMacroTablePages"],
                            "note": "Macro expenditure table rendered as embedded image; MDA utilization or alternative quarter used without fabricating numbers.",
                        }
                    )

                existing = reports_by_year.get(yr)
                if yr == 2016 and existing is not None:
                    # Preserve 697-MDA OAGF Capital Releases totals; enrich cleanly with Q4 BIR macro rows
                    existing["macroRows"] = parsed["macroRows"]
                    if existing["macroRows"] and existing["mdaBreakdown"]:
                        existing["granularity"] = "COMBINED_MACRO_AND_MDA"
                    existing["birMacroSourceFile"] = parsed["sourceFile"]
                    existing["birMacroSha256"] = parsed["sha256"]
                elif yr == 2023 and existing is not None:
                    # Preserve macro fiscal performance baseline; attach Q4 BIR MDA breakdown
                    if parsed["mdaBreakdown"]:
                        existing["mdaBreakdown"] = parsed["mdaBreakdown"]
                        existing["mdaCount"] = parsed["mdaCount"]
                        existing["totalUtilizedNaira"] = parsed["totalUtilizedNaira"]
                        existing["overallUtilizationPct"] = parsed["overallUtilizationPct"]
                        if existing["macroRows"]:
                            existing["granularity"] = "COMBINED_MACRO_AND_MDA"
                        existing["birMdaSourceFile"] = parsed["sourceFile"]
                        existing["birMdaSha256"] = parsed["sha256"]
                else:
                    reports_by_year[yr] = parsed
                break

    years_list = [reports_by_year[y] for y in sorted(reports_by_year.keys())]
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "verifiedYears": sorted(reports_by_year.keys()),
        "dropFolder": "bir_pdfs/<year>/",
        "dropInstructions": (
            "Drop official Budget Office Quarterly Implementation Reports (PDF) or OAGF Open Treasury CSVs "
            "(columns: mdaName, appropriatedNaira, releasedNaira, utilizedNaira) into bir_pdfs/<year>/ and run "
            "`python -m ingestion.parsers.bir_parser`."
        ),
        "scannedSkipped": scanned_skipped,
        "ocrRecovered": ocr_recovered,
        "birOcrChunksIndexed": len(bir_ocr_chunk_rows),
        "imageTableNotes": image_table_notes,
        "years": years_list,
    }

    if write:
        if fts_sqlite_path is not None and bir_ocr_chunk_rows:
            _write_bir_ocr_sqlite(Path(fts_sqlite_path), bir_ocr_chunk_rows)
        _atomic_write_json(ds / "execution_tracker.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Build BudgetLens BIR / Capital Releases Execution Tracker")
    parser.add_argument("--source", type=str, default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--bir", type=str, default=str(DEFAULT_BIR_ROOT))
    parser.add_argument("--datasets", type=str, default=str(DEFAULT_DATASETS_DIR))
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--no-ocr", action="store_true", help="Disable local RapidOCR fallback on scanned/image-table BIR PDFs.")
    args = parser.parse_args()

    out = build_execution_tracker(
        args.source,
        args.bir,
        args.datasets,
        write=True,
        fts_sqlite_path=args.sqlite,
        enable_ocr=not args.no_ocr,
    )
    print(f"Execution Tracker built: {len(out['years'])} verified BIR/OAGF years ({out['verifiedYears']})")
    for y in out["years"]:
        print(
            f"  FY {y['financialYear']} [{y.get('quarterCovered', 'Q4')} | {y['granularity']}]: "
            f"MDAs={y['mdaCount']} | Macro={len(y['macroRows'])} | "
            f"App=NGN {y['totalAppropriatedNaira']/1e9:.2f}B | "
            f"Rel=NGN {y['totalReleasedNaira']/1e9:.2f}B ({y['overallReleasePct']}%)"
        )
    if out.get("ocrRecovered"):
        print(f"  OCR recovered PDFs: {len(out['ocrRecovered'])} | chunks={out.get('birOcrChunksIndexed', 0)}")
    if out.get("scannedSkipped"):
        print(f"  Scanned (OCR_PENDING): {len(out['scannedSkipped'])} files")
    if out.get("imageTableNotes"):
        print(f"  Image-table notes: {len(out['imageTableNotes'])} entries")


if __name__ == "__main__":
    main()
