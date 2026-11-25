import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from backend.main import app
from backend.routers.ai import verify_grounded_response
from backend.routers.search import sanitize_fts_query
from ingestion.indexers.fts_builder import build_fts_index


def test_fts5_sanitization_blocks_injection_and_syntax_errors():
    assert sanitize_fts_query('Land Cruiser; DROP TABLE budget_records; --') == '"Land"* "Cruiser"* "DROP"* "TABLE"* "budget"* "records"*'
    assert sanitize_fts_query('***""() AND OR NOT') == ""
    assert sanitize_fts_query("borehole Kano 2025") == '"borehole"* "Kano"* "2025"*'


def test_citation_verifier_rejects_fabricated_numbers_and_codes():
    gate = verify_grounded_response(
        "Found ₦500.00 Billion under ERGP999999 and ₦100.00 Million under ERGP1001.",
        allowed_amounts=[100_000_000],
        allowed_codes={"ERGP1001"},
    )
    assert gate["groundingVerified"] is False
    assert "₦500.00 Billion" in gate["rejectedFigures"]
    assert "ERGP999999" in gate["rejectedCodes"]
    assert "[UNVERIFIED FIGURE REDACTED]" in gate["verifiedText"]
    assert "[UNRETRIEVED CODE REDACTED]" in gate["verifiedText"]

    clean_gate = verify_grounded_response(
        "Verified ₦100.00 Million under ERGP1001.",
        allowed_amounts=[100_000_000],
        allowed_codes={"ERGP1001"},
    )
    assert clean_gate["groundingVerified"] is True
    assert clean_gate["rejectedFigures"] == []
    assert clean_gate["rejectedCodes"] == []


