"""Coverage Audit & Historical Extraction Diagnostic Indexer (1999-2026).

Computes per-year source PDF diagnostics (text density, scanned/image pages, web captures,
OCR availability) alongside extracted-vs-official macro totals and classifies every year
into `FULL_SCHEDULE`, `PARTIAL_SCHEDULE`, or `SUMMARY_ACT_ONLY`.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_ROOT = PROJECT_ROOT / "source_pdfs"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"

# Aligned 1:1 with src/data/historicalMacroData.ts (totalBn * 1e9)
OFFICIAL_MACRO_TOTALS: dict[int, int] = {
    1999: 299_000_000_000,
    2000: 677_500_000_000,
    2001: 894_200_000_000,
    2002: 1_064_800_000_000,
    2003: 976_300_000_000,
    2004: 1_300_000_000_000,
    2005: 1_799_900_000_000,
    2006: 1_900_000_000_000,
    2007: 2_300_000_000_000,
    2008: 2_748_000_000_000,
    2009: 3_101_800_000_000,
    2010: 4_427_200_000_000,
    2011: 4_484_700_000_000,
    2012: 4_697_200_000_000,
    2013: 4_987_200_000_000,
    2014: 4_695_200_000_000,
    2015: 4_493_400_000_000,
    2016: 6_060_700_000_000,
    2017: 7_441_200_000_000,
    2018: 9_120_300_000_000,
    2019: 8_917_000_000_000,
    2020: 10_805_500_000_000,
    2021: 13_588_000_000_000,
    2022: 17_126_900_000_000,
    2023: 24_820_000_000_000,
    2024: 28_770_000_000_000,
    2025: 46_019_600_000_000,
    2026: 54_200_000_000_000,
}


_MDA_ROLLUP_CODE_RE = re.compile(r"^[0-5]\d{8,9}$")


def detect_ocr_status() -> str:
    """Checks whether an offline OCR runtime is available in the Python environment."""
    from ingestion.parsers.ocr_engine import is_ocr_available

    has_tess = importlib.util.find_spec("pytesseract") is not None
    return "OCR_AVAILABLE" if (is_ocr_available() or has_tess) else "OCR_ENGINE_UNAVAILABLE"


def classify_coverage_tier(extracted_count: int, extracted_ratio_pct: float) -> str:
    """
    Classifies annual schedule completeness conservatively:
      - SUMMARY_ACT_ONLY: statutory summary acts (<= 250 items) without line-item schedules
      - FULL_SCHEDULE: >= 1,500 items and (>= 45% official budget coverage OR >= 15,000 line items)
      - PARTIAL_SCHEDULE: mixed / partial ministry subsets
    """
    if extracted_count <= 250:
        return "SUMMARY_ACT_ONLY"
    if extracted_count >= 1500 and (extracted_ratio_pct >= 45.0 or extracted_count >= 15000):
        return "FULL_SCHEDULE"
    return "PARTIAL_SCHEDULE"


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _scan_source_year_pdfs(year_dir: Path) -> dict[str, Any]:
    if not year_dir.exists():
        return {
            "pdf_count": 0,
            "total_pages": 0,
            "scanned_pages_count": 0,
            "web_capture_pdfs": [],
        }

    pdf_files = sorted(f for f in year_dir.iterdir() if f.is_file() and f.suffix.lower() == ".pdf")
    total_pages = 0
    scanned_pages = 0
    web_capture_pdfs: list[str] = []

    for pdf_path in pdf_files:
        try:
            doc = fitz.open(str(pdf_path))
            pages = len(doc)
            total_pages += pages
            if pages == 0:
                web_capture_pdfs.append(pdf_path.name)
                doc.close()
                continue

            sample_txt = "\n".join(doc[i].get_text("text") for i in range(min(2, pages)))
            if (
                "Media Center" in sample_txt
                and "Budget Documents" in sample_txt
                and "Executive Order" in sample_txt
                and not re.search(r"\d{1,3}(?:,\d{3})+|\d{1,3}(?:\s\d{3}){2,}", sample_txt)
            ):
                web_capture_pdfs.append(pdf_path.name)
            else:
                for p in doc:
                    if len(p.get_text("text").strip()) < 40:
                        scanned_pages += 1
            doc.close()
        except Exception:
            web_capture_pdfs.append(pdf_path.name)

    return {
        "pdf_count": len(pdf_files),
        "total_pages": total_pages,
        "scanned_pages_count": scanned_pages,
        "web_capture_pdfs": web_capture_pdfs,
    }


def _audit_year_extraction_breakdown(
    ds_dir: Path,
    yr: int,
    extracted_amount: int,
    official_macro: int,
    extracted_ratio_pct: float,
    stats: dict[str, Any],
) -> dict[str, Any]:
    """Inspect source files and MDA roll-up rows behind >100% extracted-to-macro ratios."""
    source_files = [str(s) for s in (stats.get("sourceFiles") or []) if str(s).strip()]
    rollup_count = 0
    rollup_amount = 0
    projects_path = ds_dir / str(yr) / "projects.min.json"
    if projects_path.is_file():
        try:
            records = json.loads(projects_path.read_text(encoding="utf-8"))
            if isinstance(records, list):
                for rec in records:
                    code = str(rec.get("projectCode") or "").strip()
                    if _MDA_ROLLUP_CODE_RE.match(code):
                        rollup_count += 1
                        rollup_amount += int(rec.get("amount") or 0)
        except Exception:
            pass

    non_rollup_amount = max(0, extracted_amount - rollup_amount)
    non_rollup_ratio_pct = round((non_rollup_amount / official_macro) * 100, 1) if official_macro > 0 else 0.0
    over_100 = extracted_ratio_pct > 100.0

    note: str | None = None
    if over_100:
        reasons: list[str] = []
        lower_files = [f.lower() for f in source_files]
        if any("supplementary" in f for f in lower_files):
            reasons.append("includes Supplementary Appropriation Act alongside main Act")
        if any("bill" in f for f in lower_files) and any("act" in f or "signed" in f or "approved" in f or "repeal" in f for f in lower_files):
            reasons.append("multi-document corpus combines Appropriation Bill/Amendment schedules alongside signed Act")
        elif len(source_files) > 1:
            reasons.append(f"merges {len(source_files)} source PDF schedules ({', '.join(source_files[:3])})")
        if yr == 2025:
            reasons.append("enacted FY 2025 signed total (₦54.99T) exceeded the ₦46.02T baseline in OFFICIAL_MACRO_TOTALS")
        if rollup_count > 0:
            reasons.append(
                f"includes {rollup_count:,} MDA administrative roll-up rows (₦{rollup_amount / 1e9:.2f}B); non-rollup line items equal {non_rollup_ratio_pct}%"
            )
        else:
            reasons.append(
                f"non-rollup extracted total is ₦{non_rollup_amount / 1e9:.2f}B ({non_rollup_ratio_pct}% of macro baseline)"
            )
        note = "; ".join(reasons) + "."

    return {
        "source_files_count": len(source_files),
        "source_files": source_files,
        "mda_rollup_rows_count": rollup_count,
        "mda_rollup_amount_naira": rollup_amount,
        "non_rollup_extracted_amount": non_rollup_amount,
        "non_rollup_ratio_pct": non_rollup_ratio_pct,
        "over_100_pct_flag": over_100,
        "extracted_breakdown_note": note,
    }


def run_coverage_audit(
    source_root: str | Path = DEFAULT_SOURCE_ROOT,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    write: bool = True,
) -> dict[str, Any]:
    """Runs the 1999-2026 coverage & PDF diagnostic audit across source PDFs and live datasets."""
    src_root = Path(source_root)
    ds_dir = Path(datasets_dir)
    ocr_status = detect_ocr_status()

    years_set = set(OFFICIAL_MACRO_TOTALS.keys())
    if ds_dir.exists():
        for entry in ds_dir.iterdir():
            if entry.is_dir() and entry.name.isdigit():
                years_set.add(int(entry.name))
    if src_root.exists():
        for entry in src_root.iterdir():
            if entry.is_dir() and entry.name.isdigit():
                years_set.add(int(entry.name))

    year_reports: dict[str, dict[str, Any]] = {}
    tier_counts = {"FULL_SCHEDULE": 0, "PARTIAL_SCHEDULE": 0, "SUMMARY_ACT_ONLY": 0}

    for yr in sorted(years_set):
        stats_path = ds_dir / str(yr) / "statistics.json"
        stats: dict[str, Any] = {}
        if stats_path.exists():
            try:
                stats = json.loads(stats_path.read_text(encoding="utf-8"))
            except Exception:
                stats = {}

        extracted_count = int(stats.get("totalCapitalProjects") or 0)
        extracted_amount = int(stats.get("totalCapitalAmount") or 0)
        official_macro = int(OFFICIAL_MACRO_TOTALS.get(yr) or stats.get("officialTotalBudget") or 0)
        extracted_ratio_pct = round((extracted_amount / official_macro) * 100, 1) if official_macro > 0 else 0.0
        coverage_tier = classify_coverage_tier(extracted_count, extracted_ratio_pct)
        tier_counts[coverage_tier] = tier_counts.get(coverage_tier, 0) + 1

        pdf_diag = _scan_source_year_pdfs(src_root / str(yr))
        diag_note = None
        if pdf_diag["scanned_pages_count"] > 0 and ocr_status != "OCR_AVAILABLE":
            diag_note = ocr_status

        breakdown = _audit_year_extraction_breakdown(
            ds_dir, yr, extracted_amount, official_macro, extracted_ratio_pct, stats
        )

        year_reports[str(yr)] = {
            "financial_year": yr,
            "pdf_count": pdf_diag["pdf_count"],
            "total_pages": pdf_diag["total_pages"],
            "scanned_pages_count": pdf_diag["scanned_pages_count"],
            "web_capture_pdfs": pdf_diag["web_capture_pdfs"],
            "ocr_status": ocr_status if pdf_diag["scanned_pages_count"] > 0 else "TEXT_NATIVE",
            "diagnostic_note": diag_note,
            "extracted_count": extracted_count,
            "extracted_amount": extracted_amount,
            "official_macro_total": official_macro,
            "extracted_ratio_pct": extracted_ratio_pct,
            "coverage_tier": coverage_tier,
            **breakdown,
        }

    over_100_years = [
        {
            "financial_year": int(y["financial_year"]),
            "extracted_ratio_pct": y["extracted_ratio_pct"],
            "non_rollup_ratio_pct": y["non_rollup_ratio_pct"],
            "source_files": y["source_files"],
            "extracted_breakdown_note": y["extracted_breakdown_note"],
        }
        for y in year_reports.values()
        if y.get("over_100_pct_flag")
    ]

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ocr_status": ocr_status,
        "years_audited": len(year_reports),
        "tier_summary": tier_counts,
        "over_100_pct_years": over_100_years,
        "years": year_reports,
    }

    if write:
        _atomic_write_json(ds_dir / "coverage_audit.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="BudgetLens Historical Coverage & PDF Diagnostic Audit")
    parser.add_argument("--write", action="store_true", help="Write public/datasets/coverage_audit.json atomically")
    parser.add_argument("--source", type=str, default=str(DEFAULT_SOURCE_ROOT))
    parser.add_argument("--datasets", type=str, default=str(DEFAULT_DATASETS_DIR))
    args = parser.parse_args()

    result = run_coverage_audit(source_root=args.source, datasets_dir=args.datasets, write=args.write)
    print(
        f"Coverage audit complete: {result['years_audited']} years | "
        f"tiers={result['tier_summary']} | ocr={result['ocr_status']}"
    )
    for yr in ("2006", "2011", "2015"):
        row = result["years"].get(yr)
        if row:
            print(
                f"  FY {yr}: {row['coverage_tier']} | "
                f"{row['extracted_count']:,} items | "
                f"NGN {row['extracted_amount'] / 1e9:.2f}B / {row['official_macro_total'] / 1e9:.2f}B "
                f"({row['extracted_ratio_pct']}%) | scanned_pages={row['scanned_pages_count']}"
            )


if __name__ == "__main__":
    main()
