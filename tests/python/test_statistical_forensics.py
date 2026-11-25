import json
import math
from pathlib import Path

from ingestion.indexers.statistical_forensics_builder import (
    chi_square_p_value_df8,
    classify_virement_category,
    compute_benford_metrics,
    compute_premature_replacement_alerts,
    is_valid_mda_name,
)


def test_benford_mad_and_low_sample_guard():
    benford_counts = [301, 176, 125, 97, 79, 67, 58, 51, 46]
    good_amounts = [
        (d + 1) * 1_000_000 + i * 50
        for d, cnt in enumerate(benford_counts)
        for i in range(cnt)
    ]
    res_good = compute_benford_metrics(good_amounts, 2026)
    assert res_good["validRecordCount"] == 1000
    assert res_good["meanAbsoluteDeviation"] <= 0.006
    assert res_good["conformityBand"] == "CLOSE_CONFORMITY"
    assert res_good["chiSquarePValue"] > 0.95

    low_n = compute_benford_metrics([100_000_000] * 15, 2000)
    assert low_n["conformityBand"] == "INSUFFICIENT_SAMPLE"
    assert low_n["auditRating"] == "INSUFFICIENT_SAMPLE"
    assert low_n["benfordIntegrityScore"] == 0
    assert math.isfinite(chi_square_p_value_df8(15.507313))
    assert abs(chi_square_p_value_df8(15.507313) - 0.05) < 1e-4


def test_premature_replacement_excludes_consumables_and_detects_suv_repeats():
    records_by_year = {
        2023: [
            {
                "recordIdentity": {
                    "id": "P-2023-1",
                    "financialYear": 2023,
                    "projectCode": "ERGP1",
                    "verbatimProjectName": "OFFICE STATIONERIES / COMPUTER CONSUMABLES",
                    "amountNaira": 50_000_000,
                    "spendingType": "CAPITAL",
                },
                "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Works"},
                "assetTokens": [{"category": "office_tech", "quantity": 1}],
                "sourceProvenance": {"pdfPage": 10, "sourceFilename": "2023.pdf"},
            },
            {
                "recordIdentity": {
                    "id": "P-2023-2",
                    "financialYear": 2023,
                    "projectCode": "ERGP2",
                    "verbatimProjectName": "PROCUREMENT OF 4 NOS TOYOTA PRADO SUVS FOR OFFICIALS",
                    "amountNaira": 320_000_000,
                    "spendingType": "CAPITAL",
                },
                "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Works - HQTRS"},
                "assetTokens": [{"category": "vehicles_mobility", "quantity": 4}],
                "sourceProvenance": {"pdfPage": 12, "sourceFilename": "2023.pdf"},
            },
        ],
        2025: [
            {
                "recordIdentity": {
                    "id": "P-2025-1",
                    "financialYear": 2025,
                    "projectCode": "ERGP3",
                    "verbatimProjectName": "OFFICE STATIONERIES / COMPUTER CONSUMABLES",
                    "amountNaira": 70_000_000,
                    "spendingType": "CAPITAL",
                },
                "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Works"},
                "assetTokens": [{"category": "office_tech", "quantity": 1}],
                "sourceProvenance": {"pdfPage": 18, "sourceFilename": "2025.pdf"},
            },
            {
                "recordIdentity": {
                    "id": "P-2025-2",
                    "financialYear": 2025,
                    "projectCode": "ERGP4",
                    "verbatimProjectName": "PURCHASE OF 5 NOS HILUX PICKUP TRUCKS",
                    "amountNaira": 450_000_000,
                    "spendingType": "CAPITAL",
                },
                "mdaGovernanceTaxonomy": {"mdaName": "Federal Ministry of Works"},
                "assetTokens": [{"category": "vehicles_mobility", "quantity": 5}],
                "sourceProvenance": {"pdfPage": 24, "sourceFilename": "2025.pdf"},
            },
        ],
    }

    alerts = compute_premature_replacement_alerts(records_by_year)
    assert len(alerts) == 1
    assert alerts[0]["assetCategory"] == "vehicles_mobility"
    assert alerts[0]["yearsActive"] == [2023, 2025]
    assert alerts[0]["minGapYears"] == 2
    assert alerts[0]["activeInventoryTally"] == 9
    assert alerts[0]["totalSpentNaira"] == 770_000_000

    assert is_valid_mda_name("General Federal") is False
    assert is_valid_mda_name("KM267+400-KM372+842") is False
    assert classify_virement_category("Service Wide Vote Margin", "OVERHEAD") == "SERVICE_WIDE_VOTE"


def test_precomputed_statistical_forensics_artifact_valid():
    path = Path("public/datasets/statistical_forensics_1999_2026.json")
    assert path.exists()
    assert path.stat().st_size < 5 * 1024 * 1024
    data = json.loads(path.read_text(encoding="utf-8"))
    assert len(data["yearsCovered"]) == 28
    assert len(data["benfordTrend"]) == 28
    assert len(data["prematureReplacementAlerts"]) > 0
    for row in data["benfordTrend"]:
        assert math.isfinite(row["meanAbsoluteDeviation"])
        assert math.isfinite(row["chiSquareStat"])
        assert math.isfinite(row["chiSquarePValue"])
