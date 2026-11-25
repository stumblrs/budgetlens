"""
Budget Lens - Smart Ingestion Pipeline CLI
==========================================
Autonomous, discovery-driven ingestion with:
  - Auto-discovery of all year folders in source_pdfs/
  - Incremental processing (SHA-256 fingerprint registry)
  - Crash-resume via per-file checkpoints
  - Gemma-4-E2B review (gracefully skipped if unavailable)
  - Post-ingestion cascade (registry, knowledge base, lineages)
  - Two-layer thermal protection for low-end hardware

Usage:
  python -m ingestion.cli                    # Smart auto-detect run
  python -m ingestion.cli --dry-run          # Discovery report only
  python -m ingestion.cli --overnight        # Conservative/safe mode
  python -m ingestion.cli --resume-only      # Finish partials only
  python -m ingestion.cli --skip-gemma       # Rule-engine-only mode
  python -m ingestion.cli --force 2024       # Re-ingest a specific year
  python -m ingestion.cli --reset-all        # Clear registry, re-ingest all
"""

import os
import sys

# Force UTF-8 output on Windows terminals (fixes cp1252 encoding errors)
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

import argparse
import math
import time
import re
from typing import List, Optional, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from ingestion.enrichers.gemma_analyst.analyst import GemmaAnalyst

from ingestion.scanner.discovery import DiscoveryEngine, YearGroup, DiscoveredFile
from ingestion.scanner.fingerprint import Fingerprint
from ingestion.scanner.registry import (
    IngestionRegistry, STATUS_NOT_FOUND, STATUS_PARTIAL, STATUS_COMPLETE, STATUS_FAILED, STATUS_STAGE1, STATUS_IN_PROGRESS
)
from ingestion.checkpoints.checkpoint_manager import CheckpointManager
from ingestion.parsers.pdf_parser import PdfParser
from ingestion.parsers.narrative_parser import NarrativeParser
from ingestion.indexers.db_builder import DbBuilder
from ingestion.indexers.narrative_builder import NarrativeBuilder
from ingestion.indexers.cascade import CascadeEngine
# Gemma runtime imports are deferred to main() to avoid llama_cpp DLL load on
# --dry-run and --skip-gemma modes (llama_cpp native init is expensive)

SOURCE_ROOT = "source_pdfs"

STATUS_ICONS = {
    STATUS_COMPLETE: "✓ COMPLETE",
    STATUS_STAGE1: "⚙ STAGED",
    STATUS_PARTIAL: "⚡ PARTIAL",
    STATUS_FAILED: "✗ FAILED",
    STATUS_NOT_FOUND: "★ NEW",
}


# ──────────────────────────────────────────────────────────────────────
# Discovery & Work Queue
# ──────────────────────────────────────────────────────────────────────

def build_work_queue(
    year_groups: List[YearGroup],
    registry: IngestionRegistry,
    checkpoint_manager: Optional[CheckpointManager] = None,
    resume_only: bool = False,
    force_year: Optional[int] = None
) -> List[dict]:
    """
    Classifies each discovered file as NEW, STAGED, PARTIAL, IN_PROGRESS, FAILED, or COMPLETE.
    Returns a list of work items.
    """
    work_queue = []

    for group in year_groups:
        for f in group.files:
            fp = Fingerprint.compute(f.path)
            fp_short = Fingerprint.short(fp)
            status = registry.get_status(fp)

            # Force override: reset registry entry so it re-ingests
            if force_year is not None and group.year == force_year:
                if status in (STATUS_COMPLETE, STATUS_STAGE1):
                    registry.reset_year(group.year)
                    status = STATUS_NOT_FOUND

            is_work = (status in (STATUS_NOT_FOUND, STATUS_PARTIAL, STATUS_FAILED, STATUS_STAGE1, STATUS_IN_PROGRESS))
            if getattr(f, "doc_role", "") == "DUPLICATE_SKIP":
                is_work = False
            if resume_only and status == STATUS_NOT_FOUND:
                is_work = False  # --resume-only skips new files

            cp_reg = registry.get_checkpoint_record(fp) or 0
            cp_file = checkpoint_manager.get_last_index(fp_short) if checkpoint_manager else 0
            checkpoint_record = max(cp_reg, cp_file)

            work_queue.append({
                "file": f,
                "year": group.year,
                "fingerprint": fp,
                "fingerprint_short": fp_short,
                "status": status,
                "is_work": is_work,
                "checkpoint_record": checkpoint_record
            })

    return work_queue


