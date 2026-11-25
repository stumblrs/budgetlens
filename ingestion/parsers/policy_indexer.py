"""Budget Office Policy, MTEF/FSP & Finance Act Indexer (Stage 4).

Enriches `policy_pdfs/manifest.json` metadata (inferring fiscalYearStart /
fiscalYearEnd and normalized docType to fix misfiled Finance Acts in mtef/ and
ogp/), extracts MTEF macro benchmark parameters into
`public/datasets/policy_benchmarks.json`, and chunks the 32 text-extractable
policy PDFs into `policy_chunks` + `policy_fts` inside
`backend/data/external_ledger_fts.sqlite`. Image-only PDFs are explicitly
flagged as `OCR_PENDING` per Decision #1.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF

from ingestion.parsers.ocr_engine import (
    get_active_ocr_engine_name,
    is_ocr_available,
    ocr_pdf_pages,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_POLICY_MANIFEST = PROJECT_ROOT / "policy_pdfs" / "manifest.json"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"

YEAR_RANGE_RE = re.compile(r"\b(20\d{2})\s*[-–—]\s*(20\d{2})\b")
SINGLE_YEAR_RE = re.compile(r"\b(20\d{2})\b")
NUM_TOKEN_RE = re.compile(r"\d[\d,]*(?:\.\d+)?")

CATEGORY_TO_DOCTYPE = {
    "mtef": "MTEF_FSP",
    "mtss": "MTSS",
    "ndp": "NDP",
    "ogp": "OGP",
}


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def _atomic_write_json(path: Path, payload: Any, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        if indent is not None:
            json.dump(payload, f, indent=indent, ensure_ascii=False)
        else:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def infer_doc_type_and_years(doc_entry: dict[str, Any]) -> dict[str, Any]:
    """Infer normalized docType and (fiscalYearStart, fiscalYearEnd) from title/slug/category."""
    title = str(doc_entry.get("title") or "").strip()
    slug = str(doc_entry.get("slug") or "").strip()
    category = str(doc_entry.get("category") or "").strip().lower()
    combined = f"{title} {slug}".lower()

    if "finance act" in combined or "finance-act" in combined:
        doc_type = "FINANCE_ACT"
    elif "consultation" in combined or "citizen" in combined or "understanding the draft" in combined:
        doc_type = "CONSULTATION_GUIDE"
    else:
        doc_type = CATEGORY_TO_DOCTYPE.get(category, "POLICY_DOC")

    yr_start: int | None = None
    yr_end: int | None = None
    m_range = YEAR_RANGE_RE.search(title) or YEAR_RANGE_RE.search(slug.replace("-", " "))
    if m_range:
        y1, y2 = int(m_range.group(1)), int(m_range.group(2))
        if 2000 <= y1 <= 2035 and y1 <= y2 <= 2035:
            yr_start, yr_end = y1, y2
    if yr_start is None:
        m_single = SINGLE_YEAR_RE.search(title) or SINGLE_YEAR_RE.search(slug)
        if m_single:
            y = int(m_single.group(1))
            if 2000 <= y <= 2035:
                yr_start, yr_end = y, y

    if yr_start is None:
        if "economic-sustainability-plan" in slug:
            yr_start, yr_end = 2020, 2021
        elif "final-nigeria-national-action-plan-on-open-government-partnership" in slug:
            yr_start, yr_end = 2017, 2019

    return {
        "docType": doc_type,
        "fiscalYearStart": yr_start,
        "fiscalYearEnd": yr_end,
    }


def _extract_metric_from_lines(lines: list[str], patterns: tuple[str, ...], min_v: float, max_v: float) -> float | None:
    """Scan adjacent lines after a metric label for a plausible numeric value."""
    for idx, line in enumerate(lines):
        low = line.lower()
        if not any(p in low for p in patterns):
            continue
        window = " ".join(lines[idx : idx + 5])
        nums: list[float] = []
        for raw in NUM_TOKEN_RE.findall(window):
            try:
                val = float(raw.replace(",", ""))
            except ValueError:
                continue
            if min_v <= val <= max_v:
                nums.append(val)
        if nums:
            # Prefer the last/most recent or budget column number in the row
            return round(nums[-1], 2)
    return None


def _extract_mtef_benchmarks(pages_text: list[tuple[int, str]], yr_start: int | None) -> dict[str, Any] | None:
    """Extract key MTEF/FSP macroeconomic assumptions (oil price, mbpd, FX, GDP, inflation)."""
    best_hit: dict[str, Any] | None = None
    best_score = 0

    for page_no, text in pages_text:
        low = text.lower()
        if "table of contents" in low or "...." in low:
            continue
        if not ("oil price" in low or "crude oil" in low or "exchange rate" in low):
            continue
        if "mbpd" not in low and "us$" not in low and "n/$" not in low and "₦/$" not in low:
            continue

        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        oil_price = _extract_metric_from_lines(lines, ("oil price benchmark", "crude oil price", "oil price (us$"), 20.0, 160.0)
        oil_prod = _extract_metric_from_lines(lines, ("oil production", "crude oil production", "production (mbpd)"), 0.8, 3.0)
        fx_rate = _extract_metric_from_lines(lines, ("exchange rate (n/$", "exchange rate (₦/$", "exchange rate"), 110.0, 2500.0)
        gdp_growth = _extract_metric_from_lines(lines, ("real gdp growth", "gdp growth"), -5.0, 15.0)
        inflation = _extract_metric_from_lines(lines, ("inflation rate", "inflation (%)"), 5.0, 45.0)

        score = sum(1 for v in (oil_price, oil_prod, fx_rate, gdp_growth, inflation) if v is not None)
        if score >= 2 and score > best_score:
            best_score = score
            best_hit = {
                "financialYear": yr_start,
                "sourcePage": page_no,
                "oilPriceUsdPerBbl": oil_price,
                "oilProductionMbpd": oil_prod,
                "exchangeRateNairaPerUsd": fx_rate,
                "gdpGrowthPct": gdp_growth,
                "inflationPct": inflation,
            }
    return best_hit


def _chunk_page_text(text: str, *, chunk_size: int = 1200, overlap: int = 150) -> list[str]:
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


def _write_policy_sqlite(db_path: Path, chunk_rows: list[tuple[Any, ...]]) -> None:
    """Update `policy_chunks` and `policy_fts` inside `external_ledger_fts.sqlite` without touching other tables."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.execute("DROP TABLE IF EXISTS policy_fts;")
        conn.execute("DROP TABLE IF EXISTS policy_chunks;")
        conn.execute(
            """
            CREATE TABLE policy_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_slug TEXT NOT NULL,
                doc_title TEXT NOT NULL,
                doc_type TEXT NOT NULL,
                fiscal_year_start INTEGER,
                fiscal_year_end INTEGER,
                page_number INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                sha256 TEXT NOT NULL,
                chunk_text TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE VIRTUAL TABLE policy_fts USING fts5(
                doc_title,
                doc_type,
                chunk_text,
                content='policy_chunks',
                content_rowid='id',
                tokenize='porter unicode61'
            )
            """
        )
        if chunk_rows:
            conn.executemany(
                """
                INSERT INTO policy_chunks (
                    doc_slug, doc_title, doc_type, fiscal_year_start, fiscal_year_end,
                    page_number, chunk_index, sha256, chunk_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                chunk_rows,
            )
            conn.execute("INSERT INTO policy_fts(policy_fts) VALUES('rebuild');")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_policy_slug ON policy_chunks(doc_slug);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_policy_type ON policy_chunks(doc_type);")
        conn.commit()
    finally:
        conn.close()


def build_policy_index(
    manifest_path: str | Path = DEFAULT_POLICY_MANIFEST,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    fts_sqlite_path: str | Path | None = DEFAULT_FTS_SQLITE,
    write: bool = True,
    enrich_manifest: bool = True,
    enable_ocr: bool = True,
) -> dict[str, Any]:
    """Index `policy_pdfs/` into `policy_benchmarks.json` and `policy_chunks`/`policy_fts`."""
    m_path = Path(manifest_path)
    ds_dir = Path(datasets_dir)
    if not m_path.exists():
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_POLICY_DROP",
            "totalManifestEntries": 0,
            "textIndexedCount": 0,
            "ocrIndexedCount": 0,
            "totalIndexedCount": 0,
            "ocrPendingCount": 0,
            "invalidPdfCount": 0,
            "totalChunksIndexed": 0,
            "scannedSkipped": [],
            "invalidSkipped": [],
            "documents": [],
            "macroBenchmarks": [],
        }
        if write:
            _atomic_write_json(ds_dir / "policy_benchmarks.json", payload)
        return payload

    manifest = json.loads(m_path.read_text(encoding="utf-8"))
    raw_docs = manifest.get("documents", [])
    policy_root = m_path.parent

    indexed_docs: list[dict[str, Any]] = []
    scanned_skipped: list[dict[str, Any]] = []
    invalid_skipped: list[dict[str, Any]] = []
    macro_benchmarks: list[dict[str, Any]] = []
    chunk_rows: list[tuple[Any, ...]] = []

    text_indexed_count = 0
    ocr_indexed_count = 0
    for entry in raw_docs:
        inferred = infer_doc_type_and_years(entry)
        rel_local = str(entry.get("localPath") or "").replace("\\", "/")
        pdf_path = PROJECT_ROOT / rel_local if (PROJECT_ROOT / rel_local).exists() else policy_root / rel_local.replace("policy_pdfs/", "")

        if enrich_manifest:
            entry["financialYear"] = inferred["fiscalYearStart"] or 0
            entry["fiscalYearStart"] = inferred["fiscalYearStart"]
            entry["fiscalYearEnd"] = inferred["fiscalYearEnd"]
            entry["docType"] = inferred["docType"]

        if entry.get("status") != "ok" or not pdf_path.exists():
            rec = {
                "slug": entry.get("slug"),
                "title": entry.get("title"),
                "category": entry.get("category"),
                "docType": inferred["docType"],
                "fiscalYearStart": inferred["fiscalYearStart"],
                "fiscalYearEnd": inferred["fiscalYearEnd"],
                "localPath": rel_local,
                "pageCount": 0,
                "chunkCount": 0,
                "sha256": _sha256_file(pdf_path) if pdf_path.exists() else None,
                "extractionStatus": "INVALID_PDF",
            }
            indexed_docs.append(rec)
            invalid_skipped.append({"slug": rec["slug"], "title": rec["title"], "reason": entry.get("status", "missing")})
            continue

        file_sha = _sha256_file(pdf_path)
        doc = fitz.open(str(pdf_path))
        try:
            page_count = len(doc)
            sample_chars = sum(len(doc[i].get_text().strip()) for i in range(min(5, page_count)))
            pages_text: list[tuple[int, str]] = []
            used_ocr = False

            if sample_chars < 100:
                if enable_ocr and is_ocr_available():
                    ocr_map = ocr_pdf_pages(pdf_path, dpi=180, verbose=True)
                    ocr_pages_text = [
                        (idx + 1, str(ocr_map.get(idx + 1, {}).get("text") or ""))
                        for idx in range(page_count)
                    ]
                    ocr_total_chars = sum(len(t.strip()) for _, t in ocr_pages_text)
                    if ocr_total_chars >= 60:
                        pages_text = ocr_pages_text
                        used_ocr = True

                if not used_ocr:
                    rec = {
                        "slug": entry.get("slug"),
                        "title": entry.get("title"),
                        "category": entry.get("category"),
                        "docType": inferred["docType"],
                        "fiscalYearStart": inferred["fiscalYearStart"],
                        "fiscalYearEnd": inferred["fiscalYearEnd"],
                        "localPath": rel_local,
                        "pageCount": page_count,
                        "chunkCount": 0,
                        "sha256": file_sha,
                        "extractionStatus": "OCR_PENDING",
                    }
                    indexed_docs.append(rec)
                    scanned_skipped.append({
                        "slug": rec["slug"],
                        "title": rec["title"],
                        "pageCount": page_count,
                        "status": "OCR_PENDING",
                    })
                    continue
            else:
                for idx in range(page_count):
                    pages_text.append((idx + 1, doc[idx].get_text()))

            doc_chunks = 0
            for page_no, txt in pages_text:
                for c_idx, chunk in enumerate(_chunk_page_text(txt)):
                    chunk_rows.append((
                        str(entry.get("slug") or ""),
                        str(entry.get("title") or ""),
                        inferred["docType"],
                        inferred["fiscalYearStart"],
                        inferred["fiscalYearEnd"],
                        page_no,
                        c_idx,
                        file_sha,
                        chunk,
                    ))
                    doc_chunks += 1

            if used_ocr:
                ocr_indexed_count += 1
            else:
                text_indexed_count += 1

            if inferred["docType"] == "MTEF_FSP":
                bench = _extract_mtef_benchmarks(pages_text, inferred["fiscalYearStart"])
                if bench:
                    bench["docSlug"] = entry.get("slug")
                    bench["docTitle"] = entry.get("title")
                    bench["sha256"] = file_sha
                    macro_benchmarks.append(bench)

            doc_rec: dict[str, Any] = {
                "slug": entry.get("slug"),
                "title": entry.get("title"),
                "category": entry.get("category"),
                "docType": inferred["docType"],
                "fiscalYearStart": inferred["fiscalYearStart"],
                "fiscalYearEnd": inferred["fiscalYearEnd"],
                "localPath": rel_local,
                "pageCount": page_count,
                "chunkCount": doc_chunks,
                "sha256": file_sha,
                "extractionStatus": "OCR_INDEXED" if used_ocr else "TEXT_INDEXED",
            }
            if used_ocr:
                doc_rec["ocrEngine"] = get_active_ocr_engine_name()
            indexed_docs.append(doc_rec)
        finally:
            doc.close()

    macro_benchmarks.sort(key=lambda b: int(b.get("financialYear") or 0), reverse=True)

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_POLICY_INDEX",
        "source": manifest.get("source"),
        "totalManifestEntries": len(raw_docs),
        "textIndexedCount": text_indexed_count,
        "ocrIndexedCount": ocr_indexed_count,
        "totalIndexedCount": text_indexed_count + ocr_indexed_count,
        "ocrPendingCount": len(scanned_skipped),
        "invalidPdfCount": len(invalid_skipped),
        "totalChunksIndexed": len(chunk_rows),
        "scannedSkipped": scanned_skipped,
        "invalidSkipped": invalid_skipped,
        "macroBenchmarks": macro_benchmarks,
        "documents": indexed_docs,
    }

    if write:
        if enrich_manifest:
            _atomic_write_json(m_path, manifest, indent=2)
        if fts_sqlite_path is not None:
            _write_policy_sqlite(Path(fts_sqlite_path), chunk_rows)
        _atomic_write_json(ds_dir / "policy_benchmarks.json", payload)

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Index policy_pdfs into policy_benchmarks.json and SQLite FTS5.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_POLICY_MANIFEST)
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--no-ocr", action="store_true", help="Disable local RapidOCR fallback on scanned PDFs.")
    args = parser.parse_args()

    res = build_policy_index(
        manifest_path=args.manifest,
        datasets_dir=args.datasets_dir,
        fts_sqlite_path=args.sqlite,
        write=True,
        enrich_manifest=True,
        enable_ocr=not args.no_ocr,
    )
    print(
        f"Policy Index [{res['status']}]: entries={res['totalManifestEntries']} | "
        f"textIndexed={res['textIndexedCount']} | ocrIndexed={res['ocrIndexedCount']} | "
        f"ocrPending={res['ocrPendingCount']} | invalid={res['invalidPdfCount']} | "
        f"chunks={res['totalChunksIndexed']} | macroBenchmarks={len(res['macroBenchmarks'])}"
    )


if __name__ == "__main__":
    main()
