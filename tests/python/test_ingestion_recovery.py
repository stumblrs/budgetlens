import json
from pathlib import Path

from ingestion.cli import compute_forensic_priority, is_rollup_skip
from ingestion.indexers.coverage_audit import classify_coverage_tier
from ingestion.indexers.db_builder import DbBuilder
from ingestion.parsers.pdf_parser import PdfParser, classify_ipsas_record


def test_clean_amount_handles_broken_decimals_and_multicolumns():
    # Previously crashed with ValueError: invalid literal for int() with base 10: '1.021'
    assert PdfParser._clean_amount("1. 021", 2015) == 0
    # Multi-column spaced-thousands should pick rightmost column instead of concatenating >10T
    assert PdfParser._clean_amount("  3 193 239 879        630 900 000 ", 2011) == 630_900_000


def test_classify_ipsas_record_skips_total_colon_rollups():
    valid, stype = classify_ipsas_record("ERGP100", "TOTAL: FEDERAL MINISTRY OF TRANSPORT", 42_000_000_000, 2009)
    assert valid is False
    assert stype == "SUMMARY_ROLLUP"


def test_db_builder_emits_none_instead_of_empty_overlay_for_unenriched_rows():
    builder = DbBuilder()
    sample_projects = [
        {
            "id": "P-2026-00001",
            "projectCode": "ERGP1",
            "projectName": "Construction of Solar Borehole in Kano",
            "amount": 100_000_000,
            "page": 10,
            "agency": "Ministry of Water Resources",
            "assetTokens": [],
        },
        {
            "id": "P-2026-00002",
            "projectCode": "ERGP2",
            "projectName": "Supply of Ambulances to General Hospital",
            "amount": 250_000_000,
            "page": 12,
            "agency": "Ministry of Health",
            "assetTokens": [],
        },
    ]
    reviews = {
        "P-2026-00002": {
            "recordId": "P-2026-00002",
            "gemmaModelVersion": "gemma-4-E2B",
            "location": {"state": "FCT", "lga": "AMAC", "geopoliticalZone": "North Central"},
        }
    }
    records = builder._build_records(2026, sample_projects, ["test.pdf"], reviews)
    assert records[0]["gemmaAnalyticalOverlay"] is None
    assert records[1]["gemmaAnalyticalOverlay"]["gemmaModelVersion"] == "gemma-4-E2B"


def test_coverage_audit_classifier():
    assert classify_coverage_tier(188, 99.0) == "SUMMARY_ACT_ONLY"
    assert classify_coverage_tier(1800, 18.5) == "PARTIAL_SCHEDULE"
    assert classify_coverage_tier(10008, 75.0) == "FULL_SCHEDULE"
    assert classify_coverage_tier(58300, 87.0) == "FULL_SCHEDULE"


def test_forensic_priority_queue_ranks_anomalies_above_routine_overhead():
    suv_capital = {
        "projectName": "Procurement of 10 Nos Prado SUVs for Official Secretariat Operations",
        "amount": 600_000_000,
        "spendingType": "CAPITAL",
    }
    routine_phone = {
        "projectName": "TELEPHONE CHARGES",
        "amount": 5_000_000,
        "spendingType": "OVERHEAD",
    }
    assert compute_forensic_priority(suv_capital) > compute_forensic_priority(routine_phone)
    assert is_rollup_skip({"projectName": "TOTAL: FEDERAL MINISTRY OF TRANSPORT", "projectCode": "P1"}) is True
    assert is_rollup_skip({"projectName": "Ministry Summary", "projectCode": "0215001001"}) is True


def test_registry_has_complete_sha256_coverage_tiers_and_preserved_gemma_stream():
    reg_path = Path("public/datasets/registry.json")
    data = json.loads(reg_path.read_text(encoding="utf-8"))
    docs = data.get("documents", [])
    assert len(docs) == 28
    empty_sha = [d["financial_year"] for d in docs if not str(d.get("sha256") or "").strip()]
    assert empty_sha == []
    valid_tiers = {"FULL_SCHEDULE", "PARTIAL_SCHEDULE", "SUMMARY_ACT_ONLY"}
    assert all(d.get("coverage_tier") in valid_tiers for d in docs)
    total_gemma = sum(int(d.get("gemma_enriched_count") or 0) for d in docs)
    assert total_gemma >= 1065


def test_live_coverage_audit_explains_over_100_pct_years():
    cov_path = Path("public/datasets/coverage_audit.json")
    assert cov_path.exists()
    cov = json.loads(cov_path.read_text(encoding="utf-8"))
    over_years = {r["financial_year"]: r for r in cov.get("over_100_pct_years", [])}
    for yr in (1999, 2018, 2019, 2025):
        assert yr in over_years
        row = cov["years"][str(yr)]
        assert row["over_100_pct_flag"] is True
        assert row["extracted_breakdown_note"]
        assert isinstance(row["non_rollup_ratio_pct"], float)
        assert row["source_files_count"] >= 2