def print_discovery_report(work_queue: List[dict], registry: IngestionRegistry) -> None:
    """Prints the pre-run discovery report showing status of all found files."""
    new_count = sum(1 for w in work_queue if w["status"] == STATUS_NOT_FOUND)
    partial_count = sum(1 for w in work_queue if w["status"] == STATUS_PARTIAL)
    failed_count = sum(1 for w in work_queue if w["status"] == STATUS_FAILED)
    complete_count = sum(1 for w in work_queue if w["status"] == STATUS_COMPLETE)

    # Group by year for display
    by_year = {}
    for w in work_queue:
        yr = w["year"]
        if yr not in by_year:
            by_year[yr] = []
        by_year[yr].append(w)

    for year in sorted(by_year.keys()):
        print(f"\n  YEAR {year}")
        for w in by_year[year]:
            icon = STATUS_ICONS.get(w["status"], "? UNKNOWN")
            filename = w["file"].filename
            size_mb = w["file"].size_bytes / (1024 * 1024)

            if w["status"] == STATUS_PARTIAL:
                processed = w["checkpoint_record"]
                print(f"  |-- {filename:<50}  {icon}  {processed:,} records processed")
            elif w["status"] == STATUS_FAILED:
                entry = registry.get_entry(w["fingerprint"])
                err = entry.get("error", {}) if entry else {}
                err_msg = err.get("message", str(err)) if isinstance(err, dict) else str(err)
                print(f"  |-- {filename:<50}  {icon}  [RETRY PENDING] {err_msg[:40]}")
            elif w["status"] == STATUS_COMPLETE:
                entry = registry.get_entry(w["fingerprint"])
                total = entry.get("totalRecords", "?") if entry else "?"
                print(f"  |-- {filename:<50}  {icon}  {total:,} records")
            else:
                print(f"  |-- {filename:<50}  {icon}  ({size_mb:.1f} MB)")

    print(f"\n{'-' * 66}")
    print(f"  WORK QUEUE SUMMARY:")
    if new_count:
        print(f"    -> {new_count} new file(s) to ingest")
    if partial_count:
        print(f"    -> {partial_count} partial file(s) to resume")
    if failed_count:
        print(f"    -> {failed_count} failed file(s) queued for retry")
    if not new_count and not partial_count and not failed_count:
        print(f"    -> Nothing to do. All {complete_count} file(s) are COMPLETE.")
    print(f"{'-' * 66}")


# ──────────────────────────────────────────────────────────────────────
# Ingestion Runner
# ──────────────────────────────────────────────────────────────────────

def _partial_reviews_path(checkpoint_manager: CheckpointManager, fp_short: str) -> str:
    return os.path.join(checkpoint_manager.checkpoint_dir, f"{fp_short}_reviews.json")


def _load_partial_reviews(checkpoint_manager: CheckpointManager, fp_short: str) -> dict:
    import json
    path = _partial_reviews_path(checkpoint_manager, fp_short)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data if isinstance(data, dict) else {}
        except Exception:
            return {}
    return {}


def _save_partial_reviews(checkpoint_manager: CheckpointManager, fp_short: str, reviews: dict) -> None:
    import json
    path = _partial_reviews_path(checkpoint_manager, fp_short)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(reviews, f)
    os.replace(tmp, path)


def _clear_partial_reviews(checkpoint_manager: CheckpointManager, fp_short: str) -> None:
    path = _partial_reviews_path(checkpoint_manager, fp_short)
    if os.path.exists(path):
        try:
            os.remove(path)
        except Exception:
            pass


_ROLLUP_CODE_RE = re.compile(r"^[0-5]\d{8,9}$")
_ROUTINE_OVERHEAD_RE = re.compile(
    r"(telephone\s+charges|electricity\s+charges|internet\s+access|stationeries|water\s+rates|sewerage\s+charges|bank\s+charges|cleaning\s*&\s*fumigation|office\s+rent|maintenance\s+of\s+office\s+furniture)",
    re.IGNORECASE,
)


