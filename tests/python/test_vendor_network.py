import json
import re
import sqlite3
from pathlib import Path

from ingestion.indexers.vendor_network_builder import (
    build_vendor_network_index,
    classify_beneficiary_entity,
    compute_mda_hhi,
)


def _create_synthetic_network_sqlite(db_path: Path) -> None:
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

        # Planning-stage row -> MUST be excluded from HHI & captive pairs
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-plan', 2024, 'planning', 'Planned Mega Road', 'FEDERAL MINISTRY OF WORKS',
                'FEDERAL MINISTRY OF WORKS', '01', 'Planning Ghost Ltd', 'PLANNING GHOST LTD',
                NULL, NULL, 999000000000, 0, '', 'Open', '', '', '', 0.0, 'n.json'
            )
            """
        )
        # Captive pair: Alpha Builders Ltd wins 3 of 3 in Works (500M of 600M -> 83.3%) + Super-contractor across 5 MDAs
        for idx, mda in enumerate(
            (
                "FEDERAL MINISTRY OF WORKS",
                "FEDERAL MINISTRY OF WORKS",
                "FEDERAL MINISTRY OF WORKS",
                "FEDERAL MINISTRY OF HEALTH",
                "FEDERAL MINISTRY OF EDUCATION",
                "FEDERAL MINISTRY OF WATER RESOURCES",
                "FEDERAL MINISTRY OF AGRICULTURE",
            ),
            start=1,
        ):
            aw = 200_000_000 if mda == "FEDERAL MINISTRY OF WORKS" else 50_000_000
            conn.execute(
                """
                INSERT INTO nocopo_contracts VALUES (
                    ?, 2024, 'implementation', 'Civil Works Package', ?, ?, '01',
                    'Alpha Builders Nigeria Ltd', 'ALPHA BUILDERS NIG LTD', 'BPP-CI-1', NULL,
                    ?, 100000000, '2024-03-01', 'National Competitive Bidding', '', '', '', 0.0, 'n.json'
                )
                """,
                (f"ocds-a-{idx}", mda, mda, aw),
            )
        # Minor vendor in Works (100M) so Works total = 700M and Alpha share = 600/700 = 85.7%
        conn.execute(
            """
            INSERT INTO nocopo_contracts VALUES (
                'ocds-other', 2024, 'award', 'Other Works Lot', 'FEDERAL MINISTRY OF WORKS',
                'FEDERAL MINISTRY OF WORKS', '01', 'Minor Works Ltd', 'MINOR WORKS LTD',
                'BPP-CI-2', NULL, 100000000, 0, '2024-05-01', 'National Competitive Bidding', '', '', '', 0.0, 'n.json'
            )
            """
        )

        # GovSpend for Alpha Builders -> 1,500M paid vs 800M NOCOPO awarded (> 125% discrepancy)
        conn.execute(
            """
            INSERT INTO govspend_payments VALUES (
                'G-ALPHA-1', '2024-06-01', 2024, '01', 'FEDERAL MINISTRY OF WORKS',
                'FEDERAL MINISTRY OF WORKS', 'Alpha Builders Nigeria Ltd', 'ALPHA BUILDERS NIG LTD',
                1500000000, 'Milestone settlement'
            )
            """
        )
        # Off-NOCOPO Statutory/Payroll/Bank transfers (MUST NOT enter private corporate list)
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('G-IPPIS', '2024-06-02', 2024, '01', 'OAGF', 'OAGF', 'NEW IPPIS TRANSATION ACCOUNT', 'NEW IPPIS TRANSATION ACCOUNT', 5000000000, 'Monthly salary run')"
        )
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('G-FIRS', '2024-06-03', 2024, '01', 'OAGF', 'OAGF', 'FEDERAL INLAND REVENUE SERVICES', 'FEDERAL INLAND REVENUE SERVICES', 3000000000, 'VAT remittance')"
        )
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('G-NBET', '2024-06-04', 2024, '01', 'OAGF', 'OAGF', 'Nigerian Bulk Electricity Trading plc (NBET).', 'NIGERIAN BULK ELECTRICITY TRADING PLC NBET', 2000000000, 'Market remittance')"
        )
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('G-CBN', '2024-06-05', 2024, '01', 'OAGF', 'OAGF', 'Central Bank of Nigeria', 'CENTRAL BANK OF NIGERIA', 4000000000, 'CBN FX settlement')"
        )
        # Off-NOCOPO true Private Corporate Vendor
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('G-PRIV', '2024-06-06', 2024, '01', 'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', 'Shadow Supplies Limited', 'SHADOW SUPPLIES LTD', 2500000000, 'Direct Treasury transfer without OCDS contract')"
        )
        conn.commit()
    finally:
        conn.close()


def test_entity_taxonomy_never_mislabeled_institutional_as_private():
    institutional_cases = [
        "Central Bank of Nigeria",
        "CBN",
        "Office of the Accountant General of the Federation (OAGF)",
        "FEDERAL INLAND REVENUE SERVICES",
        "National Pension Commission",
        "IBTC Pension Managers",
        "IPPIS TRANSACTION ACCOUNT (",
        "NEW IPPIS TRANSATION ACCOUNT",
        "TSA SUB RECURRENT",
        "FEDERAL MINISTRY OF WORKS",
        "HQ NIGERIAN ARMY FINANCE CORPS",
        "Nigerian Bulk Electricity Trading plc (NBET).",
        "NDPHC ENERGY SALES PROCEED ACCOUNT",
        "Zenith Bank Plc",
        "First Bank of Nigeria Ltd",
        "Universal Basic Education Commission (UBEC).",
    ]
    for name in institutional_cases:
        cat = classify_beneficiary_entity(name)
        assert cat != "PRIVATE_CORPORATE", f"{name!r} misclassified as PRIVATE_CORPORATE ({cat})"

    private_cases = [
        "Julius Berger Nigeria Plc",
        "Dantata & Sawoe Construction Company Nigeria Ltd",
        "Egbin Power Plc",
        "Reynolds Construction Company (Nig) Ltd",
        "Apex Global Ventures",
        "Zaria Civil Builders Enterprises",
    ]
    for name in private_cases:
        assert classify_beneficiary_entity(name) == "PRIVATE_CORPORATE", f"{name!r} should be PRIVATE_CORPORATE"


def test_compute_mda_hhi_exact_math():
    assert compute_mda_hhi([100])[0] == 10000.0
    assert compute_mda_hhi([50, 50])[0] == 5000.0
    hhi, norm, band = compute_mda_hhi([25, 25, 25, 25])
    assert hhi == 2500.0
    assert norm == 0.25
    assert band == "HIGHLY_CONCENTRATED"
    assert compute_mda_hhi([10] * 10)[2] == "COMPETITIVE"


def test_synthetic_vendor_network_captures_and_discrepancies(tmp_path: Path):
    db_path = tmp_path / "fts.sqlite"
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True)
    _create_synthetic_network_sqlite(db_path)

    res = build_vendor_network_index(
        fts_sqlite_path=db_path,
        datasets_dir=ds_dir,
        leaderboard_path=tmp_path / "missing_lb.json",
        write=True,
    )

    assert res["status"] == "VERIFIED_VENDOR_NETWORK"
    assert len(res["captivePairs"]) == 1
    assert res["captivePairs"][0]["contractorName"] == "Alpha Builders Nigeria Ltd"
    assert res["captivePairs"][0]["shareOfMdaPct"] > 80.0

    assert len(res["multiMdaContractors"]) == 1
    assert res["multiMdaContractors"][0]["mdaCount"] == 5

    assert len(res["payoutDiscrepancies"]) == 1
    assert res["payoutDiscrepancies"][0]["excessNaira"] == 700_000_000

    priv_names = [v["beneficiaryName"] for v in res["offNocopoAudit"]["topOffNocopoPrivateVendors"]]
    assert priv_names == ["Shadow Supplies Limited"]
    assert res["headline"]["offNocopoPrivateCount"] == 1
    assert res["headline"]["offNocopoPrivatePaidNaira"] == 2_500_000_000


def test_live_vendor_network_artifact_and_hygiene():
    out_path = Path("public/datasets/vendor_network_index.json")
    assert out_path.exists()
    assert out_path.stat().st_size < 2_000_000
    raw_text = out_path.read_text(encoding="utf-8")
    assert "TEST MINISTRY - NOCOPO" not in raw_text
    assert "\u00c4\u00bb" not in raw_text
    data = json.loads(raw_text)
    assert data["status"] == "VERIFIED_VENDOR_NETWORK"
    h = data["headline"]
    assert h["captivePairCount"] >= 5
    assert h["multiMdaContractorCount"] >= 50
    assert h["overpaid125Count"] >= 2000
    assert len(data["mdaConcentration"]) > 0
    assert len(data["offNocopoAudit"]["topOffNocopoPrivateVendors"]) > 0
    assert len(data["bipartiteGraphs"]["captiveGraph"]["edges"]) > 0
    assert len(data["bipartiteGraphs"]["multiMdaGraph"]["edges"]) > 0

    forbidden_re = re.compile(
        r"\b(?:IPPIS|FIRS|PENCOM|CENTRAL BANK|FEDERAL MINISTRY|NDPHC|NBET|OAGF)\b"
    )
    for vendor in data["offNocopoAudit"]["topOffNocopoPrivateVendors"]:
        assert vendor["category"] == "PRIVATE_CORPORATE"
        up = vendor["beneficiaryName"].upper()
        assert not forbidden_re.search(up), (
            f"Institutional entity leaked into Private Vendors: {vendor['beneficiaryName']}"
        )
