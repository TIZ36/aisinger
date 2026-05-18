"""简易档：F5-TTS 零样本说话音色克隆。"""
from __future__ import annotations

import shutil
from pathlib import Path

from ..config import detect_device
from ..voicelib import store
from ..voicelib.schema import Voice
from .base import VoiceCloneAdapter


class F5TTSAdapter(VoiceCloneAdapter):
    tier = "simple"

    def __init__(self):
        self.device = detect_device()
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return self._model
        from f5_tts.api import F5TTS  # lazy import
        self._model = F5TTS(device=self.device if self.device != "cuda" else None)
        return self._model

    def create_voice(self, name: str, samples: list[Path], ref_text: str = "", **kwargs) -> Voice:
        """F5-TTS 不训练，直接把第一段样本作为参考片段存下来。

        ref_text 是参考音频对应的转写文本（F5-TTS 需要）。留空则尝试 Whisper 自动转写。
        """
        if not samples:
            raise ValueError("at least one sample required")
        voice = store.create(name=name, tier="simple", meta={"ref_text": ref_text})
        dest = store.voice_dir(voice.id) / "ref.wav"
        shutil.copy(samples[0], dest)
        voice = store.update(voice.id, artifacts={"ref_wav": str(dest)}) or voice
        return voice

    def synthesize(self, voice: Voice, target: Path | str, **kwargs) -> Path:
        text = str(target)
        ref_wav = voice.artifacts.get("ref_wav")
        ref_text = voice.meta.get("ref_text", "")
        if not ref_wav:
            raise RuntimeError("voice has no ref_wav artifact")
        out_dir = store.voice_dir(voice.id) / "outputs"
        out_dir.mkdir(parents=True, exist_ok=True)
        from uuid import uuid4
        out_path = out_dir / f"{uuid4().hex[:8]}.wav"
        model = self._ensure_model()
        model.infer(
            ref_file=ref_wav,
            ref_text=ref_text,
            gen_text=text,
            file_wave=str(out_path),
        )
        return out_path