def is_rollup_skip(project: dict) -> bool:
    """Returns True when a record is a ministry/subheading summary rollup rather than a leaf appropriation item."""
    title_up = str(project.get("projectName") or "").strip().upper()
    code = str(project.get("projectCode") or "").strip()
    if title_up.startswith(("TOTAL:", "TOTAL ", "TOTAL-", "SUB-TOTAL", "SUB TOTAL", "GRAND TOTAL")):
        return True
    if _ROLLUP_CODE_RE.match(code):
        return True
    return False


def compute_forensic_priority(project: dict) -> float:
    """
    Computes Stage-2 forensic-priority score so flagged high-value capital anomalies run before routine overhead.
    Formula: severity_weight (HIGH=100, MEDIUM=50, LOW=20) + capital_bonus (+20) + log10(amount)*3 - overhead_demotion.
    """
    from ingestion.enrichers.forensic_rules import ForensicRules

    title = str(project.get("projectName") or "")
    amount = int(project.get("amount") or 0)
    spending_type = str(project.get("spendingType") or project.get("projectType") or "CAPITAL").upper()

    flags = ForensicRules.evaluate(title, amount)
    severity_weight = 0.0
    for fl in flags:
        sev = str(fl.get("severity") or "").lower()
        if sev == "high":
            severity_weight = max(severity_weight, 100.0)
        elif sev == "medium":
            severity_weight = max(severity_weight, 50.0)
        elif sev == "low":
            severity_weight = max(severity_weight, 20.0)

    capital_bonus = 20.0 if spending_type == "CAPITAL" else 0.0
    magnitude_score = math.log10(max(amount, 1)) * 3.0
    demotion = -60.0 if (amount < 50_000_000 and _ROUTINE_OVERHEAD_RE.search(title)) else 0.0
    return round(severity_weight + capital_bonus + magnitude_score + demotion, 3)