def test_search_and_ai_endpoints_on_synthetic_fts_db(tmp_path: Path):
    ds_dir = tmp_path / "datasets"
    for yr, code, title, mda, amt, sev in (
        (2019, "ERGP10", "Procurement of Toyota Land Cruiser Prado SUV", "Ministry of Works", 180_000_000, "high"),
        (2025, "ERGP20", "Construction of Solar Borehole in Kano State", "Ministry of Water Resources", 95_000_000, "low"),
        (2025, "ERGP21", "Provision of Solar Boreholes in Kano State", "Border Communities Development Agency", 88_000_000, "medium"),
        (2024, "ERGP22", "Construction of Solar Powered Borehole in Kaduna State", "Ministry of Water Resources", 72_000_000, "low"),
    ):
        yr_dir = ds_dir / "db" / str(yr)
        yr_dir.mkdir(parents=True, exist_ok=True)
        rec_file = yr_dir / "records.json"
        existing = json.loads(rec_file.read_text(encoding="utf-8")) if rec_file.exists() else []
        existing.append(
            {
                "recordIdentity": {
                    "id": f"P-{yr}-{code}",
                    "financialYear": yr,
                    "projectCode": code,
                    "verbatimProjectName": title,
                    "amountNaira": amt,
                    "spendingType": "CAPITAL",
                },
                "mdaGovernanceTaxonomy": {"mdaName": mda, "sector": "Infrastructure"},
                "sourceProvenance": {"pdfPage": 14, "sourceFilename": f"{yr}.pdf", "sha256Hash": "abc123"},
                "geographicTaxonomy": {"state": "Kano" if "Kano" in title else ("Kaduna" if "Kaduna" in title else "FCT")},
                "forensicEvidenceFlags": [{"severity": sev}],
            }
        )
        rec_file.write_text(json.dumps(existing), encoding="utf-8")

    db_path = tmp_path / "test_fts.sqlite"
    static_path = tmp_path / "search_index_top.json"
    build_fts_index(datasets_dir=ds_dir, db_path=db_path, static_index_path=static_path)

    prev = os.environ.get("BUDGETLENS_FTS_DB")
    os.environ["BUDGETLENS_FTS_DB"] = str(db_path)
    try:
        client = TestClient(app)
        res = client.get("/api/search", params={"q": "Land Cruiser", "severity": "high"})
        assert res.status_code == 200
        body = res.json()
        assert body["totalMatches"] == 1
        assert body["results"][0]["projectCode"] == "ERGP10"

        # Injection attempt should safely return 0 matches instead of 500
        inj = client.get("/api/search", params={"q": '"); DROP TABLE budget_records; --'})
        assert inj.status_code == 200
        assert inj.json()["totalMatches"] == 0

        # Standard AI query
        ai_res = client.post("/api/ai/query", json={"question": "Show borehole projects in Kano 2025"})
        assert ai_res.status_code == 200
        ai_body = ai_res.json()
        assert ai_body["groundingVerified"] is True
        assert ai_body["totalMatches"] == 2
        assert {c["code"] for c in ai_body["citations"]} == {"ERGP20", "ERGP21"}

        # Duplicate discovery across disguised wording
        dup_res = client.post("/api/ai/query", json={"question": "Find duplicate solar borehole projects in Kano 2025"})
        assert dup_res.status_code == 200
        dup_body = dup_res.json()
        assert dup_body["groundingVerified"] is True
        assert dup_body["queryMode"] == "duplicates"
        assert len(dup_body["duplicateClusters"]) >= 1
        top_cluster = dup_body["duplicateClusters"][0]
        assert top_cluster["count"] >= 2
        assert "Disguised" in top_cluster["matchType"]

        # Similar items discovery anchored to ERGP20
        sim_res = client.post("/api/ai/query", json={"question": "Find items similar to ERGP20"})
        assert sim_res.status_code == 200
        sim_body = sim_res.json()
        assert sim_body["groundingVerified"] is True
        assert sim_body["queryMode"] == "similar"
        assert len(sim_body["similarItems"]) >= 1
        assert all(item["similarityPct"] >= 30 for item in sim_body["similarItems"])

        # Multi-dataset padding & forensics queries must stay 100% grounded
        pad_res = client.post("/api/ai/query", json={"question": "Show Bill vs Act budget padding in 2025", "mode": "padding"})
        assert pad_res.status_code == 200
        assert pad_res.json()["groundingVerified"] is True
        assert pad_res.json()["datasetsConnected"]["billActPadding"] is True

        for_res = client.post("/api/ai/query", json={"question": "Show Benford MAD and premature replacement alerts", "mode": "forensics"})
        assert for_res.status_code == 200
        assert for_res.json()["groundingVerified"] is True
        assert for_res.json()["datasetsConnected"]["statisticalForensics"] is True

        exe_res = client.post("/api/ai/query", json={"question": "Show 2016 BIR capital budget releases", "mode": "execution"})
        assert exe_res.status_code == 200
        assert exe_res.json()["groundingVerified"] is True
        assert exe_res.json()["datasetsConnected"]["executionTracker"] is True

        pol_res = client.post("/api/ai/query", json={"question": "What is the MTEF oil price benchmark?", "mode": "policy"})
        assert pol_res.status_code == 200
        assert pol_res.json()["groundingVerified"] is True
        assert pol_res.json()["queryMode"] == "policy"
    finally:
        if prev is None:
            os.environ.pop("BUDGETLENS_FTS_DB", None)
        else:
            os.environ["BUDGETLENS_FTS_DB"] = prev


def test_live_fts_database_exists_and_queries_fast():
    db_path = Path("backend/data/budgetlens_fts.sqlite")
    static_path = Path("public/datasets/search_index_top.json")
    assert db_path.exists()
    assert static_path.exists()
    client = TestClient(app)
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["ftsDbReady"] is True


def test_ai_answers_avoid_doc_and_pdf_names_for_entity_and_policy_queries():
    client = TestClient(app)
    forbidden = (".pdf", ".json", ".csv", "NOCOPO", "GovSpend", "MTEF/FSP", "SQL/FTS5", "Budget Implementation Report")

    for question in (
        "Is there any Hi-Tech contract?",
        "What are the 2026 MTEF oil price benchmark assumptions?",
    ):
        res = client.post("/api/ai/query", json={"question": question})
        assert res.status_code == 200
        body = res.json()
        assert body["groundingVerified"] is True
        for marker in forbidden:
            assert marker not in body["answer"]


