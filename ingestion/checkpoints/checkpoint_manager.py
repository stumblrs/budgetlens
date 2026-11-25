import os
import json
from datetime import datetime, timezone
from typing import Optional


class CheckpointManager:
    """
    Saves per-file crash-recovery checkpoints during ingestion.
    Stored in: ingestion/checkpoints/{fingerprint_short}.json

    A checkpoint is written every N records (N depends on hardware profile).
    On resume, the pipeline reads the checkpoint and skips already-processed records.
    Checkpoints are deleted when a file completes successfully.
    """

    CHECKPOINT_DIR = os.path.join(os.path.dirname(__file__), "..", "checkpoints_data")

    def __init__(self, checkpoint_dir: Optional[str] = None):
        self.checkpoint_dir = os.path.abspath(checkpoint_dir or self.CHECKPOINT_DIR)
        os.makedirs(self.checkpoint_dir, exist_ok=True)

    def _path(self, fingerprint_short: str) -> str:
        return os.path.join(self.checkpoint_dir, f"{fingerprint_short}.json")

    def save(self, fingerprint: str, fingerprint_short: str,
             file_path: str, year: int, last_record_index: int) -> None:
        """Writes a checkpoint file for the given file."""
        checkpoint = {
            "fingerprint": fingerprint,
            "filePath": file_path,
            "year": year,
            "lastRecordIndex": last_record_index,
            "savedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        }
        path = self._path(fingerprint_short)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(checkpoint, f, indent=2)
        os.replace(tmp, path)

    def load(self, fingerprint_short: str) -> Optional[dict]:
        """
        Loads a checkpoint file.
        Returns None if no checkpoint exists for this file.
        """
        path = self._path(fingerprint_short)
        if not os.path.exists(path):
            return None
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    def get_last_index(self, fingerprint_short: str) -> int:
        """
        Returns the last saved record index, or 0 if no checkpoint exists.
        Use this to determine where to resume processing.
        """
        checkpoint = self.load(fingerprint_short)
        if checkpoint is None:
            return 0
        return checkpoint.get("lastRecordIndex", 0)

    def clear(self, fingerprint_short: str) -> None:
        """Deletes the checkpoint file after successful completion."""
        path = self._path(fingerprint_short)
        if os.path.exists(path):
            os.remove(path)

    def clear_all(self) -> None:
        """Deletes all checkpoint files for a fresh start."""
        if not os.path.exists(self.checkpoint_dir):
            return
        import glob
        for f in glob.glob(os.path.join(self.checkpoint_dir, "*.json*")):
            try:
                os.remove(f)
            except Exception:
                pass

    def exists(self, fingerprint_short: str) -> bool:
        """Returns True if a checkpoint file exists for this file."""
        return os.path.exists(self._path(fingerprint_short))
