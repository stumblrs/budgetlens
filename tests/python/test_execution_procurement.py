import json
from pathlib import Path

from ingestion.parsers.bir_parser import (
    apply_macro_integrity_guards,
    build_execution_tracker,
    classify_bir_filename,
    parse_2016_capital_releases_pdf,
    parse_2023_budget_performance_pdf,
)
from ingestion.parsers.nocopo_connector import (
    _extract_release_fields,
    build_procurement_links,
    compute_contractor_concentration,
    deduplicate_releases_by_ocid,
    match_ocds_to_budget_records,
)


def test_2016_and_2023_bir_pdf_parsers():
    p16 = Path("source_pdfs/2016/Total Capital and Capital Releases.pdf")
    r16 = parse_2016_capital_releases_pdf(p16)
    assert r16["financialYear"] == 2016
    assert r16["status"] == "VERIFIED_BIR_SOURCE"
    assert r16["mdaCount"] >= 50
    assert r16["totalAppropriatedNaira"] > 0
    assert r16["totalReleasedNaira"] > 0

    p23 = Path("source_pdfs/2023/2023 Budget Performance.pdf")
    r23 = parse_2023_budget_performance_pdf(p23)
    assert r23["financialYear"] == 2023
    assert r23["status"] == "VERIFIED_BIR_SOURCE"
    assert len(r23["macroRows"]) >= 2


def test_nocopo_ocds_matching_and_contractor_concentration():
    releases = [
        {
            "ocid": "ocds-ng-001",
            "date": "2025-05-10T00:00:00Z",
            "buyer": {"name": "Federal Ministry of Works"},
            "tender": {"id": "ERGP1001", "title": "Dualization of Highway", "procurementMethodDetails": "Open Competitive"},
            "awards": [
                {
                    "value": {"amount": 450_000_000, "currency": "NGN"},
                    "suppliers": [
                        {
                            "name": "Alpha Civil Contractors Ltd",
                            "identifier": {"id": "RC-998877"},
                            "beneficialOwners": [{"name": "A. Bello"}],
                        }
                    ],
                }
            ],
            "_sourceFile": "nocopo_2025.json",
        },
        {
            "ocid": "ocds-ng-002",
            "date": "2025-06-15T00:00:00Z",
            "buyer": {"name": "Federal Ministry of Works"},
            "tender": {"id": "UNKNOWN", "title": "Rehabilitation of Rural Feeder Bridges in Katsina"},
            "awards": [
                {
                    "value": {"amount": 250_000_000, "currency": "NGN"},
                    "suppliers": [{"name": "Alpha Civil Contractors Ltd", "identifier": {"id": "RC-998877"}}],
                }
            ],
            "_sourceFile": "nocopo_2025.json",
        },
    ]
    budget_records = [
        {
            "recordIdentity": {
                "id": "P-2025-1",
                "financialYear": 2025,
                "projectCode": "ERGP1001",
                "verbatimProjectName": "Dualization of Highway",
                "amountNaira": 500_000_000,
            },
            "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Works"},
        },
        {
            "recordIdentity": {
                "id": "P-2025-2",
                "financialYear": 2025,
                "projectCode": "ERGP1002",
                "verbatimProjectName": "Rehabilitation of Rural Feeder Bridges in Katsina State",
                "amountNaira": 300_000_000,
            },
            "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Works"},
        },
    ]

    links = match_ocds_to_budget_records(releases, budget_records)
    assert len(links) == 2
    assert links[0]["matchType"] == "EXACT_ERGP_CODE"
    assert links[0]["confidenceScore"] == 1.0
    assert links[1]["matchType"] == "HIGH_CONFIDENCE_FUZZY"
    assert links[1]["confidenceScore"] >= 0.72

    conc = compute_contractor_concentration(links)
    assert len(conc) == 1
    assert conc[0]["contractorName"] == "Alpha Civil Contractors Ltd"
    assert conc[0]["awardCount"] == 2
    assert conc[0]["totalAwardNaira"] == 700_000_000


def test_generated_execution_and_procurement_artifacts_exist():
    exec_path = Path("public/datasets/execution_tracker.json")
    proc_path = Path("public/datasets/procurement_links.json")
    assert exec_path.exists()
    assert proc_path.exists()
    exec_data = json.loads(exec_path.read_text(encoding="utf-8"))
    assert 2016 in exec_data["verifiedYears"]
    assert 2023 in exec_data["verifiedYears"]
    assert len(exec_data["verifiedYears"]) >= 12
    proc_data = json.loads(proc_path.read_text(encoding="utf-8"))
    assert proc_data["status"] in {"AWAITING_PROCUREMENT_DROP", "VERIFIED_OCDS_SNAPSHOT"}


