import json
import re
import sqlite3
from pathlib import Path

from ingestion.indexers.oaugf_indexer import build_oaugf_index


def test_oaugf_indexer_synthetic_excludes_header_and_builds_fts(tmp_path: Path):
    ext_dir = tmp_path / "oaugf_extracted"
    ext_dir.mkdir(parents=True, exist_ok=True)
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True, exist_ok=True)

    (ds_dir / "mda_integrity_scorecards.json").write_text(
        json.dumps(
            {
                "mdas": [
                    {"mdaKey": "MINISTRY OF WORKS", "mdaName": "FEDERAL MINISTRY OF WORKS"},
                    {"mdaKey": "AUDITOR GENERAL FOR THE FEDERATION", "mdaName": "OFFICE OF THE AUDITOR GENERAL FOR THE FEDERATION"},
                ]
            }
        ),
        encoding="utf-8",
    )

    doc_payload = {
        "id": "99",
        "title": "Annual Audit Report 2024",
        "category": "Annual Audit Report",
        "years": ["2024"],
        "publishedDate": "2025-01-15",
        "sourceUrl": "https://oaugf.ng/doc/99",
        "sha256": "a" * 64,
        "pageCount": 1,
        "nativePages": 1,
        "ocrPages": 0,
        "status": "EXTRACTED",
        "pages": [
            {
                "page": 42,
                "source": "native",
                "text": (
                    "Office of the Auditor-General for the Federation\n"
                    "Federal Ministry of Works\n"
                    "ISSUE 12: PAYMENT VOUCHERS NOT PRESENTED FOR AUDIT - ₦250,000,000.00\n"
                    "Payment vouchers totaling ₦250,000,000.00 were not presented for examination."
                ),
            }
        ],
    }
    (ext_dir / "99_annual.json").write_text(json.dumps(doc_payload), encoding="utf-8")
    (ext_dir / "index.json").write_text(
        json.dumps(
            {
                "documents": [
                    {"id": "99", "outputFile": "99_annual.json", "status": "EXTRACTED"},
                ]
            }
        ),
        encoding="utf-8",
    )

    fts_db = tmp_path / "ext.sqlite"
    res = build_oaugf_index(
        extracted_dir=ext_dir,
        datasets_dir=ds_dir,
        fts_sqlite_path=fts_db,
        write=True,
    )
    assert res["headline"]["parsedAuditIssuesCount"] == 1
    assert "AUDITOR GENERAL FOR THE FEDERATION" not in res["byMda"]
    assert "MINISTRY OF WORKS" in res["byMda"]
    assert res["byMda"]["MINISTRY OF WORKS"]["totalFlaggedNaira"] == 250_000_000

    conn = sqlite3.connect(str(fts_db))
    hits = conn.execute(
        "SELECT c.page_number FROM oaugf_fts f JOIN oaugf_chunks c ON c.id = f.rowid WHERE oaugf_fts MATCH '\"vouchers\"*'"
    ).fetchall()
    conn.close()
    assert len(hits) == 1
    assert hits[0][0] == 42


def test_live_oaugf_audit_index_and_sqlite_ready():
    p = Path("public/datasets/oaugf_audit_index.json")
    assert p.is_file()
    data = json.loads(p.read_text(encoding="utf-8"))
    h = data["headline"]
    assert h["reportsIndexed"] == 36
    assert h["reportsWithFindingsCount"] >= 30
    assert h["parsedAuditIssuesCount"] >= 6000
    assert h["repeatNeglectCount"] > 0
    assert h["recoveryDirectiveCount"] > 0
    assert len(data.get("issues", [])) == min(h["parsedAuditIssuesCount"], 2200)
    assert len(data.get("shardFiles", [])) >= 6
    assert h["matchedMdasCount"] >= 80
    assert "AUDITOR GENERAL FOR THE FEDERATION" not in data["byMda"]

    conn = sqlite3.connect("backend/data/external_ledger_fts.sqlite")
    cnt = conn.execute("SELECT COUNT(*) FROM oaugf_chunks").fetchone()[0]
    conn.close()
    assert cnt >= 20000

    # P7-CP-4 checks: zero TOC dot-leader excerpts, explicit Doc 41 diagnosis, explicit 2021-2022 gap
    dot_re = re.compile(r"(?:[.\u2026]{5,}\s*\d+)")
    for bucket_list in (data.get("topIssues", []), data.get("issues", [])):
        for it in bucket_list:
            txt = f"{it.get('heading', '')} {it.get('excerpt', '')}"
            assert not dot_re.search(txt), f"Leaked TOC dot-leader issue: {txt!r}"
    for m_entry in data.get("byMda", {}).values():
        for sf in m_entry.get("sampleFindings", []):
            txt = f"{sf.get('heading', '')} {sf.get('excerpt', '')}"
            assert not dot_re.search(txt), f"Leaked TOC dot-leader MDA finding: {txt!r}"
    for shard_file in (Path("public/datasets/oaugf_issues")).glob("*.json"):
        shard = json.loads(shard_file.read_text(encoding="utf-8"))
        for it in shard.get("issues", []):
            txt = f"{it.get('heading', '')} {it.get('excerpt', '')}"
            assert not dot_re.search(txt), f"Leaked TOC dot-leader shard finding: {txt!r}"

    doc41 = next((d for d in data.get("documents", []) if str(d.get("id")) == "41"), None)
    assert doc41 is not None
    assert doc41["extractionStatus"] == "SCANNED_IMAGE_BODY_PENDING_OCR"
    assert "2021" in str(h.get("missingAnnualAuditYears", [])) or 2021 in (h.get("missingAnnualAuditYears") or [])


