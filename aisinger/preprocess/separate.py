"""人声/伴奏分离。包装 Demucs v4 htdemucs_ft。"""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

DEFAULT_MODEL = "htdemucs_ft"


def separate(input_wav: Path, out_dir: Path, model: str = DEFAULT_MODEL) -> tuple[Path, Path]:
    """Run Demucs CLI. Returns (vocals_path, instrumental_path)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        model,
        "--two-stems",
        "vocals",
        "-o",
        str(out_dir),
        str(input_wav),
    ]
    subprocess.run(cmd, check=True)
    stem = out_dir / model / input_wav.stem
    return stem / "vocals.wav", stem / "no_vocals.wav"


def separate_stream(
    input_wav: Path, out_dir: Path, model: str = DEFAULT_MODEL
) -> Iterator[str | tuple[Path, Path]]:
    """Run Demucs CLI and stream its output. Yields final paths when done."""
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "-n",
        model,
        "--two-stems",
        "vocals",
        "-o",
        str(out_dir),
        str(input_wav),
    ]
    yield f"[separate 5%] 启动 Demucs: {input_wav.name}"
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    last_pct = 5
    for line in proc.stdout:
        text = line.rstrip()
        if not text:
            continue
        if last_pct < 90:
            last_pct += 5
        yield f"[separate {last_pct}%] {text}"
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"Demucs 分离失败 (exit={code})")
    stem = out_dir / model / input_wav.stem
    vocals = stem / "vocals.wav"
    instrumental = stem / "no_vocals.wav"
    if not vocals.exists() or not instrumental.exists():
        raise RuntimeError(f"Demucs 输出缺失: {vocals} / {instrumental}")
    yield "[separate 100%] 人声/伴奏分离完成"
    yield vocals, instrumental
