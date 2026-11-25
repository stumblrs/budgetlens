import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app
from ingestion.parsers.govspend_indexer import build_govspend_index


def test_govspend_indexer_unit_padding_split_and_zero_exclusion(tmp_path):
    jsonl = tmp_path / "sample.jsonl"
    rows = [
        {
            "date": "2024-05-10",
            "payment_no": "P-1",
            "payer_code": "145001001",  # 9-digit -> 0145001001
            "organization_name": "FEDERAL MINISTRY OF HEALTH - HQTRS",
            "beneficiary_name": "Zenith Builders Nigeria Limited",
            "amount": 3_000_000.0,
            "description": "Batch 1 medical equipment",
        },
        {
            "date": "2024-05-10",
            "payment_no": "P-2",
            "payer_code": "145001001",
            "organization_name": "FEDERAL MINISTRY OF HEALTH - HQTRS",
            "beneficiary_name": "Zenith Builders Nigeria Limited",
            "amount": 3_000_000.0,
            "description": "Batch 2 medical equipment",
        },
        {
            "date": "2024-05-10",
            "payment_no": "P-3",
            "payer_code": "145001001",
            "organization_name": "FEDERAL MINISTRY OF HEALTH - HQTRS",
            "beneficiary_name": "Zenith Builders Nigeria Limited",
            "amount": 3_000_000.0,
            "description": "Batch 3 medical equipment",
        },
        {
            "date": "2024-05-11",
            "payment_no": "P-ZERO",
            "payer_code": "0145001001",
            "organization_name": "FEDERAL MINISTRY OF HEALTH",
            "beneficiary_name": "Zero Test Ltd",
            "amount": 0.0,
            "description": "Reversed voucher",
        },
    ]
    jsonl.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")

    ds_dir = tmp_path / "datasets"
    sqlite_path = tmp_path / "external.sqlite"
    out = build_govspend_index(jsonl, ds_dir, sqlite_path, write=True)

    assert out["totalRowsScanned"] == 4
    assert out["validPaymentCount"] == 3
    assert out["zeroAmountExcludedCount"] == 1
    assert out["totalDisbursedNaira"] == 9_000_000
    assert out["topMdas"][0]["payerCode"] == "0145001001"
    assert len(out["splitPaymentAlerts"]) == 1
    assert out["splitPaymentAlerts"][0]["voucherCount"] == 3
    assert (ds_dir / "govspend_summary.json").exists()
    assert sqlite_path.exists()


def test_live_govspend_summary_and_expenditures_api():
    summary_path = Path("public/datasets/govspend_summary.json")
    assert summary_path.exists()
    assert summary_path.stat().st_size < 2_000_000

    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary["status"] == "VERIFIED_GOVSPEND_LEDGER"
    assert summary["totalRowsScanned"] == 467_780
    assert summary["zeroAmountExcludedCount"] == 17
    assert summary["validPaymentCount"] == 467_763
    assert summary["totalDisbursedNaira"] > 0
    assert summary["nocopoCrossLinkCount"] > 0

    client = TestClient(app)
    res = client.get("/api/expenditures/search?q=health&limit=10")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["totalMatches"] >= 1

    # FTS5 injection immunity
    inj = client.get('/api/expenditures/search?q="AND+OR+NOT+*&limit=5')
    assert inj.status_code == 200

    ben_res = client.get("/api/expenditures/beneficiary?name=JULIUS+BERGER+NIGERIA+PLC&limit=5")
    assert ben_res.status_code == 200
    assert ben_res.json()["available"] is True
