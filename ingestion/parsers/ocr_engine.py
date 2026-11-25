"""Shared Local OCR Engine (Windows WinRT Primary + RapidOCR Fallback) for Scanned PDFs & Image Tables.

Renders PDF pages via PyMuPDF (`fitz`) with zero native Poppler dependency, runs
Windows native `Windows.Media.Ocr.OcrEngine` (with `rapidocr-onnxruntime` fallback off-Windows),
projects OCR word bounding boxes back into PDF point coordinates compatible with
`page.get_text("words")`, and persists per-file atomic JSON caches under `ingestion/ocr_cache/`.
"""

from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import os
import re
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fitz  # PyMuPDF
import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OCR_CACHE_DIR = PROJECT_ROOT / "ingestion" / "ocr_cache"

_WORKER_OCR: Any = None
_WORKER_WINRT_ENGINE: Any = None
_WORKER_WINRT_LOOP: asyncio.AbstractEventLoop | None = None
_WINRT_AVAIL_CACHE: bool | None = None


def is_winrt_ocr_available() -> bool:
    """Return True if Windows native WinRT OCR (`Windows.Media.Ocr.OcrEngine`) is usable."""
    global _WINRT_AVAIL_CACHE
    if _WINRT_AVAIL_CACHE is not None:
        return _WINRT_AVAIL_CACHE
    if sys.platform != "win32":
        _WINRT_AVAIL_CACHE = False
        return False
    if importlib.util.find_spec("winrt.windows.media.ocr") is None:
        _WINRT_AVAIL_CACHE = False
        return False
    try:
        from winrt.windows.globalization import Language
        from winrt.windows.media.ocr import OcrEngine

        eng = (
            OcrEngine.try_create_from_user_profile_languages()
            or OcrEngine.try_create_from_language(Language("en-US"))
            or OcrEngine.try_create_from_language(Language("en-GB"))
        )
        _WINRT_AVAIL_CACHE = eng is not None
    except Exception:
        _WINRT_AVAIL_CACHE = False
    return _WINRT_AVAIL_CACHE


def is_rapidocr_available() -> bool:
    """Return True if `rapidocr_onnxruntime` is importable in the current environment."""
    return importlib.util.find_spec("rapidocr_onnxruntime") is not None


def is_ocr_available() -> bool:
    """Return True if any supported local OCR engine (WinRT or RapidOCR) is available."""
    return is_winrt_ocr_available() or is_rapidocr_available()


def get_active_ocr_engine_name() -> str:
    """Return the identifier of the active OCR engine."""
    if is_winrt_ocr_available():
        return "windows-winrt-ocr"
    if is_rapidocr_available():
        return "rapidocr-onnxruntime"
    return "none"


def _get_worker_winrt() -> tuple[Any, asyncio.AbstractEventLoop, int]:
    """Lazily initialize per-process WinRT OcrEngine and dedicated event loop."""
    global _WORKER_WINRT_ENGINE, _WORKER_WINRT_LOOP
    from winrt.windows.globalization import Language
    from winrt.windows.media.ocr import OcrEngine

    if _WORKER_WINRT_ENGINE is None:
        _WORKER_WINRT_ENGINE = (
            OcrEngine.try_create_from_user_profile_languages()
            or OcrEngine.try_create_from_language(Language("en-US"))
            or OcrEngine.try_create_from_language(Language("en-GB"))
        )
        if _WORKER_WINRT_ENGINE is None:
            raise RuntimeError("Windows WinRT OcrEngine could not be initialized for English.")
    if _WORKER_WINRT_LOOP is None or _WORKER_WINRT_LOOP.is_closed():
        _WORKER_WINRT_LOOP = asyncio.new_event_loop()
    max_dim = int(getattr(OcrEngine, "max_image_dimension", 2600) or 2600)
    return _WORKER_WINRT_ENGINE, _WORKER_WINRT_LOOP, max_dim