def test_bir_filename_ranking_and_exclusions():
    q4c = classify_bir_filename("2021-fourth-quarter-and-consolidated-budget-implementation-report.pdf")
    q4 = classify_bir_filename("2024-fourth-quarter-budget-implementation-report-2.pdf")
    q3 = classify_bir_filename("2020-third-quarter-budget-implementation-report.pdf")
    q2 = classify_bir_filename("second-quarter-2026-budget-implementation-report.pdf")
    q1 = classify_bir_filename("2020-first-quarter-budget-implementation-report.pdf")
    unity = classify_bir_filename("2024-unity-schools-budget-implimentation-report.pdf")
    macro = classify_bir_filename("reviewed-2o25-third-quarter-macroeconomics-financial-analysis.pdf")

    assert not q4c[2] and not q4[2] and not q3[2] and not q2[2] and not q1[2]
    assert q4c[1] > q4[1] > q3[1] > q2[1] > q1[1]
    assert q4[0] == "Q4" and q3[0] == "Q3" and q2[0] == "Q2" and q1[0] == "Q1"
    assert unity[2] is True
    assert macro[2] is True


def test_execution_tracker_multi_year_sanity_and_2024_utilization():
    import sqlite3

    exec_path = Path("public/datasets/execution_tracker.json")
    exec_data = json.loads(exec_path.read_text(encoding="utf-8"))
    by_year = {int(y["financialYear"]): y for y in exec_data["years"]}

    assert exec_data.get("scannedSkipped") == []
    assert len(exec_data["verifiedYears"]) == 18
    assert 2014 in exec_data["verifiedYears"]
    assert len(exec_data.get("ocrRecovered", [])) == 3
    assert int(exec_data.get("birOcrChunksIndexed") or 0) > 1000
    assert by_year[2016]["mdaCount"] >= 600
    assert 4_000_000_000_000 <= by_year[2012]["totalAppropriatedNaira"] <= 5_000_000_000_000

    # Verify FY 2014, 2015, 2020, 2021 recovered cleanly via OCR
    assert by_year[2014]["totalAppropriatedNaira"] > 1_000_000_000_000
    assert by_year[2014]["quarterCovered"] == "Q2"
    assert by_year[2014]["isPartialYear"] is True
    assert by_year[2014]["totalUtilizedNaira"] is None

    # FY 2013 must omit aligned-actual-missing Overhead row rather than fabricating 0.0%
    y13_overhead = [r for r in by_year[2013]["macroRows"] if "overhead cost" in r["label"].lower()]
    assert y13_overhead == []
    assert by_year[2013].get("macroIntegrityWarnings")

    # FY 2015 Debt Service Sub-Total reconciled to Dom + For sum cleanly
    y15_debt = next(
        r for r in by_year[2015]["macroRows"] if "debt service / recurrent debt" in r["label"].lower()
    )
    assert y15_debt["actualNaira"] >= 1_000_000_000_000
    assert y15_debt["derivedFromComponents"] is True
    assert y15_debt["performancePct"] > 105.0

    assert len(by_year[2015]["macroRows"]) >= 6
    assert by_year[2020]["totalAppropriatedNaira"] > 8_000_000_000_000
    assert by_year[2021]["totalAppropriatedNaira"] > 10_000_000_000_000

    y24 = by_year[2024]
    assert len(y24["macroRows"]) >= 8
    assert len(y24["mdaBreakdown"]) >= 10
    works24 = next((m for m in y24["mdaBreakdown"] if "works" in m["mdaName"].lower()), None)
    assert works24 is not None
    assert works24["appropriatedNaira"] > 900_000_000_000
    assert (works24.get("utilizedNaira") or 0) > 500_000_000_000

    bad_terms = ("utilization", "utiization", "utilisation", "period.")
    for yr, entry in by_year.items():
        assert 100_000_000_000 <= entry["totalAppropriatedNaira"] <= 200_000_000_000_000, f"FY {yr} app out of bounds"
        assert 0.0 <= entry["overallReleasePct"] <= 250.0, f"FY {yr} pct out of bounds"
        for mda in entry["mdaBreakdown"]:
            low_name = mda["mdaName"].lower()
            assert not any(term in low_name for term in bad_terms), f"FY {yr} leaked header/prose: {mda['mdaName']!r}"

    # Verify bir_ocr_fts exists and is searchable in external_ledger_fts.sqlite
    conn = sqlite3.connect("backend/data/external_ledger_fts.sqlite")
    try:
        cnt = conn.execute("SELECT COUNT(*) FROM bir_ocr_chunks").fetchone()[0]
        assert cnt > 1000
        hits = conn.execute(
            "SELECT COUNT(*) FROM bir_ocr_fts WHERE bir_ocr_fts MATCH '\"Consolidated\"* OR \"Revenue\"*'"
        ).fetchone()[0]
        assert hits >= 1
    finally:
        conn.close()


