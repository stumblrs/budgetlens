import os
import json
import shutil
import time
from datetime import datetime, timezone
from typing import Dict, List


class NarrativeBuilder:
    """
    Builds and updates public/datasets/narratives/{year}.json for narrative and
    macro-policy PDFs, cleanly merging multiple source documents per fiscal year.
    """

    def __init__(self, base_dir: str = "public/datasets"):
        self.base_dir = os.path.abspath(base_dir)
        self.narratives_dir = os.path.join(self.base_dir, "narratives")
        os.makedirs(self.narratives_dir, exist_ok=True)

    def clear_all(self) -> None:
        """Clears previously generated narrative JSON files prior to a fresh batch rebuild."""
        if not os.path.exists(self.narratives_dir):
            return
        for entry in os.scandir(self.narratives_dir):
            if entry.is_file() and entry.name.endswith(".json"):
                try:
                    os.remove(entry.path)
                except Exception:
                    pass

    def write_narrative_summary(
        self,
        year: int,
        source_filename: str,
        extracted_data: dict,
    ) -> None:
        """Writes or merges a document's structured policy intelligence into narratives/{year}.json."""
        file_path = os.path.join(self.narratives_dir, f"{year}.json")

        existing_data: dict = {}
        if os.path.exists(file_path):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    existing_data = json.load(f)
            except Exception:
                existing_data = {}

        sources: List[str] = list(existing_data.get("sourcesAnalyzed", []))
        if source_filename and source_filename not in sources:
            sources.append(source_filename)

        # Merge document breakdown per analyzed PDF
        breakdown: List[dict] = [
            d for d in existing_data.get("documentBreakdown", [])
            if isinstance(d, dict) and d.get("filename") != source_filename
        ]
        breakdown.append({
            "filename": source_filename,
            "docCategory": extracted_data.get("docCategory", "NARRATIVE"),
            "totalPages": extracted_data.get("totalPages", 0),
            "extractedChars": extracted_data.get("extractedChars", 0),
            "extractionMode": extracted_data.get("extractionMode", "VERBATIM_PDF_EXTRACTED"),
        })

        # Merge policy priorities (preserve order, max 8)
        priorities: List[str] = list(existing_data.get("policyPriorities", []))
        for item in extracted_data.get("policyPriorities", []) or []:
            if item and item not in priorities:
                priorities.append(item)
        priorities = priorities[:8]

        # Merge verbatim excerpts, prioritizing Budget Speeches and MTEF/FSP documents
        existing_excerpts: List[dict] = [
            e for e in existing_data.get("verbatimExcerpts", [])
            if isinstance(e, dict) and e.get("sourceFile") != source_filename
        ]
        new_excerpts = list(extracted_data.get("verbatimExcerpts", []) or [])
        all_excerpts = new_excerpts + existing_excerpts
        category_rank = {
            "BUDGET_SPEECH": 0,
            "PUBLIC_PRESENTATION": 1,
            "MTEF_FSP": 2,
            "FINANCE_ACT": 3,
            "CITIZENS_GUIDE": 4,
            "CALL_CIRCULAR": 5,
            "EXECUTIVE_PROPOSAL": 6,
            "APPROPRIATION_PREAMBLE": 7,
        }
        all_excerpts.sort(key=lambda e: category_rank.get(e.get("docCategory", ""), 9))
        all_excerpts = all_excerpts[:8]

        incoming_cat = extracted_data.get("docCategory", "NARRATIVE")
        prev_best_cat = existing_data.get("_bestMacroCategory", "APPROPRIATION_PREAMBLE")
        prefer_incoming = category_rank.get(incoming_cat, 9) <= category_rank.get(prev_best_cat, 9)

        prev_macro = existing_data.get("macroeconomicFramework", {})
        if prefer_incoming:
            macro = {
                "benchmarkOilPriceUSD": extracted_data.get("benchmarkOilPriceUSD") or prev_macro.get("benchmarkOilPriceUSD"),
                "dailyOilProductionMBPD": extracted_data.get("dailyOilProductionMBPD") or prev_macro.get("dailyOilProductionMBPD"),
                "exchangeRateNairaPerUSD": extracted_data.get("exchangeRateNairaPerUSD") or prev_macro.get("exchangeRateNairaPerUSD"),
                "projectedGdpGrowthPercent": extracted_data.get("projectedGdpGrowthPercent") or prev_macro.get("projectedGdpGrowthPercent"),
                "inflationRatePercent": extracted_data.get("inflationRatePercent") or prev_macro.get("inflationRatePercent"),
            }
            best_cat = incoming_cat
        else:
            macro = {
                "benchmarkOilPriceUSD": prev_macro.get("benchmarkOilPriceUSD") or extracted_data.get("benchmarkOilPriceUSD"),
                "dailyOilProductionMBPD": prev_macro.get("dailyOilProductionMBPD") or extracted_data.get("dailyOilProductionMBPD"),
                "exchangeRateNairaPerUSD": prev_macro.get("exchangeRateNairaPerUSD") or extracted_data.get("exchangeRateNairaPerUSD"),
                "projectedGdpGrowthPercent": prev_macro.get("projectedGdpGrowthPercent") or extracted_data.get("projectedGdpGrowthPercent"),
                "inflationRatePercent": prev_macro.get("inflationRatePercent") or extracted_data.get("inflationRatePercent"),
            }
            best_cat = prev_best_cat

        budget_theme = (
            extracted_data.get("budgetTheme")
            if (prefer_incoming or not existing_data.get("budgetTheme"))
            else existing_data.get("budgetTheme")
        )
        executive_summary = (
            extracted_data.get("executiveSummary")
            if (prefer_incoming or not existing_data.get("executiveSummary"))
            else existing_data.get("executiveSummary")
        )

        narrative_record = {
            "financialYear": year,
            "lastUpdated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "_bestMacroCategory": best_cat,
            "budgetTheme": budget_theme or f"{year} Federal Budget Framework",
            "sourcesAnalyzed": sources,
            "documentBreakdown": breakdown,
            "macroeconomicFramework": macro,
            "policyPriorities": priorities,
            "executiveSummary": executive_summary or "",
            "verbatimExcerpts": all_excerpts,
        }

        tmp_path = file_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(narrative_record, f, indent=2, ensure_ascii=False)

        for attempt in range(5):
            try:
                os.replace(tmp_path, file_path)
                break
            except PermissionError:
                if attempt == 4:
                    shutil.copyfile(tmp_path, file_path)
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                else:
                    time.sleep(0.2)
