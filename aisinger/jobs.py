"""作业管理器：把生成器式任务转成 SSE 事件流。

设计:
- 每个 job_id 一个线程跑生成器
- 生成器 yield 的值放进 asyncio.Queue
- SSE endpoint 异步消费 queue → 发给浏览器
- 单进程内存级，重启即丢，MVP 足够

事件类型 (SSE event):
- stage:   {"stage":"separate","pct":42,"detail":"..."}
- log:     {"level":"info","msg":"..."}
- done:    {"result": ...}
- error:   {"msg":"..."}
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
import time
import traceback
import uuid
import subprocess
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any


# RVC 5 步训练阶段映射：通过 worker 输出的 [label] 前缀识别
_STAGE_PATTERNS = [
    (re.compile(r"\[source\s+(\d+(?:\.\d+)?)%\]"), "source", None),
    (re.compile(r"\[separate\s+(\d+(?:\.\d+)?)%\]"), "separate", None),
    (re.compile(r"\[slice\s+(\d+(?:\.\d+)?)%\]"), "slice", None),
    (re.compile(r"\[input\]"), "input", 5),
    (re.compile(r"\[voice\]"), "voice", 18),
    (re.compile(r"\[track\]|\[text\]"), "source", 32),
    (re.compile(r"\[synthesize\]"), "synthesize", 58),
    (re.compile(r"\[finalize\]"), "finalize", 88),
    (re.compile(r"\[preprocess "), "separate", None),
    (re.compile(r"htdemucs"), "separate", None),
    (re.compile(r"响度|归一化|normaliz"), "slice", None),
    (re.compile(r"\[1/5 preprocess\]"), "rvc-pp", None),
    (re.compile(r"\[2/5 f0\]"), "rvc-f0", None),
    (re.compile(r"\[3/5 feature\]"), "rvc-feat", None),
    (re.compile(r"\[4/5 train\]"), "rvc-train", None),
    (re.compile(r"\[5/5 index\]"), "rvc-index", None),
]
_EPOCH_RE = re.compile(r"epoch\s*[:=]?\s*(\d+)\s*/\s*(\d+)", re.I)
_RVC_EPOCH_RE = re.compile(r"Epoch:\s*(\d+)", re.I)


@dataclass
class Job:
    id: str
    kind: str  # "train" | "synthesize"
    status: str = "running"  # running | done | error | cancelled
    result: Any = None
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    stage: str = ""
    pct: float = 0.0
    detail: str = ""
    meta: dict[str, Any] = field(default_factory=dict)
    logs: list[str] = field(default_factory=list)  # ring buffer 最后 N 行
    cancel_requested: bool = False
    cancel_callbacks: list[Callable[[], None]] = field(default_factory=list)


class JobCancelled(RuntimeError):
    pass


_JOBS: dict[str, Job] = {}
_QUEUES: dict[str, asyncio.Queue] = {}
_LOOP: asyncio.AbstractEventLoop | None = None
_LOCAL = threading.local()


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    """主 event loop 注入，让 worker thread 能 schedule 回主循环。"""
    global _LOOP
    _LOOP = loop


def _publish(job_id: str, event: dict[str, Any]) -> None:
    q = _QUEUES.get(job_id)
    if q is None or _LOOP is None:
        return
    asyncio.run_coroutine_threadsafe(q.put(event), _LOOP)


def _parse_stage(line: str, job: Job) -> dict[str, Any] | None:
    """从一行日志里嗅出阶段信号。返回 stage event 或 None。"""
    for pat, stage, fixed_pct in _STAGE_PATTERNS:
        if m := pat.search(line):
            if stage != job.stage:
                job.stage = stage
                job.pct = 0.0
            if m.lastindex:
                pct = float(m.group(1))
                job.pct = max(job.pct, min(100.0, pct))
                job.detail = line[:120]
                return {"stage": stage, "pct": job.pct, "detail": job.detail}
            if fixed_pct is not None:
                job.pct = fixed_pct
                job.detail = line[:80]
                return {"stage": stage, "pct": job.pct, "detail": job.detail}
            # epoch 进度
            m = _EPOCH_RE.search(line)
            if m and stage == "rvc-train":
                cur, total = int(m.group(1)), int(m.group(2))
                if total > 0:
                    pct = cur / total * 100
                    job.pct = max(job.pct, pct)
                    job.detail = f"epoch {cur}/{total}"
                    return {"stage": stage, "pct": job.pct, "detail": job.detail}
            m = _RVC_EPOCH_RE.search(line)
            total = int(job.meta.get("epochs") or 0)
            if m and stage == "rvc-train" and total > 0:
                cur = int(m.group(1))
                pct = min(100.0, cur / total * 100)
                job.pct = max(job.pct, pct)
                job.detail = f"epoch {cur}/{total}"
                return {"stage": stage, "pct": job.pct, "detail": job.detail}
            job.detail = line[:80]
            return {"stage": stage, "pct": job.pct, "detail": job.detail}
    return None


def _runner(job: Job, gen_factory: Callable[[], Iterator[Any]]) -> None:
    try:
        _LOCAL.job = job
        gen = gen_factory()
        for item in gen:
            check_cancelled()
            if isinstance(item, str):
                evt = _parse_stage(item, job)
                if evt:
                    _publish(job.id, {"event": "stage", "data": evt})
                job.logs.append(item)
                if len(job.logs) > 200:
                    del job.logs[:50]
                _publish(job.id, {"event": "log", "data": {"level": "info", "msg": item}})
            else:
                # 终值（Voice / song record 等）
                job.result = item
        if job.cancel_requested:
            raise JobCancelled("任务已终止")
        job.status = "done"
        job.pct = 100.0
        job.finished_at = time.time()
        # serialize result
        payload: Any = job.result
        try:
            if hasattr(payload, "model_dump"):
                payload = payload.model_dump()
            elif hasattr(payload, "__dict__"):
                payload = {k: v for k, v in payload.__dict__.items() if not k.startswith("_")}
        except Exception:
            payload = str(payload)
        _publish(job.id, {"event": "done", "data": {"result": payload}})
    except JobCancelled as e:
        job.status = "cancelled"
        job.error = str(e)
        job.detail = str(e)
        job.finished_at = time.time()
        _publish(job.id, {"event": "error", "data": {"msg": job.error, "cancelled": True}})
    except Exception as e:  # noqa: BLE001
        job.status = "error"
        job.error = f"{type(e).__name__}: {e}"
        job.finished_at = time.time()
        _publish(
            job.id, {"event": "error", "data": {"msg": job.error, "trace": traceback.format_exc()}}
        )
    finally:
        if getattr(_LOCAL, "job", None) is job:
            _LOCAL.job = None


def submit(
    kind: str, gen_factory: Callable[[], Iterator[Any]], meta: dict[str, Any] | None = None
) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], kind=kind, meta=meta or {})
    _JOBS[job.id] = job
    _QUEUES[job.id] = asyncio.Queue()
    t = threading.Thread(target=_runner, args=(job, gen_factory), daemon=True, name=f"job-{job.id}")
    t.start()
    return job


def get(job_id: str) -> Job | None:
    return _JOBS.get(job_id)


def list_running() -> list[Job]:
    return [j for j in _JOBS.values() if j.status == "running"]


def current() -> Job | None:
    return getattr(_LOCAL, "job", None)


def check_cancelled() -> None:
    job = current()
    if job and job.cancel_requested:
        raise JobCancelled("任务已终止")


def register_cancel_callback(callback: Callable[[], None]) -> None:
    job = current()
    if job is not None:
        job.cancel_callbacks.append(callback)


def unregister_cancel_callback(callback: Callable[[], None]) -> None:
    job = current()
    if job is not None:
        try:
            job.cancel_callbacks.remove(callback)
        except ValueError:
            pass


def run_process(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
    timeout = kwargs.pop("timeout", None)
    started = time.time()
    proc = subprocess.Popen(cmd, **kwargs)

    def terminate() -> None:
        if proc.poll() is None:
            proc.terminate()

    register_cancel_callback(terminate)
    try:
        stdout: str | bytes | None = None
        while True:
            check_cancelled()
            if timeout is not None and time.time() - started > float(timeout):
                terminate()
                raise subprocess.TimeoutExpired(cmd, float(timeout), output=stdout)
            try:
                stdout, _ = proc.communicate(timeout=0.5)
                break
            except subprocess.TimeoutExpired:
                continue
        if proc.returncode:
            raise subprocess.CalledProcessError(proc.returncode, cmd, output=stdout)
        return subprocess.CompletedProcess(cmd, proc.returncode, stdout)
    finally:
        unregister_cancel_callback(terminate)
        if proc.poll() is None:
            proc.terminate()


def cancel(job_id: str) -> bool:
    job = _JOBS.get(job_id)
    if not job or job.status != "running":
        return False
    job.cancel_requested = True
    job.detail = "正在终止任务"
    for callback in list(job.cancel_callbacks):
        try:
            callback()
        except Exception:
            pass
    _publish(
        job.id,
        {"event": "stage", "data": {"stage": job.stage, "pct": job.pct, "detail": job.detail}},
    )
    return True


async def stream(job_id: str):
    """SSE 异步生成器：从 queue 取事件 yield 出去。"""
    q = _QUEUES.get(job_id)
    if q is None:
        yield {"event": "error", "data": json.dumps({"msg": "job not found"})}
        return
    job = _JOBS.get(job_id)
    if job:
        # 先推一个初始 snapshot
        yield {
            "event": "snapshot",
            "data": json.dumps(
                {
                    "status": job.status,
                    "stage": job.stage,
                    "pct": job.pct,
                    "detail": job.detail,
                    "started_at": job.started_at,
                    "finished": job.status in ("done", "error", "cancelled"),
                    "error": job.error,
                    "logs": job.logs[-60:],
                }
            ),
        }
    while True:
        try:
            evt = await asyncio.wait_for(q.get(), timeout=30.0)
        except asyncio.TimeoutError:
            # heartbeat
            yield {"event": "ping", "data": "1"}
            continue
        yield {"event": evt["event"], "data": json.dumps(evt["data"], ensure_ascii=False)}
        if evt["event"] in ("done", "error"):
            break
