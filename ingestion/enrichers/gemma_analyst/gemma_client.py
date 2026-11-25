import os
import sys
from typing import Optional

# Hardware profile constants
PROFILE_I3 = "I3_CONSERVATIVE"
PROFILE_I5 = "I5_OPTIMAL"

# Profile settings
PROFILES = {
    PROFILE_I3: {
        "n_threads": 2,
        "n_ctx": 512,
        "n_batch": 128,
        "batch_records": 8,       # Records per batch before cooldown sleep
        "cooldown_seconds": 12,   # Sleep between batches
        "checkpoint_every": 10,   # Save checkpoint every 10 records
    },
    PROFILE_I5: {
        "n_threads": 5,
        "n_ctx": 1024,
        "n_batch": 256,
        "batch_records": 20,
        "cooldown_seconds": 6,
        "checkpoint_every": 10,
    },
}

# Relative path to the GGUF model (from ingestion/ directory)
MODEL_FILENAME = "gemma-4-E2B.gguf"


def _get_model_path() -> str:
    """Resolves the absolute path to the GGUF model file."""
    ingestion_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    return os.path.join(ingestion_dir, MODEL_FILENAME)


def detect_hardware_profile() -> tuple[str, dict]:
    """
    Detects CPU cores and available RAM, returns appropriate profile name + settings.
    Falls back to I3_CONSERVATIVE if psutil is unavailable.
    """
    try:
        import psutil
        cores = psutil.cpu_count(logical=False) or 2
        available_ram_gb = psutil.virtual_memory().available / (1024 ** 3)
    except ImportError:
        print("  [WARN] psutil not available -- defaulting to I3_CONSERVATIVE profile.")
        return PROFILE_I3, PROFILES[PROFILE_I3]

    if cores >= 6 and available_ram_gb >= 10:
        profile = PROFILE_I5
    else:
        profile = PROFILE_I3

    return profile, PROFILES[profile]


def print_hardware_summary(profile_name: str, settings: dict) -> None:
    """Prints hardware detection results to terminal."""
    try:
        import psutil
        cores = psutil.cpu_count(logical=False) or "?"
        ram_gb = psutil.virtual_memory().total / (1024 ** 3)
        avail_gb = psutil.virtual_memory().available / (1024 ** 3)
        hw_line = f"CPU: {cores} physical cores | RAM: {ram_gb:.1f}GB total, {avail_gb:.1f}GB available"
    except ImportError:
        hw_line = "Hardware detection unavailable"

    print(f"  Hardware:         {hw_line}")
    print(f"  Profile:          {profile_name}")
    print(f"  Threads:          {settings['n_threads']}")
    print(f"  Context Window:   {settings['n_ctx']} tokens")
    print(f"  Batch Size:       {settings['n_batch']} tokens")
    print(f"  Records/Batch:    {settings['batch_records']}")
    print(f"  Cooldown:         {settings['cooldown_seconds']}s between batches")
    print(f"  Checkpoint Every: {settings['checkpoint_every']} records")


class GemmaClient:
    """
    Loads and manages the local Gemma GGUF model via llama-cpp-python.
    Provides a single infer(prompt) method for all pipeline jobs.

    If llama-cpp-python is not installed, raises ImportError with a
    helpful message guiding the user to install it.
    """

    def __init__(self, profile_settings: dict, verbose: bool = False):
        self.settings = profile_settings
        self.verbose = verbose
        self._model = None
        self._available = False
        self._load_model()

    def _load_model(self) -> None:
        """Attempts to load the Gemma model. Sets _available=False on any failure."""
        model_path = _get_model_path()

        if not os.path.exists(model_path):
            print(f"\n  ⚠  GEMMA MODEL NOT FOUND: {model_path}")
            print(f"     Place gemma-4-E2B.gguf in the ingestion/ directory.")
            print(f"     Running in rule-engine-only mode.\n")
            return

        try:
            # type: ignore[import-not-found, import-untyped]
            from llama_cpp import Llama  # pyright: ignore[reportMissingImports]
        except ImportError:
            print(f"\n  [WARN] llama-cpp-python not installed.")
            print(f"         Install: pip install llama-cpp-python --prefer-binary")
            print(f"         Running in rule-engine-only mode.\n")
            return

        print(f"  Loading Gemma model: {os.path.basename(model_path)} ...")
        try:
            self._model = Llama(
                model_path=model_path,
                n_threads=self.settings["n_threads"],
                n_ctx=self.settings["n_ctx"],
                n_batch=self.settings["n_batch"],
                n_gpu_layers=0,        # CPU-only — no GPU
                use_mlock=False,       # Don't lock RAM — safe for low-end machines
                verbose=self.verbose,
                temperature=0.0        # Deterministic output — no hallucination drift
            )
            self._available = True
            print(f"  [OK] Gemma loaded successfully.\n")
        except Exception as e:
            print(f"\n  [FAIL] Failed to load Gemma model: {e}")
            print(f"     Running in rule-engine-only mode.\n")

    @property
    def is_available(self) -> bool:
        """Returns True if the model loaded successfully and is ready for inference."""
        return self._available

    def infer(self, prompt: str, max_tokens: int = 300) -> str:
        """
        Runs inference for a single prompt.
        Returns the model's response text (JSON string).
        Returns empty string if model is not available.
        """
        if not self._available or self._model is None:
            return ""

        try:
            response = self._model(
                prompt,
                max_tokens=max_tokens,
                stop=["</s>", "\n\n\n"],
                echo=False
            )
            return response["choices"][0]["text"].strip()
        except Exception as e:
            if self.verbose:
                print(f"  ⚠  Gemma inference error: {e}")
            return ""
