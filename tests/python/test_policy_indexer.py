import json
import sqlite3
from pathlib import Path

import fitz
from fastapi.testclient import TestClient

from backend.main import app
from ingestion.parsers.policy_indexer import build_policy_index, infer_doc_type_and_years


def test_infer_doc_type_reclassifies_misfiled_finance_acts():
    fa_ogp = infer_doc_type_and_years({
        "title": "Finance ACT, 2021",
        "slug": "finance-act-2021",
        "category": "ogp",
    })
    assert fa_ogp == {"docType": "FINANCE_ACT", "fiscalYearStart": 2021, "fiscalYearEnd": 2021}

    fa_mtef = infer_doc_type_and_years({
        "title": "Finance Act, 2023",
        "slug": "finance-act-2023-2",
        "category": "mtef",
    })
    assert fa_mtef == {"docType": "FINANCE_ACT", "fiscalYearStart": 2023, "fiscalYearEnd": 2023}

    mtef = infer_doc_type_and_years({
        "title": "2026 - 2028 MTEF & FSP",
        "slug": "2026-2028-mtef-fsp",
        "category": "mtef",
    })
    assert mtef == {"docType": "MTEF_FSP", "fiscalYearStart": 2026, "fiscalYearEnd": 2028}


def test_build_policy_index_on_synthetic_pdfs_preserves_other_tables(tmp_path: Path):
    policy_dir = tmp_path / "policy_pdfs"
    mtef_dir = policy_dir / "mtef"
    mtef_dir.mkdir(parents=True)

    # 1. Text PDF with MTEF benchmark table
    text_pdf = mtef_dir / "2026-2028-mtef-fsp.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text(
        (72, 72),
        (
            "2026 - 2028 Medium Term Expenditure Framework and Fiscal Strategy Paper.\n"
            "Oil Price Benchmark (US$/b) 77.96\n"
            "Oil Production (mbpd) 1.78\n"
            "Exchange Rate (N/$) 1400\n"
            "Real GDP Growth 3.88\n"
        ),
    )
    doc.save(str(text_pdf))
    doc.close()

    # 2. Scanned/image-only PDF (empty text layer)
    scanned_pdf = mtef_dir / "scanned-guide.pdf"
    sdoc = fitz.open()
    sdoc.new_page()
    sdoc.save(str(scanned_pdf))
    sdoc.close()

    manifest_path = policy_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps({
            "source": "https://budgetoffice.gov.ng/policy",
            "totalDocuments": 2,
            "documents": [
                {
                    "financialYear": 0,
                    "title": "2026 - 2028 MTEF & FSP",
                    "slug": "2026-2028-mtef-fsp",
                    "category": "mtef",
                    "localPath": str(text_pdf),
                    "status": "ok",
                },
                {
                    "financialYear": 0,
                    "title": "Citizen's Guide to 2023 - 2025 MTEF & FSP",
                    "slug": "scanned-guide",
                    "category": "mtef",
                    "localPath": str(scanned_pdf),
                    "status": "ok",
                },
            ],
        }),
        encoding="utf-8",
    )

    # Pre-seed external sqlite with a dummy govspend_payments table to ensure it is NOT dropped
    sqlite_path = tmp_path / "external_ledger_fts.sqlite"
    conn = sqlite3.connect(str(sqlite_path))
    conn.execute("CREATE TABLE govspend_payments (id INTEGER PRIMARY KEY, amount_naira INTEGER)")
    conn.execute("INSERT INTO govspend_payments (amount_naira) VALUES (12345)")
    conn.commit()
    conn.close()

    ds_dir = tmp_path / "datasets"
    res = build_policy_index(
        manifest_path=manifest_path,
        datasets_dir=ds_dir,
        fts_sqlite_path=sqlite_path,
        write=True,
        enrich_manifest=True,
    )

    assert res["status"] == "VERIFIED_POLICY_INDEX"
    assert res["textIndexedCount"] == 1
    assert res["ocrPendingCount"] == 1
    assert res["totalChunksIndexed"] == 1
    assert len(res["macroBenchmarks"]) == 1
    assert res["macroBenchmarks"][0]["oilPriceUsdPerBbl"] == 77.96
    assert (ds_dir / "policy_benchmarks.json").exists()

    # Verify govspend_payments survived and policy_fts is searchable
    conn2 = sqlite3.connect(str(sqlite_path))
    try:
        assert conn2.execute("SELECT COUNT(*) FROM govspend_payments").fetchone()[0] == 1
        hits = conn2.execute(
            "SELECT doc_title FROM policy_fts WHERE policy_fts MATCH '\"Exchange\"*'"
        ).fetchall()
        assert len(hits) == 1
    finally:
        conn2.close()


