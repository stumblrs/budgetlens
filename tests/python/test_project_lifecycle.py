import json
import sqlite3
from pathlib import Path

from ingestion.indexers.project_lifecycle_builder import (
    build_project_lifecycle_index,
    classify_paid_on_paper,
    match_bir_mda,
    shard_bucket_for_key,
)


def _create_synthetic_sqlite(db_path: Path) -> None:
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

        # 1. Generic numeric code ('22020305') - must NEVER cross-link by project code
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-num', 2024, 'implementation', 'Printing of Treasury Books',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Wrong Numeric Vendor Ltd', 'WRONG NUMERIC VENDOR LTD', 'BPP-CI-99', NULL,
                50000000, 50000000, '2024-02-10', 'Direct Procurement', '', '22020305', '', 0.0, 'n.json'
            )
            """
        )
        # 2. Awarded & NOCOPO paid ('ERGP91001')
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-paid', 2024, 'implementation', 'Rehabilitation of Abuja Keffi Arterial Road',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Alpha Roadworks Nigeria Ltd', 'ALPHA ROADWORKS NIG LTD', 'BPP-CI-1', NULL,
                500000000, 320000000, '2024-03-15', 'National Competitive Bidding', 'P-2024-00001', 'ERGP91001', 'EXACT_ERGP_CODE', 1.0, 'n.json'
            )
            """
        )
        # 3. Planning-only ('ERGP91002') -> awarded=0, never Paid-on-Paper
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-plan', 2024, 'planning', 'Solar Boreholes Plan in Rural North',
                'FEDERAL MINISTRY OF WATER RESOURCES', 'FEDERAL MINISTRY OF WATER RESOURCES', '0252001001',
                '', '', NULL, NULL,
                900000000, 0, '', '', 'P-2024-00002', 'ERGP91002', 'EXACT_ERGP_CODE', 1.0, 'n.json'
            )
            """
        )
        # 4. Awarded N0 paid in NOCOPO, but contractor received MDA GovSpend payout ('ERGP91003') -> VENDOR_MDA_PAID
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-vmda', 2024, 'contract', 'Equipping of Teaching Hospital Diagnostic Wing',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', '0521001001',
                'Beta Diagnostics Ltd', 'BETA DIAGNOSTICS LTD', 'BPP-CI-3', NULL,
                250000000, 0, '2024-04-01', 'Selective Tendering', 'P-2024-00003', 'ERGP91003', 'EXACT_ERGP_CODE', 1.0, 'n.json'
            )
            """
        )
        # 5. Awarded unpaid with zero GovSpend ('ERGP91004') -> NONE
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-unpaid', 2024, 'award', 'Construction of Feeder Bridge in Gombe',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Unpaid Builders Co', 'UNPAID BUILDERS CO', 'BPP-CI-4', NULL,
                140000000, 0, '2024-05-12', 'National Competitive Bidding', 'P-2024-00004', 'ERGP91004', 'EXACT_ERGP_CODE', 1.0, 'n.json'
            )
            """
        )

        # Direct ERGP GovSpend payment (even with NO NOCOPO contract on P-2024-00005 / ERGP91005 -> DIRECT_PROJECT_PAID)
        conn.execute(
            """
            INSERT INTO govspend_payments VALUES (
                'PAY-ERGP-1', '2024-06-15', 2024, '0215001001',
                'FEDERAL COLLEGE OF HORTICULTURE, DADIN-KOWA', 'FEDERAL COLLEGE OF HORTICULTURE DADIN KOWA',
                'Direct Agri Supply Ltd', 'DIRECT AGRI SUPPLY LTD', 45000000,
                'ERGP91005: SUPPLY OF SEEDLINGS ACROSS SELECTED FARMING CLUSTERS'
            )
            """
        )
        # Same-MDA GovSpend payout for Beta Diagnostics Ltd (no ERGP tag)
        conn.execute(
            """
            INSERT INTO govspend_payments VALUES (
                'PAY-MDA-1', '2024-07-02', 2024, '0521001001',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH',
                'Beta Diagnostics Ltd', 'BETA DIAGNOSTICS LTD', 90000000,
                'PARTIAL SETTLEMENT FOR DIAGNOSTIC EQUIPMENT DELIVERY'
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_shard_bucket_vectors():
    expected = {
        "P-2025-00001": "27",
        "ERGP22101448": "09",
        "DIFF-2023-00100": "46",
        "ERGP21250280": "27",
        "MOBAN09501181": "05",
    }
    for key, bucket in expected.items():
        assert shard_bucket_for_key(key) == bucket
        assert shard_bucket_for_key(f"  {key.lower()}  ") == bucket


def test_classify_paid_on_paper_paths():
    assert classify_paid_on_paper(100, 1, 0, 0, 0, 0)[:2] == (True, "DIRECT_PROJECT_PAID")
    assert classify_paid_on_paper(0, 0, 50_000, 1, 0, 0)[:2] == (True, "DIRECT_PROJECT_PAID")
    assert classify_paid_on_paper(0, 1, 0, 0, 200_000, 2)[:2] == (True, "VENDOR_MDA_PAID")
    assert classify_paid_on_paper(0, 1, 0, 0, 0, 0)[:2] == (False, "NONE")
    # Planning-only (awarded=0) with MDA payouts must NOT flag Paid-on-Paper
    assert classify_paid_on_paper(0, 0, 0, 0, 500_000, 3)[:2] == (False, "NONE")


def test_synthetic_lifecycle_pipeline_all_guards(tmp_path: Path):
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True)
    sqlite_path = tmp_path / "fts.sqlite"
    _create_synthetic_sqlite(sqlite_path)

    policy_path = ds_dir / "policy_benchmarks.json"
    policy_path.write_text(
        json.dumps(
            {
                "documents": [
                    {
                        "slug": "2018-2020-mtef",
                        "title": "2018-2020 MTEF & FSP",
                        "docType": "MTEF_FSP",
                        "fiscalYearStart": 2018,
                        "fiscalYearEnd": 2020,
                        "sha256": "sha256:cover19",
                        "extractionStatus": "TEXT_INDEXED",
                    }
                ],
                "macroBenchmarks": [
                    {
                        "financialYear": 2024,
                        "sourcePage": 4,
                        "oilPriceUsdPerBbl": None,
                        "oilProductionMbpd": 1.2,
                        "exchangeRateNairaPerUsd": 400.0,
                        "gdpGrowthPct": None,
                        "inflationPct": None,
                        "docSlug": "consultative-presentation-2024",
                        "docTitle": "Consultative Presentation 2024",
                        "sha256": "sha256:pres",
                    },
                    {
                        "financialYear": 2024,
                        "sourcePage": 24,
                        "oilPriceUsdPerBbl": 77.96,
                        "oilProductionMbpd": 1.78,
                        "exchangeRateNairaPerUsd": 800.0,
                        "gdpGrowthPct": 3.88,
                        "inflationPct": 21.4,
                        "docSlug": "2024-2026-mtef-fsp",
                        "docTitle": "2024-2026 MTEF & FSP",
                        "sha256": "sha256:full24",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    exec_path = ds_dir / "execution_tracker.json"
    exec_path.write_text(
        json.dumps(
            {
                "years": [
                    {
                        "financialYear": 2010,
                        "status": "VERIFIED_BIR_SOURCE",
                        "quarterCovered": "Q2",
                        "reportPeriodLabel": "Q2 Half-Year YTD",
                        "reportTitle": "FY 2010 BIR",
                        "granularity": "COMBINED_MACRO_AND_MDA",
                        "overallReleasePct": 75.64,
                        "overallUtilizationPct": 32.83,
                        "mdaBreakdown": [
                            {
                                "mdaName": "Works",
                                "appropriatedNaira": 0,
                                "releasedNaira": 71_937_407_430,
                                "utilizedNaira": 28_750_947_858,
                                "releasePct": 0.0,
                                "utilizationPct": 39.97,
                                "overspendVirement": False,
                            }
                        ],
                    },
                    {
                        "financialYear": 2024,
                        "status": "VERIFIED_BIR_SOURCE",
                        "quarterCovered": "Q4",
                        "reportPeriodLabel": "Q4 Full-Year",
                        "reportTitle": "FY 2024 BIR",
                        "granularity": "COMBINED_MACRO_AND_MDA",
                        "overallReleasePct": 98.4,
                        "overallUtilizationPct": 88.53,
                        "mdaBreakdown": [
                            {
                                "mdaName": "Federal Ministry of Works",
                                "appropriatedNaira": 1000,
                                "releasedNaira": 950,
                                "utilizedNaira": 850,
                                "releasePct": 95.0,
                                "utilizationPct": 89.47,
                                "overspendVirement": False,
                            },
                            {
                                "mdaName": "Health",
                                "appropriatedNaira": 500,
                                "releasedNaira": 400,
                                "utilizedNaira": 360,
                                "releasePct": 80.0,
                                "utilizationPct": 90.0,
                                "overspendVirement": False,
                            },
                            {
                                "mdaName": "Agriculture",
                                "appropriatedNaira": 300,
                                "releasedNaira": 210,
                                "utilizedNaira": 190,
                                "releasePct": 70.0,
                                "utilizationPct": 90.48,
                                "overspendVirement": False,
                            },
                        ],
                    },
                    {
                        "financialYear": 2025,
                        "status": "VERIFIED_BIR_SOURCE",
                        "quarterCovered": "Q2",
                        "reportPeriodLabel": "Q2 Half-Year YTD",
                        "reportTitle": "FY 2025 BIR",
                        "granularity": "MACRO_FISCAL_PERFORMANCE",
                        "overallReleasePct": 60.49,
                        "overallUtilizationPct": None,
                        "mdaBreakdown": [],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    diffs_dir = ds_dir / "bill_act_diffs"
    diffs_dir.mkdir()
    (diffs_dir / "2024.json").write_text(
        json.dumps(
            {
                "financialYear": 2024,
                "items": [
                    {
                        "id": "DIFF-2024-001",
                        "financialYear": 2024,
                        "status": "NASS_INSERTION",
                        "matchConfidence": "INSERTED_NEW",
                        "isZonalIntervention": True,
                        "projectCode": "ERGP91001",
                        "projectName": "Rehabilitation of Abuja Keffi Arterial Road",
                        "mdaName": "FEDERAL MINISTRY OF WORKS",
                        "proposedAmountNaira": 0,
                        "enactedAmountNaira": 500_000_000,
                        "deltaNaira": 500_000_000,
                        "deltaPct": 100.0,
                        "billPage": None,
                        "actPage": 42,
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    y2024_dir = ds_dir / "2024"
    y2024_dir.mkdir()
    (y2024_dir / "projects.min.json").write_text(
        json.dumps(
            [
                {
                    "id": "P-2024-00001",
                    "projectCode": "ERGP91001",
                    "projectName": "Rehabilitation of Abuja Keffi Arterial Road",
                    "agency": "FEDERAL MINISTRY OF WORKS - HQTRS",
                    "amount": 500_000_000,
                    "page": 42,
                },
                {
                    "id": "P-2024-00002",
                    "projectCode": "ERGP91002",
                    "projectName": "Solar Boreholes Plan in Rural North",
                    "agency": "FEDERAL MINISTRY OF WATER RESOURCES",
                    "amount": 900_000_000,
                    "page": 55,
                },
                {
                    "id": "P-2024-00003",
                    "projectCode": "ERGP91003",
                    "projectName": "Equipping of Teaching Hospital Diagnostic Wing",
                    "agency": "UNIVERSITY TEACHING HOSPITAL IBADAN",
                    "amount": 250_000_000,
                    "page": 71,
                },
                {
                    "id": "P-2024-00004",
                    "projectCode": "ERGP91004",
                    "projectName": "Construction of Feeder Bridge in Gombe",
                    "agency": "FEDERAL MINISTRY OF WORKS",
                    "amount": 140_000_000,
                    "page": 88,
                },
                {
                    "id": "P-2024-00005",
                    "projectCode": "ERGP91005",
                    "projectName": "Supply of Seedlings Across Selected Farming Clusters",
                    "agency": "FEDERAL COLLEGE OF HORTICULTURE, DADIN-KOWA",
                    "amount": 45_000_000,
                    "page": 91,
                },
                {
                    "id": "P-2024-00006",
                    "projectCode": "22020305",
                    "projectName": "SECURITY BOOKS AND FORMS",
                    "agency": "FEDERAL MINISTRY OF WORKS",
                    "amount": 10_000_000,
                    "page": 12,
                },
            ]
        ),
        encoding="utf-8",
    )

    sweep_path = ds_dir / "forensic_sweep_1999_2026.json"
    sweep_path.write_text(
        json.dumps(
            {
                "pillars": {
                    "blankChecks": {
                        "items": [
                            {
                                "id": "P-2024-00001",
                                "financialYear": 2024,
                                "projectCode": "ERGP91001",
                                "projectName": "Rehabilitation of Abuja Keffi Arterial Road",
                                "agency": "FEDERAL MINISTRY OF WORKS - HQTRS",
                                "amount": 500_000_000,
                                "page": 42,
                            },
                            {
                                "id": "P-2024-00006",
                                "financialYear": 2024,
                                "projectCode": "22020305",
                                "projectName": "SECURITY BOOKS AND FORMS",
                                "agency": "FEDERAL MINISTRY OF WORKS",
                                "amount": 10_000_000,
                                "page": 12,
                            },
                        ]
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    res = build_project_lifecycle_index(
        datasets_dir=ds_dir,
        policy_path=policy_path,
        execution_path=exec_path,
        diffs_dir=diffs_dir,
        sweep_path=sweep_path,
        leaderboard_path=tmp_path / "missing_lb.json",
        fts_sqlite_path=sqlite_path,
        write=True,
    )

    assert res["status"] == "VERIFIED_PROJECT_LIFECYCLE"
    assert res["shardCount"] == 64

    # MTEF selection must pick full 2024-2026 MTEF & FSP over consultative slide, and NOT fabricate FY 2019
    assert res["mtefByYear"]["2024"]["docSlug"] == "2024-2026-mtef-fsp"
    assert res["mtefByYear"]["2024"]["oilPriceUsdPerBbl"] == 77.96
    assert res["mtefByYear"]["2019"]["status"] == "NO_MTEF_BENCHMARK"
    assert res["mtefByYear"]["2019"]["oilPriceUsdPerBbl"] is None
    assert res["mtefByYear"]["2019"]["coveringDocTitle"] == "2018-2020 MTEF & FSP"

    # BIR FY 2010 zero appropriation denominator must convert 0.0 -> None; FY 2025 macro-only -> NO_MDA_BREAKDOWN
    bir_2010 = match_bir_mda(res["birByYear"]["2010"], "FEDERAL MINISTRY OF WORKS")
    assert bir_2010["status"] == "MATCHED_MDA"
    assert bir_2010["releasePct"] is None
    bir_2025 = match_bir_mda(res["birByYear"]["2025"], "FEDERAL MINISTRY OF WORKS")
    assert bir_2025["status"] == "NO_MDA_BREAKDOWN"
    assert bir_2025["nationalOverallReleasePct"] == 60.49
    bir_1999 = match_bir_mda(res["birByYear"].get("1999"), "FEDERAL MINISTRY OF WORKS")
    assert bir_1999["status"] == "NO_BIR_REPORT"

    def _get_rec(rid: str) -> dict | None:
        p = ds_dir / "project_lifecycle" / f"{shard_bucket_for_key(rid)}.json"
        data = json.loads(p.read_text(encoding="utf-8"))
        return data["byRecordId"].get(rid.upper())

    r1 = _get_rec("P-2024-00001")
    assert r1 is not None
    assert r1["paidOnPaperPriority"] is True
    assert r1["paidOnPaperTier"] == "DIRECT_PROJECT_PAID"
    assert r1["billDiff"]["status"] == "NASS_INSERTION"
    assert r1["bir"]["releasePct"] == 95.0
    assert r1["nocopo"]["totalAwardedNaira"] == 500_000_000
    assert r1["nocopo"]["totalNocopoDisbursedNaira"] == 320_000_000

    # Planning-only must NEVER report awarded Naira or Paid-on-Paper
    r2 = _get_rec("P-2024-00002")
    assert r2 is not None
    assert r2["paidOnPaperPriority"] is False
    assert r2["nocopo"]["status"] == "PLANNING_OR_TENDER_ONLY"
    assert r2["nocopo"]["totalAwardedNaira"] == 0

    # Awarded + Vendor same-MDA GovSpend + parent-ministry Health match
    r3 = _get_rec("P-2024-00003")
    assert r3 is not None
    assert r3["paidOnPaperPriority"] is True
    assert r3["paidOnPaperTier"] == "VENDOR_MDA_PAID"
    assert r3["bir"]["matchType"] == "PARENT_MINISTRY_MDA"
    assert r3["bir"]["releasePct"] == 80.0
    assert r3["govspend"]["vendorMdaPaidNaira"] == 90_000_000

    # Awarded unpaid -> NONE
    r4 = _get_rec("P-2024-00004")
    assert r4 is not None
    assert r4["paidOnPaperPriority"] is False
    assert r4["paidOnPaperTier"] == "NONE"

    # Direct ERGP GovSpend payment without NOCOPO -> DIRECT_PROJECT_PAID + parent-ministry Agriculture match
    r5 = _get_rec("P-2024-00005")
    assert r5 is not None
    assert r5["paidOnPaperPriority"] is True
    assert r5["paidOnPaperTier"] == "DIRECT_PROJECT_PAID"
    assert r5["bir"]["matchedMdaName"] == "Agriculture"
    assert r5["govspend"]["directPaidNaira"] == 45_000_000

    # Numeric IPSAS code '22020305' must NOT match NOCOPO
    assert _get_rec("P-2024-00006") is None

    # Scrutiny badges check
    badges = res["scrutinyBadges"]
    assert badges["P-2024-00001"]["paidOnPaperPriority"] is True
    assert badges["P-2024-00006"]["paidOnPaperPriority"] is False
    assert badges["P-2024-00006"]["birReleasePct"] == 95.0


def test_live_project_lifecycle_artifacts_and_shards():
    index_path = Path("public/datasets/project_lifecycle_index.json")
    shards_dir = Path("public/datasets/project_lifecycle")
    assert index_path.exists()
    assert index_path.stat().st_size < 2_500_000

    index_data = json.loads(index_path.read_text(encoding="utf-8"))
    assert index_data["status"] == "VERIFIED_PROJECT_LIFECYCLE"
    assert index_data["shardCount"] == 64

    summary = index_data["summary"]
    assert summary["directProjectPaidCount"] > 0
    assert summary["directGovspendErgpCount"] > 0
    assert summary["nocopoAwardedCount"] > 0
    assert summary["birMdaMatchedCount"] > 0
    assert summary["mtefMatchedCount"] > 0
    assert summary["scrutinyBadgeCount"] > 0
    assert summary["scrutinyPaidOnPaperCount"] > 0

    for yr in ("2009", "2019", "2021", "2025", "2026"):
        assert index_data["birByYear"][yr]["mdaBreakdown"] == []

    shard_files = sorted(shards_dir.glob("*.json"))
    assert len(shard_files) == 64
    for sf in shard_files:
        assert sf.stat().st_size < 2_500_000
