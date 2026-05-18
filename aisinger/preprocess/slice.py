"""基于静音检测的音频切片。移植自 openvpi/audio-slicer 的核心算法。"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf


def _get_rms(y: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    pad = frame_length // 2
    y = np.pad(y, (pad, pad), mode="reflect")
    n_frames = 1 + (len(y) - frame_length) // hop_length
    frames = np.lib.stride_tricks.as_strided(
        y,
        shape=(frame_length, n_frames),
        strides=(y.strides[0], hop_length * y.strides[0]),
    )
    return np.sqrt(np.mean(frames**2, axis=0))


class Slicer:
    """切片器：根据响度阈值找静音段做切割。"""

    def __init__(
        self,
        sr: int,
        threshold_db: float = -40.0,
        min_length_ms: int = 5000,
        min_interval_ms: int = 300,
        hop_size_ms: int = 10,
        max_sil_kept_ms: int = 500,
    ):
        if min_length_ms < min_interval_ms < hop_size_ms:
            raise ValueError("require min_length >= min_interval >= hop_size")
        self.sr = sr
        self.threshold = 10 ** (threshold_db / 20.0)
        self.hop_size = round(sr * hop_size_ms / 1000)
        self.win_size = min(round(sr * min_interval_ms / 1000), 4 * self.hop_size)
        self.min_length = round(sr * min_length_ms / 1000 / self.hop_size)
        self.min_interval = round(min_interval_ms / hop_size_ms)
        self.max_sil_kept = round(max_sil_kept_ms / hop_size_ms)

    def slice(self, wav: np.ndarray) -> list[np.ndarray]:
        if wav.ndim > 1:
            mono = wav.mean(axis=-1)
        else:
            mono = wav
        if mono.shape[0] / self.sr <= self.min_length / 1000 * self.hop_size:
            return [wav]
        rms = (
            _get_rms(mono, frame_length=self.win_size, hop_length=self.hop_size).squeeze(0)
            if False
            else _get_rms(mono, frame_length=self.win_size, hop_length=self.hop_size)
        )
        sil_tags = []
        silence_start = None
        clip_start = 0
        for i, r in enumerate(rms):
            if r < self.threshold:
                if silence_start is None:
                    silence_start = i
                continue
            if silence_start is None:
                continue
            is_leading = silence_start == 0 and i > self.max_sil_kept
            need_slice = (
                i - silence_start >= self.min_interval and i - clip_start >= self.min_length
            )
            if not is_leading and not need_slice:
                silence_start = None
                continue
            mid = (silence_start + i) // 2
            sil_tags.append((silence_start, mid, i))
            clip_start = i
            silence_start = None
        if silence_start is not None and len(rms) - silence_start >= self.min_interval:
            sil_tags.append((silence_start, (silence_start + len(rms)) // 2, len(rms)))
        chunks: list[np.ndarray] = []
        if not sil_tags:
            return [wav]
        cur = 0
        for _s, m, _e in sil_tags:
            end = m * self.hop_size
            chunks.append(wav[cur:end])
            cur = end
        chunks.append(wav[cur:])
        return [c for c in chunks if len(c) > 0]


def slice_to_files(
    input_wav: Path,
    out_dir: Path,
    sr: int = 44100,
    *,
    min_duration_sec: float = 1.0,
    min_rms: float = 1e-4,
) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    wav, file_sr = sf.read(str(input_wav))
    if file_sr != sr:
        import librosa

        wav = (
            librosa.resample(wav.T if wav.ndim > 1 else wav, orig_sr=file_sr, target_sr=sr).T
            if wav.ndim > 1
            else librosa.resample(wav, orig_sr=file_sr, target_sr=sr)
        )
    slicer = Slicer(sr=sr)
    paths: list[Path] = []
    for i, chunk in enumerate(slicer.slice(wav)):
        mono = chunk.mean(axis=-1) if chunk.ndim > 1 else chunk
        if len(mono) < int(sr * min_duration_sec):
            continue
        if float(np.sqrt(np.mean(np.square(mono)))) < min_rms:
            continue
        p = out_dir / f"chunk_{i:03d}.wav"
        sf.write(str(p), chunk, sr)
        paths.append(p)
    return paths
