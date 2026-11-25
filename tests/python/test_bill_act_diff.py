import json
from pathlib import Path

from ingestion.indexers.bill_act_diff_builder import (
    classify_pdf_role,
    is_zonal_intervention,
    match_bill_and_act_items,
)


def _make_item(code: str, title: str, mda: str, amount: int, source: str, page: int):
    norm_t = title.lower()
    return {
        "projectCode": code,
        "normCode": code.upper() if code != "ERGP" else "",
        "projectName": title,
        "normTitle": norm_t,
        "tokens": {t for t in norm_t.split() if len(t) >= 3},
        "mdaName": mda,
        "normMda": mda.lower(),
        "amountNaira": amount,
        "page": page,
        "sourceFile": source,
        "sha256": f"sha256:{source}",
        "isZip": is_zonal_intervention(code, title, source),
    }


def test_role_classifier_and_3_tier_matching():
    assert classify_pdf_role("2025 Executive Proposal.pdf") == "BILL"
    assert classify_pdf_role("2025 Appropriation ACT as Passed.pdf") == "ACT"
    assert classify_pdf_role("2025 MTEF & FSP.pdf") == "IGNORE"

    bill = [
        _make_item("ERGP1001", "Construction of Rural Road in Kano", "Ministry of Works", 100_000_000, "bill.pdf", 5),
        _make_item("ERGP1002", "Equipping of Primary Health Clinic", "Ministry of Health", 80_000_000, "bill.pdf", 8),
    ]
    act = [
        _make_item("ERGP1001", "Construction of Rural Road in Kano", "Ministry of Works", 250_000_000, "act.pdf", 12),
        _make_item("ZIP9001", "Zonal Intervention Solar Boreholes", "Ministry of Water", 300_000_000, "act.pdf", 99),
    ]

    res = match_bill_and_act_items(2025, bill, act, {"bill.pdf": "sha256:b"}, {"act.pdf": "sha256:a"})
    s = res["summary"]
    assert s["comparisonScope"] == "SUMMARY_LEVEL_ONLY"
    assert s["inflatedCount"] == 1
    assert s["inflatedTotalNaira"] == 150_000_000
    assert s["insertionsCount"] == 1
    assert s["insertionsTotalNaira"] == 300_000_000
    assert s["removedCount"] == 1
    assert s["zipCount"] == 1


def test_generated_bill_act_diffs_index_exists():
    idx_path = Path("public/datasets/bill_act_diffs/index.json")
    assert idx_path.exists()
    data = json.loads(idx_path.read_text(encoding="utf-8"))
    assert data["cyclesCount"] >= 4
    years = {c["financialYear"] for c in data["cycles"]}
    assert {2021, 2022, 2025}.issubset(years)
