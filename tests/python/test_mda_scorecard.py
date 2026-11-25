"""Unit & live-integrity tests for P3-S6 MDA Integrity Scorecard & Macro Credibility Builder."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from ingestion.indexers.mda_scorecard_builder import (
    DEFAULT_DATASETS_DIR,
    build_macro_credibility_tracker,
    build_mda_scorecards,
    compute_composite_score,
)


def _create_synthetic_ledger_db(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
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
            contract_award_naira REAL,
            total_paid_naira REAL,
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
    conn.execute(
        """
        CREATE TABLE govspend_payments (
            payment_no TEXT,
            payment_date TEXT,
            financial_year INTEGER,
            payer_code TEXT,
            organization_name TEXT,
            norm_mda TEXT,
            beneficiary_name TEXT,
            norm_beneficiary TEXT,
            amount_naira REAL,
            description TEXT
        )
        """
    )

    # 3 awarded contracts (National Competitive Bidding, equal split -> high open + diversification)
    # Plus 10 planning contracts via Emergency (MUST BE STRICTLY EXCLUDED!)
    awarded = [
        ("ocid-a1", 2023, "contract", "Road A", "FEDERAL MINISTRY OF TESTWORKS - HQTRS", "FEDERAL MINISTRY OF TESTWORKS", "0234", "ALPHA LTD", "ALPHA LTD", "", "", 100_000_000, 100_000_000, "2023-05-01", "National Competitive Bidding", "", "", "", 1.0, "x.json"),
        ("ocid-a2", 2023, "implementation", "Road B", "FEDERAL MINISTRY OF TESTWORKS", "FEDERAL MINISTRY OF TESTWORKS", "0234", "BETA LTD", "BETA LTD", "", "", 100_000_000, 100_000_000, "2023-06-01", "National Competitive Bidding", "", "", "", 1.0, "x.json"),
        ("ocid-a3", 2024, "award", "Road C", "FEDERAL MINISTRY OF TESTWORKS", "FEDERAL MINISTRY OF TESTWORKS", "0234", "GAMMA LTD", "GAMMA LTD", "", "", 100_000_000, 0, "2024-04-01", "National Competitive Bidding", "", "", "", 1.0, "x.json"),
    ]
    planning_noise = [
        (f"ocid-p{i}", 2024, "planning", "Unfunded Plan", "FEDERAL MINISTRY OF TESTWORKS", "FEDERAL MINISTRY OF TESTWORKS", "0234", "CAPTURE CO", "CAPTURE CO", "", "", 9_000_000_000, 0, "2024-01-01", "Emergency", "", "", "", 1.0, "x.json")
        for i in range(10)
    ]
    conn.executemany(
        "INSERT INTO nocopo_contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        awarded + planning_noise,
    )

    # 22 GovSpend vouchers in FY 2022 + partial 2026: clean evenly spread vs near-threshold
    gov_rows = []
    for m in range(1, 13):
        amt = 2_000_000 if m < 12 else 6_000_000  # Dec ratio = 3.0x vs monthly mean -> small penalty
        gov_rows.append(
            (f"P-2022-{m}-A", f"2022-{m:02d}-10", 2022, "0234", "FEDERAL MINISTRY OF TESTWORKS", "FEDERAL MINISTRY OF TESTWORKS", f"SUPPLIER {m} LTD", f"SUPPLIER {m} LTD", amt, "Routine")
        )
        gov_rows.append(
            (f"P-2022-{m}-B", f"2022-{m:02d}-15", 2022, "0234", "FEDERAL MINISTRY OF TESTWORKS", "FEDERAL MINISTRY OF TESTWORKS", f"SUPPLIER {m}B LTD", f"SUPPLIER {m}B LTD", amt, "Routine")
        )
    conn.executemany(
        "INSERT INTO govspend_payments VALUES (?,?,?,?,?,?,?,?,?,?)",
        gov_rows,
    )
    conn.commit()
    conn.close()


def test_compute_composite_score_omits_missing_from_denominator() -> None:
    pillars = {
        "paddingRestraint": {"score": 80.0, "weight": 20, "status": "SCORED"},
        "birCapitalExecution": {"score": None, "weight": 20, "status": "NO_SOURCE_COVERAGE"},
        "openBiddingShare": {"score": 100.0, "weight": 20, "status": "SCORED"},
        "vendorDiversification": {"score": None, "weight": 20, "status": "INSUFFICIENT_SAMPLE"},
        "cashDiscipline": {"score": 60.0, "weight": 20, "status": "SCORED"},
    }
    res = compute_composite_score(pillars)
    assert res["metricsPresent"] == 3
    assert res["activeWeightSum"] == 60
    # Mean of (80, 100, 60) = 80.0 — never treated as 48.0!
    assert res["compositeScore"] == 80.0
    assert res["grade"] == "A"


def test_synthetic_scorecards_and_macro_credibility_guards(tmp_path: Path) -> None:
    db_path = tmp_path / "ledger.sqlite"
    ds_dir = tmp_path / "datasets"
    diffs_dir = ds_dir / "bill_act_diffs"
    diffs_dir.mkdir(parents=True)

    _create_synthetic_ledger_db(db_path)

    # Bill vs Act diff with trailing hyphen MDA name
    (diffs_dir / "2023.json").write_text(
        json.dumps(
            {
                "financialYear": 2023,
                "items": [
                    {
                        "mdaName": "FEDERAL MINISTRY OF TESTWORKS -",
                        "status": "INSERTED_BY_NASS",
                        "proposedAmountNaira": 0,
                        "enactedAmountNaira": 200_000_000,
                        "deltaNaira": 200_000_000,
                    },
                    {
                        "mdaName": "FEDERAL MINISTRY OF TESTWORKS",
                        "status": "UNCHANGED",
                        "proposedAmountNaira": 800_000_000,
                        "enactedAmountNaira": 800_000_000,
                        "deltaNaira": 0,
                    },
                ],
                "topPaddedMdas": [],
            }
        ),
        encoding="utf-8",
    )

    # BIR execution with FY 2010 zero-appropriated guard + FY 2015 Debt Service Dom+For guard
    (ds_dir / "execution_tracker.json").write_text(
        json.dumps(
            {
                "years": [
                    {
                        "financialYear": 2010,
                        "status": "VERIFIED_BIR_SOURCE",
                        "quarterCovered": "Q2",
                        "overallReleasePct": 75.0,
                        "mdaBreakdown": [
                            {
                                "mdaName": "Testworks",
                                "appropriatedNaira": 0,
                                "releasedNaira": 100_000_000,
                                "utilizedNaira": 80_000_000,
                                "releasePct": 0.0,
                                "utilizationPct": 80.0,
                            }
                        ],
                        "macroRows": [
                            {"label": "Aggregate Federal Government Revenue / Total Inflow", "budgetNaira": 1000, "actualNaira": 800, "performancePct": 80.0},
                            {"label": "Domestic Debt Service", "budgetNaira": 200, "actualNaira": 150, "performancePct": 75.0},
                            {"label": "Foreign Debt Service", "budgetNaira": 100, "actualNaira": 120, "performancePct": 120.0},
                        ],
                    },
                    {
                        "financialYear": 2015,
                        "status": "VERIFIED_BIR_SOURCE",
                        "quarterCovered": "Q4",
                        "overallReleasePct": 80.0,
                        "mdaBreakdown": [],
                        "macroRows": [
                            {"label": "Aggregate Federal Government Revenue / Total Inflow", "budgetNaira": 3000, "actualNaira": 2400, "performancePct": 80.0},
                            {"label": "Domestic Debt Service", "budgetNaira": 894_610_000_000, "actualNaira": 996_800_000_000, "performancePct": 111.42},
                            {"label": "Foreign Debt Service", "budgetNaira": 59_010_000_000, "actualNaira": 63_590_000_000, "performancePct": 107.76},
                            # Corrupted OCR subtotal must be overridden cleanly by Dom + For
                            {"label": "Debt Service / Recurrent Debt (Sub-Total)", "budgetNaira": 953_620_000_000, "actualNaira": 60_380_000_000, "performancePct": 6.33},
                        ],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    (ds_dir / "policy_benchmarks.json").write_text(json.dumps({"macroBenchmarks": [], "documents": []}), encoding="utf-8")
    (ds_dir / "debt_profile.json").write_text(json.dumps({"yearlyDebt": []}), encoding="utf-8")

    sc_payload = build_mda_scorecards(fts_sqlite_path=db_path, datasets_dir=ds_dir, write=True)
    assert len(sc_payload["mdas"]) == 1
    row = sc_payload["mdas"][0]
    assert row["mdaKey"] == "TESTWORKS"
    # Planning Emergency contracts must be excluded -> openBiddingShare stays 100.0 (3/3 National Competitive Bidding)
    assert row["pillars"]["openBiddingShare"]["score"] == 100.0
    assert row["pillars"]["openBiddingShare"]["awardedCount"] == 3
    # Equal 100M x 3 vendors -> HHI = 1/3 -> (1 - 1/3)*100 = 66.7
    assert abs(row["pillars"]["vendorDiversification"]["score"] - 66.7) < 0.2
    # FY 2010 zero appropriatedNaira guarded: releasePct ignored, utilization 80.0 used directly
    assert row["pillars"]["birCapitalExecution"]["score"] == 80.0
    assert row["pillars"]["paddingRestraint"]["score"] == 80.0  # 200M / 1B = 20% padded -> 80.0

    mc_payload = build_macro_credibility_tracker(datasets_dir=ds_dir, write=True)
    y2015 = next(y for y in mc_payload["yearlySeries"] if y["financialYear"] == 2015)
    assert y2015["bir"]["debtServiceDerivedFromComponents"] is True
    assert y2015["bir"]["debtServicePerformancePct"] == 111.2
    assert y2015["bir"]["debtServiceOverrunFlag"] is True

    obj = next(a for a in mc_payload["administrations"] if a["presidentId"] == "obasanjo")
    assert obj["birCoverageStatus"] == "PRE_BIR_ERA_NO_SOURCE"
    assert obj["avgCapitalPerformancePct"] is None


def test_live_scorecards_and_macro_credibility_integrity() -> None:
    sc_path = DEFAULT_DATASETS_DIR / "mda_integrity_scorecards.json"
    mc_path = DEFAULT_DATASETS_DIR / "macro_credibility_tracker.json"
    assert sc_path.exists(), "Run mda_scorecard_builder before pytest"
    assert mc_path.exists(), "Run mda_scorecard_builder before pytest"
    assert sc_path.stat().st_size < 2_500_000
    assert mc_path.stat().st_size < 2_500_000

    sc = json.loads(sc_path.read_text(encoding="utf-8"))
    assert sc["headline"]["totalScoredMdas"] >= 100
    assert sc["headline"]["full5PillarCount"] >= 10
    assert sc["headline"]["planningContractsExcluded"] == 82140

    for entry in sc["mdas"]:
        recomputed = compute_composite_score(entry["pillars"])
        assert entry["metricsPresent"] == recomputed["metricsPresent"]
        assert entry["activeWeightSum"] == recomputed["activeWeightSum"]
        assert entry["compositeScore"] == recomputed["compositeScore"]

    mc = json.loads(mc_path.read_text(encoding="utf-8"))
    assert mc["headline"]["birYearsCount"] == 18
    by_yr = {r["financialYear"]: r for r in mc["yearlySeries"]}
    assert by_yr[2015]["bir"]["debtServiceDerivedFromComponents"] is True
    assert by_yr[2015]["bir"]["debtServicePerformancePct"] > 105.0
    assert by_yr[2009]["bir"]["debtServiceDerivedFromComponents"] is True
    assert by_yr[2020]["bir"]["revenuePerformancePct"] is None
    assert by_yr[2023]["bir"]["revenuePerformancePct"] == 107.6

    from ingestion.indexers.project_lifecycle_builder import classify_parent_ministry_families

    obj = next(a for a in mc["administrations"] if a["presidentId"] == "obasanjo")
    assert obj["birCoverageStatus"] == "PRE_BIR_ERA_NO_SOURCE"
    assert obj["avgCapitalPerformancePct"] is None
    assert obj["avgDebtServicePerformancePct"] is None

    # Live precision checks: ICPC must not inherit LABOUR; Youth & Sports must not match Housing Transportation
    by_key = {m["mdaKey"]: m for m in sc["mdas"]}
    for mda_entry in sc["mdas"]:
        up_name = mda_entry["mdaName"].upper()
        if "ICPC" in up_name or "INDEPENDENT CORRUPT PRACTICES" in up_name:
            assert "LABOUR" not in mda_entry["parentFamilies"]
            assert mda_entry["parentFamilies"] == ["ANTI_CORRUPTION"]
        if "YOUTH" in up_name and "SPORT" in up_name:
            bir_labels = mda_entry["pillars"]["birCapitalExecution"].get("matchedBirLabels") or []
            assert all("transport" not in lbl.lower() for lbl in bir_labels)
    assert "TRANSPORTATION" not in by_key or "YOUTH_SPORTS" not in by_key["TRANSPORTATION"]["parentFamilies"]


def test_parent_ministry_family_word_boundaries_prevent_false_links() -> None:
    from ingestion.indexers.project_lifecycle_builder import classify_parent_ministry_families

    assert classify_parent_ministry_families("INDEPENDENT CORRUPT PRACTICES AND RELATED OFFENCES COMMISSION") == [
        "ANTI_CORRUPTION"
    ]
    assert classify_parent_ministry_families("ECONOMIC AND FINANCIAL CRIMES COMMISSION (EFCC)") == [
        "ANTI_CORRUPTION"
    ]
    assert classify_parent_ministry_families("Housing Transportation") == ["HOUSING", "TRANSPORT"]
    assert classify_parent_ministry_families("FEDERAL MINISTRY OF TRANSPORTATION - HQTRS") == ["TRANSPORT"]
    assert classify_parent_ministry_families("FEDERAL MINISTRY OF YOUTH AND SPORTS DEVELOPMENT") == [
        "YOUTH_SPORTS"
    ]
    assert classify_parent_ministry_families("NATIONAL DIRECTORATE OF EMPLOYMENT (NDE)") == ["LABOUR"]
    assert "EDUCATION" not in classify_parent_ministry_families("NIGERIA ATOMIC NUCLEAR ENERGY COMMISSION")