def test_nocopo_ocid_dedup_ergp_description_parties_and_transactions():
    raw_releases = [
        {
            "ocid": "ocds-gyl66f-517001001-00010",
            "date": "2922-05-01T00:00:00Z",  # typo year should be sanitized
            "tag": ["planning"],
            "buyer": {"id": "NG-BPP-BPP-NOC-517001001", "name": "FEDERAL MINISTRY OF EDUCATION - HQTRS"},
            "planning": {
                "budget": {
                    "id": "818",
                    "description": "ERGP14101515",
                    "project": "Rehabilitation of Federal Unity College Blocks",
                    "amount": {"amount": 45000000.0, "currency": "NGN"},
                }
            },
        },
        {
            "ocid": "ocds-gyl66f-517001001-00010",
            "date": "2024-06-15T00:00:00Z",
            "tag": ["planning", "tender", "award", "contract", "implementation"],
            "buyer": {"id": "NG-BPP-BPP-NOC-517001001", "name": "FEDERAL MINISTRY OF EDUCATION - HQTRS"},
            "parties": [
                {
                    "id": "NG-BPP-BPP-CI-7788",
                    "name": "Zenith Builders Nigeria Limited",
                    "identifier": {"scheme": "NG-BPP", "id": "BPP-CI-7788"},
                    "roles": ["supplier", "payee"],
                }
            ],
            "awards": [
                {
                    "date": "2024-06-15T00:00:00Z",
                    "value": {"amount": 42000000.0, "currency": "NGN"},
                    "suppliers": [{"id": "NG-BPP-BPP-CI-7788", "name": "Zenith Builders Nigeria Limited"}],
                }
            ],
            "contracts": [
                {
                    "dateSigned": "2024-06-20T00:00:00Z",
                    "implementation": {
                        "transactions": [
                            {"value": {"amount": 15000000.0, "currency": "NGN"}},
                            {"value": {"amount": 10000000.0, "currency": "NGN"}},
                        ]
                    },
                }
            ],
        },
    ]

    deduped = deduplicate_releases_by_ocid(raw_releases)
    assert len(deduped) == 1
    fields = _extract_release_fields(deduped[0])
    assert fields["stage"] == "implementation"
    assert fields["ergpCodes"] == ["ERGP14101515"]
    assert fields["buyerAdminCode"] == "0517001001"
    assert fields["bppContractorId"] == "BPP-CI-7788"
    assert fields["cacRcNumber"] is None  # BPP ID must not be mislabeled as CAC RC
    assert fields["totalPaidNaira"] == 25_000_000
    assert fields["yearHint"] == 2024

    typo_only = _extract_release_fields({"ocid": "ocds-bad-yr", "date": "2922-01-01T00:00:00Z"})
    assert typo_only["yearHint"] is None
    assert typo_only["awardDate"] is None

    budget_records = [
        {
            "recordIdentity": {
                "id": "P-2024-99",
                "financialYear": 2024,
                "projectCode": "ERGP14101515",
                "verbatimProjectName": "Rehabilitation of Federal Unity College Blocks",
                "amountNaira": 45_000_000,
            },
            "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Education"},
        }
    ]
    links = match_ocds_to_budget_records(raw_releases, budget_records)
    assert len(links) == 1
    assert links[0]["matchType"] == "EXACT_ERGP_CODE"
    assert links[0]["bppContractorId"] == "BPP-CI-7788"
    assert links[0]["totalPaidNaira"] == 25_000_000


def test_live_nocopo_snapshot_and_procurement_api():
    from fastapi.testclient import TestClient
    from backend.main import app

    proc_path = Path("public/datasets/procurement_links.json")
    sqlite_path = Path("backend/data/external_ledger_fts.sqlite")
    proc_data = json.loads(proc_path.read_text(encoding="utf-8"))

    assert proc_data["status"] == "VERIFIED_OCDS_SNAPSHOT"
    assert 90_000 <= proc_data["deduplicatedOcidCount"] < proc_data["releasesScanned"]
    assert proc_data["matchedCount"] > 0
    assert proc_data["totalAwardNaira"] > 0
    assert proc_data["totalDisbursedNaira"] > 0
    assert sqlite_path.exists()

    client = TestClient(app)
    res = client.get("/api/procurement/search?q=hospital&limit=10")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["totalMatches"] >= 1

    # FTS5 punctuation / injection immunity
    inj = client.get('/api/procurement/search?q="OR+NOT+*&limit=5')
    assert inj.status_code == 200


def test_bir_macro_integrity_guards_reconcile_2015_debt_and_flag_omissions():
    macro_rows = [
        {"label": "Domestic Debt Service", "budgetNaira": 894_610_000_000, "actualNaira": 996_800_000_000, "performancePct": 111.42},
        {"label": "Foreign Debt Service", "budgetNaira": 59_010_000_000, "actualNaira": 63_590_000_000, "performancePct": 107.76},
        {"label": "Debt Service / Recurrent Debt (Sub-Total)", "budgetNaira": 953_620_000_000, "actualNaira": 60_380_000_000, "performancePct": 6.33},
    ]
    guarded, warnings = apply_macro_integrity_guards(macro_rows, 2015, "Q4")
    sub = guarded[2]
    assert sub["actualNaira"] == 1_060_390_000_000
    assert sub["rawExtractedActualNaira"] == 60_380_000_000
    assert sub["derivedFromComponents"] is True
    assert abs(sub["performancePct"] - 111.2) < 0.05
    assert len(warnings) == 1
