from pathlib import Path

import fitz

from ingestion.parsers.ocr_engine import (
    _clean_ocr_numeric_token,
    is_ocr_available,
    ocr_pdf_pages,
)


def test_clean_ocr_numeric_token_fixes_numeric_noise_preserves_prose():
    assert _clean_ocr_numeric_token("1,23O.45") == "1,230.45"
    assert _clean_ocr_numeric_token("₦5,000.00") == "5,000.00"
    assert _clean_ocr_numeric_token("=N=120.5") == "120.5"
    assert _clean_ocr_numeric_token("(1,2O0.5O)") == "(1,200.50)"
    assert _clean_ocr_numeric_token("N1,500.25") == "1,500.25"

    # Real words & identifiers must never be corrupted
    assert _clean_ocr_numeric_token("OVERHEAD") == "OVERHEAD"
    assert _clean_ocr_numeric_token("TOTAL") == "TOTAL"
    assert _clean_ocr_numeric_token("Q2") == "Q2"
    assert _clean_ocr_numeric_token("NIGERIA") == "NIGERIA"
    assert _clean_ocr_numeric_token("FEDERAL") == "FEDERAL"


def test_ocr_pdf_pages_recovers_rasterized_pdf_and_caches_atomically(tmp_path: Path):
    assert is_ocr_available() is True

    # Create a vector page first, render to PNG, then embed into a fresh image-only PDF
    vec_doc = fitz.open()
    vec_page = vec_doc.new_page(width=612, height=792)
    vec_page.insert_text(
        (72, 120),
        "FEDERAL REPUBLIC OF NIGERIA\nMINISTRY OF WORKS CAPITAL BUDGET\nALLOCATION TOTAL 450,250.00",
        fontsize=20,
    )
    png_bytes = vec_page.get_pixmap(dpi=200, alpha=False).tobytes("png")
    vec_doc.close()

    img_pdf = tmp_path / "scanned_sample.pdf"
    doc = fitz.open()
    pg = doc.new_page(width=612, height=792)
    pg.insert_image(pg.rect, stream=png_bytes)
    doc.save(str(img_pdf))
    doc.close()

    # Confirm zero selectable native text layer
    chk = fitz.open(str(img_pdf))
    assert chk[0].get_text("text").strip() == ""
    chk.close()

    cache_dir = tmp_path / "ocr_cache"
    res1 = ocr_pdf_pages(img_pdf, dpi=180, cache_dir=cache_dir, verbose=False)
    assert 1 in res1
    p1 = res1[1]
    upper_txt = p1["text"].upper()
    assert "NIGERIA" in upper_txt
    assert "WORKS" in upper_txt or "CAPITAL" in upper_txt
    assert len(p1["words"]) >= 6

    for w in p1["words"]:
        x0, y0, x1, y1, _ = w
        assert 0.0 <= x0 < x1 <= p1["widthPt"] + 1e-3
        assert 0.0 <= y0 < y1 <= p1["heightPt"] + 1e-3

    cache_files = list(cache_dir.glob("*.json"))
    assert len(cache_files) == 1

    # Second call reloads cleanly from disk cache
    res2 = ocr_pdf_pages(img_pdf, dpi=180, cache_dir=cache_dir, verbose=False)
    assert res2[1]["text"] == res1[1]["text"]
