"""AI 歌曲库：合成产物。每条记录 = voice × (track | text) + 参数 → 输出 wav。"""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any

from ..config import SONGS_DIR

INDEX = SONGS_DIR / "index.json"


def _load() -> dict[str, dict[str, Any]]:
    if not INDEX.exists():
        return {}
    return json.loads(INDEX.read_text())


def _save(idx: dict[str, dict[str, Any]]) -> None:
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps(idx, ensure_ascii=False, indent=2))


def song_dir(sid: str) -> Path:
    return SONGS_DIR / sid


def create(
    voice_id: str,
    *,
    track_id: str | None = None,
    text: str | None = None,
    audio_path: Path,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sid = uuid.uuid4().hex[:12]
    d = song_dir(sid)
    d.mkdir(parents=True, exist_ok=True)
    dest = d / f"output{audio_path.suffix.lower() or '.wav'}"
    if audio_path.resolve() != dest.resolve():
        import shutil
        shutil.copy(audio_path, dest)
    size = dest.stat().st_size
    rec = {
        "id": sid,
        "voice_id": voice_id,
        "track_id": track_id,
        "text": text,
        "audio": str(dest),
        "params": params or {},
        "size_bytes": size,
        "created_at": time.time(),
    }
    idx = _load()
    idx[sid] = rec
    _save(idx)
    return rec


def get(sid: str) -> dict[str, Any] | None:
    return _load().get(sid)


def list_all() -> list[dict[str, Any]]:
    items = list(_load().values())
    items.sort(key=lambda r: r.get("created_at", 0), reverse=True)
    return items


def delete(sid: str) -> bool:
    idx = _load()
    if sid not in idx:
        return False
    del idx[sid]
    _save(idx)
    d = song_dir(sid)
    if d.exists():
        import shutil
        shutil.rmtree(d)
    return True


def fmt_size(b: int) -> str:
    if b < 1024:
        return f"{b} B"
    if b < 1024 * 1024:
        return f"{b/1024:.1f} KB"
    return f"{b/1024/1024:.1f} MB"


def fmt_relative(ts: float) -> str:
    now = time.time()
    d = now - ts
    if d < 60:
        return "刚刚"
    if d < 3600:
        return f"{int(d // 60)} 分钟前"
    if d < 86400:
        h = int(d // 3600)
        return f"{h} 小时前"
    days = int(d // 86400)
    if days == 1:
        return "昨天"
    if days < 7:
        return f"{days} 天前"
    return time.strftime("%Y-%m-%d", time.localtime(ts))
