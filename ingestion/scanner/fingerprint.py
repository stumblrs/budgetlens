import hashlib


class Fingerprint:
    """
    Computes SHA-256 content fingerprints for PDF files.
    The fingerprint is content-based, not name-based:
      - Renaming a file produces the same fingerprint.
      - Replacing a file with updated content produces a new fingerprint.
    """

    BUFFER_SIZE = 65536  # 64KB read chunks — memory-efficient for large PDFs

    @staticmethod
    def compute(file_path: str) -> str:
        """
        Computes the SHA-256 hash of a file.
        Returns a lowercase hex string prefixed with 'sha256:'.
        Example: 'sha256:abc123def456...'
        """
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            while True:
                data = f.read(Fingerprint.BUFFER_SIZE)
                if not data:
                    break
                sha256.update(data)
        return f"sha256:{sha256.hexdigest()}"

    @staticmethod
    def short(fingerprint: str) -> str:
        """Returns a short 12-char version for display and filenames."""
        # Strip the 'sha256:' prefix, take first 12 hex chars
        return fingerprint.replace("sha256:", "")[:12]
