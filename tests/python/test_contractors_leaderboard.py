import json
import os
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app
from ingestion.parsers.contractors_leaderboard import (
    build_contractors_leaderboard,
    canonical_contractor_key,
    shard_bucket_for_name,
)


def test_canonical_contractor_key_merges_honorifics_and_suffixes():
    k1 = canonical_contractor_key("M/s Julius Berger Nig. Plc.")
    k2 = canonical_contractor_key("Julius Berger Nigeria Plc")
    k3 = canonical_contractor_key("MESSRS KOPEK CONSTRUCTION LIMITED")
    k4 = canonical_contractor_key("Kopek Construction Ltd.")
    assert k1 == k2
    assert k3 == k4


def test_build_contractors_leaderboard_synthetic_sqlite(tmp_path: Path):
    db_path = tmp_path / "ext.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        """
        CREATE TABLE nocopo_contracts (
            ocid TEXT PRIMARY KEY,
            financial_year INTEGER,
            stage TEXT,
            title TEXT,
            mda_name TEXT,
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
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            payment_no TEXT,
            payment_date TEXT,
            financial_year INTEGER,
            payer_code TEXT,
            organization_name TEXT,
            norm_mda TEXT,
            beneficiary_name TEXT,
            norm_beneficiary TEXT,
            amount_naira INTEGER,
            description TEXT
        )
        """
    )
    rows = [
        ("ocid-1", 2021, "award", "Road A", "Ministry of Works", "", "M/s Julius Berger Nig. Plc.", "M S JULIUS BERGER NIG PLC", "BPP-1", None, 100_000_000, 50_000_000, "2021-05-01", "open", None, None, "NO_PUBLIC_RECORD_FOUND", 0.0, "x.json"),
        ("ocid-2", 2023, "contract", "Bridge B", "FCDA", "", "Julius Berger Nigeria Plc", "JULIUS BERGER NIG PLC", "BPP-1", None, 250_000_000, 120_000_000, "2023-06-01", "open", None, None, "NO_PUBLIC_RECORD_FOUND", 0.0, "x.json"),
        ("ocid-3", 2022, "award", "Clinic C", "Ministry of Health", "", "Acme Medical Ltd", "ACME MEDICAL LTD", "BPP-2", None, 40_000_000, 0, "2022-03-01", "selective", None, None, "NO_PUBLIC_RECORD_FOUND", 0.0, "x.json"),
    ]
    conn.executemany(
        "INSERT INTO nocopo_contracts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        rows,
    )
    conn.execute(
        "INSERT INTO govspend_payments (payment_no, payment_date, financial_year, payer_code, organization_name, norm_mda, beneficiary_name, norm_beneficiary, amount_naira, description) VALUES (?,?,?,?,?,?,?,?,?,?)",
        ("PAY-1", "2023-08-10", 2023, "0111001001", "FCDA", "FCDA", "Julius Berger Nig Plc", "JULIUS BERGER NIG PLC", 90_000_000, "Bridge stage 1"),
    )
    conn.commit()
    conn.close()

    ds_dir = tmp_path / "datasets"
    res = build_contractors_leaderboard(fts_sqlite_path=db_path, datasets_dir=ds_dir, write=True)
    assert res["status"] == "VERIFIED_CONTRACTORS_LEADERBOARD"
    assert res["totalDistinctContractors"] == 2
    assert res["repeatContractorsCount"] == 1
    assert res["totalAwardedContracts"] == 3
    assert res["totalContractedNaira"] == 390_000_000

    top = res["contractors"][0]
    assert top["contractCount"] == 2
    assert top["totalContractedNaira"] == 350_000_000
    assert top["govspendPaidNaira"] == 90_000_000
    assert top["mdaCount"] == 2
    assert (ds_dir / "contractors_leaderboard.json").exists()

    jb_bucket = shard_bucket_for_name(top["contractorName"])
    jb_shard = ds_dir / "contractor_history" / f"{jb_bucket}.json"
    assert jb_shard.exists()
    shard_data = json.loads(jb_shard.read_text(encoding="utf-8"))
    jb_entry = shard_data[top["contractorName"]]
    assert len(jb_entry["contracts"]) == 2
    assert len(jb_entry["payments"]) == 1


def test_live_contractors_leaderboard_and_api_endpoint():
    out_path = Path("public/datasets/contractors_leaderboard.json")
    assert out_path.exists()
    raw_text = out_path.read_text(encoding="utf-8")
    assert "TEST MINISTRY - NOCOPO" not in raw_text
    assert "\u00c4\u00bb" not in raw_text
    data = json.loads(raw_text)
    assert data["status"] == "VERIFIED_CONTRACTORS_LEADERBOARD"
    assert 15000 <= data["totalAwardedContracts"] < 15492
    assert data["totalDistinctContractors"] > 9000

    s_bucket = shard_bucket_for_name("Sudabelt Medical Co. Limited")
    s_shard = Path(f"public/datasets/contractor_history/{s_bucket}.json")
    assert s_shard.exists()
    s_data = json.loads(s_shard.read_text(encoding="utf-8"))
    assert len(s_data["Sudabelt Medical Co. Limited"]["contracts"]) == 30

    prev = os.environ.get("BUDGETLENS_CONTRACTORS_JSON")
    os.environ["BUDGETLENS_CONTRACTORS_JSON"] = str(out_path)
    try:
        client = TestClient(app)
        res = client.get("/api/procurement/contractors", params={"sort": "count", "min_awards": 5, "limit": 10})
        assert res.status_code == 200
        body = res.json()
        assert body["available"] is True
        assert body["totalMatches"] >= 10
        assert len(body["results"]) == 10
        counts = [r["contractCount"] for r in body["results"]]
        assert all(c >= 5 for c in counts)
        assert counts == sorted(counts, reverse=True)
    finally:
        if prev is None:
            os.environ.pop("BUDGETLENS_CONTRACTORS_JSON", None)
        else:
            os.environ["BUDGETLENS_CONTRACTORS_JSON"] = prev


def test_contractor_history_drilldown_endpoint_live():
    client = TestClient(app)

    res = client.get("/api/procurement/contractor-history", params={"name": "Sudabelt Medical Co. Limited", "limit": 50})
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["totalContracts"] == 30
    assert len(body["contracts"]) == 30
    assert body["totalContractedNaira"] > 2_000_000_000

    # Verify honorific variants ("M/s Julius Berger Nig. Plc.") are matched when querying clean name
    jb_res = client.get("/api/procurement/contractor-history", params={"name": "Julius Berger Nigeria Plc"})
    assert jb_res.status_code == 200
    jb_body = jb_res.json()
    assert jb_body["available"] is True
    assert jb_body["totalContracts"] >= 1
    assert jb_body["totalContractedNaira"] > 0
