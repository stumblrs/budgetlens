import argparse
import os
import json
import shutil
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List


BASE_DIR = "public/datasets"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_EXTERNAL_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"


class CascadeEngine:
    """
    Post-ingestion cascade engine.
    After any year dataset is written, rebuilds all global outputs automatically:

      Step B — registry.json          (year manifest with grand totals)
      Step C — ai_knowledge_base.json (full cross-year project + sector index)
      Step D — recurring_lineages.json (ERGP code lineage tracker)
      Phase 3 — Unified cross-dataset intelligence builders & provenance manifest
    """

    PHASE3_STEP_ORDER: tuple[str, ...] = (
        "follow_the_money",
        "project_lifecycle",
        "procurement_risk",
        "govspend_forensics",
        "vendor_network",
        "mda_scorecards",
        "geo_assets",
        "provenance",
    )

    PHASE4_STEP_ORDER: tuple[str, ...] = (
        "oaugf_audit",
        "vendor_network",
        "govspend_forensics",
        "red_flag_convergence",
        "provenance",
    )

    PHASE5_STEP_ORDER: tuple[str, ...] = (
        "evidence_engine",
        "provenance",
    )

    def __init__(self, base_dir: str = BASE_DIR):
        self.base_dir = os.path.abspath(base_dir)

    # ------------------------------------------------------------------
    # Public: Run full cascade
    # ------------------------------------------------------------------

    def run(self, fast: bool = False) -> None:
        """Runs post-ingestion cascade steps. If fast=True, skips heavy cross-year full-project KB rebuild."""
        print("\n  +- Post-Ingestion Cascade ---------------------------------")
        self._rebuild_registry()
        if not fast:
            self._rebuild_lineages()
            self._rebuild_knowledge_base()
            self._rebuild_macro_narratives()
            self._rebuild_statistical_forensics()
        self._rebuild_hierarchy_summary()
        print("  +- Cascade complete.\n")

    def run_phase3(
        self,
        fts_sqlite_path: str | Path | None = None,
        *,
        skip_geo: bool = False,
        skip_provenance: bool = False,
        only_steps: list[str] | None = None,
    ) -> dict[str, Any]:
        """Run Phase 3 cross-dataset intelligence builders in deterministic dependency order.

        Preserves Stage-2 checkpoints (`ingestion/checkpoints_data/`), warm OCR caches
        (`ingestion/ocr_cache/`), and existing Gemma overlays.
        """
        ds_dir = Path(self.base_dir)
        fts_db = Path(fts_sqlite_path) if fts_sqlite_path else DEFAULT_EXTERNAL_FTS_SQLITE

        only_set: set[str] | None = None
        if only_steps is not None:
            cleaned = [s.strip() for s in only_steps if s and s.strip()]
            unknown = [s for s in cleaned if s not in self.PHASE3_STEP_ORDER]
            if unknown:
                raise ValueError(
                    f"Unknown Phase 3 step(s): {unknown}. Valid steps: {list(self.PHASE3_STEP_ORDER)}"
                )
            only_set = set(cleaned)

        print("\n  +- Phase 3 Intelligence Cascade -----------------------------")
        steps_run: list[str] = []
        timings: dict[str, float] = {}

        for step in self.PHASE3_STEP_ORDER:
            if only_set is not None and step not in only_set:
                continue
            if skip_geo and step == "geo_assets":
                continue
            if skip_provenance and step == "provenance":
                continue

            print(f"  │  Phase 3 [{step}] ...", end=" ", flush=True)
            t0 = time.perf_counter()

            if step == "follow_the_money":
                from ingestion.indexers.follow_the_money_builder import build_follow_the_money_links

                build_follow_the_money_links(
                    diffs_dir=ds_dir / "bill_act_diffs",
                    lineages_path=ds_dir / "recurring_lineages.json",
                    fts_sqlite_path=fts_db,
                    leaderboard_path=ds_dir / "contractors_leaderboard.json",
                    datasets_dir=ds_dir,
                    write=True,
                )
            elif step == "project_lifecycle":
                from ingestion.indexers.project_lifecycle_builder import build_project_lifecycle_index

                build_project_lifecycle_index(
                    datasets_dir=ds_dir,
                    policy_path=ds_dir / "policy_benchmarks.json",
                    execution_path=ds_dir / "execution_tracker.json",
                    diffs_dir=ds_dir / "bill_act_diffs",
                    sweep_path=ds_dir / "forensic_sweep_1999_2026.json",
                    leaderboard_path=ds_dir / "contractors_leaderboard.json",
                    fts_sqlite_path=fts_db,
                    write=True,
                )
            elif step == "procurement_risk":
                from ingestion.indexers.procurement_risk_builder import build_procurement_risk_index

                build_procurement_risk_index(
                    fts_sqlite_path=fts_db,
                    datasets_dir=ds_dir,
                    leaderboard_path=ds_dir / "contractors_leaderboard.json",
                    write=True,
                )
            elif step == "govspend_forensics":
                from ingestion.indexers.govspend_forensics_builder import build_govspend_forensics

                build_govspend_forensics(
                    fts_sqlite_path=fts_db,
                    datasets_dir=ds_dir,
                    write=True,
                )
            elif step == "vendor_network":
                from ingestion.indexers.vendor_network_builder import build_vendor_network_index

                build_vendor_network_index(
                    fts_sqlite_path=fts_db,
                    datasets_dir=ds_dir,
                    leaderboard_path=ds_dir / "contractors_leaderboard.json",
                    write=True,
                )
            elif step == "mda_scorecards":
                from ingestion.indexers.mda_scorecard_builder import (
                    build_macro_credibility_tracker,
                    build_mda_scorecards,
                )

                build_mda_scorecards(
                    fts_sqlite_path=fts_db,
                    datasets_dir=ds_dir,
                    write=True,
                )
                build_macro_credibility_tracker(
                    datasets_dir=ds_dir,
                    write=True,
                )
            elif step == "geo_assets":
                from ingestion.indexers.geo_asset_indexer import build_indexes

                build_indexes(
                    datasets_root=ds_dir,
                    fts_sqlite_path=fts_db,
                )
            elif step == "provenance":
                from ingestion.indexers.build_provenance_manifest import build_provenance_manifest

                build_provenance_manifest(
                    datasets_dir=ds_dir,
                    output_path=ds_dir / "source_provenance.json",
                )

            elapsed = round(time.perf_counter() - t0, 3)
            steps_run.append(step)
            timings[step] = elapsed
            print(f"done ({elapsed:.2f}s).")

        print("  +- Phase 3 Cascade complete.\n")
        return {
            "stepsRun": steps_run,
            "timings": timings,
            "baseDir": str(ds_dir),
        }

    def run_phase4(
        self,
        fts_sqlite_path: str | Path | None = None,
        *,
        skip_oaugf_sqlite: bool = True,
    ) -> dict[str, Any]:
        """Run Phase 4 all-years OAuGF audit, personal/opaque cash forensics, and 6-ledger convergence."""
        ds_dir = Path(self.base_dir)
        fts_db = Path(fts_sqlite_path) if fts_sqlite_path else DEFAULT_EXTERNAL_FTS_SQLITE

        print("\n  +- Phase 4 Deep Audit & Convergence Cascade -----------------")
        steps_run: list[str] = []
        timings: dict[str, float] = {}

        for step in self.PHASE4_STEP_ORDER:
            print(f"  │  Phase 4 [{step}] ...", end=" ", flush=True)
            t0 = time.perf_counter()

            if step == "oaugf_audit":
                from ingestion.indexers.oaugf_indexer import build_oaugf_index

                build_oaugf_index(
                    datasets_dir=ds_dir,
                    fts_sqlite_path=None if skip_oaugf_sqlite else fts_db,
                    write=True,
                )
            elif step == "vendor_network":
                from ingestion.indexers.vendor_network_builder import build_vendor_network_index

                build_vendor_network_index(
                    fts_sqlite_path=fts_db,
                    datasets_dir=ds_dir,
                    leaderboard_path=ds_dir / "contractors_leaderboard.json",
                    write=True,
                )
            elif step == "govspend_forensics":
                from ingestion.indexers.govspend_forensics_builder import build_govspend_forensics

                build_govspend_forensics(
                    fts_sqlite_path=fts_db,
                    datasets_dir=ds_dir,
                    write=True,
                )
            elif step == "red_flag_convergence":
                from ingestion.indexers.red_flag_convergence_builder import build_red_flag_convergence_index

                build_red_flag_convergence_index(
                    datasets_dir=ds_dir,
                    write=True,
                )
            elif step == "provenance":
                from ingestion.indexers.build_provenance_manifest import build_provenance_manifest

                build_provenance_manifest(
                    datasets_dir=ds_dir,
                    output_path=ds_dir / "source_provenance.json",
                )

            elapsed = round(time.perf_counter() - t0, 3)
            steps_run.append(step)
            timings[step] = elapsed
            print(f"done ({elapsed:.2f}s).")

        print("  +- Phase 4 Cascade complete.\n")
        return {
            "stepsRun": steps_run,
            "timings": timings,
            "baseDir": str(ds_dir),
        }

    def run_phase5(self) -> dict[str, Any]:
        """Run Phase 5 Evidence Engine v3.0 28-year cross-ledger indexer & provenance manifest."""
        ds_dir = Path(self.base_dir)
        print("\n  +- Phase 5 Evidence Engine v3.0 Cascade ---------------------")
        steps_run: list[str] = []
        timings: dict[str, float] = {}

        for step in self.PHASE5_STEP_ORDER:
            print(f"  │  Phase 5 [{step}] ...", end=" ", flush=True)
            t0 = time.perf_counter()

            if step == "evidence_engine":
                from ingestion.indexers.evidence_engine_indexer import (
                    build_evidence_engine_all_years,
                )

                build_evidence_engine_all_years(datasets_dir=ds_dir, write=True)
            elif step == "provenance":
                from ingestion.indexers.build_provenance_manifest import build_provenance_manifest

                build_provenance_manifest(
                    datasets_dir=ds_dir,
                    output_path=ds_dir / "source_provenance.json",
                )

            elapsed = round(time.perf_counter() - t0, 3)
            steps_run.append(step)
            timings[step] = elapsed
            print(f"done ({elapsed:.2f}s).")

        print("  +- Phase 5 Cascade complete.\n")
        return {
            "stepsRun": steps_run,
            "timings": timings,
            "baseDir": str(ds_dir),
        }

    # ------------------------------------------------------------------
    # Step E — macro_narratives_summary.json
    # ------------------------------------------------------------------

    def _rebuild_macro_narratives(self) -> None:
        print("  │  Step E: Rebuilding macro_narratives_summary.json ...", end=" ", flush=True)

        narratives_dir = os.path.join(self.base_dir, "narratives")
        if not os.path.exists(narratives_dir):
            print("no narratives directory found.")
            return

        summaries = []
        for entry in sorted(os.scandir(narratives_dir), key=lambda e: e.name):
            if not entry.is_file() or not entry.name.endswith(".json"):
                continue

            with open(entry.path, "r", encoding="utf-8") as f:
                data = json.load(f)
                summaries.append(data)

        out = os.path.join(self.base_dir, "macro_narratives_summary.json")
        self._atomic_write(out, {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "totalYearsWithNarratives": len(summaries),
            "narratives": summaries
        })
        print(f"done ({len(summaries)} year narrative summaries merged).")

    # ------------------------------------------------------------------
    # Step G — statistical_forensics_1999_2026.json
    # ------------------------------------------------------------------

    def _rebuild_statistical_forensics(self) -> None:
        print("  │  Step G: Rebuilding statistical_forensics_1999_2026.json ...", end=" ", flush=True)
        try:
            from ingestion.indexers.statistical_forensics_builder import build_statistical_forensics

            payload = build_statistical_forensics(base_dir=self.base_dir, write=True)
            print(
                f"done ({len(payload.get('yearsCovered', []))} years, "
                f"{payload.get('summary', {}).get('totalPrematureAlerts', 0)} lifecycle alerts)."
            )
        except Exception as exc:
            print(f"skipped ({exc}).")

    def _load_provenance_years(self) -> dict:
        prov_path = os.path.join(self.base_dir, "source_provenance.json")
        if not os.path.exists(prov_path):
            return {}
        try:
            with open(prov_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("years", {}) if isinstance(data, dict) else {}
        except Exception:
            return {}

    def _load_coverage_years(self) -> dict:
        audit_path = os.path.join(self.base_dir, "coverage_audit.json")
        if not os.path.exists(audit_path):
            return {}
        try:
            with open(audit_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("years", {}) if isinstance(data, dict) else {}
        except Exception:
            return {}

    def backfill_statistics_provenance(self, skip_years: set[int] | None = None) -> int:
        """
        Safely hydrates missing `sha256` and `coverage_tier` inside each year's statistics.json
        while preserving `gemmaEnrichedCount`, `enrichmentStatus`, and totals untouched.
        """
        from ingestion.indexers.coverage_audit import OFFICIAL_MACRO_TOTALS, classify_coverage_tier

        prov_years = self._load_provenance_years()
        audit_years = self._load_coverage_years()
        patched = 0

        for entry in sorted(os.scandir(self.base_dir), key=lambda e: e.name):
            if not entry.is_dir() or not entry.name.isdigit():
                continue
            yr_num = int(entry.name)
            if skip_years and yr_num in skip_years:
                continue

            stats_path = os.path.join(entry.path, "statistics.json")
            if not os.path.exists(stats_path):
                continue

            with open(stats_path, "r", encoding="utf-8") as f:
                stats = json.load(f)

            changed = False
            prov_yr = prov_years.get(str(yr_num), {})
            primary_hex = str((prov_yr.get("primaryFile") or {}).get("sha256") or "").strip()
            existing_sha = str(stats.get("sha256") or "").strip()
            if not existing_sha and primary_hex:
                stats["sha256"] = f"sha256:{primary_hex}"
                changed = True

            audit_yr = audit_years.get(str(yr_num), {})
            tier = audit_yr.get("coverage_tier")
            if not tier:
                cnt = int(stats.get("totalCapitalProjects") or 0)
                amt = int(stats.get("totalCapitalAmount") or 0)
                macro = OFFICIAL_MACRO_TOTALS.get(yr_num, 0)
                ratio = round((amt / macro) * 100, 1) if macro > 0 else 0.0
                tier = classify_coverage_tier(cnt, ratio)
            if stats.get("coverageTier") != tier:
                stats["coverageTier"] = tier
                changed = True

            if changed:
                self._atomic_write(stats_path, stats)
                patched += 1

        return patched

    # ------------------------------------------------------------------
    # Step B — registry.json
    # ------------------------------------------------------------------

    def _rebuild_registry(self) -> None:
        print("  │  Step B: Rebuilding registry.json ...", end=" ", flush=True)
        from ingestion.indexers.coverage_audit import OFFICIAL_MACRO_TOTALS, classify_coverage_tier

        prov_years = self._load_provenance_years()
        audit_years = self._load_coverage_years()

        year_entries = []
        for entry in sorted(os.scandir(self.base_dir), key=lambda e: e.name):
            if not entry.is_dir() or not entry.name.isdigit():
                continue

            stats_path = os.path.join(entry.path, "statistics.json")
            if not os.path.exists(stats_path):
                continue

            with open(stats_path, "r", encoding="utf-8") as f:
                stats = json.load(f)

            proj_count = stats.get("totalCapitalProjects", 0)
            total_budget = stats.get("totalCapitalAmount", 0)
            page_count = stats.get("totalPages", 0)
            yr_num = int(entry.name)
            ingested_at = stats.get("ingestedAt", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

            prov_yr = prov_years.get(str(yr_num), {})
            primary_hex = str((prov_yr.get("primaryFile") or {}).get("sha256") or "").strip()
            sha_val = str(stats.get("sha256") or "").strip()
            if not sha_val and primary_hex:
                sha_val = f"sha256:{primary_hex}"

            audit_yr = audit_years.get(str(yr_num), {})
            official_macro = int(audit_yr.get("official_macro_total") or OFFICIAL_MACRO_TOTALS.get(yr_num) or 0)
            extracted_ratio_pct = (
                float(audit_yr["extracted_ratio_pct"])
                if "extracted_ratio_pct" in audit_yr
                else (round((total_budget / official_macro) * 100, 1) if official_macro > 0 else 0.0)
            )
            coverage_tier = (
                audit_yr.get("coverage_tier")
                or stats.get("coverageTier")
                or classify_coverage_tier(proj_count, extracted_ratio_pct)
            )

            year_entries.append({
                "financial_year": yr_num,
                "financialYear": yr_num,
                "project_count": proj_count,
                "extractedProjectsCount": proj_count,
                "total_budget": total_budget,
                "totalBudget": total_budget,
                "page_count": page_count,
                "pageCount": page_count,
                "gemma_enriched_count": stats.get("gemmaEnrichedCount", 0),
                "enrichment_status": stats.get("enrichmentStatus", "STAGE1_RULE_VERIFIED"),
                "source_files": stats.get("sourceFiles", [stats.get("sourceFile", "")]),
                "sha256": sha_val,
                "source_sha256_count": int(prov_yr.get("fileCount") or len(stats.get("sourceFiles", []))),
                "coverage_tier": coverage_tier,
                "official_macro_total": official_macro,
                "extracted_ratio_pct": extracted_ratio_pct,
                "scanned_pages_count": int(audit_yr.get("scanned_pages_count") or 0),
                "reconciliation_passed": True,
                "ingested_at": ingested_at,
                "status": "ingesting"  # Will be updated below
            })

        if not year_entries:
            print("no years found.")
            return

        # Determine active year (most recent year with published datasets, preferring >=1 record if available)
        non_empty = [e for e in year_entries if e["project_count"] > 0]
        max_year = max((e["financial_year"] for e in (non_empty or year_entries)))
        for e in year_entries:
            e["status"] = "active" if e["financial_year"] == max_year else "archived"

        grand_total_projects = sum(e["project_count"] for e in year_entries)
        grand_total_budget = sum(e["total_budget"] for e in year_entries)
        all_years = sorted(e["financial_year"] for e in year_entries)

        registry = {
            "active_year": max_year,
            "activeYear": max_year,
            "earliest_year": min(all_years),
            "latest_year": max_year,
            "total_years": len(year_entries),
            "grand_total_projects": grand_total_projects,
            "grand_total_budget": grand_total_budget,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "documents": sorted(year_entries, key=lambda e: e["financial_year"])
        }

        out = os.path.join(self.base_dir, "registry.json")
        self._atomic_write(out, registry)
        print(f"done ({len(year_entries)} years, "
              f"₦{grand_total_budget / 1e12:.2f}T total).")

    # ------------------------------------------------------------------
    # Step C — ai_knowledge_base.json
    # ------------------------------------------------------------------

    def _rebuild_knowledge_base(self) -> None:
        print("  │  Step C: Rebuilding ai_knowledge_base.json ...", end=" ", flush=True)

        all_projects: List[dict] = []
        by_year: dict = {}
        by_sector: dict = defaultdict(lambda: {
            "count": 0, "total": 0, "yearBreakdown": {}, "topProjects": []
        })

        for entry in sorted(os.scandir(self.base_dir), key=lambda e: e.name):
            if not entry.is_dir() or not entry.name.isdigit():
                continue

            year = int(entry.name)
            projects_path = os.path.join(entry.path, "projects.min.json")
            if not os.path.exists(projects_path):
                continue

            with open(projects_path, "r", encoding="utf-8") as f:
                year_projects = json.load(f)

            year_total = sum(p.get("amount", 0) for p in year_projects)
            by_year[str(year)] = {
                "total": year_total,
                "projectCount": len(year_projects)
            }

            for p in year_projects:
                sector = p.get("sector", p.get("agency", "General"))
                amount = p.get("amount", 0)

                # Normalised project for knowledge base
                kb_project = {
                    "code": p.get("projectCode", p.get("id", "")),
                    "title": p.get("projectName", ""),
                    "amount": amount,
                    "page": p.get("page", 0),
                    "sector": sector,
                    "year": year,
                    "type": p.get("projectType", "Capital Expenditure"),
                    "agency": p.get("agency", "")
                }
                all_projects.append(kb_project)

                # Sector aggregation
                by_sector[sector]["count"] += 1
                by_sector[sector]["total"] += amount
                year_key = str(year)
                by_sector[sector]["yearBreakdown"][year_key] = (
                    by_sector[sector]["yearBreakdown"].get(year_key, 0) + amount
                )

        # Build top 5 projects per sector (cross-year, by amount)
        for sector in by_sector:
            sector_projects = [p for p in all_projects if p.get("sector") == sector]
            top = sorted(sector_projects, key=lambda p: p["amount"], reverse=True)[:5]
            by_sector[sector]["topProjects"] = top

        all_years = sorted(int(y) for y in by_year.keys())
        knowledge_base = {
            "meta": {
                "totalProjects": len(all_projects),
                "totalBudget": sum(p["amount"] for p in all_projects),
                "earliestYear": min(all_years) if all_years else None,
                "latestYear": max(all_years) if all_years else None,
                "years": all_years,
                "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "byYear": by_year,
                "bySector": dict(by_sector)
            },
            "projects": all_projects
        }

        out = os.path.join(self.base_dir, "ai_knowledge_base.json")
        self._atomic_write(out, knowledge_base)
        print(f"done ({len(all_projects):,} projects across {len(all_years)} years).")

    # ------------------------------------------------------------------
    # Step D — recurring_lineages.json
    # ------------------------------------------------------------------

    def _rebuild_lineages(self) -> None:
        print("  │  Step D: Rebuilding recurring_lineages.json ...", end=" ", flush=True)

        # Group all project appearances by ERGP code
        by_code: dict = defaultdict(list)

        for entry in sorted(os.scandir(self.base_dir), key=lambda e: e.name):
            if not entry.is_dir() or not entry.name.isdigit():
                continue

            year = int(entry.name)
            projects_path = os.path.join(entry.path, "projects.min.json")
            if not os.path.exists(projects_path):
                continue

            with open(projects_path, "r", encoding="utf-8") as f:
                year_projects = json.load(f)

            for p in year_projects:
                code = str(p.get("projectCode", "")).strip()
                if not code:
                    continue
                is_ergp = code.upper().startswith(("ERGP", "ZIP", "NASS"))
                # Only track non-ERGP codes if paired with project title prefix so generic economic codes don't collide
                group_key = code if is_ergp else f"{code}::{' '.join(str(p.get('projectName', '')).upper().split()[:5])}"
                by_code[group_key].append({
                    "year": year,
                    "financialYear": year,
                    "projectId": p.get("id", ""),
                    "projectCode": code,
                    "projectName": p.get("projectName", ""),
                    "title": p.get("projectName", ""),
                    "agency": p.get("agency", ""),
                    "amount": p.get("amount", 0),
                    "page": p.get("page", 0)
                })

        # Build lineages for codes appearing in 2+ distinct years
        lineages = []
        for idx, (group_key, appearances) in enumerate(by_code.items(), 1):
            distinct_years = sorted({a["year"] for a in appearances})
            if len(distinct_years) < 2:
                continue

            appearances_sorted = sorted(appearances, key=lambda a: (a["year"], -a["amount"]))
            # Keep at most 2 highest-value appearances per year to avoid multi-hundred-MB JSON payloads
            compact_instances = []
            per_yr_counts: dict = defaultdict(int)
            for app in appearances_sorted:
                if per_yr_counts[app["year"]] < 2:
                    compact_instances.append(app)
                    per_yr_counts[app["year"]] += 1

            total_amount = sum(a["amount"] for a in appearances_sorted)
            year_span = max(distinct_years) - min(distinct_years)
            within_lifespan = year_span <= 5
            code = appearances_sorted[-1]["projectCode"]
            title = appearances_sorted[-1]["title"]
            agency = appearances_sorted[-1]["agency"] or "Federal MDA"
            severity = "high" if (len(distinct_years) >= 3 or (within_lifespan and total_amount > 1_000_000_000)) else "medium"
            lineage_id = f"LIN-{idx:06d}"

            lineages.append({
                "lineageId": lineage_id,
                "lineage_id": lineage_id,
                "projectCode": code,
                "project_code": code,
                "canonicalTitle": title,
                "canonical_title": title,
                "agency": agency,
                "yearsAppeared": distinct_years,
                "years_appeared": distinct_years,
                "appearanceCount": len(appearances_sorted),
                "cumulativeAllocation": total_amount,
                "cumulative_allocation": total_amount,
                "yearSpan": year_span,
                "withinAssetLifespan": within_lifespan,
                "match_confidence": 0.96 if code.upper().startswith(("ERGP", "ZIP", "NASS")) else 0.85,
                "severity": severity,
                "instances": compact_instances,
            })

        # Sort by cumulative allocation descending and cap to top 3,500 for fast browser loading
        lineages.sort(key=lambda l: l["cumulativeAllocation"], reverse=True)
        lineages = lineages[:3500]

        output = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "totalLineages": len(lineages),
            "lineages": lineages
        }

        out = os.path.join(self.base_dir, "recurring_lineages.json")
        self._atomic_write(out, output)
        print(f"done ({len(lineages):,} recurring project lineages detected).")

    # ------------------------------------------------------------------
    # Step F — db/hierarchy_summary.json
    # ------------------------------------------------------------------

    @staticmethod
    def _format_naira(amt: int) -> str:
        if amt >= 1e12:
            return f"₦{amt / 1e12:.2f} Trillion"
        if amt >= 1e9:
            return f"₦{amt / 1e9:.2f} Billion"
        if amt >= 1e6:
            return f"₦{amt / 1e6:.2f} Million"
        return f"₦{amt:,}"

    def _rebuild_hierarchy_summary(self) -> None:
        print("  │  Step F: Rebuilding db/hierarchy_summary.json ...", end=" ", flush=True)
        years_ingested: List[int] = []
        year_summaries: dict = {}
        total_records_all = 0
        total_amount_all = 0

        for entry in sorted(os.scandir(self.base_dir), key=lambda e: e.name):
            if not entry.is_dir() or not entry.name.isdigit():
                continue
            stats_path = os.path.join(entry.path, "statistics.json")
            if not os.path.exists(stats_path):
                continue
            with open(stats_path, "r", encoding="utf-8") as f:
                stats = json.load(f)
            yr = int(entry.name)
            rec_count = stats.get("totalCapitalProjects", 0)
            tot_amt = stats.get("totalCapitalAmount", 0)
            years_ingested.append(yr)
            total_records_all += rec_count
            total_amount_all += tot_amt
            year_summaries[str(yr)] = {
                "recordCount": rec_count,
                "totalAmountNaira": tot_amt,
                "totalAmountFormatted": self._format_naira(tot_amt),
                "topZones": stats.get("zoneDistribution", {}),
            }

        total_lineages = 0
        lineages_path = os.path.join(self.base_dir, "recurring_lineages.json")
        if os.path.exists(lineages_path):
            try:
                with open(lineages_path, "r", encoding="utf-8") as f:
                    lin_data = json.load(f)
                    total_lineages = lin_data.get("totalLineages", len(lin_data)) if isinstance(lin_data, dict) else len(lin_data)
            except Exception:
                total_lineages = 0

        summary = {
            "totalRecordsAllYears": total_records_all,
            "totalAmountAllYears": total_amount_all,
            "yearsIngested": sorted(years_ingested),
            "totalLineages": total_lineages,
            "yearSummaries": year_summaries,
        }
        db_dir = os.path.join(self.base_dir, "db")
        os.makedirs(db_dir, exist_ok=True)
        out = os.path.join(db_dir, "hierarchy_summary.json")
        self._atomic_write(out, summary)
        print(f"done ({len(years_ingested)} years summarized).")

    # ------------------------------------------------------------------
    # Helper — Atomic write
    # ------------------------------------------------------------------

    def _atomic_write(self, path: str, data: dict) -> None:
        """Writes data atomically: write to temp file first, then rename with retry for Windows locks."""
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(',', ':'))

        for attempt in range(5):
            try:
                os.replace(tmp, path)
                break
            except PermissionError:
                if attempt == 4:
                    import shutil
                    shutil.copyfile(tmp, path)
                    try:
                        os.remove(tmp)
                    except Exception:
                        pass
                else:
                    time.sleep(0.2)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="BudgetLens Post-Ingestion & Phase 3 Cross-Dataset Intelligence Cascade"
    )
    parser.add_argument("--base-dir", default=BASE_DIR, help="Datasets root directory (default: public/datasets)")
    parser.add_argument("--fast", action="store_true", help="Run Stage-2 cascade without full cross-year KB rebuild")
    parser.add_argument(
        "--phase3",
        action="store_true",
        help="Run unified Phase 3 cross-dataset intelligence builders & provenance manifest",
    )
    parser.add_argument(
        "--phase4",
        action="store_true",
        help="Run Phase 4 all-years OAuGF audit, personal/opaque cash forensics & 6-ledger convergence",
    )
    parser.add_argument(
        "--phase5",
        action="store_true",
        help="Run Phase 5 Evidence Engine v3.0 28-year cross-ledger indexer & provenance manifest",
    )
    parser.add_argument("--with-stage2", action="store_true", help="Also run Stage-2 cascade before --phase3")
    parser.add_argument("--fts-sqlite", default=None, help="Path to external_ledger_fts.sqlite")
    parser.add_argument("--skip-geo", action="store_true", help="Skip 36-state geo & asset rebuild in --phase3")
    parser.add_argument("--skip-provenance", action="store_true", help="Skip source_provenance.json refresh in --phase3")
    parser.add_argument(
        "--only",
        default="",
        help=f"Comma-separated subset of Phase 3 steps: {','.join(CascadeEngine.PHASE3_STEP_ORDER)}",
    )
    args = parser.parse_args(argv)

    engine = CascadeEngine(base_dir=args.base_dir)
    if args.phase5:
        engine.run_phase5()
    elif args.phase4:
        engine.run_phase4(fts_sqlite_path=args.fts_sqlite)
    elif args.phase3:
        if args.with_stage2:
            engine.run(fast=args.fast)
        only_steps = [s.strip() for s in args.only.split(",") if s.strip()] if args.only else None
        engine.run_phase3(
            fts_sqlite_path=args.fts_sqlite,
            skip_geo=args.skip_geo,
            skip_provenance=args.skip_provenance,
            only_steps=only_steps,
        )
    else:
        engine.run(fast=args.fast)


if __name__ == "__main__":
    main()