def run_file(
    work_item: dict,
    registry: IngestionRegistry,
    checkpoint_manager: CheckpointManager,
    db_builder: DbBuilder,
    gemma_analyst: Optional["GemmaAnalyst"],
    profile_settings: dict,
    is_stage1: bool = False,
    cascade: Optional[CascadeEngine] = None,
    priority_forensic: bool = False,
) -> bool:
    """
    Ingests a single PDF file. Returns True on success, False on failure.
    Handles checkpoint resume for PARTIAL files.
    """
    f: DiscoveredFile = work_item["file"]
    year = work_item["year"]
    fingerprint = work_item["fingerprint"]
    fp_short = work_item["fingerprint_short"]
    resume_from = work_item["checkpoint_record"]
    checkpoint_every = profile_settings["checkpoint_every"]

    print(f"\n  +- Ingesting: {f.filename} ({year}) {'[RESUMING]' if resume_from > 0 else ''}")
    print(f"  |  Path: {f.path}")

    try:
        registry.mark_in_progress(fingerprint, f.path, year, f.filename)

        # Handle NARRATIVE PDFs
        if f.doc_type == "NARRATIVE":
            n_parser = NarrativeParser(f.path, year)
            sections = n_parser.extract_key_sections()
            print(f"  |  [OK] Extracted text from narrative PDF: {f.filename} ({sections['totalPages']} pages)")

            extracted_narrative = n_parser.extract_structured_narrative()
            if gemma_analyst and gemma_analyst.client.is_available:
                from ingestion.enrichers.gemma_analyst.prompts import build_narrative_extraction_prompt
                from ingestion.enrichers.gemma_analyst.analyst import _safe_parse_json
                prompt = build_narrative_extraction_prompt(f.filename, sections["text"], year)
                res = gemma_analyst.client.infer(prompt, max_tokens=350)
                llm_data = _safe_parse_json(res)
                if isinstance(llm_data, dict):
                    for k, v in llm_data.items():
                        if v not in (None, "", []):
                            extracted_narrative[k] = v

            n_builder = NarrativeBuilder()
            n_builder.write_narrative_summary(year, f.filename, extracted_narrative)
            registry.mark_complete(fingerprint, 0, 0)
            checkpoint_manager.clear(fp_short)
            print(f"  |  [OK] Narrative summary saved to public/datasets/narratives/{year}.json")
            print(f"  +---------------------------------------------------------")
            return True

        # Handle LINE_ITEMS PDFs (Tables)
        from ingestion.staging.staging_manager import StagingManager
        staging_mgr = StagingManager()

        existing_year_records = staging_mgr.load_raw_records(year)
        file_staged = [r for r in existing_year_records if r.get("sourceFile") == f.filename]
        total_pages = 0

        if file_staged and work_item["status"] in (STATUS_STAGE1, STATUS_PARTIAL, STATUS_IN_PROGRESS):
            all_projects = file_staged
            print(f"  |  [OK] Loaded {len(all_projects):,} staged records from lake (skipping duplicate parse)")
        else:
            parser = PdfParser(f.path, year, file_tag=fp_short[:6])
            all_projects, total_pages = parser.parse()
            print(f"  |  [OK] Parsed {total_pages} pages, {len(all_projects):,} records extracted")

            # Save to Staging Lake (Stage 1, idempotent per sourceFile)
            staging_mgr.save_raw_records(year, f.filename, all_projects, file_tag=fp_short[:6])
            print(f"  |  [OK] Saved {len(all_projects):,} raw records to Staging Lake (ingestion/staging/{year}/)")

        # Stage 1: Publish baseline rule-verified dataset immediately so webapp displays live data
        if is_stage1:
            cumulative_projects = staging_mgr.load_raw_records(year) or all_projects
            source_files = staging_mgr.get_source_files(year) or [f.filename]
            db_builder.write_year_dataset(
                year=year,
                projects=cumulative_projects,
                total_pages=total_pages,
                source_files=source_files,
                sha256=fingerprint,
                preserve_existing_gemma=True,
            )
            if cascade:
                cascade.run(fast=True)
            total_amount = sum(p["amount"] for p in all_projects)
            registry.mark_stage1(fingerprint, len(all_projects), total_amount)
            checkpoint_manager.clear(fp_short)
            print(f"  |  [OK] Stage 1 Complete & Published Live -- {len(all_projects):,} records")
            print(f"  +---------------------------------------------------------")
            return True

        # Stage 2 / Full Mode: Gemma analysis + live checkpoint dataset publishing
        # Never reorder files that already have a live checkpoint (resume_from > 0).
        if priority_forensic and resume_from == 0:
            filtered = [p for p in all_projects if not is_rollup_skip(p)]
            all_projects = sorted(filtered, key=compute_forensic_priority, reverse=True)
            print(f"  |  [PRIORITY] Forensic queue ordered ({len(all_projects):,} leaf records; rollups skipped)")

        projects = all_projects[resume_from:]
        if resume_from > 0:
            print(f"  |  [RESUME] Resuming from record {resume_from:,} "
                  f"({len(projects):,} remaining)")

        gemma_reviews = _load_partial_reviews(checkpoint_manager, fp_short) if resume_from > 0 else {}
        high_risk = []

        try:
            for i, project in enumerate(projects):
                global_idx = resume_from + i

                # Real-time terminal progress
                proj_name = project.get("projectName", "")[:45]
                print(f"  |  [RECORD {global_idx + 1}/{len(all_projects)}] {proj_name}...", end="\r", flush=True)

                # Gemma review
                if gemma_analyst and gemma_analyst.client.is_available:
                    review = gemma_analyst.analyse(project)
                    gemma_reviews[project["id"]] = review
                    risk = review.get("ambiguityDetection", {}).get("riskLevel", "LOW")
                    if risk in ("HIGH", "CRITICAL"):
                        high_risk.append({**project, "gemmaReview": review})

                # Checkpoint every N records + flush live progress to webapp
                if (global_idx + 1) % checkpoint_every == 0:
                    checkpoint_manager.save(fingerprint, fp_short, f.path, year, global_idx + 1)
                    registry.save_checkpoint(fingerprint, global_idx + 1)
                    _save_partial_reviews(checkpoint_manager, fp_short, gemma_reviews)

                    cumulative_projects = staging_mgr.load_raw_records(year) or all_projects
                    source_files = staging_mgr.get_source_files(year) or [f.filename]
                    db_builder.write_year_dataset(
                        year=year,
                        projects=cumulative_projects,
                        total_pages=total_pages,
                        source_files=source_files,
                        sha256=fingerprint,
                        gemma_reviews=gemma_reviews,
                        preserve_existing_gemma=True,
                    )
                    if cascade:
                        cascade.run(fast=True)
                    print(f"\n  |  [CHECKPOINT] {global_idx + 1:,}/{len(all_projects):,} records published live")
        except KeyboardInterrupt:
            current_processed = global_idx + 1 if 'global_idx' in locals() else resume_from
            if current_processed > 0:
                print(f"\n  |  [INTERRUPT] Saving recovery checkpoint at record {current_processed:,}/{len(all_projects):,}...")
                checkpoint_manager.save(fingerprint, fp_short, f.path, year, current_processed)
                registry.save_checkpoint(fingerprint, current_processed)
                _save_partial_reviews(checkpoint_manager, fp_short, gemma_reviews)
            raise

        print(f"\n  |  [OK] All {len(all_projects):,} records analysed")

        # Load cumulative year records and source files from Staging Lake for dataset publishing
        cumulative_projects = staging_mgr.load_raw_records(year) or all_projects
        source_files = staging_mgr.get_source_files(year) or [f.filename]

        print(f"  |  Writing cumulative dataset ({len(cumulative_projects):,} total records across {len(source_files)} file(s))...")
        db_builder.write_year_dataset(
            year=year,
            projects=cumulative_projects,
            total_pages=total_pages,
            source_files=source_files,
            sha256=fingerprint,
            gemma_reviews=gemma_reviews,
            preserve_existing_gemma=True,
        )
        if cascade:
            cascade.run(fast=False)

        # Mark complete
        total_amount = sum(p["amount"] for p in all_projects)
        registry.mark_complete(fingerprint, len(all_projects), total_amount)
        checkpoint_manager.clear(fp_short)
        _clear_partial_reviews(checkpoint_manager, fp_short)

        print(f"  |  [OK] Complete -- {len(all_projects):,} records written")
        if high_risk:
            print(f"  |  [WARN] {len(high_risk)} high-risk records flagged for review")
        print(f"  +---------------------------------------------------------")
        return True

    except KeyboardInterrupt:
        print(f"\n  |  [INTERRUPT] Process killed by user (Ctrl+C). Exiting.")
        sys.exit(130)

    except Exception as e:
        registry.mark_failed(fingerprint, e, stage="STAGE_1_PARSING")
        print(f"  |  [FAIL] [{type(e).__name__}] {e}")
        print(f"  +---------------------------------------------------------")
        return False


