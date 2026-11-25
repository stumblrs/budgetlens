import json
import sqlite3
from pathlib import Path

from ingestion.indexers.follow_the_money_builder import (
    build_follow_the_money_links,
    is_unique_project_code,
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

        # 1. Generic IPSAS economic code collision guard ('22020305') - must NOT exact match
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-1', 2022, 'implementation', 'Printing of Security Forms',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Wrong Economic Code Printer Ltd', 'WRONG ECONOMIC CODE PRINTER LTD', 'BPP-CI-1', NULL,
                50000000, 50000000, '2022-05-01', 'National Competitive Bidding', '', '22020305', '', 0.0, 'n.json'
            )
            """
        )
        # 2. Unique ERGP exact match ('ERGP90001') awarded + paid
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-2', 2022, 'implementation', 'Construction of Bridge in Katsina',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Zenith Civil Works Limited', 'ZENITH CIVIL WORKS LTD', 'BPP-CI-2', NULL,
                400000000, 250000000, '2022-06-01', 'Direct Procurement', '', 'ERGP90001', '', 0.0, 'n.json'
            )
            """
        )
        # 3. Planning-only ERGP ('ERGP90002') -> must not inflate awarded Naira
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-3', 2022, 'planning', 'Solar Boreholes Across Rural Communities',
                'FEDERAL MINISTRY OF WATER RESOURCES', 'FEDERAL MINISTRY OF WATER RESOURCES', '0252001001',
                '', '', NULL, NULL,
                999000000, 0, '', '', '', 'ERGP90002', '', 0.0, 'n.json'
            )
            """
        )
        # 4. Multi-contractor switched repeat lineage ('ERGP90003')
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-4', 2021, 'implementation', 'Upgrading of Regional Trauma Clinic Zaria',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', '0521001001',
                'Alpha Builders Ltd', 'ALPHA BUILDERS LTD', 'BPP-CI-4', NULL,
                120000000, 120000000, '2021-04-01', 'National Competitive Bidding', '', 'ERGP90003', '', 0.0, 'n.json'
            )
            """
        )
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-5', 2022, 'contract', 'Upgrading of Regional Trauma Clinic Zaria Phase II',
                'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', '0521001001',
                'Beta Medics Nigeria Ltd', 'BETA MEDICS NIG LTD', 'BPP-CI-5', NULL,
                180000000, 0, '2022-08-01', 'Selective Tendering', '', 'ERGP90003', '', 0.0, 'n.json'
            )
            """
        )
        # 5. Awarded unpaid lineage ('ERGP90004')
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-6', 2022, 'award', 'Dualization of Makurdi Otukpo Express Carriageway',
                'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Delta Highways Ltd', 'DELTA HIGHWAYS LTD', 'BPP-CI-6', NULL,
                800000000, 0, '2022-09-01', 'National Competitive Bidding', '', 'ERGP90004', '', 0.0, 'n.json'
            )
            """
        )
        # 6. Distinctive fuzzy MDA+title contract (diff year 2022, contract year 2023)
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-7', 2023, 'implementation', 'Rehabilitation of Gboko Katsina Ala Federal Highway Benue Corridor',
                'FEDERAL MINISTRY OF WORKS - HQTRS', 'FEDERAL MINISTRY OF WORKS', '0234001001',
                'Katsina Ala Roads Ltd', 'KATSINA ALA ROADS LTD', 'BPP-CI-7', NULL,
                600000000, 300000000, '2023-03-10', 'Emergency', '', 'ERGP99999', '', 0.0, 'n.json'
            )
            """
        )

        # GovSpend voucher matching Zenith Civil Works Ltd under Works
        conn.execute(
            """
            INSERT INTO govspend_payments VALUES (
                'PAY-1', '2022-07-15', 2022, '0234001001', 'FEDERAL MINISTRY OF WORKS - HQTRS',
                'FEDERAL MINISTRY OF WORKS', 'Zenith Civil Works Limited', 'ZENITH CIVIL WORKS LTD',
                175000000, 'Part payment for Bridge ERGP90001'
            )
            """
        )
        conn.commit()
    finally:
        conn.close()


def test_is_unique_project_code_rejects_bare_numeric_economic_codes():
    assert is_unique_project_code("22020305") == ""
    assert is_unique_project_code("0238005002") == ""
    assert is_unique_project_code("ERGP22101448") == "ERGP22101448"
    assert is_unique_project_code("MOBAN09501181") == "MOBAN09501181"


def test_build_follow_the_money_links_synthetic_rules_and_classifications(tmp_path: Path):
    diffs_dir = tmp_path / "bill_act_diffs"
    diffs_dir.mkdir(parents=True)
    lineages_path = tmp_path / "recurring_lineages.json"
    sqlite_path = tmp_path / "ext.sqlite"
    ds_dir = tmp_path / "datasets"
    _create_synthetic_sqlite(sqlite_path)

    (diffs_dir / "2022.json").write_text(
        json.dumps(
            {
                "financialYear": 2022,
                "items": [
                    {
                        "id": "D-ECON",
                        "financialYear": 2022,
                        "status": "ALLOCATION_INFLATED",
                        "projectCode": "22020305",
                        "projectName": "SERVICE WIDE VOTE",
                        "mdaName": "FEDERAL MINISTRY OF WORKS",
                    },
                    {
                        "id": "D-ERGP",
                        "financialYear": 2022,
                        "status": "NASS_INSERTION",
                        "projectCode": "ERGP90001",
                        "projectName": "Construction of Bridge in Katsina",
                        "mdaName": "FEDERAL MINISTRY OF WORKS",
                    },
                    {
                        "id": "D-PLAN",
                        "financialYear": 2022,
                        "status": "NASS_INSERTION",
                        "projectCode": "ERGP90002",
                        "projectName": "Solar Boreholes Across Rural Communities",
                        "mdaName": "FEDERAL MINISTRY OF WATER RESOURCES",
                    },
                    {
                        "id": "D-FUZZY",
                        "financialYear": 2022,
                        "status": "ALLOCATION_INFLATED",
                        "projectCode": "23020114",
                        "projectName": "Rehabilitation of Gboko Katsina Ala Federal Highway Benue Corridor",
                        "mdaName": "FEDERAL MINISTRY OF WORKS",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    lineages_path.write_text(
        json.dumps(
            {
                "totalLineages": 5,
                "lineages": [
                    {
                        "lineage_id": "LIN-SWITCH",
                        "project_code": "ERGP90003",
                        "canonical_title": "Upgrading of Regional Trauma Clinic Zaria",
                        "agency": "FEDERAL MINISTRY OF HEALTH",
                        "years_appeared": [2021, 2022],
                        "instances": [],
                    },
                    {
                        "lineage_id": "LIN-ACTIVE",
                        "project_code": "ERGP90001",
                        "canonical_title": "Construction of Bridge in Katsina",
                        "agency": "FEDERAL MINISTRY OF WORKS",
                        "years_appeared": [2021, 2022],
                        "instances": [],
                    },
                    {
                        "lineage_id": "LIN-UNPAID",
                        "project_code": "ERGP90004",
                        "canonical_title": "Dualization of Makurdi Otukpo Express Carriageway",
                        "agency": "FEDERAL MINISTRY OF WORKS",
                        "years_appeared": [2022, 2023],
                        "instances": [],
                    },
                    {
                        "lineage_id": "LIN-PLANNED",
                        "project_code": "ERGP90002",
                        "canonical_title": "Solar Boreholes Across Rural Communities",
                        "agency": "FEDERAL MINISTRY OF WATER RESOURCES",
                        "years_appeared": [2022, 2023],
                        "instances": [],
                    },
                    {
                        "lineage_id": "LIN-BOILER",
                        "project_code": "22020305",
                        "canonical_title": "SERVICE WIDE VOTE",
                        "agency": "FEDERAL MINISTRY OF WORKS",
                        "years_appeared": [2021, 2022, 2023],
                        "instances": [],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    res = build_follow_the_money_links(
        diffs_dir=diffs_dir,
        lineages_path=lineages_path,
        fts_sqlite_path=sqlite_path,
        leaderboard_path=tmp_path / "missing_lb.json",
        datasets_dir=ds_dir,
        write=True,
    )

    assert res["status"] == "VERIFIED_FOLLOW_THE_MONEY"
    dlinks = res["diffLinksById"]
    # Generic numeric code + boilerplate title must NEVER match
    assert "D-ECON" not in dlinks
    # Unique ERGP match + GovSpend MDA receipt + non-competitive count
    assert dlinks["D-ERGP"]["executionStatus"] == "CONTRACTED_AND_DISBURSED"
    assert dlinks["D-ERGP"]["matchMethod"] == "EXACT_PROJECT_CODE"
    assert dlinks["D-ERGP"]["totalAwardedNaira"] == 400_000_000
    assert dlinks["D-ERGP"]["matchedMdaGovspendPaidNaira"] == 175_000_000
    assert dlinks["D-ERGP"]["nonCompetitiveCount"] == 1
    # Planning-only must never report awarded Naira
    assert dlinks["D-PLAN"]["executionStatus"] == "PLANNED_TENDER_ONLY"
    assert dlinks["D-PLAN"]["totalAwardedNaira"] == 0
    # High-confidence fuzzy MDA+Title fallback
    assert dlinks["D-FUZZY"]["matchMethod"] == "FUZZY_MDA_TITLE"
    assert dlinks["D-FUZZY"]["confidenceScore"] >= 0.78
    assert dlinks["D-FUZZY"]["nonCompetitiveCount"] == 1

    llinks = res["lineageLinksById"]
    assert llinks["LIN-SWITCH"]["classification"] == "VENDOR_SWITCHED_REPEAT"
    assert llinks["LIN-SWITCH"]["distinctContractorCount"] == 2
    assert llinks["LIN-ACTIVE"]["classification"] == "ACTIVE_PHASED_BUILD"
    assert llinks["LIN-UNPAID"]["classification"] == "AWARDED_UNPAID"
    assert llinks["LIN-PLANNED"]["classification"] == "PLANNED_ONLY_REPEAT"
    assert llinks["LIN-PLANNED"]["totalAwardedNaira"] == 0
    assert "LIN-BOILER" not in llinks
    assert res["summary"]["lineageClassificationCounts"]["BUDGET_ONLY_REPEAT"] == 1


def test_live_follow_the_money_artifact_integrity():
    out_path = Path("public/datasets/follow_the_money_links.json")
    assert out_path.exists()
    assert out_path.stat().st_size < 2_500_000
    data = json.loads(out_path.read_text(encoding="utf-8"))
    assert data["status"] == "VERIFIED_FOLLOW_THE_MONEY"
    summary = data["summary"]
    assert summary["lineagesScanned"] == 3500
    assert sum(summary["lineageClassificationCounts"].values()) == 3500
    assert summary["diffMatchedAwardedCount"] > 0
    assert summary["lineageClassificationCounts"]["VENDOR_SWITCHED_REPEAT"] >= 1
