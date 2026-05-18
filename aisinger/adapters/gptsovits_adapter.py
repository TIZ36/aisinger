"""高级档：GPT-SoVITS。主进程通过 JSON-line 与隔离 venv 内的 worker 通信。"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
from collections.abc import Iterator
from pathlib import Path

from ..config import ROOT, THIRD_PARTY_DIR, detect_device
from ..voicelib import store
from ..voicelib.schema import Voice
from .base import VoiceCloneAdapter

GPTSOVITS_DIR = THIRD_PARTY_DIR / "GPT-SoVITS"
WORKER_VENV = ROOT / ".venvs" / "gptsovits"


class GPTSoVITSWorker:
    """Popen 包装：长驻 worker 进程，支持发送命令并流式读取响应。"""

    def __init__(self):
        if not GPTSOVITS_DIR.exists() or not WORKER_VENV.exists():
            raise RuntimeError(
                "GPT-SoVITS 未初始化。先运行: ./scripts/bootstrap_gptsovits.sh"
            )
        python = WORKER_VENV / "bin" / "python"
        env = os.environ.copy()
        # 让 worker 能 import 主仓库的 aisinger.workers.protocol
        env["PYTHONPATH"] = f"{ROOT}{os.pathsep}{env.get('PYTHONPATH','')}"
        env["AISINGER_DEVICE"] = detect_device()
        self.proc = subprocess.Popen(
            [
                str(python), "-m", "aisinger.workers.gptsovits_worker",
                "--gptsovits-dir", str(GPTSOVITS_DIR),
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=env,
        )
        # 读 ready
        ready_line = self.proc.stdout.readline()  # type: ignore[union-attr]
        if not ready_line:
            err = self.proc.stderr.read() if self.proc.stderr else ""
            raise RuntimeError(f"worker 启动失败:\n{err}")
        ready = json.loads(ready_line)
        if ready.get("event") != "ready":
            raise RuntimeError(f"worker 异常响应: {ready_line}")

        # 后台收集 stderr，避免管道阻塞
        self._stderr_lines: list[str] = []
        threading.Thread(target=self._drain_stderr, daemon=True).start()

    def _drain_stderr(self) -> None:
        assert self.proc.stderr is not None
        for line in self.proc.stderr:
            self._stderr_lines.append(line.rstrip())

    def send(self, cmd: str, args: dict | None = None) -> Iterator[dict]:
        """发送一条命令，流式 yield 该命令的事件，直到 result/error。"""
        req_id = uuid.uuid4().hex[:8]
        msg = {"id": req_id, "cmd": cmd, "args": args or {}}
        assert self.proc.stdin is not None and self.proc.stdout is not None
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                tail = "\n".join(self._stderr_lines[-30:])
                raise RuntimeError(f"worker 进程意外退出\nstderr 尾部:\n{tail}")
            evt = json.loads(line)
            if evt.get("id") != req_id:
                continue  # 其他请求的事件，忽略
            yield evt
            if evt["event"] in ("result", "error"):
                break

    def close(self) -> None:
        if self.proc.poll() is None:
            try:
                if self.proc.stdin:
                    self.proc.stdin.close()
            except Exception:
                pass
            self.proc.terminate()


class GPTSoVITSAdapter(VoiceCloneAdapter):
    tier = "pro"

    def __init__(self):
        self.device = detect_device()
        self._worker: GPTSoVITSWorker | None = None

    def _w(self) -> GPTSoVITSWorker:
        if self._worker is None:
            self._worker = GPTSoVITSWorker()
        return self._worker

    def create_voice(
        self,
        name: str,
        samples: list[Path],
        *,
        ref_text: str = "",
        ref_lang: str = "zh",
        **kwargs,
    ) -> Voice:
        """零样本：取第一份样本作为参考片段（理想 5–20 秒纯净人声 + 对应文字）。"""
        if not samples:
            raise ValueError("至少需要一份参考音频")
        voice = store.create(
            name=name,
            tier="pro",
            meta={"ref_text": ref_text, "ref_lang": ref_lang},
        )
        vdir = store.voice_dir(voice.id)
        ref_dest = vdir / "ref.wav"
        shutil.copy(samples[0], ref_dest)
        voice = store.update(voice.id, artifacts={"ref_wav": str(ref_dest)}) or voice
        return voice

    def synthesize(
        self,
        voice: Voice,
        target: Path | str,
        *,
        gen_lang: str = "zh",
        **kwargs,
    ) -> Path:
        text = str(target)
        ref_wav = voice.artifacts.get("ref_wav")
        if not ref_wav:
            raise RuntimeError("voice 缺少 ref_wav")
        ref_text = voice.meta.get("ref_text", "")
        ref_lang = voice.meta.get("ref_lang", "zh")
        out_dir = store.voice_dir(voice.id) / "outputs"
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / f"{uuid.uuid4().hex[:8]}.wav"

        last: dict | None = None
        for evt in self._w().send(
            "synthesize",
            {
                "ref_wav": ref_wav,
                "ref_text": ref_text,
                "ref_lang": ref_lang,
                "gen_text": text,
                "gen_lang": gen_lang,
                "out_path": str(out_path),
            },
        ):
            last = evt
            if evt["event"] == "log":
                print(f"[gptsovits] {evt['msg']}", file=sys.stderr)
        if not last or last["event"] != "result":
            raise RuntimeError(f"合成失败: {last}")
        return Path(last["data"]["out_path"])

    def close(self) -> None:
        if self._worker:
            self._worker.close()
            self._worker = None
