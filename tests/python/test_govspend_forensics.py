import json
import sqlite3
from pathlib import Path

from ingestion.indexers.govspend_forensics_builder import (
    build_govspend_forensics,
    extract_leading_two_digits,
    is_abbreviated_payroll_description,
    is_payroll_or_statutory_voucher,
)


def _create_synthetic_govspend_sqlite(db_path: Path) -> None:
    conn = sqlite3.connect(str(db_path))
    try:
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

        # Partial year 2018 (only Sep-Dec -> must be flagged isPartialYear=True, ratio=None)
        for idx, mo in enumerate(("09", "10", "11", "12"), start=1):
            conn.execute(
                "INSERT INTO govspend_payments VALUES (?, ?, 2018, '01', 'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', 'Vendor A Ltd', 'VENDOR A LTD', ?, 'Partial year payment')",
                (f"P18-{idx}", f"2018-{mo}-15", 10_000_000),
            )

        # Complete year 2023 (Jan-Nov 10M/mo = 110M, Dec 40M -> rush ratio = 4.0x)
        for m in range(1, 12):
            conn.execute(
                "INSERT INTO govspend_payments VALUES (?, ?, 2023, '01', 'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', 'Monthly Vendor Ltd', 'MONTHLY VENDOR LTD', ?, 'Monthly milestone')",
                (f"P23-{m}", f"2023-{m:02d}-10", 10_000_000),
            )
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('P23-12', '2023-12-20', 2023, '01', 'FEDERAL MINISTRY OF WORKS', 'FEDERAL MINISTRY OF WORKS', 'Monthly Vendor Ltd', 'MONTHLY VENDOR LTD', 40000000, 'December surge')"
        )

        # Near-threshold cluster beneath ₦10M ([9M, 10M)) + rolling 7-day 3-voucher split cluster
        for k in range(3):
            conn.execute(
                "INSERT INTO govspend_payments VALUES (?, ?, 2024, '02', 'FEDERAL MINISTRY OF HEALTH', 'FEDERAL MINISTRY OF HEALTH', 'Split Clinic Supplies Ltd', 'SPLIT CLINIC SUPPLIES LTD', ?, 'Medical supplies batch')",
                (f"P24-S{k}", f"2024-05-{10 + k * 2:02d}", 9_850_000),
            )

        # Small MDA (< 500 vouchers) with skewed digit 9 -> MUST NOT appear in topFlaggedMdas
        for k in range(40):
            conn.execute(
                "INSERT INTO govspend_payments VALUES (?, '2024-06-01', 2024, '03', 'SMALL AGENCY', 'SMALL AGENCY', 'Tiny Vendor', 'TINY VENDOR', 9900000, 'Small sample')",
                (f"PS-{k}",),
            )

        # Large MDA (>= 500 vouchers) -> MUST appear in topFlaggedMdas
        for k in range(520):
            conn.execute(
                "INSERT INTO govspend_payments VALUES (?, '2024-07-01', 2024, '04', 'HIGH VOLUME MDA', 'HIGH VOLUME MDA', 'Volume Vendor', 'VOLUME VENDOR', ?, 'Batch payment')",
                (f"PL-{k}", 9_500_000 + (k * 100)),
            )

        conn.commit()
    finally:
        conn.close()


def test_extract_leading_two_digits():
    assert extract_leading_two_digits(9_850_000) == 98
    assert extract_leading_two_digits(123_456) == 12
    assert extract_leading_two_digits(50_000) == 50
    assert extract_leading_two_digits(0) is None
    assert extract_leading_two_digits(-100) is None


