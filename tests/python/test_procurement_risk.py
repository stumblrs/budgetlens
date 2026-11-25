import json
import sqlite3
from pathlib import Path

from ingestion.indexers.procurement_risk_builder import (
    build_procurement_risk_index,
    classify_overrun_anomaly,
    classify_procurement_method,
    is_sandbox_or_test_procurement,
)


def _create_synthetic_risk_sqlite(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute(
            """
            CREATE TABLE nocopo_contracts (
                ocid TEXT,
                financial_year INTEGER,
                stage TEXT,
                title TEXT,
                mda_name TEXT,
                norm_mda TEXT,
                buyer_admin_code TEXT,
                contractor_name TEXT,
                norm_contractor TEXT,
                bpp_contractor_id TEXT,
                cac_rc_number TEXT,
                contract_award_naira INTEGER,
                total_paid_naira INTEGER,
                award_date TEXT,
                procurement_method TEXT,
                budget_record_id TEXT,
                project_code TEXT,
                match_type TEXT,
                confidence_score REAL,
                source_file TEXT
            )
            """
        )
        # 1. Planning-stage record with huge inflated payment/award -> MUST BE EXCLUDED
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-plan-1', 2024, 'planning', 'Master Plan Budget Ceiling',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Phantom Planner Ltd', 'PHANTOM PLANNER LTD', NULL, NULL,
                999000000000, 1000000000000, '', 'Emergency', '', 'ERGP1', '', 0.0, 'n.json'
            )
            """
        )
        # 2. Tender-stage record -> MUST BE EXCLUDED
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-tender-1', 2024, 'tender', 'Open Tender Lot A',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                '', '', NULL, NULL,
                500000000, 0, '', 'Direct Procurement', '', 'ERGP2', '', 0.0, 'n.json'
            )
            """
        )
        # 3. Awarded Non-Competitive + Overrun (award=100M, paid=250M -> +150M overrun)
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-ov-1', 2023, 'implementation', 'Emergency Bridge Deck Repair',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Emergency Fixers Ltd', 'EMERGENCY FIXERS LTD', 'BPP-CI-10', NULL,
                100000000, 250000000, '2023-05-01', 'Emergency', '', 'ERGP3', '', 0.0, 'n.json'
            )
            """
        )
        # 4. Awarded Competitive + Zero-Paid (award=400M, paid=0)
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-zp-1', 2024, 'award', 'Dualization of Regional Highway',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', '0521001001',
                'Stalled Builders Ltd', 'STALLED BUILDERS LTD', 'BPP-CI-20', NULL,
                400000000, 0, '2024-06-01', 'National Competitive Bidding', '', 'ERGP4', '', 0.0, 'n.json'
            )
            """
        )
        # 5. Awarded Non-Competitive + Normal Paid (award=200M, paid=200M)
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-nc-1', 2024, 'contract', 'Direct Procurement of Medical Scanners',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', '0521001001',
                'Sole Medics Nig Ltd', 'SOLE MEDICS NIG LTD', 'BPP-CI-30', NULL,
                200000000, 200000000, '2024-07-15', 'Direct Procurement', '', 'ERGP5', '', 0.0, 'n.json'
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_classify_procurement_method():
    assert classify_procurement_method("National Competitive Bidding") == "COMPETITIVE_OPEN"
    assert classify_procurement_method("International Competitive Bidding") == "COMPETITIVE_OPEN"
    assert classify_procurement_method("Emergency") == "NON_COMPETITIVE"
    assert classify_procurement_method("Selective Tendering") == "NON_COMPETITIVE"
    assert classify_procurement_method("Direct Procurement") == "NON_COMPETITIVE"
    assert classify_procurement_method("Repeat Procurement") == "NON_COMPETITIVE"
    assert classify_procurement_method("Sole Source") == "NON_COMPETITIVE"
    assert classify_procurement_method("Request for quotation") == "MINOR_QUOTATION"
    assert classify_procurement_method("") == "UNSPECIFIED"


def test_synthetic_procurement_risk_excludes_planning_and_flags_overruns(tmp_path: Path):
    db_path = tmp_path / "fts.sqlite"
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True)
    _create_synthetic_risk_sqlite(db_path)

    res = build_procurement_risk_index(
        fts_sqlite_path=db_path,
        datasets_dir=ds_dir,
        leaderboard_path=tmp_path / "missing_lb.json",
        write=True,
    )

    assert res["status"] == "VERIFIED_PROCUREMENT_RISK"
    h = res["headline"]
    assert h["planningExcludedCount"] == 2
    assert h["totalAwardedRows"] == 3
    assert h["totalAwardedNaira"] == 700_000_000
    assert h["totalPaidNaira"] == 450_000_000

    # Non-competitive = Emergency (100M) + Direct Procurement (200M) = 300M of 700M
    assert h["nonCompetitiveCount"] == 2
    assert h["nonCompetitiveAwardedNaira"] == 300_000_000
    assert h["overrunCount"] == 1
    assert h["overrunDeltaNaira"] == 150_000_000
    assert h["zeroPaidCount"] == 1
    assert h["zeroPaidAwardedNaira"] == 400_000_000

    assert len(res["topOverrunContracts"]) == 1
    assert res["topOverrunContracts"][0]["ocid"] == "ocds-ov-1"
    assert res["topOverrunContracts"][0]["overrunPct"] == 150.0
    assert len(res["topZeroPaidAwards"]) == 1
    assert res["topZeroPaidAwards"][0]["ocid"] == "ocds-zp-1"