def test_phase3_cross_dataset_and_bir_ocr_ai_grounding():
    client = TestClient(app)
    forbidden = (".pdf", ".json", ".csv", "NOCOPO", "GovSpend", "MTEF/FSP", "SQL/FTS5", "Budget Implementation Report")

    cases = [
        ("Show MDA integrity scorecard and debt service overrun credibility", "scorecard"),
        ("Show non-competitive procurement risk and variation overruns", "procurement_risk"),
        ("Show December rush and threshold splitting treasury cash forensics", "cash_forensics"),
        ("Show captive vendor pairs and off-nocopo private firms", "vendor_capture"),
        ("Show follow the money padded-to-paid and zombie projects", "follow_money"),
        ("Show OAuGF Auditor-General audit queries on unvouched payments", "oaugf_audit"),
        ("Show 2016 capital budget releases execution", "execution"),
    ]

    for question, expected_mode in cases:
        res = client.post("/api/ai/query", json={"question": question})
        assert res.status_code == 200
        body = res.json()
        assert body["available"] is True
        assert body["queryMode"] == expected_mode, f"{question!r} routed to {body['queryMode']}"
        assert body["groundingVerified"] is True, f"Unverified for {question!r}: {body.get('rejectedFigures')} {body.get('rejectedCodes')}"
        assert body["answer"].strip() != ""
        dc = body["datasetsConnected"]
        for flag in (
            "birOcrFts",
            "oaugfAuditFts",
            "mdaScorecards",
            "macroCredibility",
            "procurementRisk",
            "govspendForensics",
            "vendorNetwork",
            "followTheMoney",
            "oaugfAuditIndex",
        ):
            assert dc[flag] is True, f"Expected {flag}=True for {question!r}"
        for marker in forbidden:
            assert marker not in body["answer"], f"Forbidden marker {marker!r} found in answer for {question!r}"


def test_cascade_phase3_order_and_provenance_manifest(tmp_path: Path, monkeypatch):
    from ingestion.indexers.cascade import CascadeEngine

    ds_dir = tmp_path / "datasets"
    ds_dir.mkdir(parents=True, exist_ok=True)
    ckpt_dir = tmp_path / "checkpoints_data"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    sentinel = ckpt_dir / "2026_checkpoint.json"
    sentinel.write_text('{"preserve_existing_gemma": true}', encoding="utf-8")

    called: list[str] = []

    def _rec(step_name: str):
        def _fn(*args, **kwargs):
            called.append(step_name)
            return {}
        return _fn

    monkeypatch.setattr("ingestion.indexers.follow_the_money_builder.build_follow_the_money_links", _rec("follow_the_money"))
    monkeypatch.setattr("ingestion.indexers.project_lifecycle_builder.build_project_lifecycle_index", _rec("project_lifecycle"))
    monkeypatch.setattr("ingestion.indexers.procurement_risk_builder.build_procurement_risk_index", _rec("procurement_risk"))
    monkeypatch.setattr("ingestion.indexers.govspend_forensics_builder.build_govspend_forensics", _rec("govspend_forensics"))
    monkeypatch.setattr("ingestion.indexers.vendor_network_builder.build_vendor_network_index", _rec("vendor_network"))
    monkeypatch.setattr("ingestion.indexers.mda_scorecard_builder.build_mda_scorecards", _rec("mda_scorecards_pillar"))
    monkeypatch.setattr("ingestion.indexers.mda_scorecard_builder.build_macro_credibility_tracker", _rec("mda_scorecards_macro"))
    monkeypatch.setattr("ingestion.indexers.geo_asset_indexer.build_indexes", _rec("geo_assets"))
    monkeypatch.setattr("ingestion.indexers.build_provenance_manifest.build_provenance_manifest", _rec("provenance"))

    engine = CascadeEngine(base_dir=str(ds_dir))
    res = engine.run_phase3(fts_sqlite_path=tmp_path / "ext.sqlite")
    assert res["stepsRun"] == list(CascadeEngine.PHASE3_STEP_ORDER)
    assert called == [
        "follow_the_money",
        "project_lifecycle",
        "procurement_risk",
        "govspend_forensics",
        "vendor_network",
        "mda_scorecards_pillar",
        "mda_scorecards_macro",
        "geo_assets",
        "provenance",
    ]
    assert sentinel.read_text(encoding="utf-8") == '{"preserve_existing_gemma": true}'

    prov = json.loads(Path("public/datasets/source_provenance.json").read_text(encoding="utf-8"))
    assert prov["externalSources"]["dmo_pdfs"]["fileCount"] >= 500
    p3 = prov.get("phase3Datasets", {})
    for fn in (
        "follow_the_money_links.json",
        "project_lifecycle_index.json",
        "procurement_risk_index.json",
        "govspend_forensics.json",
        "vendor_network_index.json",
        "mda_integrity_scorecards.json",
        "macro_credibility_tracker.json",
        "geo_intelligence_index.json",
    ):
        assert fn in p3
        assert len(p3[fn]["sha256"]) == 64
