"""全局配置：设备检测、路径常量、环境检查。"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
PROCESSED_DIR = DATA_DIR / "processed"
VOICES_DIR = DATA_DIR / "voices"
TRACKS_DIR = DATA_DIR / "tracks"
SONGS_DIR = DATA_DIR / "songs"
MODELS_DIR = ROOT / "models"
THIRD_PARTY_DIR = ROOT / "third_party"

for d in (UPLOADS_DIR, PROCESSED_DIR, VOICES_DIR, TRACKS_DIR, SONGS_DIR, MODELS_DIR):
    d.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE = 44100
TARGET_LUFS = -23.0


def detect_device() -> str:
    """Return 'cuda' | 'mps' | 'cpu'. Imports torch lazily."""
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def ensure_env() -> str:
    """Run once at startup. Sets MPS fallback, checks ffmpeg, returns device."""
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    if shutil.which("ffmpeg") is None:
        print("ERROR: ffmpeg not found. Install with `brew install ffmpeg`.", file=sys.stderr)
        sys.exit(1)
    return detect_device()