def test_build_policy_index_ocrs_rasterized_pdf_into_fts(tmp_path: Path):
    policy_dir = tmp_path / "policy_pdfs"
    mtef_dir = policy_dir / "mtef"
    mtef_dir.mkdir(parents=True)

    # Render synthetic text to PNG, then embed into an image-only PDF (0 native chars)
    vec_doc = fitz.open()
    vp = vec_doc.new_page(width=612, height=792)
    vp.insert_text(
        (72, 120),
        "FINANCE ACT 2023 AMENDMENT PROVISIONS\nWITHHOLDING TAX AND EXCISE DUTIES SECTION ONE HUNDRED\nFEDERAL INLAND REVENUE SERVICE COLLECTION",
        fontsize=18,
    )
    png_bytes = vp.get_pixmap(dpi=200, alpha=False).tobytes("png")
    vec_doc.close()

    scanned_fa = mtef_dir / "scanned-finance-act.pdf"
    doc = fitz.open()
    pg = doc.new_page(width=612, height=792)
    pg.insert_image(pg.rect, stream=png_bytes)
    doc.save(str(scanned_fa))
    doc.close()

    manifest_path = policy_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps({
            "source": "https://budgetoffice.gov.ng/policy",
            "totalDocuments": 1,
            "documents": [
                {
                    "financialYear": 0,
                    "title": "Finance Act, 2023",
                    "slug": "scanned-finance-act",
                    "category": "mtef",
                    "localPath": str(scanned_fa),
                    "status": "ok",
                }
            ],
        }),
        encoding="utf-8",
    )

    sqlite_path = tmp_path / "ext.sqlite"
    ds_dir = tmp_path / "datasets"
    res = build_policy_index(
        manifest_path=manifest_path,
        datasets_dir=ds_dir,
        fts_sqlite_path=sqlite_path,
        write=True,
        enrich_manifest=True,
        enable_ocr=True,
    )

    assert res["ocrIndexedCount"] == 1
    assert res["ocrPendingCount"] == 0
    assert res["scannedSkipped"] == []
    assert res["documents"][0]["extractionStatus"] == "OCR_INDEXED"
    assert res["totalChunksIndexed"] >= 1

    conn = sqlite3.connect(str(sqlite_path))
    try:
        hits = conn.execute(
            "SELECT doc_title FROM policy_fts WHERE policy_fts MATCH '\"EXCISE\"* OR \"FINANCE\"*'"
        ).fetchall()
        assert len(hits) >= 1
    finally:
        conn.close()


def test_live_policy_benchmarks_and_fts_integrity():
    bench_path = Path("public/datasets/policy_benchmarks.json")
    assert bench_path.exists()
    assert bench_path.stat().st_size < 2 * 1024 * 1024
    data = json.loads(bench_path.read_text(encoding="utf-8"))
    assert data["status"] == "VERIFIED_POLICY_INDEX"
    assert data["textIndexedCount"] == 32
    assert data["ocrIndexedCount"] == 4
    assert data["ocrPendingCount"] == 0
    assert data["scannedSkipped"] == []
    assert data["invalidPdfCount"] == 1
    assert data["totalChunksIndexed"] > 3150
    assert len(data["macroBenchmarks"]) >= 1

    # Verify misfiled Finance Acts were normalized to FINANCE_ACT & OCR-indexed
    by_slug = {d["slug"]: d for d in data["documents"]}
    assert by_slug["finance-act-2021"]["docType"] == "FINANCE_ACT"
    assert by_slug["2020-finance-act"]["docType"] == "FINANCE_ACT"
    assert by_slug["finance-act-2023-2"]["docType"] == "FINANCE_ACT"
    assert by_slug["2020-finance-act"]["extractionStatus"] == "OCR_INDEXED"
    assert by_slug["finance-act-2023-2"]["extractionStatus"] == "OCR_INDEXED"
    assert by_slug["citizen-s-guide-to-2022-2023-mtef-fsp"]["extractionStatus"] == "OCR_INDEXED"
    assert by_slug["citizens-guide-to-2023-2025-mtef-fsp"]["extractionStatus"] == "OCR_INDEXED"

    # Verify OCR'd Finance Act chunks are searchable in policy_fts
    conn = sqlite3.connect("backend/data/external_ledger_fts.sqlite")
    try:
        fa_hits = conn.execute(
            "SELECT COUNT(*) FROM policy_fts WHERE policy_fts MATCH '\"Amendment\"* AND \"Finance\"*'"
        ).fetchone()[0]
        assert fa_hits >= 1
    finally:
        conn.close()

    # Verify live AI policy query stays 100% grounded
    client = TestClient(app)
    res = client.post("/api/ai/query", json={"question": "What are the 2026 MTEF oil price benchmark assumptions?", "mode": "policy"})
    assert res.status_code == 200
    body = res.json()
    assert body["groundingVerified"] is True
    assert body["datasetsConnected"]["policyBenchmarks"] is True
    assert body["datasetsConnected"]["policyFts"] is True
    assert len(body["policyCitations"]) >= 1