def test_synthetic_govspend_forensics_controls_and_splits(tmp_path: Path):
    db_path = tmp_path / "fts.sqlite"
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True)
    _create_synthetic_govspend_sqlite(db_path)

    res = build_govspend_forensics(
        fts_sqlite_path=db_path,
        datasets_dir=ds_dir,
        min_mda_benford_n=500,
        write=True,
    )

    assert res["status"] == "VERIFIED_GOVSPEND_FORENSICS"
    yr_map = {y["financialYear"]: y for y in res["decemberRush"]["yearlyRush"]}
    assert yr_map[2018]["isPartialYear"] is True
    assert yr_map[2018]["decemberRushRatio"] is None
    assert yr_map[2023]["isPartialYear"] is False
    assert yr_map[2023]["decemberRushRatio"] == 4.0

    # Near-threshold ₦10M band ([9M, 10M)) captures P24-S0..2 + 40 small + 520 large + 2018/2023? (Wait: 10M is >= 10M so excluded from <10M)
    tiers_by_lbl = {t["tierLabel"]: t for t in res["thresholdSplitting"]["tiers"]}
    assert tiers_by_lbl["₦10M"]["voucherCount"] == 3 + 40 + 520

    # Rolling 7-day split cluster detected for Split Clinic Supplies Ltd (3 vouchers over 4 days)
    splits = res["thresholdSplitting"]["topRolling7DayClusters"]
    assert any(
        c["beneficiaryName"] == "Split Clinic Supplies Ltd" and c["voucherCount"] == 3
        for c in splits
    )

    # Small MDA (< 500) excluded from Benford MDA alerts; HIGH VOLUME MDA (>= 500) included
    flagged_names = {m["organizationName"] for m in res["benfordCash"]["topFlaggedMdas"]}
    assert "SMALL AGENCY" not in flagged_names
    assert "HIGH VOLUME MDA" in flagged_names


def test_payroll_and_abbreviated_description_classifiers():
    for code in ("MAY 19 SAL", "SEP 19 SAL", "OCT SAL 18", "FEB 2024 PE", "Jul 24 NRA", "Non Regular"):
        assert is_abbreviated_payroll_description(code) is True, f"Expected abbreviated payroll: {code!r}"
    for non_payroll_short in ("None", "43788", "0", "", "OPERATIONS", "Capital", "COVERT OPS", "CONSUMEABLE"):
        assert is_abbreviated_payroll_description(non_payroll_short) is False, f"Unexpected payroll match: {non_payroll_short!r}"

    assert is_payroll_or_statutory_voucher("IPPIS TRANSACTION ACCOUNT", "OCT 2024 Salary") is True
    assert is_payroll_or_statutory_voucher("NEW IPPIS TRANSATION ACCOUNT", "APRIL 2026 SAL") is True
    assert is_payroll_or_statutory_voucher("HQ NIGERIAN ARMY FINANCE CORPS", "BEING PMT FOR TROOPS NON REG ALLCE APR 26") is True
    assert is_payroll_or_statutory_voucher("NATIONAL PENSION COMMISSION", "Pension remit") is True
    assert is_payroll_or_statutory_voucher("Split Clinic Supplies Ltd", "Medical supplies batch") is False
    assert is_payroll_or_statutory_voucher("VISIBLE CONSTRUCTION LIMITED", "None") is False
    assert is_payroll_or_statutory_voucher("Monthly Vendor Ltd", "Monthly milestone") is False


