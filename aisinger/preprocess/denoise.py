"""降噪 + 响度归一化。"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf


def denoise_and_normalize(
    input_wav: Path,
    output_wav: Path,
    target_lufs: float = -23.0,
    do_denoise: bool = True,
) -> Path:
    data, sr = sf.read(str(input_wav))
    if do_denoise:
        import noisereduce as nr
        data = nr.reduce_noise(y=data.T if data.ndim > 1 else data, sr=sr, stationary=False)
        if data.ndim > 1:
            data = data.T
    meter = pyln.Meter(sr)
    mono = data.mean(axis=-1) if data.ndim > 1 else data
    loudness = meter.integrated_loudness(mono)
    if np.isfinite(loudness):
        data = pyln.normalize.loudness(data, loudness, target_lufs)
    output_wav.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_wav), data, sr)
    return output_wav