def _get_worker_rapidocr() -> Any:
    """Lazily initialize a per-process RapidOCR singleton."""
    global _WORKER_OCR
    if _WORKER_OCR is None:
        from rapidocr_onnxruntime import RapidOCR

        _WORKER_OCR = RapidOCR()
    return _WORKER_OCR


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
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _clean_ocr_numeric_token(tok: str) -> str:
    """Gently normalize currency prefixes and `O`/`o`->`0` inside numeric OCR tokens only.

    Real prose tokens (e.g., `OVERHEAD`, `TOTAL`, `Q2`, `NIGERIA`) are returned untouched.
    """
    s = str(tok or "").strip()
    if not s:
        return s

    lead_paren = "(" if s.startswith("(") else ""
    work = s[1:] if lead_paren else s
    trail_paren = ")" if work.endswith(")") else ""
    if trail_paren:
        work = work[:-1]
    trail_pct = "%" if work.endswith("%") else ""
    if trail_pct:
        work = work[:-1]

    for prefix in ("=N=", "=n=", "₦", "NGN"):
        if work.startswith(prefix) and len(work) > len(prefix):
            work = work[len(prefix) :].lstrip()
            break
    if work.startswith(("N", "n")) and len(work) > 1 and (work[1].isdigit() or work[1] in {"O", "o", "."}):
        work = work[1:].lstrip()

    core_no_sign = work[1:] if work.startswith("-") else work
    alpha_chars = [ch for ch in core_no_sign if ch.isalpha()]
    digit_chars = [ch for ch in core_no_sign if ch.isdigit()]
    if not digit_chars:
        return s
    if any(ch not in {"O", "o"} for ch in alpha_chars):
        return s
    if not all(ch.isdigit() or ch in {",", ".", "O", "o"} for ch in core_no_sign):
        return s

    cleaned_core = work.replace("O", "0").replace("o", "0")
    return f"{lead_paren}{cleaned_core}{trail_pct}{trail_paren}"


def _reconstruct_reading_order_text(words: list[list[Any]], y_tol: float = 6.0) -> str:
    """Group PDF-point word boxes into sorted horizontal lines."""
    if not words:
        return ""
    sorted_words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2.0, w[0]))
    bands: list[list[list[Any]]] = []
    band_ys: list[float] = []
    for w in sorted_words:
        yc = (w[1] + w[3]) / 2.0
        if not bands or abs(yc - band_ys[-1]) > y_tol:
            bands.append([w])
            band_ys.append(yc)
        else:
            bands[-1].append(w)
            band_ys[-1] = sum((item[1] + item[3]) / 2.0 for item in bands[-1]) / len(bands[-1])

    lines: list[str] = []
    for band in bands:
        band.sort(key=lambda w: w[0])
        line = " ".join(str(w[4]) for w in band).strip()
        if line:
            lines.append(line)
    return "\n".join(lines)


def _ocr_result_to_page_payload(
    ocr_result: list[Any] | None,
    width_pt: float,
    height_pt: float,
    pix_w: int,
    pix_h: int,
    *,
    dpi: int = 180,
    min_score: float = 0.40,
) -> dict[str, Any]:
    """Convert RapidOCR detections into PDF-point word coordinates and reconstructed text."""
    sx = width_pt / max(1, pix_w)
    sy = height_pt / max(1, pix_h)
    words: list[list[Any]] = []

    for det in ocr_result or []:
        if not isinstance(det, (list, tuple)) or len(det) < 3:
            continue
        box, raw_text, raw_score = det[0], det[1], det[2]
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0
        if score < min_score:
            continue
        text_str = str(raw_text or "").strip()
        if not text_str or not box or len(box) < 4:
            continue

        xs = [float(pt[0]) for pt in box]
        ys = [float(pt[1]) for pt in box]
        bx0 = max(0.0, min(xs) * sx)
        by0 = max(0.0, min(ys) * sy)
        bx1 = min(width_pt, max(xs) * sx)
        by1 = min(height_pt, max(ys) * sy)
        span = max(1.0, bx1 - bx0)
        total_len = max(1, len(text_str))

        for m in re.finditer(r"\S+", text_str):
            wx0 = round(bx0 + (m.start() / total_len) * span, 2)
            wx1 = round(bx0 + (m.end() / total_len) * span, 2)
            if wx1 <= wx0:
                wx1 = round(wx0 + 1.0, 2)
            words.append([wx0, round(by0, 2), wx1, round(by1, 2), m.group(0)])

    text = _reconstruct_reading_order_text(words)
    return {
        "widthPt": round(float(width_pt), 2),
        "heightPt": round(float(height_pt), 2),
        "dpi": int(dpi),
        "engine": "rapidocr-onnxruntime",
        "text": text,
        "words": words,
    }


