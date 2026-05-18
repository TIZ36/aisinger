"""音色库：JSON 索引 + 每个音色一个目录存放工件。"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

from ..config import VOICES_DIR
from .schema import Tier, Voice

INDEX_FILE = VOICES_DIR / "index.json"


def _load_index() -> dict[str, dict]:
    if not INDEX_FILE.exists():
        return {}
    return json.loads(INDEX_FILE.read_text())


def _save_index(idx: dict[str, dict]) -> None:
    INDEX_FILE.parent.mkdir(parents=True, exist_ok=True)
    INDEX_FILE.write_text(json.dumps(idx, ensure_ascii=False, indent=2))


def voice_dir(voice_id: str) -> Path:
    return VOICES_DIR / voice_id


def create(name: str, tier: Tier, artifacts: dict[str, str] | None = None, meta: dict | None = None) -> Voice:
    voice_id = uuid.uuid4().hex[:12]
    v = Voice(id=voice_id, name=name, tier=tier, artifacts=artifacts or {}, meta=meta or {})
    voice_dir(voice_id).mkdir(parents=True, exist_ok=True)
    idx = _load_index()
    idx[voice_id] = v.model_dump()
    _save_index(idx)
    return v


def get(voice_id: str) -> Voice | None:
    idx = _load_index()
    data = idx.get(voice_id)
    return Voice.model_validate(data) if data else None


def list_voices(tier: Tier | None = None) -> list[Voice]:
    idx = _load_index()
    voices = [Voice.model_validate(d) for d in idx.values()]
    if tier:
        voices = [v for v in voices if v.tier == tier]
    return voices


def update(voice_id: str, **changes) -> Voice | None:
    idx = _load_index()
    if voice_id not in idx:
        return None
    idx[voice_id].update(changes)
    _save_index(idx)
    return Voice.model_validate(idx[voice_id])


def delete(voice_id: str) -> bool:
    idx = _load_index()
    if voice_id not in idx:
        return False
    del idx[voice_id]
    _save_index(idx)
    d = voice_dir(voice_id)
    if d.exists():
        import shutil
        shutil.rmtree(d)
    return True
