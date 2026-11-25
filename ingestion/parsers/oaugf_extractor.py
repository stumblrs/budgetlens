"""Extract and OCR all OAuGF Audit Report PDFs into durable page-level JSON archives.

Uses PyMuPDF (`fitz`) for native text pages and `ocr_pdf_pages()` from
`ingestion.parsers.ocr_engine` (Windows WinRT OCR primary / RapidOCR fallback)
strictly on sparse/scanned pages (`< 60` native characters), checkpointing every
20 OCR pages into `ingestion/ocr_cache/` and writing verified per-document JSONs
under `ingestion/oaugf_extracted/`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz

from ingestion.parsers.ocr_engine import DEFAULT_OCR_CACHE_DIR, get_active_ocr_engine_name, ocr_pdf_pages

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST_PATH = PROJECT_ROOT / "oaugf_pdfs" / "manifest.json"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "ingestion" / "oaugf_extracted"
MIN_NATIVE_CHARS = 60


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _safe_doc_filename(doc_id: Any, slug: str) -> str:
    raw = f"{doc_id}_{slug}" if slug else str(doc_id)
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", raw).strip("_")
    return f"{cleaned[:96]}.json"


def extract_single_oaugf_pdf(
    doc_entry: dict[str, Any],
    *,
    output_dir: Path,
    ocr_cache_dir: Path,
    dpi: int = 180,
    max_workers: int | None = None,
) -> dict[str, Any]:
    """Extract native + OCR text for one OAuGF PDF and atomically persist its JSON archive."""
    pdf_path = Path(doc_entry["local_path"])
    if not pdf_path.is_absolute():
        pdf_path = PROJECT_ROOT / pdf_path

    out_name = _safe_doc_filename(doc_entry.get("id"), str(doc_entry.get("slug") or ""))
    out_path = output_dir / out_name

    if out_path.exists():
        try:
            existing = json.loads(out_path.read_text(encoding="utf-8"))
            if existing.get("status") == "EXTRACTED" and isinstance(existing.get("pages"), list):
                return {
                    "id": doc_entry.get("id"),
                    "title": doc_entry.get("title"),
                    "outputFile": out_name,
                    "status": "EXTRACTED_CACHED",
                    "pageCount": existing.get("pageCount", 0),
                    "nativePages": existing.get("nativePages", 0),
                    "ocrPages": existing.get("ocrPages", 0),
                    "totalChars": existing.get("totalChars", 0),
                    "pdfPath": str(pdf_path),
                }
        except Exception:
            pass

    if not pdf_path.exists():
        return {
            "id": doc_entry.get("id"),
            "title": doc_entry.get("title"),
            "outputFile": None,
            "status": "MISSING_PDF",
            "pdfPath": str(pdf_path),
        }

    file_sha = doc_entry.get("sha256") or _sha256_file(pdf_path)

    try:
        doc = fitz.open(str(pdf_path))
    except Exception as exc:
        err_payload = {
            "id": doc_entry.get("id"),
            "title": doc_entry.get("title"),
            "category": doc_entry.get("category"),
            "years": doc_entry.get("years", []),
            "publishedDate": doc_entry.get("published_date"),
            "sourceUrl": doc_entry.get("url"),
            "sha256": file_sha,
            "status": "CORRUPT_PDF",
            "error": str(exc),
        }
        _atomic_write_json(out_path, err_payload)
        return {
            "id": doc_entry.get("id"),
            "title": doc_entry.get("title"),
            "outputFile": out_name,
            "status": "CORRUPT_PDF",
            "error": str(exc),
            "pdfPath": str(pdf_path),
        }

    try:
        page_count = len(doc)
        native_texts: dict[int, str] = {}
        scan_indices: list[int] = []
        for idx in range(page_count):
            txt = (doc[idx].get_text("text") or "").strip()
            if len(txt) >= MIN_NATIVE_CHARS:
                native_texts[idx + 1] = txt
            else:
                scan_indices.append(idx)
    finally:
        doc.close()

    ocr_pages_map: dict[int, dict[str, Any]] = {}
    if scan_indices:
        ocr_pages_map = ocr_pdf_pages(
            pdf_path,
            page_indices=scan_indices,
            dpi=dpi,
            cache_dir=ocr_cache_dir,
            checkpoint_every=20,
            max_workers=max_workers,
            verbose=True,
        )

    pages_out: list[dict[str, Any]] = []
    native_count = 0
    ocr_count = 0
    total_chars = 0

    for pno in range(1, page_count + 1):
        if pno in native_texts:
            txt = native_texts[pno]
            src = "native"
            native_count += 1
        elif pno in ocr_pages_map:
            txt = str(ocr_pages_map[pno].get("text") or "").strip()
            src = "ocr" if txt else "empty"
            if txt:
                ocr_count += 1
        else:
            txt = ""
            src = "empty"

        total_chars += len(txt)
        pages_out.append(
            {
                "page": pno,
                "source": src,
                "text": txt,
            }
        )

    payload = {
        "id": doc_entry.get("id"),
        "title": doc_entry.get("title"),
        "category": doc_entry.get("category"),
        "years": doc_entry.get("years", []),
        "tags": doc_entry.get("tags", []),
        "publishedDate": doc_entry.get("published_date"),
        "sourceUrl": doc_entry.get("url"),
        "originalPdfName": pdf_path.name,
        "sha256": file_sha,
        "pageCount": page_count,
        "nativePages": native_count,
        "ocrPages": ocr_count,
        "totalChars": total_chars,
        "ocrEngine": get_active_ocr_engine_name() if scan_indices else "native-only",
        "extractedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "EXTRACTED",
        "pages": pages_out,
    }
    _atomic_write_json(out_path, payload)

    return {
        "id": doc_entry.get("id"),
        "title": doc_entry.get("title"),
        "category": doc_entry.get("category"),
        "years": doc_entry.get("years", []),
        "outputFile": out_name,
        "status": "EXTRACTED",
        "pageCount": page_count,
        "nativePages": native_count,
        "ocrPages": ocr_count,
        "totalChars": total_chars,
        "sha256": file_sha,
        "pdfPath": str(pdf_path),
    }


def extract_all_oaugf_pdfs(
    *,
    manifest_path: Path = DEFAULT_MANIFEST_PATH,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    ocr_cache_dir: Path = DEFAULT_OCR_CACHE_DIR,
    dpi: int = 180,
    max_workers: int | None = None,
) -> dict[str, Any]:
    """Extract and OCR all downloaded PDFs listed in `oaugf_pdfs/manifest.json`."""
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    docs = [d for d in manifest.get("documents", []) if d.get("status") in ("downloaded", "skipped")]
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    for idx, doc_entry in enumerate(docs, 1):
        print(f"[{idx}/{len(docs)}] Extracting: {doc_entry.get('title', '')[:70]}", flush=True)
        res = extract_single_oaugf_pdf(
            doc_entry,
            output_dir=output_dir,
            ocr_cache_dir=ocr_cache_dir,
            dpi=dpi,
            max_workers=max_workers,
        )
        results.append(res)
        print(
            f"  -> {res['status']} | pages={res.get('pageCount', 0)} "
            f"(native={res.get('nativePages', 0)}, ocr={res.get('ocrPages', 0)}) | "
            f"chars={res.get('totalChars', 0):,}",
            flush=True,
        )

    index_payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sourceManifest": str(manifest_path),
        "totalDocuments": len(results),
        "extractedCount": sum(1 for r in results if r["status"].startswith("EXTRACTED")),
        "corruptCount": sum(1 for r in results if r["status"] == "CORRUPT_PDF"),
        "totalPages": sum(int(r.get("pageCount") or 0) for r in results),
        "totalNativePages": sum(int(r.get("nativePages") or 0) for r in results),
        "totalOcrPages": sum(int(r.get("ocrPages") or 0) for r in results),
        "totalChars": sum(int(r.get("totalChars") or 0) for r in results),
        "documents": results,
    }
    _atomic_write_json(output_dir / "index.json", index_payload)
    return index_payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Extract native + OCR text from OAuGF PDFs")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST_PATH))
    parser.add_argument("--out-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--dpi", type=int, default=180)
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()

    summary = extract_all_oaugf_pdfs(
        manifest_path=Path(args.manifest),
        output_dir=Path(args.out_dir),
        dpi=args.dpi,
        max_workers=args.workers,
    )
    print(
        f"\nDone: {summary['extractedCount']}/{summary['totalDocuments']} extracted "
        f"(corrupt={summary['corruptCount']}) | pages={summary['totalPages']:,} "
        f"(native={summary['totalNativePages']:,}, ocr={summary['totalOcrPages']:,}) | "
        f"chars={summary['totalChars']:,}"
    )
