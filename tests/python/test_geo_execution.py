"""Tests for P3-S7 Geo-Execution Layer (Budgeted vs. Contracted vs. Paid across 36 States + FCT)."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from ingestion.enrichers.geo_taxonomy import CANONICAL_STATES, GeoTaxonomy
from ingestion.indexers.geo_asset_indexer import DEFAULT_DATASETS_DIR, build_indexes


def test_ifo_and_short_token_false_positives_blocked() -> None:
    # 'ifo' ("in favour of"), 'edu' ("education"), 'owen' must NEVER trigger Ogun/Kwara/Edo falsely
    z, st, _ = GeoTaxonomy.detect_execution_location(
        "Being payment made ifo ABC Ventures Ltd iro edu workshop and owen conference allowance",
        "FEDERAL MINISTRY OF EDUCATION - HQTRS",
        source_kind="govspend",
    )
    assert st == "HQ / Federal Direct"
    assert z == "HQ / Direct Federal"

    # Real Ogun corridor match still works cleanly
    z2, st2, _ = GeoTaxonomy.detect_execution_location(
        "Rehabilitation of Ifo Local Government Road in Ogun State",
        "FEDERAL MINISTRY OF WORKS",
        source_kind="nocopo",
    )
    assert st2 == "Ogun"
    assert z2 == "South West"


def test_abuja_hq_vs_fct_local_infrastructure_isolation() -> None:
    # Hotel/DTA/workshop/HQ rent mentioning Abuja must isolate into HQ / Federal Direct
    _, st_hq, _ = GeoTaxonomy.detect_execution_location(
        "Air ticket and 7 days DTA for Abuja headquarters stakeholders workshop at Wuse Hotel",
        "FEDERAL MINISTRY OF HEALTH - HQTRS",
        source_kind="govspend",
    )
    assert st_hq == "HQ / Federal Direct"

    # Genuine FCT local council infrastructure still maps to Federal Capital Territory
    _, st_fct, _ = GeoTaxonomy.detect_execution_location(
        "Construction of Kuje - Gwagwalada Feeder Road in FCT",
        "FEDERAL CAPITAL TERRITORY ADMINISTRATION",
        source_kind="nocopo",
    )
    assert st_fct == "Federal Capital Territory"


def test_synthetic_budget_contracted_and_paid_layers(tmp_path: Path) -> None:
    ds_dir = tmp_path / "datasets"
    y_dir = ds_dir / "2023"
    y_dir.mkdir(parents=True)
    db_path = tmp_path / "ledger.sqlite"

    (y_dir / "projects.min.json").write_text(
        json.dumps(
            [
                {
                    "id": "P-2023-00010",
                    "projectCode": "ERGP5511001",
                    "projectName": "Construction of Solar Boreholes in Kano State",
                    "amount": 500_000_000,
                    "agency": "FEDERAL MINISTRY OF WATER RESOURCES",
                    "page": 45,
                    "sector": "Water",
                }
            ]
        ),
        encoding="utf-8",
    )

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE nocopo_contracts (
            ocid TEXT, financial_year INTEGER, stage TEXT, title TEXT, mda_name TEXT,
            contractor_name TEXT, contract_award_naira REAL, total_paid_naira REAL,
            budget_record_id TEXT, project_code TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE govspend_payments (
            payment_no TEXT, payment_date TEXT, financial_year INTEGER,
            organization_name TEXT, beneficiary_name TEXT, amount_naira REAL, description TEXT
        )
        """
    )
    conn.executemany(
        "INSERT INTO nocopo_contracts VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
            # Vague title linked to Kano budget record -> must resolve to Kano via linked ERGP/record
            ("ocds-a1", 2023, "contract", "LOT 2 DRILLING WORKS", "WATER RESOURCES", "KANO DRILLERS LTD", 300_000_000, 150_000_000, "P-2023-00010", "ERGP5511001"),
            # Generic HQ award -> isolated to HQ / Federal Direct
            ("ocds-a2", 2023, "award", "Supply of Abuja HQ Secretariat Generators", "OSGF", "ABUJA TECH LTD", 200_000_000, 200_000_000, "", ""),
            # Planning stage MUST be excluded
            ("ocds-p1", 2023, "planning", "Proposed Bridge in Lagos State", "WORKS", "", 9_000_000_000, 0, "", ""),
        ],
    )
    conn.executemany(
        "INSERT INTO govspend_payments VALUES (?,?,?,?,?,?,?)",
        [
            ("G-1", "2023-08-15", 2023, "WORKS", "ROADS CO", 120_000_000, "Part payment iro rehabilitation of Enugu - Nsukka road in Enugu State"),
            ("G-2", "2023-09-01", 2023, "HEALTH - HQTRS", "TRAVEL CO", 80_000_000, "Being payment made ifo Travel Co for DTA & workshop in Abuja"),
        ],
    )
    conn.commit()
    conn.close()

    _, geo = build_indexes(datasets_root=ds_dir, fts_sqlite_path=db_path)
    es = geo["executionSummary"]
    assert es["nocopoPlanningExcludedCount"] == 1
    assert es["nocopoTotalAwardedCount"] == 2
    assert es["nocopoGeoMatchedCount"] == 1
    assert es["nocopoGeoMatchedPct"] == 60.0
    assert es["nocopoHqNationwideNaira"] == 200_000_000

    assert es["govspendTotalVoucherCount"] == 2
    assert es["govspendGeoMatchedCount"] == 1
    assert es["govspendGeoMatchedNaira"] == 120_000_000
    assert es["govspendHqNationwideNaira"] == 80_000_000
    # Ogun must NOT be matched via "ifo"
    assert es["cumulativeByState"]["Ogun"]["govspendDisbursedNaira"] == 0
    assert es["cumulativeByState"]["Enugu"]["govspendDisbursedNaira"] == 120_000_000
    assert geo["years"]["2023"]["states"]["Kano"]["contractedNaira"] == 300_000_000


def test_live_geo_intelligence_execution_layers() -> None:
    gp = DEFAULT_DATASETS_DIR / "geo_intelligence_index.json"
    assert gp.exists(), "Run geo_asset_indexer before running live tests"
    data = json.loads(gp.read_text(encoding="utf-8"))
    assert "executionSummary" in data
    es = data["executionSummary"]

    assert es["nocopoPlanningExcludedCount"] == 82140
    assert es["nocopoTotalAwardedCount"] == 16726
    assert 0.0 < es["nocopoGeoMatchedPct"] <= 100.0
    assert 0.0 < es["govspendGeoMatchedPct"] <= 100.0
    assert es["govspendHqNationwideNaira"] > 10_000_000_000_000
    # Verify Ogun GovSpend false-positive (previously N5.09T from "ifo") is eliminated (< N1.5T)
    assert es["cumulativeByState"]["Ogun"]["govspendDisbursedNaira"] < 1_500_000_000_000
    assert len(es["cumulativeByState"]) == len(CANONICAL_STATES) == 37
