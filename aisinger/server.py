"""FastAPI server — REST + SSE 替代 Gradio。"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sse_starlette.sse import EventSourceResponse

from . import jobs
from .config import UPLOADS_DIR, ensure_env
from .songlib import store as songs
from .tracklib import store as tracks
from .voicelib import store as voices

BASE = Path(__file__).parent

# ====== upload limits ======
MAX_UPLOAD_BYTES = 30 * 1024 * 1024
ALLOWED_AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".flac", ".ogg", ".aac"}


def _validate_audio_upload(f: UploadFile) -> None:
    ext = Path(f.filename or "").suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTS:
        raise HTTPException(
            400, f"不支持的格式 {ext or '(无后缀)'}：仅接受 {', '.join(sorted(ALLOWED_AUDIO_EXTS))}"
        )


async def _save_upload(f: UploadFile, dst: Path) -> int:
    """流式落盘，并校验大小。返回 bytes 写入数。"""
    dst.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with dst.open("wb") as out:
        while True:
            chunk = await f.read(1024 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                out.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(
                    413, f"文件太大（最大 {MAX_UPLOAD_BYTES // 1024 // 1024} MB）。试试切短一点。"
                )
            out.write(chunk)
    return written


# ====== app ======
app = FastAPI(title="aisinger")
app.mount("/static", StaticFiles(directory=str(BASE / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE / "templates"))

# pro 档 adapter 在主进程内单例持有，worker 子进程长驻
_pro_adapter = None


def _get_pro():
    global _pro_adapter
    if _pro_adapter is None:
        from .adapters.gptsovits_adapter import GPTSoVITSAdapter

        _pro_adapter = GPTSoVITSAdapter()
    return _pro_adapter


def _create_song_sync(
    voice_id: str,
    track_id: str | None,
    text: str | None,
    pitch: int,
    index_rate: float,
    f0_method: str = "pm",
):
    voice = voices.get(voice_id)
    if not voice:
        raise HTTPException(404, "voice not found")

    if voice.tier == "simple":
        if not text:
            raise HTTPException(400, "simple 档需要 text 输入")
        from .adapters.f5tts_adapter import F5TTSAdapter

        out = F5TTSAdapter().synthesize(voice, text)
    elif voice.tier == "mid":
        if not track_id:
            raise HTTPException(400, "mid 档需要 track_id")
        t = tracks.get(track_id)
        if not t:
            raise HTTPException(404, "track not found")
        from .adapters.rvc_adapter import RVCAdapter

        out = RVCAdapter().synthesize(
            voice,
            Path(t["audio"]),
            transpose=pitch,
            f0_method=f0_method,
            index_rate=index_rate,
        )
    elif voice.tier == "pro":
        if not text:
            raise HTTPException(400, "高级档需要 text 输入")
        try:
            out = _get_pro().synthesize(voice, text)
        except RuntimeError as e:
            raise HTTPException(503, f"高级档未就绪：{e}")
    else:
        raise HTTPException(400, f"unknown tier: {voice.tier}")

    return songs.create(
        voice_id=voice_id,
        track_id=track_id,
        text=text,
        audio_path=Path(out),
        params={"pitch": pitch, "index_rate": index_rate, "f0_method": f0_method},
    )


@app.on_event("startup")
async def _startup() -> None:
    ensure_env()
    jobs.set_loop(asyncio.get_event_loop())


# ============= UI =============
@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


# ============= VOICES =============
def _voice_view(v) -> dict[str, Any]:
    d = v.model_dump() if hasattr(v, "model_dump") else dict(v)
    return d


@app.get("/api/voices")
async def list_voices() -> list[dict[str, Any]]:
    return [_voice_view(v) for v in voices.list_voices()]


@app.get("/api/voices/{vid}")
async def get_voice(vid: str):
    v = voices.get(vid)
    if not v:
        raise HTTPException(404, "voice not found")
    return _voice_view(v)


@app.delete("/api/voices/{vid}")
async def delete_voice(vid: str):
    ok = voices.delete(vid)
    if not ok:
        raise HTTPException(404, "voice not found")
    return {"ok": True}


@app.post("/api/voices")
async def create_voice(
    name: str = Form(...),
    tier: str = Form("mid"),
    epochs: int = Form(20),
    batch_size: int = Form(4),
    ref_text: str = Form(""),
    ref_lang: str = Form("zh"),
    samples: list[UploadFile] = File(default_factory=list),
):
    """新建音色。
    simple/pro 档 = 零样本/瞬时，返回 voice_id（无 job）
    mid 档 = 真训练，返回 job_id（前端订阅 SSE）
    """
    if not name.strip():
        raise HTTPException(400, "请填写音色名称")

    # 校验 + 落盘
    for f in samples or []:
        _validate_audio_upload(f)
    upload_dir = UPLOADS_DIR / uuid.uuid4().hex[:8]
    sample_paths: list[Path] = []
    for f in samples or []:
        dst = upload_dir / (f.filename or f"sample_{len(sample_paths)}.wav")
        await _save_upload(f, dst)
        sample_paths.append(dst)

    if tier == "simple":
        if not sample_paths:
            raise HTTPException(400, "简易档需要至少 1 段说话音频")
        from .adapters.f5tts_adapter import F5TTSAdapter

        voice = F5TTSAdapter().create_voice(name=name, samples=sample_paths, ref_text=ref_text)
        return {"voice_id": voice.id, "job_id": None, "voice": voice.model_dump()}

    if tier == "mid":
        if not sample_paths:
            raise HTTPException(400, "中等档需要至少 1 首样本歌曲")
        from .adapters.rvc_adapter import RVCAdapter

        adapter = RVCAdapter()

        def _gen():
            for item in adapter.train_voice(
                name, sample_paths, epochs=epochs, batch_size=batch_size
            ):
                yield item

        job = jobs.submit("train", _gen, meta={"voice_name": name, "tier": tier, "epochs": epochs})
        return {"job_id": job.id, "voice_id": None}

    if tier == "pro":
        if not sample_paths:
            raise HTTPException(400, "高级档需要 1 段 5–20s 纯净人声参考")
        if not ref_text.strip():
            raise HTTPException(400, "高级档需要填写参考音频对应的文字 (ref_text)")
        try:
            voice = _get_pro().create_voice(
                name=name, samples=sample_paths, ref_text=ref_text, ref_lang=ref_lang
            )
        except RuntimeError as e:
            raise HTTPException(503, f"高级档未就绪：{e}")
        return {"voice_id": voice.id, "job_id": None, "voice": voice.model_dump()}

    raise HTTPException(400, f"未知档位: {tier}")


# ============= TRACKS =============
@app.get("/api/tracks")
async def list_tracks():
    out = []
    for t in tracks.list_all():
        out.append({**t, "duration": t.get("duration")})
    return out


@app.post("/api/tracks")
async def upload_track(
    name: str = Form(...),
    artist: str = Form(""),
    file: UploadFile = File(...),
):
    if not name.strip():
        raise HTTPException(400, "请填写歌曲名")
    _validate_audio_upload(file)
    dst = UPLOADS_DIR / f"{uuid.uuid4().hex[:8]}_{file.filename}"
    await _save_upload(file, dst)
    rec = tracks.create(name=name, artist=artist, source=dst)
    return rec


@app.get("/api/tracks/{tid}")
async def get_track(tid: str):
    t = tracks.get(tid)
    if not t:
        raise HTTPException(404, "track not found")
    return t


@app.get("/api/tracks/{tid}/audio")
async def get_track_audio(tid: str):
    t = tracks.get(tid)
    if not t:
        raise HTTPException(404, "track not found")
    return FileResponse(t["audio"])


@app.delete("/api/tracks/{tid}")
async def delete_track(tid: str):
    ok = tracks.delete(tid)
    if not ok:
        raise HTTPException(404, "track not found")
    return {"ok": True}


# ============= SONGS =============
@app.get("/api/songs")
async def list_songs():
    return songs.list_all()


@app.post("/api/songs")
async def create_song(
    voice_id: str = Form(...),
    track_id: str | None = Form(None),
    text: str | None = Form(None),
    pitch: int = Form(0),
    index_rate: float = Form(0.75),
    f0_method: str = Form("pm"),
):
    return _create_song_sync(voice_id, track_id, text, pitch, index_rate, f0_method)


@app.post("/api/songs/jobs")
async def create_song_job(
    voice_id: str = Form(...),
    track_id: str | None = Form(None),
    text: str | None = Form(None),
    pitch: int = Form(0),
    index_rate: float = Form(0.75),
    f0_method: str = Form("pm"),
):
    voice = voices.get(voice_id)
    if not voice:
        raise HTTPException(404, "voice not found")
    if voice.tier == "mid" and not track_id:
        raise HTTPException(400, "mid 档需要 track_id")
    if voice.tier in {"simple", "pro"} and not text:
        raise HTTPException(400, f"{voice.tier} 档需要 text 输入")

    def _gen():
        yield "[input] 校验输入"
        yield "[voice] 载入音色"
        if track_id:
            yield "[track] 载入曲目"
        else:
            yield "[text] 载入文本"
        yield "[synthesize] 开始合成"
        if voice.tier == "mid":
            yield f"[synthesize] RVC Mac 安全模式：CPU + {f0_method}，禁用 index，单线程推理"
        rec = _create_song_sync(voice_id, track_id, text, pitch, index_rate, f0_method)
        yield "[finalize] 写入歌曲库"
        yield rec

    job = jobs.submit(
        "synthesize",
        _gen,
        meta={
            "voice_id": voice_id,
            "track_id": track_id,
            "text": text,
            "pitch": pitch,
            "index_rate": index_rate,
            "f0_method": f0_method,
        },
    )
    return {"job_id": job.id}


@app.get("/api/songs/{sid}/audio")
async def get_song_audio(sid: str):
    s = songs.get(sid)
    if not s:
        raise HTTPException(404, "song not found")
    return FileResponse(s["audio"])


@app.delete("/api/songs/{sid}")
async def delete_song(sid: str):
    ok = songs.delete(sid)
    if not ok:
        raise HTTPException(404, "song not found")
    return {"ok": True}


# ============= JOBS / SSE =============
def _job_view(j: jobs.Job, *, with_logs: bool = False) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": j.id,
        "kind": j.kind,
        "status": j.status,
        "stage": j.stage,
        "pct": j.pct,
        "detail": j.detail,
        "meta": j.meta,
        "started_at": j.started_at,
        "finished_at": j.finished_at,
        "error": j.error,
    }
    if with_logs or j.status != "running":
        d["logs"] = j.logs[-60:]
    return d


@app.get("/api/jobs")
async def list_jobs():
    return [_job_view(j) for j in jobs._JOBS.values()]


@app.get("/api/jobs/{job_id}")
async def get_job(job_id: str):
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    return _job_view(j, with_logs=True)


@app.delete("/api/jobs/{job_id}")
async def dismiss_job(job_id: str):
    """从内存里清掉已结束的 job（仅 done/error 状态可清）。"""
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    if j.status == "running":
        raise HTTPException(400, "运行中的任务无法清除，请先停止")
    jobs._JOBS.pop(job_id, None)
    jobs._QUEUES.pop(job_id, None)
    return {"ok": True}


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str):
    j = jobs.get(job_id)
    if not j:
        raise HTTPException(404, "job not found")
    if j.status != "running":
        return {"ok": True, "status": j.status}
    if not jobs.cancel(job_id):
        raise HTTPException(400, "任务无法终止")
    return {"ok": True, "status": "cancelling"}


@app.get("/sse/jobs/{job_id}")
async def sse_jobs(job_id: str, request: Request):
    async def event_iter():
        async for evt in jobs.stream(job_id):
            if await request.is_disconnected():
                break
            yield evt

    return EventSourceResponse(event_iter())
