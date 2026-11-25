import os
import json
from datetime import datetime, timezone
from typing import Optional

# File states
STATUS_NOT_FOUND = "NOT_FOUND"
STATUS_PARTIAL = "PARTIAL"
STATUS_STAGE1 = "STAGE1_COMPLETE"
STATUS_COMPLETE = "COMPLETE"
STATUS_FAILED = "FAILED"
STATUS_IN_PROGRESS = "IN_PROGRESS"

REGISTRY_VERSION = "2.0"


class IngestionRegistry:
    """
    Permanent ledger that tracks every PDF file ever processed by the pipeline.
    Stored at: ingestion/ingestion_registry.json

    Each file is indexed by its SHA-256 fingerprint (content-aware, not name-aware).
    This allows:
      - Renaming files without re-ingesting them.
      - Detecting when a file has been updated (hash changes → re-ingest).
      - Resuming interrupted ingestions via stored checkpoints.
    """

    DEFAULT_PATH = os.path.join(os.path.dirname(__file__), "..", "ingestion_registry.json")

    def __init__(self, registry_path: Optional[str] = None):
        self.registry_path = os.path.abspath(registry_path or self.DEFAULT_PATH)
        self._data: dict = {}
        self.load()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def load(self) -> None:
        """Loads registry from disk. Creates an empty registry if not found."""
        if os.path.exists(self.registry_path):
            with open(self.registry_path, "r", encoding="utf-8") as f:
                self._data = json.load(f)
        else:
            self._data = {
                "version": REGISTRY_VERSION,
                "createdAt": self._now(),
                "lastScan": None,
                "files": {}
            }

    def save(self) -> None:
        """Writes registry to disk safely with retry logic for Windows file locks."""
        self._data["lastScan"] = self._now()
        os.makedirs(os.path.dirname(self.registry_path), exist_ok=True)
        tmp_path = self.registry_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, indent=2)

        # Retry loop for Windows file locks
        for attempt in range(5):
            try:
                os.replace(tmp_path, self.registry_path)  # Atomic rename
                break
            except PermissionError:
                if attempt == 4:
                    # Fallback to copy if replace is permanently locked
                    import shutil
                    shutil.copyfile(tmp_path, self.registry_path)
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                else:
                    import time
                    time.sleep(0.2)

    # ------------------------------------------------------------------
    # Status Queries
    # ------------------------------------------------------------------

    def get_status(self, fingerprint: str) -> str:
        """
        Returns the ingestion status for a fingerprint.
        Returns STATUS_NOT_FOUND if the file has never been seen.
        """
        entry = self._data["files"].get(fingerprint)
        if entry is None:
            return STATUS_NOT_FOUND
        return entry.get("status", STATUS_NOT_FOUND)

    def get_checkpoint_record(self, fingerprint: str) -> Optional[int]:
        """Returns the last saved record index for a PARTIAL file, or None."""
        entry = self._data["files"].get(fingerprint)
        if entry is None:
            return None
        return entry.get("checkpointRecord")

    def get_entry(self, fingerprint: str) -> Optional[dict]:
        """Returns the full registry entry for a fingerprint."""
        return self._data["files"].get(fingerprint)

    def all_entries(self) -> dict:
        """Returns all registry entries."""
        return self._data.get("files", {})

    # ------------------------------------------------------------------
    # State Mutations
    # ------------------------------------------------------------------

    def mark_in_progress(self, fingerprint: str, path: str, year: int,
                         filename: str) -> None:
        """Registers a file as actively being ingested."""
        self._data["files"][fingerprint] = {
            "originalPath": path,
            "filename": filename,
            "year": year,
            "status": STATUS_IN_PROGRESS,
            "totalRecords": None,
            "totalAmount": None,
            "ingestedAt": self._now(),
            "lastUpdatedAt": self._now(),
            "checkpointRecord": None
        }
        self.save()

    def save_checkpoint(self, fingerprint: str, record_index: int) -> None:
        """Saves mid-ingestion progress. Marks file as PARTIAL."""
        if fingerprint not in self._data["files"]:
            return
        self._data["files"][fingerprint]["status"] = STATUS_PARTIAL
        self._data["files"][fingerprint]["checkpointRecord"] = record_index
        self._data["files"][fingerprint]["lastUpdatedAt"] = self._now()
        self.save()

    def mark_stage1(self, fingerprint: str, total_records: int,
                    total_amount: int) -> None:
        """Marks a file entry as Stage 1 complete (extracted to Staging Lake, pending Stage 2)."""
        if fingerprint not in self._data["files"]:
            return
        entry = self._data["files"][fingerprint]
        entry["status"] = STATUS_STAGE1
        entry["totalRecords"] = total_records
        entry["totalAmount"] = total_amount
        entry["checkpointRecord"] = None
        entry["lastUpdatedAt"] = self._now()
        self.save()

    def mark_complete(self, fingerprint: str, total_records: int,
                      total_amount: int) -> None:
        """Finalises a file entry as fully ingested."""
        if fingerprint not in self._data["files"]:
            return
        entry = self._data["files"][fingerprint]
        entry["status"] = STATUS_COMPLETE
        entry["totalRecords"] = total_records
        entry["totalAmount"] = total_amount
        entry["checkpointRecord"] = None
        entry["lastUpdatedAt"] = self._now()
        self.save()

    def mark_failed(self, fingerprint: str, error, stage: str = "STAGE_1_PARSING") -> None:
        """Marks a file as failed with a structured JSON error object."""
        if fingerprint not in self._data["files"]:
            return
        
        err_msg = str(error)
        err_type = type(error).__name__ if isinstance(error, Exception) else "ExtractionError"
        
        self._data["files"][fingerprint]["status"] = STATUS_FAILED
        self._data["files"][fingerprint]["error"] = {
            "message": err_msg,
            "type": err_type,
            "timestamp": self._now(),
            "stage": stage
        }
        self._data["files"][fingerprint]["lastUpdatedAt"] = self._now()
        self.save()

    def reset_year(self, year: int) -> int:
        """
        Removes all COMPLETE entries for a given year from the registry
        so they will be re-ingested. Returns the count of removed entries.
        """
        to_remove = [
            fp for fp, entry in self._data["files"].items()
            if entry.get("year") == year
        ]
        for fp in to_remove:
            del self._data["files"][fp]
        self.save()
        return len(to_remove)

    def reset_all(self) -> None:
        """Clears the entire registry. Nuclear option."""
        self._data["files"] = {}
        self.save()

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
