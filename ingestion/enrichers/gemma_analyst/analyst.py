import json
import random
import time
from datetime import datetime, timezone
from typing import Optional

from ingestion.enrichers.gemma_analyst.gemma_client import GemmaClient
from ingestion.enrichers.gemma_analyst.prompts import (
    build_classify_prompt,
    build_normalize_prompt,
    build_tag_prompt,
    build_ambiguity_prompt,
    build_rules_prompt,
    build_rationale_prompt,
)

# Thermal thresholds (°C)
TEMP_WARN = 65
TEMP_CRITICAL = 80

MODEL_VERSION = "gemma-4-E2B"


def _read_cpu_temp_windows() -> Optional[float]:
    """
    Reads CPU temperature on Windows via WMI.
    Returns temperature in Celsius, or None if unavailable.
    WMI temperature is in tenths of Kelvin (multiply by 10, subtract 2732).
    """
    try:
        # pyrefly: ignore [missing-import]
        import wmi
        w = wmi.WMI(namespace="root/wmi")
        sensors = w.MSAcpi_ThermalZoneTemperature()
        if sensors:
            raw = sensors[0].CurrentTemperature
            celsius = (raw / 10.0) - 273.15
            return celsius
    except Exception:
        pass
    return None


def _safe_parse_json(text: str) -> dict:
    """
    Attempts to parse JSON from Gemma's output.
    Returns empty dict on failure (graceful degradation).
    """
    if not text:
        return {}
    # Find the first { and last } to extract just the JSON object
    start = text.find("{")
    end = text.rfind("}") + 1
    if start == -1 or end == 0:
        return {}
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return {}


