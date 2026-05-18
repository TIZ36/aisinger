"""中等档：RVC v2 推理（Phase 1 仅推理，不训练）。

期望用户通过 UI 导入已有的 .pth + .index 文件作为音色，
或后续 Phase 2 加入训练流程。
"""

from __future__ import annotations

import shutil
import subprocess
import os
from collections.abc import Iterator
from pathlib import Path

from ..config import THIRD_PARTY_DIR, detect_device
from .. import jobs
from ..training import rvc_train
from ..voicelib import store
from ..voicelib.schema import Voice
from .base import VoiceCloneAdapter

RVC_DIR = THIRD_PARTY_DIR / "Retrieval-based-Voice-Conversion-WebUI"
RVC_PYTHON = THIRD_PARTY_DIR.parent / ".venvs" / "rvc" / "bin" / "python"
RVC_INFER_TIMEOUT_SEC = 10 * 60


class RVCAdapter(VoiceCloneAdapter):
    tier = "mid"

    def __init__(self):
        self.device = detect_device()

    def create_voice(
        self,
        name: str,
        samples: list[Path],
        *,
        pth_file: Path | None = None,
        index_file: Path | None = None,
        **kwargs,
    ) -> Voice:
        """导入已有 RVC 模型。samples 可为空。

        必填 pth_file；index_file 可选。要从 samples 训练请用 train_voice()。
        """
        if pth_file is None:
            raise ValueError("import 路径必须提供 pth_file；要训练新音色请调用 train_voice()。")
        voice = store.create(name=name, tier="mid")
        vdir = store.voice_dir(voice.id)
        artifacts = {"pth": str(shutil.copy(pth_file, vdir / "model.pth"))}
        if index_file:
            artifacts["index"] = str(shutil.copy(index_file, vdir / "added.index"))
        if samples:
            ref_dir = vdir / "samples"
            ref_dir.mkdir(exist_ok=True)
            for i, s in enumerate(samples):
                shutil.copy(s, ref_dir / f"sample_{i:02d}{Path(s).suffix}")
        voice = store.update(voice.id, artifacts=artifacts) or voice
        return voice

    def train_voice(
        self,
        name: str,
        samples: list[Path],
        *,
        epochs: int = 20,
        batch_size: int = 4,
    ) -> Iterator[str | Voice]:
        """从 1-5 段带伴奏的人声演唱样本训练自有音色。生成器：流式 yield 日志，最后 yield Voice。

        每段样本先做人声分离，再转成训练片段喂给 RVC。
        """
        from ..preprocess import pipeline as pp

        if not samples:
            raise ValueError("至少需要一份样本")
        yield f"== 共享预处理 {len(samples)} 个样本 =="
        prepared: list[Path] = []
        for i, s in enumerate(samples):
            yield f"[preprocess {i + 1}/{len(samples)}] {s.name}"
            bundle = None
            for item in pp.process_stream(s, kind="song"):
                if isinstance(item, pp.ProcessedBundle):
                    bundle = item
                else:
                    yield item
            assert bundle is not None
            prepared.extend(Path(c) for c in bundle.chunks)
            yield f"[preprocess {i + 1}/{len(samples)}] 切出 {len(bundle.chunks)} 段"

        if not prepared:
            raise RuntimeError("预处理后无可用片段")
        if len(prepared) < 2:
            raise RuntimeError(
                "有效训练片段少于 2 段。请上传更长、更清晰的带伴奏演唱样本，建议总时长至少 30 秒。"
            )

        exp_name = f"aisinger_{name.replace(' ', '_')}_{len(samples)}s"
        yield f"== 启动 RVC 训练: exp={exp_name} epochs={epochs} bs={batch_size} =="

        result: rvc_train.TrainResult | None = None
        for item in rvc_train.train(
            exp_name=exp_name,
            samples=prepared,
            device=self.device,
            epochs=epochs,
            batch_size=batch_size,
        ):
            if isinstance(item, rvc_train.TrainResult):
                result = item
            else:
                yield item
        assert result is not None, "训练完成但未返回结果"

        voice = store.create(name=name, tier="mid", meta={"epochs": epochs, "exp_name": exp_name})
        vdir = store.voice_dir(voice.id)
        artifacts = {"pth": str(shutil.copy(result.pth_path, vdir / "model.pth"))}
        if result.index_path:
            artifacts["index"] = str(shutil.copy(result.index_path, vdir / "added.index"))
        voice = store.update(voice.id, artifacts=artifacts) or voice
        yield f"✅ 训练完成：{voice.name} (id={voice.id})"
        yield voice

    def synthesize(
        self,
        voice: Voice,
        target: Path | str,
        *,
        transpose: int = 0,
        f0_method: str = "rmvpe",
        index_rate: float = 0.75,
        **kwargs,
    ) -> Path:
        from ..preprocess import pipeline as pp

        target_path = Path(target)
        bundle = pp.process(target_path, kind="song")

        pth = voice.artifacts.get("pth")
        if not pth:
            raise RuntimeError("voice has no pth artifact")
        pth_path = Path(pth)
        if not pth_path.exists():
            raise RuntimeError(f"voice pth artifact not found: {pth_path}")
        idx = voice.artifacts.get("index", "")

        out_dir = store.voice_dir(voice.id) / "outputs"
        out_dir.mkdir(parents=True, exist_ok=True)
        from uuid import uuid4

        out_vocals = out_dir / f"{uuid4().hex[:8]}_vocals.wav"

        # RVC CLI uses the same isolated venv as training; the app venv lacks RVC deps.
        if not RVC_DIR.exists():
            raise RuntimeError(
                f"RVC repo not found at {RVC_DIR}. Run scripts/bootstrap_mac.sh first."
            )
        if not RVC_PYTHON.exists():
            raise RuntimeError(
                f"RVC venv not found at {RVC_PYTHON}. Run scripts/bootstrap_rvc_venv.sh first."
            )
        weights_dir = RVC_DIR / "assets" / "weights"
        weights_dir.mkdir(parents=True, exist_ok=True)
        model_name = f"aisinger_{voice.id}.pth"
        rvc_weight = weights_dir / model_name
        if not rvc_weight.exists() or rvc_weight.stat().st_mtime < pth_path.stat().st_mtime:
            shutil.copy2(pth_path, rvc_weight)
        mac_safe_mode = self.device in {"mps", "cpu"}
        infer_device = "cpu" if mac_safe_mode else self.device
        infer_index_path = "" if mac_safe_mode else idx
        infer_index_rate = 0.0 if mac_safe_mode else index_rate
        cmd = [
            str(RVC_PYTHON),
            str(RVC_DIR / "tools" / "infer_cli.py"),
            "--input_path",
            bundle.vocals or bundle.chunks[0],
            "--model_name",
            model_name,
            "--index_path",
            infer_index_path,
            "--f0method",
            f0_method,
            "--f0up_key",
            str(transpose),
            "--index_rate",
            str(infer_index_rate),
            "--device",
            infer_device,
            "--opt_path",
            str(out_vocals),
        ]
        env = os.environ.copy()
        if mac_safe_mode:
            env.update(
                {
                    "OMP_NUM_THREADS": "1",
                    "MKL_NUM_THREADS": "1",
                    "OPENBLAS_NUM_THREADS": "1",
                    "NUMEXPR_NUM_THREADS": "1",
                    "VECLIB_MAXIMUM_THREADS": "1",
                    "TOKENIZERS_PARALLELISM": "false",
                }
            )
        try:
            jobs.run_process(
                cmd,
                cwd=str(RVC_DIR),
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                timeout=RVC_INFER_TIMEOUT_SEC,
            )
        except subprocess.TimeoutExpired as e:
            output = _tail_output(e.output)
            raise RuntimeError(
                f"RVC 推理超时 ({RVC_INFER_TIMEOUT_SEC}s)，已停止。最后输出:\n{output}"
            ) from e
        except subprocess.CalledProcessError as e:
            output = _tail_output(e.stdout)
            raise RuntimeError(f"RVC 推理失败 (exit={e.returncode})。最后输出:\n{output}") from e

        if not out_vocals.exists() or out_vocals.stat().st_size == 0:
            raise RuntimeError(f"RVC 推理结束但未生成输出: {out_vocals}")

        if bundle.instrumental:
            mixed = out_dir / f"{out_vocals.stem.replace('_vocals', '')}_mix.wav"
            self._mix(out_vocals, Path(bundle.instrumental), mixed)
            return mixed
        return out_vocals

    @staticmethod
    def _mix(vocals: Path, instrumental: Path, out: Path) -> None:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(vocals),
                "-i",
                str(instrumental),
                "-filter_complex",
                "[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=0[a]",
                "-map",
                "[a]",
                str(out),
            ],
            check=True,
            capture_output=True,
        )


def _tail_output(output: str | bytes | None, limit: int = 4000) -> str:
    if output is None:
        return "<no output>"
    if isinstance(output, bytes):
        output = output.decode(errors="replace")
    return output[-limit:] if len(output) > limit else output
