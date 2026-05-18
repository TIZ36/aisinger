"""曲目库：用户上传的原始歌曲。

每首歌一个目录：audio.wav (原始/转码后) + vocals.wav + instrumental.wav + meta.json
"""
from __future__ import annotations

import json
import subprocess
import uuid
from pathlib import Path
from typing import Any

from ..config import TRACKS_DIR

INDEX = TRACKS_DIR / "index.json"


def _load() -> dict[str, dict[str, Any]]:
    if not INDEX.exists():
        return {}
    return json.loads(INDEX.read_text())


def _save(idx: dict[str, dict[str, Any]]) -> None:
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=2))


def track_dir(tid: str) -> Path:
    return TRACKS_DIR / tid


def _probe_duration(p: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(p)],
            check=True, capture_output=True, text=True,
        )
        return float(out.stdout.strip())
    except Exception:
        return None


def create(name: str, artist: str, source: Path) -> dict[str, Any]:
    tid = uuid.uuid4().hex[:12]
    d = track_dir(tid)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / f"audio{source.suffix.lower() or '.wav'}"
    if source.resolve() != dest.resolve():
        import shutil
        shutil.copy(source, dest)
    duration = _probe_duration(dest)
    rec = {
        "id": tid,
        "name": name,
        "artist": artist,
        "audio": str(dest),
        "duration": duration,
        "vocals": None,
        "instrumental": None,
        "separated": False,
    }
    idx = _load()
    idx[tid] = rec
    _save(idx)
    return rec


def get(tid: str) -> dict[str, Any] | None:
    return _load().get(tid)


def list_all() -> list[dict[str, Any]]:
    return list(_load().values())


def update(tid: str, **changes) -> dict[str, Any] | None:
    idx = _load()
    if tid not in idx:
        return None
    idx[tid].update(changes)
    _save(idx)
    return idx[tid]


def delete(tid: str) -> bool:
    idx = _load()
    if tid not in idx:
        return False
    del idx[tid]
    _save(idx)
    d = track_dir(tid)
    if d.exists():
        import shutil
        shutil.rmtree(d)
    return True


def fmt_duration(seconds: float | None) -> str:
    if seconds is None:
        return ""
    m = int(seconds // 60)
    s = int(seconds % 60)
    return f"{m}:{s:02d}"