def test_oaugf_indexer_rejects_toc_dot_leaders_and_diagnoses_scanned_doc(tmp_path: Path):
    ext_dir = tmp_path / "oaugf_extracted"
    ext_dir.mkdir(parents=True, exist_ok=True)
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True, exist_ok=True)
    (ds_dir / "mda_integrity_scorecards.json").write_text(json.dumps({"mdas": []}), encoding="utf-8")

    nddc_toc = {
        "id": "11",
        "title": "NDDC REPORT OF 2013 to 2018",
        "category": "Special Audit",
        "years": ["2013", "2018"],
        "pageCount": 10,
        "nativePages": 10,
        "ocrPages": 0,
        "status": "EXTRACTED",
        "pages": [
            {
                "page": 6,
                "source": "native",
                "text": (
                    "TABLE OF CONTENTS\n"
                    "ISSUE 1: PAYMENT OF MEDICAL CHECK-UP EXPENSES - ₦459,350,000.00…………………………………………9\n"
                    "ISSUE 2: EXCESSIVE PAYMENT OF IMPREST - ₦1,358,300,000.00…………………………………10\n"
                    "ISSUE 3: EXTERNAL SOLICITORS - ₦1,582,986,030.00………………………………………11\n"
                ),
            },
            {
                "page": 9,
                "source": "native",
                "text": (
                    "ISSUE 1: PAYMENT OF MEDICAL CHECK-UP EXPENSES\n"
                    "The Commission paid ₦459,350,000.00 to part-time board members without approval and contrary to circular."
                ),
            },
        ],
    }
    scanned_2020 = {
        "id": "41",
        "title": "Annual Audit Report 2020",
        "category": "Annual Audit Report",
        "years": ["2020"],
        "pageCount": 60,
        "nativePages": 60,
        "ocrPages": 0,
        "status": "EXTRACTED",
        "pages": [
            {
                "page": pno,
                "source": "native",
                "text": f"2020 Annual Report\nOffice of the Auditor-General for the Federation\n{pno}",
            }
            for pno in range(1, 61)
        ],
    }

    (ext_dir / "11_nddc.json").write_text(json.dumps(nddc_toc), encoding="utf-8")
    (ext_dir / "41_2020.json").write_text(json.dumps(scanned_2020), encoding="utf-8")
    (ext_dir / "index.json").write_text(
        json.dumps(
            {
                "documents": [
                    {"id": "11", "outputFile": "11_nddc.json", "status": "EXTRACTED"},
                    {"id": "41", "outputFile": "41_2020.json", "status": "EXTRACTED"},
                ]
            }
        ),
        encoding="utf-8",
    )

    res = build_oaugf_index(
        extracted_dir=ext_dir,
        datasets_dir=ds_dir,
        fts_sqlite_path=None,
        write=False,
    )
    assert res["headline"]["tocPagesSkippedCount"] == 1
    assert res["headline"]["parsedAuditIssuesCount"] == 1
    assert "41" in res["headline"]["imageOnlyPendingOcrDocIds"]
    doc41 = next(d for d in res["documents"] if d["id"] == "41")
    assert doc41["extractionStatus"] == "SCANNED_IMAGE_BODY_PENDING_OCR"
    assert doc41["substantivePagesCount"] == 0