class GemmaAnalyst:
    """
    Orchestrates all 6 Gemma analyst jobs per budget record.

    Contains the two-layer thermal cooldown system:
      Layer 1 — Fixed batch sleep: sleep after every N records.
      Layer 2 — Adaptive temperature guard: extend sleep if CPU runs hot.

    If Gemma is not available (model missing or llama-cpp-python not installed),
    returns a minimal review object with is_available=False — pipeline continues.
    """

    def __init__(self, client: GemmaClient, profile_settings: dict,
                 overnight_mode: bool = False):
        self.client = client
        self.settings = profile_settings
        self.overnight_mode = overnight_mode

        # In overnight mode: halve batch size, double cooldown
        if overnight_mode:
            self.batch_records = max(1, profile_settings["batch_records"] // 2)
            self.cooldown_seconds = profile_settings["cooldown_seconds"] * 2
        else:
            self.batch_records = profile_settings["batch_records"]
            self.cooldown_seconds = profile_settings["cooldown_seconds"]

        self._records_since_sleep = 0
        self._thermal_events = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyse(self, record: dict) -> dict:
        """
        Runs consolidated Gemma analyst review on a single budget record.
        Returns a GemmaReview object (dict).
        """
        if not self.client.is_available:
            return self._empty_review(record)

        # Consolidated forensic prompt for maximum efficiency
        prompt = f"""<start_of_turn>user
You are a senior Nigerian government budget auditor and public advocate. Review this budget line item and respond ONLY with valid JSON.

Title: {record.get("projectName", "")}
Agency: {record.get("agency", "")}
Amount: ₦{record.get("amount", 0):,}
Year: {record.get("financialYear", "")}

Respond with this exact JSON:
{{
  "primaryCategory": "<Vehicles & Transport | ICT & Equipment | Construction & Infrastructure | Personnel & Welfare | Consultancy & Services | Health & Medical | Security & Defence | Unclassified>",
  "normalizedTitle": "<cleaned title>",
  "state": "<State name e.g. Borno, Lagos, FCT, or Nationwide>",
  "lga": "<Local Government Area name, or Nationwide>",
  "geopoliticalZone": "<North-West | North-East | North-Central | South-West | South-South | South-East | FCT | Nationwide>",
  "sdgGoal": "<e.g. SDG 3: Good Health | SDG 4: Quality Education | SDG 6: Clean Water | SDG 7: Clean Energy | SDG 9: Infrastructure>",
  "assetType": "<Vehicles | Computers & IT | Office Buildings | Feeder Roads | Water Boreholes | Empowerment Kits | None>",
  "suggestedTags": ["TAG1", "TAG2"],
  "isAmbiguous": <true | false>,
  "riskLevel": "<LOW | MEDIUM | HIGH | CRITICAL>",
  "anomalyScore": <0 to 100 integer rating>,
  "auditQuestion": "<One specific physical question for local community verification>",
  "opportunityCostText": "<Relatable impact equivalent e.g. Equivalent to equipping 12 primary health centers>",
  "foiSubjectLine": "<Pre-formatted FOI request subject line under FOI Act 2011>",
  "rationale": "<one short analytical sentence>"
}}
<end_of_turn>
<start_of_turn>model
"""

        result = _safe_parse_json(self.client.infer(prompt, max_tokens=350))

        review = {
            "recordId": record.get("id", ""),
            "gemmaModelVersion": MODEL_VERSION,
            "processedAt": self._now(),
            "category": {
                "primaryCategory": result.get("primaryCategory", "Unclassified"),
                "confidence": 0.90
            },
            "normalization": {
                "normalizedTitle": result.get("normalizedTitle", record.get("projectName", "")),
                "wasNormalized": result.get("normalizedTitle") != record.get("projectName")
            },
            "location": {
                "state": result.get("state", "Nationwide"),
                "lga": result.get("lga", "Nationwide"),
                "geopoliticalZone": result.get("geopoliticalZone", "Nationwide")
            },
            "impact": {
                "sdgGoal": result.get("sdgGoal", "SDG 9: Industry & Infrastructure"),
                "assetType": result.get("assetType", "None"),
                "anomalyScore": result.get("anomalyScore", 10),
                "auditQuestion": result.get("auditQuestion", f"Verify physical execution of {record.get('projectName', '')} on site."),
                "opportunityCostText": result.get("opportunityCostText", f"Allocation of ₦{record.get('amount', 0):,} to public sector line item."),
                "foiSubjectLine": result.get("foiSubjectLine", f"Request for Contract & Procurement Records: {record.get('projectName', '')}")
            },
            "forensicTags": result.get("suggestedTags", []),
            "ambiguityDetection": {
                "isAmbiguous": result.get("isAmbiguous", False),
                "riskLevel": result.get("riskLevel", "LOW")
            },
            "applicableRules": [],
            "rationale": result.get("rationale", ""),
            "developerDecision": "PENDING"
        }

        # Thermal cooldown after batch
        self._records_since_sleep += 1
        if self._records_since_sleep >= self.batch_records:
            self._do_cooldown()
            self._records_since_sleep = 0

        return review

    def get_thermal_log(self) -> list:
        """Returns the log of all thermal events during this session."""
        return self._thermal_events

    # ------------------------------------------------------------------
    # Thermal Cooldown
    # ------------------------------------------------------------------

    def _do_cooldown(self) -> None:
        """
        Layer 1: Random sleep between 30 seconds and 2 minutes 30 seconds (30 - 150 seconds) between batches.
        Layer 2: Extend sleep based on CPU temperature.
        """
        base_sleep = random.randint(30, 150)  # Random 30s to 2m 30s (30 - 150 seconds)
        temp = _read_cpu_temp_windows()
        sleep_duration = base_sleep

        if temp is not None:
            if temp >= TEMP_CRITICAL:
                sleep_duration = max(base_sleep, 150)  # 2m 30s emergency pause
                event = f"[{self._now()}] THERMAL_CRITICAL: {temp:.1f}°C — Emergency pause {sleep_duration}s ({sleep_duration // 60}m {sleep_duration % 60}s)"
                print(f"\n  🛑 {event}")
                self._thermal_events.append(event)

            elif temp >= TEMP_WARN:
                sleep_duration = max(base_sleep, 90)  # At least 1m 30s
                event = f"[{self._now()}] THERMAL_WARN: {temp:.1f}°C — Extended cooldown {sleep_duration}s ({sleep_duration // 60}m {sleep_duration % 60}s)"
                print(f"\n  ⚠  {event}")
                self._thermal_events.append(event)
            else:
                print(f"\n  ☕ Batch cooldown: Sleeping for {sleep_duration // 60}m {sleep_duration % 60}s ({sleep_duration}s)...")
        else:
            print(f"\n  ☕ Batch cooldown: Sleeping for {sleep_duration // 60}m {sleep_duration % 60}s ({sleep_duration}s)...")

        time.sleep(sleep_duration)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _empty_review(self, record: dict) -> dict:
        """Returns a placeholder review when Gemma is unavailable."""
        return {
            "recordId": record.get("id", ""),
            "gemmaModelVersion": "UNAVAILABLE",
            "processedAt": self._now(),
            "category": {},
            "normalization": {
                "normalizedTitle": record.get("projectName", "")
            },
            "location": {
                "state": "Nationwide",
                "lga": "Nationwide",
                "geopoliticalZone": "Nationwide"
            },
            "impact": {
                "sdgGoal": "SDG 9: Industry & Infrastructure",
                "assetType": "None",
                "anomalyScore": 0,
                "auditQuestion": f"Verify physical execution of {record.get('projectName', '')} on site.",
                "opportunityCostText": f"Allocation of ₦{record.get('amount', 0):,} to public sector line item.",
                "foiSubjectLine": f"Request for Contract & Procurement Records: {record.get('projectName', '')}"
            },
            "forensicTags": [],
            "ambiguityDetection": {"riskLevel": "UNKNOWN"},
            "applicableRules": [],
            "rationale": "",
            "developerDecision": "SKIPPED"
        }

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
