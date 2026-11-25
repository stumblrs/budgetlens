import os
import json
import shutil
import hashlib
import time
from datetime import datetime, timezone
from typing import List, Optional

from ingestion.extractors.asset_tokenizer import AssetTokenizer
from ingestion.enrichers.geo_taxonomy import GeoTaxonomy
from ingestion.enrichers.human_equivalents import HumanEquivalents
from ingestion.enrichers.forensic_rules import ForensicRules
from ingestion.parsers.pdf_parser import infer_sector


class DbBuilder:
    """
    Stage 5: Writes processed records to the live application dataset folders.

    Key improvements over the previous version:
      - Atomic write: writes to {year}_TEMP first, validates, then renames
      - Multi-PDF support: accepts a list of source filenames
      - Gemma review field: includes gemmaReview object per record
      - Stores ingestedAt and sha256 in statistics.json for cascade engine
    """

    def __init__(self, base_dir: str = "public/datasets"):
        self.base_dir = os.path.abspath(base_dir)

    # ------------------------------------------------------------------
    # Public
    # ------------------------------------------------------------------

    def _load_existing_gemma_reviews(self, year: int) -> tuple[dict, dict]:
        """
        Loads previously computed Gemma overlays keyed by content-verified identity so
        live sync never overwrites genuine reviews and never copies stale reviews onto renumbered rows.
        """
        by_id: dict = {}
        by_sig: dict = {}
        existing_path = os.path.join(self.base_dir, "db", str(year), "records.json")
        if not os.path.exists(existing_path):
            return by_id, by_sig
        try:
            with open(existing_path, "r", encoding="utf-8") as f:
                recs = json.load(f)
            if not isinstance(recs, list):
                return by_id, by_sig
            for r in recs:
                overlay = r.get("gemmaAnalyticalOverlay")
                if not overlay or overlay.get("gemmaModelVersion") in (None, "UNAVAILABLE"):
                    continue
                ri = r.get("recordIdentity", {})
                sp = r.get("sourceProvenance", {})
                rid = ri.get("id")
                code_str = str(ri.get("projectCode", "")).strip()
                name_str = str(ri.get("verbatimProjectName", "")).strip().upper()
                amt = int(ri.get("amountNaira", 0) or 0)
                if rid:
                    by_id[rid] = (name_str, overlay)
                sig = (
                    code_str,
                    name_str,
                    int(sp.get("pdfPage", 1) or 1),
                    amt,
                )
                by_sig[sig] = overlay
        except Exception:
            pass
        return by_id, by_sig

    def write_year_dataset(
        self,
        year: int,
        projects: List[dict],
        total_pages: int,
        source_files: List[str],
        sha256: Optional[str] = None,
        gemma_reviews: Optional[dict] = None,  # {record_id: GemmaReview}
        preserve_existing_gemma: bool = True,
    ) -> None:
        """
        Writes a complete year dataset atomically.
        Uses a _TEMP staging folder to prevent partial writes on crash.
        """
        gemma_reviews = dict(gemma_reviews or {})
        existing_by_id, existing_by_sig = (
            self._load_existing_gemma_reviews(year) if preserve_existing_gemma else ({}, {})
        )

        # 1. Enrich projects with asset tokens, inferred sector & gemmaReview
        for p in projects:
            if "assetTokens" not in p:
                p["assetTokens"] = AssetTokenizer.extract_asset_tokens(
                    p["projectName"], p["amount"]
                )
            if not p.get("sector") or p.get("sector") == "Capital Infrastructure":
                p["sector"] = infer_sector(p.get("agency", ""), p["projectName"])

            pid = p.get("id", "")
            code_str = str(p.get("projectCode", "")).strip()
            name_str = str(p.get("projectName", "")).strip().upper()
            amt = int(p.get("amount", 0) or 0)
            review = gemma_reviews.get(pid) or p.get("gemmaReview")
            if not review and pid in existing_by_id:
                prev_name, prev_ov = existing_by_id[pid]
                if prev_name == name_str:
                    review = prev_ov
            if not review and existing_by_sig:
                sig = (
                    code_str,
                    name_str,
                    int(p.get("page", 1) or 1),
                    amt,
                )
                review = existing_by_sig.get(sig)
            if review and review.get("gemmaModelVersion") not in (None, "UNAVAILABLE"):
                p["gemmaReview"] = review
                if pid:
                    gemma_reviews[pid] = review

        # 2. Build full record objects
        records = self._build_records(year, projects, source_files, gemma_reviews)

        # 3. Build statistics summary with MDA, Sector, and Zone distributions
        total_amount = sum(p.get("amount", 0) for p in projects)
        mda_totals: dict[str, int] = {}
        sector_totals: dict[str, int] = {}
        zone_totals: dict[str, int] = {}
        gemma_count = 0

        for r in records:
            amt = r["recordIdentity"]["amountNaira"]
            mda = r["mdaGovernanceTaxonomy"]["mdaName"] or "General Federal"
            sec = r["mdaGovernanceTaxonomy"]["sector"]
            zone = r["geographicTaxonomy"]["geoPoliticalZone"]
            mda_totals[mda] = mda_totals.get(mda, 0) + amt
            sector_totals[sec] = sector_totals.get(sec, 0) + amt
            zone_totals[zone] = zone_totals.get(zone, 0) + amt
            ov = r.get("gemmaAnalyticalOverlay")
            if isinstance(ov, dict) and str(ov.get("gemmaModelVersion") or "").strip() not in ("", "UNAVAILABLE"):
                gemma_count += 1

        top_mdas = sorted(mda_totals.items(), key=lambda x: x[1], reverse=True)
        top_sectors = sorted(sector_totals.items(), key=lambda x: x[1], reverse=True)
        effective_pages = total_pages or max((p.get("page", 0) for p in projects), default=0)

        stats = {
            "financialYear": year,
            "totalPages": effective_pages,
            "totalCapitalProjects": len(projects),
            "totalCapitalAmount": total_amount,
            "gemmaEnrichedCount": gemma_count,
            "enrichmentStatus": "STAGE2_COMPLETE" if projects and gemma_count >= len(projects) else (
                "STAGE2_PARTIAL" if gemma_count > 0 else "STAGE1_RULE_VERIFIED"
            ),
            "sectorDistribution": {k: v for k, v in top_sectors},
            "topMinistries": [{"name": k, "amount": v} for k, v in top_mdas[:25]],
            "verbatimMdaAllocations": [{"code": "MDA", "name": k, "amount": v} for k, v in top_mdas],
            "zoneDistribution": zone_totals,
            "sourceFiles": source_files,
            "sourceFile": source_files[0] if source_files else "",
            "sha256": sha256 or "",
            "ingestedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "officialTotalBudget": total_amount
        }

        # 4. Atomic write: stage -> validate -> rename
        staging_dir = os.path.join(self.base_dir, f"{year}_TEMP")
        final_dir = os.path.join(self.base_dir, str(year))
        db_staging_dir = os.path.join(self.base_dir, "db", f"{year}_TEMP")
        db_final_dir = os.path.join(self.base_dir, "db", str(year))

        try:
            if os.path.exists(staging_dir):
                shutil.rmtree(staging_dir, ignore_errors=True)
            if os.path.exists(db_staging_dir):
                shutil.rmtree(db_staging_dir, ignore_errors=True)
            os.makedirs(staging_dir, exist_ok=True)
            os.makedirs(db_staging_dir, exist_ok=True)

            # Write to staging
            self._write_json(os.path.join(staging_dir, "projects.min.json"),
                             projects, minified=True)
            self._write_json(os.path.join(staging_dir, "statistics.json"), stats)
            self._write_json(os.path.join(db_staging_dir, "records.json"), records, minified=True)

            # Validate: check record count matches
            written = self._count_records(
                os.path.join(staging_dir, "projects.min.json")
            )
            if written != len(projects):
                raise ValueError(
                    f"Validation failed: wrote {written} records, expected {len(projects)}"
                )

            # Promote staging -> final (atomic rename with retry for Windows locks)
            self._promote_dir(staging_dir, final_dir)
            self._promote_dir(db_staging_dir, db_final_dir)

        except Exception:
            # Clean up staging on failure
            if os.path.exists(staging_dir):
                shutil.rmtree(staging_dir, ignore_errors=True)
            if os.path.exists(db_staging_dir):
                shutil.rmtree(db_staging_dir, ignore_errors=True)
            raise

    @staticmethod
    def _promote_dir(staging_dir: str, final_dir: str) -> None:
        for attempt in range(5):
            try:
                if os.path.exists(final_dir):
                    shutil.rmtree(final_dir)
                os.rename(staging_dir, final_dir)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                time.sleep(0.25)

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _build_records(self, year: int, projects: List[dict],
                       source_files: List[str],
                       gemma_reviews: dict) -> List[dict]:
        """Builds the full enriched record objects for records.json."""
        records = []
        primary_source = source_files[0] if source_files else ""

        for p in projects:
            zone, state, lga = GeoTaxonomy.detect_state_lga(p["projectName"])
            raw_review = gemma_reviews.get(p.get("id", "")) or p.get("gemmaReview")
            has_valid_gemma = (
                isinstance(raw_review, dict)
                and bool(str(raw_review.get("gemmaModelVersion") or "").strip())
                and str(raw_review.get("gemmaModelVersion")).strip().upper() != "UNAVAILABLE"
            )
            gemma_overlay = raw_review if has_valid_gemma else None
            g_loc = (gemma_overlay or {}).get("location", {})
            if g_loc.get("state") and g_loc.get("state") != "Nationwide":
                state = g_loc.get("state")
            if g_loc.get("lga") and g_loc.get("lga") != "Nationwide":
                lga = g_loc.get("lga")
            if g_loc.get("geopoliticalZone") and g_loc.get("geopoliticalZone") != "Nationwide":
                zone = g_loc.get("geopoliticalZone")

            human_eq = HumanEquivalents.compute(p["amount"])
            flags = ForensicRules.evaluate(p["projectName"], p["amount"])
            sector = p.get("sector") or infer_sector(p.get("agency", ""), p["projectName"])
            if sector == "Capital Infrastructure":
                sector = infer_sector(p.get("agency", ""), p["projectName"])

            records.append({
                "recordIdentity": {
                    "id": p["id"],
                    "financialYear": year,
                    "projectCode": p.get("projectCode", ""),
                    "verbatimProjectName": p["projectName"],
                    "amountNaira": p["amount"],
                    "amountFormatted": self._format_naira(p["amount"]),
                    "spendingType": p.get("spendingType") or p.get("projectType", "CAPITAL")
                },
                "sourceProvenance": {
                    "documentId": f"DOC-{year}",
                    "sourceFilename": p.get("sourceFile") or primary_source,
                    "pdfPage": p.get("page", 1),
                    "sha256Hash": hashlib.sha256(
                        p["projectName"].encode()
                    ).hexdigest()[:16]
                },
                "geographicTaxonomy": {
                    "jurisdictionLevel": "FEDERAL",
                    "geoPoliticalZone": zone,
                    "state": state,
                    "lga": lga
                },
                "mdaGovernanceTaxonomy": {
                    "mdaCode": p.get("budgetCode", ""),
                    "mdaName": p.get("agency") or "General Federal",
                    "sector": sector
                },
                "multiYearLineage": {
                    "lineageId": None,
                    "yearsAppeared": [year],
                    "cumulativeSpendNaira": p["amount"],
                    "cumulativeSpendFormatted": self._format_naira(p["amount"])
                },
                "assetTokens": p["assetTokens"],
                "forensicEvidenceFlags": flags,
                "humanScaleEquivalents": human_eq,
                "gemmaAnalyticalOverlay": gemma_overlay
            })

        return records

    def _write_json(self, path: str, data, minified: bool = False) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            if minified:
                json.dump(data, f, separators=(',', ':'))
            else:
                json.dump(data, f, indent=2)

    def _count_records(self, path: str) -> int:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return len(data) if isinstance(data, list) else 0

    @staticmethod
    def _format_naira(amt: int) -> str:
        if amt >= 1e12:
            return f"₦{amt / 1e12:.2f} Trillion"
        if amt >= 1e9:
            return f"₦{amt / 1e9:.2f} Billion"
        if amt >= 1e6:
            return f"₦{amt / 1e6:.2f} Million"
        return f"₦{amt:,}"
