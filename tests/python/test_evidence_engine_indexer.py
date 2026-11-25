"""Tests for All-Years Cross-Ledger Evidence Engine v3.0 Builder (Phase 5 · Stage P5-S1 / Checkpoint EE-CP-1)."""

from __future__ import annotations

import json
from pathlib import Path

from ingestion.indexers.evidence_engine_indexer import build_evidence_engine_all_years

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
CHECKPOINT_FILE = (
    PROJECT_ROOT / "ingestion" / "checkpoints_data" / "phase5_evidence_checkpoints.json"
)


def test_evidence_engine_all_years_dataset_and_checkpoint() -> None:
    index_path = DATASETS_DIR / "evidence_engine_all_years.json"
    if not index_path.is_file():
        build_evidence_engine_all_years(datasets_dir=DATASETS_DIR, write=True)

    assert index_path.is_file(), "evidence_engine_all_years.json must exist"
    assert index_path.stat().st_size < 1_500_000, "evidence_engine_all_years.json must stay compact (< 1.5 MB)"

    data = json.loads(index_path.read_text(encoding="utf-8"))
    assert data["status"] == "VERIFIED_EVIDENCE_ENGINE_V3_ALL_YEARS"
    assert data["engineVersion"] == "3.0.0"

    summary = data["summary"]
    assert summary["yearsScanned"] == 28
    assert summary["firstYear"] == 1999
    assert summary["lastYear"] == 2026
    assert summary["totalRecordsScanned"] >= 550_000
    assert summary["totalRulesCount"] == 22
    assert summary["textRulesCount"] == 16
    assert summary["crossLedgerRulesCount"] == 6
    assert summary["totalRuleFindings"] >= 35_000
    assert summary["totalCrossLedgerFindings"] >= 15_000
    assert summary["totalFlaggedProjects"] >= 20_000
    assert summary["totalDuplicateClusters"] >= 3_000

    rules_cat = data["rulesCatalog"]
    assert len(rules_cat) == 22
    rule_ids = {r["id"] for r in rules_cat}
    for expected_cross_rule in (
        "LEGISLATIVE_INSERTION_ANOMALY",
        "PAID_ON_PAPER_HIGH_RISK",
        "ZOMBIE_RECURRING_LINEAGE",
        "OAUGF_INDICTED_MDA_RISKY_SPEND",
        "PERSONAL_OR_OPAQUE_PAYOUT_MDA_RISK",
        "REPEAT_ASSET_LIFESPAN_VIOLATION",
    ):
        assert expected_cross_rule in rule_ids

    assert len(data["byYear"]) == 28
    assert len(data["topFlaggedMdasAllTime"]) >= 25
    assert len(data["topCompoundProjectsAllTime"]) >= 50

    ctx = data["crossLedgerContext"]
    assert len(ctx["paidOnPaperCodes"]) >= 1_000
    assert len(ctx["billInsertionCodes"]) >= 1_000
    assert len(ctx["zombieLineageCodes"]) >= 500
    assert len(ctx["mdaProfilesByKey"]) >= 50

    assert CHECKPOINT_FILE.is_file(), "phase5_evidence_checkpoints.json must be recorded"
    cp_data = json.loads(CHECKPOINT_FILE.read_text(encoding="utf-8"))
    assert "EE-CP-1" in cp_data["checkpoints"]
    assert cp_data["checkpoints"]["EE-CP-1"]["status"] == "COMPLETED"