# ──────────────────────────────────────────────────────────────────────
# Main Entrypoint
# ──────────────────────────────────────────────────────────────────────

def main():
    cli = argparse.ArgumentParser(
        description="Budget Lens Smart Ingestion Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    cli.add_argument("--stage1", action="store_true",
                     help="Stage 1: Extract PDFs to Staging Lake only (Fast, 0 Gemma latency)")
    cli.add_argument("--stage2", action="store_true",
                     help="Stage 2: Run Gemma enrichment on Staging Lake and publish to public/datasets/")
    cli.add_argument("--dry-run", action="store_true",
                     help="Show discovery report only, ingest nothing")
    cli.add_argument("--overnight", action="store_true",
                     help="Conservative mode: slower, longer cooldowns, safer")
    cli.add_argument("--resume-only", action="store_true",
                     help="Only resume PARTIAL files, skip new ones")
    cli.add_argument("--skip-gemma", action="store_true",
                     help="Run without Gemma (rule-engine only, faster)")
    cli.add_argument("--force", type=int, metavar="YEAR",
                     help="Re-ingest a specific year even if COMPLETE")
    cli.add_argument("--reset-all", action="store_true",
                     help="Clear entire registry and re-ingest everything")
    cli.add_argument("--clean", action="store_true",
                     help="Reset registry, staging lake, checkpoints, and live datasets for a fresh start")
    cli.add_argument("--sync-live", action="store_true",
                     help="Sanitize staging lake (1999-2026), publish live datasets preserving existing Gemma reviews, and rebuild cascade")
    cli.add_argument("--rebuild-cascade-only", action="store_true",
                     help="Run coverage audit, backfill missing statistics provenance/tiers, and rebuild registry.json without halting live daemons")
    cli.add_argument("--priority-forensic", action="store_true",
                     help="Order unstarted Stage-2 files by forensic risk score before routine overhead rows (never alters active checkpoints)")
    cli.add_argument("--source", type=str, default=SOURCE_ROOT,
                     help=f"Path to source PDF folder (default: {SOURCE_ROOT})")

    args = cli.parse_args()

    # ── Header ─────────────────────────────────────────────────────────
    print(f"\n{'=' * 66}")
    print(f"  Budget Lens — Smart Ingestion Pipeline")
    if args.overnight:
        print(f"  Mode: [OVERNIGHT] (conservative, crash-safe)")
    elif args.dry_run:
        print(f"  Mode: [DRY RUN] (discovery only)")
    elif args.skip_gemma or args.stage1:
        print(f"  Mode: [STAGE 1 / FAST] (extraction to Staging Lake, no Gemma)")
    else:
        print(f"  Mode: [FULL / STAGE 2] (with Gemma analyst)")
    print(f"{'=' * 66}")

    # ── Registry & Scanner ─────────────────────────────────────────────
    registry = IngestionRegistry()
    checkpoint_manager = CheckpointManager()

    if args.clean:
        from ingestion.staging.staging_manager import StagingManager
        confirm = input("\n  ⚠  CLEAN DATASET: This clears all staging files, checkpoints, live datasets, and registry.\n  Type 'yes' to confirm: ").strip().lower()
        if confirm != "yes":
            print("  Aborted.")
            return
        registry.reset_all()
        staging_mgr = StagingManager()
        staging_mgr.clear_all()
        checkpoint_manager.clear_all()
        if os.path.exists("public/datasets"):
            import shutil
            for entry in os.scandir("public/datasets"):
                if entry.name != ".gitkeep":
                    if entry.is_dir():
                        shutil.rmtree(entry.path, ignore_errors=True)
                    else:
                        try:
                            os.remove(entry.path)
                        except Exception:
                            pass
        print("  ✓ All staging files, checkpoints, live datasets, indexes, narratives, and registry cleared successfully.\n")
        return

    if args.sync_live:
        from ingestion.staging.staging_manager import StagingManager
        staging_mgr = StagingManager()
        db_builder = DbBuilder()
        cascade = CascadeEngine()

        staged_years = sorted(staging_mgr.get_staging_summary().keys())
        print(f"\n  [SYNC-LIVE] Sanitizing and publishing {len(staged_years)} staged years ({min(staged_years) if staged_years else '?'}-{max(staged_years) if staged_years else '?'})...")
        for yr in staged_years:
            clean_records, clean_sources, diag = staging_mgr.sanitize_and_deduplicate_year(yr, write_back=True)
            total_amt = sum(p.get("amount", 0) for p in clean_records)
            db_builder.write_year_dataset(
                year=yr,
                projects=clean_records,
                total_pages=0,
                source_files=clean_sources,
                preserve_existing_gemma=True,
            )
            print(
                f"  |  {yr}: {diag['cleanCount']:,} clean records "
                f"(raw={diag['rawCount']:,}, dupes={diag['droppedDupes']:,}, invalid/rollups={diag['droppedInvalid']:,}) "
                f"-> NGN {total_amt / 1e12:.2f}T"
            )
        cascade.run(fast=False)
        print("  [OK] Live datasets & global indexes synchronized.\n")
        return

    if args.rebuild_cascade_only:
        from ingestion.indexers.coverage_audit import run_coverage_audit

        print("\n  [CASCADE-ONLY] Auditing coverage and synchronizing SHA-256 registry provenance...")
        audit = run_coverage_audit(write=True)
        in_progress_years = {
            int(entry.get("year"))
            for entry in getattr(registry, "data", {}).get("files", {}).values()
            if entry.get("status") == STATUS_IN_PROGRESS and entry.get("year")
        }
        cascade = CascadeEngine()
        patched = cascade.backfill_statistics_provenance(skip_years=in_progress_years)
        cascade.run(fast=True)
        print(
            f"  [OK] Coverage audit ({audit['years_audited']} yrs) & provenance backfill "
            f"(patched {patched} year stats; skipped active={sorted(in_progress_years)}) complete.\n"
        )
        return

    if args.reset_all:
        confirm = input("\n  ⚠  RESET ALL: This clears the registry and re-ingests "
                        "everything.\n  Type 'yes' to confirm: ").strip().lower()
        if confirm != "yes":
            print("  Aborted.")
            return
        registry.reset_all()
        print("  Registry cleared.\n")

    # ── Hardware Detection & Gemma Setup ───────────────────────────────
    if args.stage1:
        args.skip_gemma = True

    gemma_analyst = None
    if not args.skip_gemma and not args.dry_run:
        from ingestion.enrichers.gemma_analyst.gemma_client import (
            GemmaClient, detect_hardware_profile, print_hardware_summary
        )
        from ingestion.enrichers.gemma_analyst.analyst import GemmaAnalyst
        profile_name, profile_settings = detect_hardware_profile()
        print(f"\n  Hardware Profile: {profile_name}")
        print_hardware_summary(profile_name, profile_settings)
        client = GemmaClient(profile_settings)
        gemma_analyst = GemmaAnalyst(client, profile_settings,
                                     overnight_mode=args.overnight)
    else:
        try:
            import psutil
            cores = psutil.cpu_count(logical=False) or 2
            avail_gb = psutil.virtual_memory().available / (1024 ** 3)
            profile_settings = {
                "n_threads": 2 if cores <= 4 else 5,
                "n_ctx": 512 if cores <= 4 else 1024,
                "n_batch": 128 if cores <= 4 else 256,
                "batch_records": 8 if cores <= 4 else 20,
                "cooldown_seconds": 12 if cores <= 4 else 6,
                "checkpoint_every": 50 if cores <= 4 else 100,
            }
            profile_name = "I3_CONSERVATIVE" if cores <= 4 else "I5_OPTIMAL"
        except ImportError:
            profile_settings = {"n_threads": 2, "n_ctx": 512, "n_batch": 128,
                                "batch_records": 8, "cooldown_seconds": 12,
                                "checkpoint_every": 50}
            profile_name = "I3_CONSERVATIVE"
        print(f"\n  Hardware Profile: {profile_name} (Gemma not loaded)")

    print(f"\n{'─' * 66}")
    print(f"  Discovery Scan: {os.path.abspath(args.source)}")
    print(f"{'─' * 66}")

    try:
        engine = DiscoveryEngine(source_root=args.source)
        year_groups = engine.scan()
    except FileNotFoundError as e:
        print(f"\n  ✗ {e}")
        sys.exit(1)

    if not year_groups:
        print("\n  No PDF year folders found. Drop PDFs into source_pdfs/{year}/ and retry.")
        sys.exit(0)

    engine.print_scan_summary(year_groups)

    # ── Work Queue ─────────────────────────────────────────────────────
    work_queue = build_work_queue(
        year_groups, registry, checkpoint_manager,
        resume_only=args.resume_only,
        force_year=args.force
    )

    print()
    print_discovery_report(work_queue, registry)

    pending = [w for w in work_queue if w["is_work"]]

    if args.dry_run or not pending:
        if not pending:
            print("\n  ✓ All files are up to date. Nothing to ingest.")
        else:
            print("\n  Dry run complete. No files were modified.")
        return

    # ── Confirm ────────────────────────────────────────────────────────
    if not args.overnight:
        try:
            confirm = input(f"\n  Proceed with ingesting {len(pending)} file(s)? [Y/n]: ")
            if confirm.strip().lower() == "n":
                print("  Aborted.")
                return
        except (EOFError, KeyboardInterrupt):
            return

    # ── Run Ingestion ──────────────────────────────────────────────────
    db_builder = DbBuilder()
    cascade = CascadeEngine()

    years_completed = []
    start_time = time.time()

    for work_item in pending:
        success = run_file(
            work_item=work_item,
            registry=registry,
            checkpoint_manager=checkpoint_manager,
            db_builder=db_builder,
            gemma_analyst=gemma_analyst,
            profile_settings=profile_settings,
            is_stage1=args.stage1,
            cascade=cascade,
            priority_forensic=args.priority_forensic
        )
        if success:
            years_completed.append(work_item["year"])
        else:
            if not isinstance(sys.exc_info()[1], KeyboardInterrupt):
                continue
            break

    # If stage 2 or full mode, rebuild cascade across all years
    if not args.stage1 and years_completed:
        cascade.run()

    # ── Final Summary ──────────────────────────────────────────────────
    elapsed = time.time() - start_time
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    print(f"\n{'=' * 66}")
    print(f"  Ingestion Session Complete")
    print(f"  Years processed: {sorted(list(set(years_completed)))}")
    print(f"  Time elapsed:    {minutes}m {seconds}s")
    print(f"  Registry:        {registry.registry_path}")
    print(f"  Outputs:         public/datasets/")
    print(f"{'=' * 66}\n")


if __name__ == "__main__":
    main()