def test_sandbox_and_kobo_shift_classifiers():
    assert is_sandbox_or_test_procurement("TEST MINISTRY - NOCOPO", "Ocean jetty") is True
    assert is_sandbox_or_test_procurement("Unspecified", "test", "ocds-998") is True
    assert is_sandbox_or_test_procurement("Federal Ministry", "SAMPLE", "ocds-1") is True
    assert is_sandbox_or_test_procurement("Federal Ministry", "Road Repair", "ocds-test-01") is True
    # Must NOT false-positive on valid MDA/titles containing 'TESTWORKS' or 'TESTING'
    assert is_sandbox_or_test_procurement("FEDERAL MINISTRY OF TESTWORKS", "Road A", "ocid-a1") is False
    assert (
        is_sandbox_or_test_procurement(
            "FEDERAL UNIVERSITY WUKARI",
            "CONTRACT FOR THE SUPPLY AND INSTALLATION TESTING AND COMMISSIONING OF LAB EQUIPMENT",
            "ocds-gyl66f-517021037-000201",
        )
        is False
    )

    assert classify_overrun_anomaly(200_000_000, 20_000_000_000)[0] == "KOBO_SHIFT_100X"
    assert classify_overrun_anomaly(18_600_000, 18_600_000_000)[0] == "DECIMAL_SHIFT_1000X"
    assert classify_overrun_anomaly(2_646, 26_460_000)[0] == "DECIMAL_SHIFT_10000X"
    assert classify_overrun_anomaly(48, 319_417_019)[0] == "UNIT_SCALE_MISMATCH"
    assert classify_overrun_anomaly(100_000_000, 250_000_000) is None
    assert classify_overrun_anomaly(47_196_561, 695_833_304) is None


def test_synthetic_quarantine_isolates_sandbox_and_kobo_shifts(tmp_path: Path):
    db_path = tmp_path / "quarantine.sqlite"
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True)
    _create_synthetic_risk_sqlite(db_path)

    conn = sqlite3.connect(str(db_path))
    try:
        # Sandbox test ministry row
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-sbx-1', 2023, 'implementation', 'Construction of ocean boat Jetty',
                'TEST MINISTRY - NOCOPO', 'TEST MINISTRY NOCOPO', '0090',
                'Test Vendor', 'TEST VENDOR', NULL, NULL,
                72000000000, 32000000000, '2023-01-01', 'Direct Procurement', '', '', '', 0.0, 'n.json'
            )
            """
        )
        # Placeholder 'test' title row (mimics 467.86B portal outlier)
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-sbx-2', 2020, 'implementation', 'test',
                '', '', '',
                '', '', NULL, NULL,
                28000000, 467891333331, '2020-02-01', 'Direct Procurement', '', '', '', 0.0, 'n.json'
            )
            """
        )
        # Exact 100x kobo shift
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-kobo-100', 2022, 'implementation', 'Supply of Vehicles',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234',
                'Real Motors Ltd', 'REAL MOTORS LTD', 'BPP-CI-88', NULL,
                200000000, 20000000000, '2022-05-01', 'National Competitive Bidding', '', '', '', 0.0, 'n.json'
            )
            """
        )
        # Exact 1,000x decimal shift
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-dec-1000', 2024, 'implementation', 'Engagement Advisory Services',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', '0521',
                'Clinic Advisors Ltd', 'CLINIC ADVISORS LTD', 'BPP-CI-89', NULL,
                18000000, 18000000000, '2024-03-01', 'Direct Procurement', '', '', '', 0.0, 'n.json'
            )
            """
        )
        conn.commit()
    finally:
        conn.close()

    res = build_procurement_risk_index(
        fts_sqlite_path=db_path,
        datasets_dir=ds_dir,
        leaderboard_path=tmp_path / "missing_lb.json",
        write=False,
    )
    h = res["headline"]
    assert h["excludedTestRecordsCount"] == 2
    assert h["koboShiftAnomalyCount"] == 2
    assert h["overrunCount"] == 1
    assert h["overrunDeltaNaira"] == 150_000_000
    assert [c["ocid"] for c in res["topOverrunContracts"]] == ["ocds-ov-1"]
    assert all("TEST" not in m["mdaName"].upper() for m in res["mdaRiskRanking"])

    anom_types = {a["ocid"]: a["anomalyType"] for a in res["portalDataEntryAnomalies"]}
    assert anom_types == {
        "ocds-sbx-1": "PORTAL_TEST_RECORD",
        "ocds-sbx-2": "PORTAL_TEST_RECORD",
        "ocds-kobo-100": "KOBO_SHIFT_100X",
        "ocds-dec-1000": "DECIMAL_SHIFT_1000X",
    }


def test_live_procurement_risk_artifact_integrity():
    out_path = Path("public/datasets/procurement_risk_index.json")
    assert out_path.exists()
    assert out_path.stat().st_size < 2_000_000
    data = json.loads(out_path.read_text(encoding="utf-8"))
    assert data["status"] == "VERIFIED_PROCUREMENT_RISK"
    h = data["headline"]
    assert h["totalAwardedRows"] > 15_000
    assert h["planningExcludedCount"] > 80_000
    assert h["nonCompetitiveCount"] > 5_000
    assert h["excludedTestRecordsCount"] >= 188
    assert h["koboShiftAnomalyCount"] >= 15
    assert 300 < h["overrunCount"] < 440
    assert 3_400 < h["zeroPaidCount"] <= 3_560
    assert len(data["mdaRiskRanking"]) == 40
    assert all("TEST" not in str(m.get("mdaName", "")).upper() for m in data["mdaRiskRanking"])
    assert len(data["topOverrunContracts"]) == 100
    assert all(c["ocid"] != "ocds-gyl66f-998768-000490" for c in data["topOverrunContracts"])
    assert len(data["topZeroPaidAwards"]) == 100
    assert len(data["portalDataEntryAnomalies"]) >= 15