def _ocr_single_page_winrt(pdf_path: str, page_idx: int, dpi: int) -> tuple[int, dict[str, Any]]:
    """Render one PDF page to GRAY8 SoftwareBitmap and recognize via Windows WinRT OCR."""
    from winrt.windows.graphics.imaging import BitmapPixelFormat, SoftwareBitmap
    from winrt.windows.storage.streams import DataWriter

    eng, loop, max_dim = _get_worker_winrt()
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_idx]
        width_pt = float(page.rect.width)
        height_pt = float(page.rect.height)
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY, alpha=False)
        if max(pix.width, pix.height) > max_dim:
            scale = (dpi / 72.0) * ((max_dim - 16) / max(pix.width, pix.height))
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY, alpha=False)

        dw = DataWriter()
        dw.write_bytes(pix.samples)
        buf = dw.detach_buffer()
        sb = SoftwareBitmap.create_copy_from_buffer(
            buf, BitmapPixelFormat.GRAY8, int(pix.width), int(pix.height)
        )
        res = loop.run_until_complete(eng.recognize_async(sb))

        sx = width_pt / max(1, int(pix.width))
        sy = height_pt / max(1, int(pix.height))
        words: list[list[Any]] = []
        for ln in res.lines:
            for w in ln.words:
                txt = str(w.text or "").strip()
                if not txt:
                    continue
                r = w.bounding_rect
                wx0 = max(0.0, float(r.x) * sx)
                wy0 = max(0.0, float(r.y) * sy)
                wx1 = min(width_pt, (float(r.x) + float(r.width)) * sx)
                wy1 = min(height_pt, (float(r.y) + float(r.height)) * sy)
                if wx1 <= wx0:
                    wx1 = wx0 + 1.0
                if wy1 <= wy0:
                    wy1 = wy0 + 1.0
                words.append([round(wx0, 2), round(wy0, 2), round(wx1, 2), round(wy1, 2), txt])

        text = _reconstruct_reading_order_text(words)
        return (
            page_idx + 1,
            {
                "widthPt": round(width_pt, 2),
                "heightPt": round(height_pt, 2),
                "dpi": int(dpi),
                "engine": "windows-winrt-ocr",
                "text": text,
                "words": words,
            },
        )
    finally:
        doc.close()


def _ocr_single_page_rapidocr(pdf_path: str, page_idx: int, dpi: int) -> tuple[int, dict[str, Any]]:
    """Render one PDF page to RGB numpy array and run RapidOCR (off-Windows fallback)."""
    ocr = _get_worker_rapidocr()
    doc = fitz.open(pdf_path)
    try:
        page = doc[page_idx]
        pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB, alpha=False)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        result, _ = ocr(img)
        payload = _ocr_result_to_page_payload(
            result,
            width_pt=float(page.rect.width),
            height_pt=float(page.rect.height),
            pix_w=int(pix.width),
            pix_h=int(pix.height),
            dpi=dpi,
        )
        return (page_idx + 1, payload)
    finally:
        doc.close()


def _ocr_single_page_worker(args: tuple[str, int, int]) -> tuple[int, dict[str, Any]]:
    """Dispatch single-page OCR to WinRT OCR (Windows primary) or RapidOCR fallback."""
    pdf_path, page_idx, dpi = args
    if is_winrt_ocr_available():
        return _ocr_single_page_winrt(pdf_path, page_idx, dpi)
    return _ocr_single_page_rapidocr(pdf_path, page_idx, dpi)


