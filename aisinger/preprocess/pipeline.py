"""编排预处理 pipeline。"""

from __future__ import annotations

import json
import subprocess
import uuid
from collections.abc import Iterator
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

from ..config import PROCESSED_DIR, SAMPLE_RATE
from . import separate, slice as slice_mod, denoise

Kind = Literal["speech", "song"]


@dataclass
class ProcessedBundle:
    job_id: str
    kind: Kind
    source: str
    chunks: list[str] = field(default_factory=list)
    vocals: str | None = None
    instrumental: str | None = None

    def manifest_path(self) -> Path:
        return PROCESSED_DIR / self.job_id / "manifest.json"

    def save(self) -> Path:
        p = self.manifest_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(asdict(self), ensure_ascii=False, indent=2))
        return p


def _to_wav(src: Path, dst: Path, sr: int = SAMPLE_RATE) -> Path:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", str(sr), str(dst)],
        check=True,
        capture_output=True,
    )
    return dst


def _to_wav_stream(src: Path, dst: Path, sr: int = SAMPLE_RATE) -> Iterator[str | Path]:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["ffmpeg", "-y", "-i", str(src), "-ac", "1", "-ar", str(sr), str(dst)]
    yield f"[source 5%] 转码为 {sr}Hz mono wav"
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        text = line.rstrip()
        if text:
            yield f"[source 40%] {text}"
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg 转码失败 (exit={code})")
    yield "[source 100%] 输入音频转码完成"
    yield dst


def process(
    input_path: Path,
    kind: Kind,
    do_denoise: bool = True,
) -> ProcessedBundle:
    job_id = uuid.uuid4().hex[:12]
    job_dir = PROCESSED_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    bundle = ProcessedBundle(job_id=job_id, kind=kind, source=str(input_path))

    wav = _to_wav(input_path, job_dir / "input.wav")

    target_for_slice = wav
    if kind == "song":
        sep_dir = job_dir / "sep"
        vocals, instr = separate.separate(wav, sep_dir)
        bundle.vocals = str(vocals)
        bundle.instrumental = str(instr)
        target_for_slice = vocals

    normalized = denoise.denoise_and_normalize(
        target_for_slice,
        job_dir / "normalized.wav",
        do_denoise=do_denoise,
    )
    chunks = slice_mod.slice_to_files(normalized, job_dir / "chunks", sr=SAMPLE_RATE)
    bundle.chunks = [str(c) for c in chunks]
    bundle.save()
    return bundle


def process_stream(
    input_path: Path,
    kind: Kind,
    do_denoise: bool = True,
) -> Iterator[str | ProcessedBundle]:
    """Streaming variant of process() for job progress updates."""
    job_id = uuid.uuid4().hex[:12]
    job_dir = PROCESSED_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    bundle = ProcessedBundle(job_id=job_id, kind=kind, source=str(input_path))

    wav: Path | None = None
    for item in _to_wav_stream(input_path, job_dir / "input.wav"):
        if isinstance(item, Path):
            wav = item
        else:
            yield item
    assert wav is not None

    target_for_slice = wav
    if kind == "song":
        sep_dir = job_dir / "sep"
        for item in separate.separate_stream(wav, sep_dir):
            if isinstance(item, tuple):
                vocals, instr = item
                bundle.vocals = str(vocals)
                bundle.instrumental = str(instr)
                target_for_slice = vocals
            else:
                yield item

    yield "[slice 5%] 开始降噪与响度归一化"
    normalized = denoise.denoise_and_normalize(
        target_for_slice,
        job_dir / "normalized.wav",
        do_denoise=do_denoise,
    )
    yield "[slice 60%] 降噪与响度归一化完成，开始切片"
    chunks = slice_mod.slice_to_files(normalized, job_dir / "chunks", sr=SAMPLE_RATE)
    bundle.chunks = [str(c) for c in chunks]
    yield f"[slice 100%] 切片完成，共 {len(chunks)} 段"
    bundle.save()
    yield bundle
