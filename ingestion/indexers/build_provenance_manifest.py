"""Build static SHA-256 source provenance manifest for all ingested FGN budget PDFs.

Reads `ingestion/ingestion_registry.json` (real 64-char SHA-256 checksums for every
source PDF across FY 1999-2026) and optional page-count metadata from
`public/datasets/registry.json` (read-only), emitting
`public/datasets/source_provenance.json` for frontend citation & provenance UI.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

PROJECT_ROOT = Path(__file__).resolve().parents[2]
INGESTION_REGISTRY_PATH = PROJECT_ROOT / "ingestion" / "ingestion_registry.json"
DATASET_REGISTRY_PATH = PROJECT_ROOT / "public" / "datasets" / "registry.json"
OUTPUT_PATH = PROJECT_ROOT / "public" / "datasets" / "source_provenance.json"

PHASE3_DATASET_FILES: tuple[str, ...] = (
    "follow_the_money_links.json",
    "project_lifecycle_index.json",
    "procurement_risk_index.json",
    "govspend_forensics.json",
    "vendor_network_index.json",
    "mda_integrity_scorecards.json",
    "macro_credibility_tracker.json",
    "geo_intelligence_index.json",
    "oaugf_audit_index.json",
    "red_flag_convergence_index.json",
    "evidence_engine_all_years.json",
)


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()


def _atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _scan_external_sources() -> dict[str, Any]:
    """Compute SHA-256 provenance entries for downloaded external datasets if present."""
    sources: dict[str, Any] = {}

    specs: list[tuple[str, Path, list[str], set[str]]] = [
        ("bir_pdfs", PROJECT_ROOT / "bir_pdfs", ["*.pdf"], set()),
        ("policy_pdfs", PROJECT_ROOT / "policy_pdfs", ["*.pdf"], set()),
        ("dmo_pdfs", PROJECT_ROOT / "dmo_pdfs", ["*.pdf"], set()),
        ("NocopoJson", PROJECT_ROOT / "NocopoJson", ["*.json"], set()),
        ("govspend_data", PROJECT_ROOT / "govspend_data", ["govspend_all.jsonl", "govspend_all.csv"], {"pages.jsonl"}),
    ]

    for key, root, patterns, exclude_names in specs:
        if not root.exists():
            continue
        matched: list[Path] = []
        for pat in patterns:
            matched.extend(root.rglob(pat))
        unique_files = sorted(
            {p for p in matched if p.is_file() and p.name not in exclude_names},
            key=lambda p: p.as_posix().lower(),
        )
        file_entries: list[dict[str, Any]] = []
        total_bytes = 0
        for fp in unique_files:
            sz = fp.stat().st_size
            total_bytes += sz
            digest = _sha256_file(fp)
            file_entries.append(
                {
                    "relativePath": fp.relative_to(PROJECT_ROOT).as_posix(),
                    "filename": fp.name,
                    "bytes": sz,
                    "sha256": digest,
                    "shortSha256": digest[:16],
                }
            )
        sources[key] = {
            "rootDir": key,
            "fileCount": len(file_entries),
            "totalBytes": total_bytes,
            "files": file_entries,
        }

    return sources


def _filename_priority(filename: str) -> int:
    """Lower rank is higher priority when totalRecords ties."""
    lower = filename.lower()
    if "duplicate listing" in lower:
        return 90
    if any(tok in lower for tok in ("speech", "guideline", "mtef", "fsp", "er&gp", "presentation")):
        return 70
    if "approved budget details" in lower or "appropriation bill details" in lower:
        return 10
    if "appropriation act" in lower:
        return 15 if "supplementary" not in lower else 25
    if "appropriation bill" in lower or "approved fgn budget" in lower:
        return 20
    return 40


def _read_page_counts() -> dict[int, dict[str, Any]]:
    """Read-only lookup of pageCount & status from public/datasets/registry.json."""
    if not DATASET_REGISTRY_PATH.exists():
        return {}
    try:
        data = json.loads(DATASET_REGISTRY_PATH.read_text(encoding="utf-8"))
        out: dict[int, dict[str, Any]] = {}
        for doc in data.get("documents", []):
            fy = doc.get("financial_year") or doc.get("financialYear")
            if fy is None:
                continue
            out[int(fy)] = {
                "pageCount": int(doc.get("page_count") or doc.get("pageCount") or 0),
                "datasetProjectCount": int(doc.get("project_count") or doc.get("extractedProjectsCount") or 0),
                "scheduleStatus": str(doc.get("status") or ""),
            }
        return out
    except Exception:
        return {}


def _scan_phase3_datasets(datasets_dir: Path) -> dict[str, Any]:
    """Compute SHA-256 digests for generated Phase 3 static intelligence artifacts."""
    out: dict[str, Any] = {}
    for rel_name in PHASE3_DATASET_FILES:
        fp = datasets_dir / rel_name
        if not fp.is_file():
            continue
        digest = _sha256_file(fp)
        out[rel_name] = {
            "filename": rel_name,
            "bytes": fp.stat().st_size,
            "sha256": digest,
            "shortSha256": digest[:16],
        }

    shards_dir = datasets_dir / "project_lifecycle"
    if shards_dir.is_dir():
        shard_files = [p for p in shards_dir.glob("*.json") if p.is_file()]
        out["project_lifecycle_shards"] = {
            "shardCount": len(shard_files),
            "totalBytes": sum(p.stat().st_size for p in shard_files),
        }
    return out


def build_provenance_manifest(
    datasets_dir: Path | str | None = None,
    output_path: Path | str | None = None,
    include_external: bool = True,
) -> dict[str, Any]:
    ds_dir = Path(datasets_dir) if datasets_dir is not None else (PROJECT_ROOT / "public" / "datasets")
    out_path = Path(output_path) if output_path is not None else (ds_dir / "source_provenance.json")

    raw_registry = json.loads(INGESTION_REGISTRY_PATH.read_text(encoding="utf-8"))
    files_map: dict[str, dict[str, Any]] = raw_registry.get("files", {})
    page_meta = _read_page_counts()

    grouped: dict[int, list[dict[str, Any]]] = {}
    for key, entry in files_map.items():
        digest = key.replace("sha256:", "").strip().lower()
        if not SHA256_RE.match(digest):
            raise ValueError(f"Invalid SHA-256 digest in registry key: {key!r}")

        year_raw = entry.get("year") or entry.get("financialYear")
        if year_raw is None:
            raise ValueError(f"Missing fiscal year for entry {key!r}")
        year = int(year_raw)

        filename = str(entry.get("filename") or "").strip()
        if not filename:
            raise ValueError(f"Missing filename for entry {key!r}")

        total_records = int(entry.get("totalRecords") or 0)
        status = str(entry.get("status") or "INDEXED")
        ingested_at = entry.get("ingestedAt") or entry.get("lastUpdatedAt") or ""

        record: dict[str, Any] = {
            "filename": filename,
            "sha256": digest,
            "shortSha256": digest[:16],
            "totalRecords": total_records,
            "status": status,
        }
        if ingested_at:
            record["ingestedAt"] = str(ingested_at)

        grouped.setdefault(year, []).append(record)

    years_payload: dict[str, dict[str, Any]] = {}
    total_files = 0

    for year in sorted(grouped.keys()):
        sorted_files = sorted(
            grouped[year],
            key=lambda item: (-item["totalRecords"], _filename_priority(item["filename"]), item["filename"].lower()),
        )
        total_files += len(sorted_files)
        yr_meta = page_meta.get(year, {})

        year_obj: dict[str, Any] = {
            "year": year,
            "fileCount": len(sorted_files),
            "totalRecords": sum(f["totalRecords"] for f in sorted_files),
            "primaryFile": sorted_files[0],
            "files": sorted_files,
        }
        if yr_meta.get("pageCount"):
            year_obj["pageCount"] = yr_meta["pageCount"]
        if yr_meta.get("scheduleStatus"):
            year_obj["scheduleStatus"] = yr_meta["scheduleStatus"]

        years_payload[str(year)] = year_obj

    manifest = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sourceRegistry": "ingestion/ingestion_registry.json",
        "totalFiles": total_files,
        "yearCount": len(years_payload),
        "years": years_payload,
        "externalSources": _scan_external_sources() if include_external else {},
        "phase3Datasets": _scan_phase3_datasets(ds_dir),
    }

    _atomic_write_text(out_path, json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    try:
        from ingestion.checkpoints.phase4_checkpoint import record_phase4_checkpoint
        from ingestion.checkpoints.phase5_checkpoint import record_phase5_checkpoint

        record_phase4_checkpoint(
            checkpoint_id="CP-5",
            stage="P4-S5",
            title="Unified Cascade, Grounded AI Integration & Full Verification Gate",
            output_files=[out_path],
            metrics={
                "yearCount": manifest["yearCount"],
                "totalFiles": manifest["totalFiles"],
                "phase3And4DatasetsCount": len(manifest["phase3Datasets"]),
            },
        )
        record_phase5_checkpoint(
            checkpoint_id="EE-CP-5",
            stage="P5-S5",
            title="Stage 6 OAuGF & 6-Ledger Card in ProjectEvidenceModal, Smarter FOI Letters, Cascade & Full Verification Gate",
            output_files=[out_path, ds_dir / "evidence_engine_all_years.json"],
            metrics={
                "yearCount": manifest["yearCount"],
                "totalFiles": manifest["totalFiles"],
                "trackedCrossLedgerDatasetsCount": len(manifest["phase3Datasets"]),
            },
        )
    except Exception:
        pass
    return manifest


if __name__ == "__main__":
    result = build_provenance_manifest()
    print(
        f"Wrote {OUTPUT_PATH.relative_to(PROJECT_ROOT)} | "
        f"years={result['yearCount']} | totalFiles={result['totalFiles']} | "
        f"phase3={len(result.get('phase3Datasets', {}))}"
    )