def ocr_pdf_pages(
    pdf_path: str | Path,
    page_indices: list[int] | None = None,
    *,
    dpi: int = 180,
    appendix_after_page: int | None = None,
    appendix_dpi: int = 140,
    cache_dir: Path = DEFAULT_OCR_CACHE_DIR,
    checkpoint_every: int = 20,
    max_workers: int | None = None,
    verbose: bool = True,
) -> dict[int, dict[str, Any]]:
    """OCR requested (or all) pages of a PDF with atomic disk caching & parallel workers."""
    if not is_ocr_available():
        raise RuntimeError("No local OCR backend is available (WinRT OCR / rapidocr_onnxruntime).")

    p = Path(pdf_path)
    if not p.exists():
        raise FileNotFoundError(f"PDF not found for OCR: {p}")

    file_sha = _sha256_file(p)
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", p.stem)[:64]
    cache_path = Path(cache_dir) / f"{file_sha[:16]}_{safe_stem}.json"

    doc = fitz.open(str(p))
    try:
        page_count = len(doc)
    finally:
        doc.close()

    if page_indices is None:
        target_indices = list(range(page_count))
    else:
        target_indices = sorted({int(i) for i in page_indices if 0 <= int(i) < page_count})

    cached_pages: dict[str, dict[str, Any]] = {}
    if cache_path.exists():
        try:
            cache_obj = json.loads(cache_path.read_text(encoding="utf-8"))
            if cache_obj.get("sha256") == file_sha and isinstance(cache_obj.get("pages"), dict):
                cached_pages = cache_obj["pages"]
        except Exception:
            cached_pages = {}

    tasks: list[tuple[str, int, int]] = []
    for idx in target_indices:
        pno = idx + 1
        target_dpi = (
            appendix_dpi
            if (appendix_after_page is not None and pno > appendix_after_page)
            else dpi
        )
        existing = cached_pages.get(str(pno))
        if existing is not None and int(existing.get("dpi") or 0) >= target_dpi:
            continue
        tasks.append((str(p), idx, target_dpi))

    def _flush_cache() -> None:
        _atomic_write_json(
            cache_path,
            {
                "file": p.name,
                "sha256": file_sha,
                "pageCount": page_count,
                "engine": get_active_ocr_engine_name(),
                "updatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "pages": cached_pages,
            },
        )

    if tasks:
        total_todo = len(tasks)
        engine_name = get_active_ocr_engine_name()
        if verbose:
            print(
                f"  [OCR:{engine_name}] {p.name}: processing {total_todo} page(s) "
                f"({len(target_indices) - total_todo} cached)...",
                flush=True,
            )

        completed = 0
        if total_todo < 12 or max_workers == 1:
            for item in tasks:
                pno, payload = _ocr_single_page_worker(item)
                cached_pages[str(pno)] = payload
                completed += 1
                if completed % max(1, checkpoint_every) == 0:
                    _flush_cache()
                    if verbose:
                        print(f"    [OCR] {p.name}: {completed}/{total_todo} pages", flush=True)
        else:
            workers = max_workers or min(3, max(2, os.cpu_count() or 2))
            with ProcessPoolExecutor(max_workers=workers) as executor:
                futures = [executor.submit(_ocr_single_page_worker, item) for item in tasks]
                for fut in as_completed(futures):
                    pno, payload = fut.result()
                    cached_pages[str(pno)] = payload
                    completed += 1
                    if completed % max(1, checkpoint_every) == 0:
                        _flush_cache()
                        if verbose:
                            print(f"    [OCR] {p.name}: {completed}/{total_todo} pages", flush=True)

        _flush_cache()
        if verbose:
            print(f"    [OCR] {p.name}: completed {completed}/{total_todo} page(s).", flush=True)

    return {
        idx + 1: cached_pages[str(idx + 1)]
        for idx in target_indices
        if str(idx + 1) in cached_pages
    }
