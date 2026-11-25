"""Atomic Phase 5 Checkpoint Recorder (`ingestion/checkpoints_data/phase5_evidence_checkpoints.json`).

Records deterministic completion metadata for Phase 5 Evidence Engine v3.0 checkpoints
(`EE-CP-1` through `EE-CP-5`) without modifying any existing Stage-2 annual budget
checkpoints (`1999`–`2026`), `phase4_checkpoints.json`, or `ingestion/ocr_cache/`.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PHASE5_CHECKPOINT_FILE = (
    PROJECT_ROOT / "ingestion" / "checkpoints_data" / "phase5_evidence_checkpoints.json"
)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()


def record_phase5_checkpoint(
    checkpoint_id: str,
    stage: str,
    title: str,
    output_files: list[Path],
    metrics: dict[str, Any],
    checkpoint_path: Path = PHASE5_CHECKPOINT_FILE,
) -> dict[str, Any]:
    """Atomically upsert a Phase 5 checkpoint entry in `phase5_evidence_checkpoints.json`."""
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    existing: dict[str, Any] = {"updatedAt": "", "checkpoints": {}}
    if checkpoint_path.is_file():
        try:
            loaded = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and isinstance(loaded.get("checkpoints"), dict):
                existing = loaded
        except Exception:
            pass

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    artifacts: list[dict[str, Any]] = []
    for fp in output_files:
        p = Path(fp)
        if p.is_file():
            digest = _sha256_file(p)
            artifacts.append(
                {
                    "file": p.name,
                    "bytes": p.stat().st_size,
                    "sha256": digest,
                    "shortSha256": digest[:16],
                }
            )

    entry = {
        "checkpointId": checkpoint_id,
        "stage": stage,
        "title": title,
        "status": "COMPLETED",
        "completedAt": now_iso,
        "artifacts": artifacts,
        "metrics": metrics,
    }
    existing["updatedAt"] = now_iso
    existing["checkpoints"][checkpoint_id] = entry

    tmp = str(checkpoint_path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(existing, f, indent=2, ensure_ascii=False)
    for attempt in range(5):
        try:
            os.replace(tmp, checkpoint_path)
            break
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)
    return entry