def test_synthetic_payroll_separation_and_opaque_exemptions(tmp_path: Path):
    db_path = tmp_path / "payroll_sep.sqlite"
    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True)
    _create_synthetic_govspend_sqlite(db_path)

    conn = sqlite3.connect(str(db_path))
    try:
        # IPPIS 3-voucher rolling 7-day salary cluster -> must NOT enter topCommercialRolling7DayClusters
        for k in range(3):
            conn.execute(
                "INSERT INTO govspend_payments VALUES (?, ?, 2024, '05', 'POLICE FORMATIONS AND COMMANDS', 'POLICE FORMATIONS AND COMMANDS', 'IPPIS TRANSACTION ACCOUNT', 'IPPIS TRANSACTION ACCOUNT', ?, 'OCT 2024 Salary POLICE FORMATION NHIS')",
                (f"PAY-IPPIS-{k}", f"2024-10-{10 + k:02d}", 90_000_000_000),
            )
        # Abbreviated payroll string ('MAY 19 SAL') -> exempted from OPAQUE_BLANK_DESCRIPTION
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('PAY-SAL-1', '2019-05-20', 2019, '06', 'NIGERIAN ARMY', 'NIGERIAN ARMY', 'HQ NIGERIAN ARMY FINANCE CORPS', 'HQ NIGERIAN ARMY FINANCE CORPS', 9150000000, 'MAY 19 SAL')"
        )
        # Genuine opaque strings ('None' and Excel serial '43788') -> MUST remain flagged
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('PAY-NONE-1', '2024-03-11', 2024, '07', 'FCTA', 'FCTA', 'VISIBLE CONSTRUCTION LIMITED', 'VISIBLE CONSTRUCTION LIMITED', 8960000000, 'None')"
        )
        conn.execute(
            "INSERT INTO govspend_payments VALUES ('PAY-SERIAL-1', '2024-03-12', 2024, '07', 'FCTA', 'FCTA', 'ALPHA ROADWORKS LTD', 'ALPHA ROADWORKS LTD', 9000000000, '43788')"
        )
        conn.commit()
    finally:
        conn.close()

    res = build_govspend_forensics(
        fts_sqlite_path=db_path,
        datasets_dir=ds_dir,
        min_mda_benford_n=500,
        write=False,
    )
    h = res["headline"]
    assert h["payrollStatutoryVoucherCount"] == 4
    assert h["exemptedShortPayrollCount"] == 1
    assert h["payrollRolling7DayClusterCount"] >= 1

    comm_bens = {c["beneficiaryName"] for c in res["thresholdSplitting"]["topCommercialRolling7DayClusters"]}
    assert "IPPIS TRANSACTION ACCOUNT" not in comm_bens
    assert "Split Clinic Supplies Ltd" in comm_bens

    opaque_cat = next(
        c for c in res["discretionaryAndOpaqueAudit"]["categories"] if c["key"] == "OPAQUE_BLANK_DESCRIPTION"
    )
    all_descs = {v["description"] for v in opaque_cat["topVouchers"]}
    assert "MAY 19 SAL" not in all_descs
    assert "None" in all_descs
    assert "43788" in all_descs
    assert opaque_cat["commercialVoucherCount"] == 2
    assert {v["beneficiaryName"] for v in opaque_cat["commercialTopVouchers"]} == {
        "VISIBLE CONSTRUCTION LIMITED",
        "ALPHA ROADWORKS LTD",
    }


def test_live_govspend_forensics_artifact_integrity():
    out_path = Path("public/datasets/govspend_forensics.json")
    assert out_path.exists()
    assert out_path.stat().st_size < 1_500_000
    data = json.loads(out_path.read_text(encoding="utf-8"))
    assert data["status"] == "VERIFIED_GOVSPEND_FORENSICS"
    h = data["headline"]
    assert h["totalVouchers"] > 450_000
    assert h["december2019To2025Vouchers"] > 80_000
    assert h["decemberRushRatio2019To2025"] is not None and h["decemberRushRatio2019To2025"] > 2.0
    assert h["rolling7DayClusterCount"] > 10_000
    assert h["payrollStatutoryVoucherCount"] > 25_000
    assert h["exemptedShortPayrollCount"] >= 50
    assert h["commercialRolling7DayClusterCount"] > 5_000
    assert h["benfordValidCount"] > 450_000
    assert len(data["benfordCash"]["firstDigit"]["digits"]) == 9
    assert len(data["benfordCash"]["top2DigitSpikes"]) == 15
    assert all(m["validCount"] >= 500 for m in data["benfordCash"]["topFlaggedMdas"])
    comm_clusters = data["thresholdSplitting"]["topCommercialRolling7DayClusters"]
    assert len(comm_clusters) >= 20
    assert all(not c["isPayrollOrStatutory"] for c in comm_clusters)
    assert all("IPPIS" not in c["beneficiaryName"].upper() for c in comm_clusters)
    opaque_cat = next(
        c for c in data["discretionaryAndOpaqueAudit"]["categories"] if c["key"] == "OPAQUE_BLANK_DESCRIPTION"
    )
    assert all(
        v["description"].strip().upper() not in {"MAY 19 SAL", "SEP 19 SAL", "OCT SAL 18"}
        for v in opaque_cat["topVouchers"]
    )
    assert opaque_cat["commercialVoucherCount"] > 1_000
    yr_map = {y["financialYear"]: y for y in data["decemberRush"]["yearlyRush"]}
    assert yr_map[2018]["isPartialYear"] is True
    assert yr_map[2026]["isPartialYear"] is True
