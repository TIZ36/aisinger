"""GPT-SoVITS worker：运行在隔离 venv 内的子进程。

启动方式（由主进程负责）::

    .venvs/gptsovits/bin/python -m aisinger.workers.gptsovits_worker \
        --gptsovits-dir third_party/GPT-SoVITS

通信：stdin/stdout JSON-line，见 protocol.py。

支持命令:
- ping：健康检查
- synthesize：零样本合成。args = {ref_wav, ref_text, ref_lang, gen_text, gen_lang,
  out_path, gpt_ckpt?, sovits_ckpt?}
- fine_tune：占位（Phase 3 之后接入完整微调流程）
"""
from __future__ import annotations

import argparse
import os
import sys
import traceback
from pathlib import Path

# 主进程通过 -m 调用时，本文件位置在主仓库 aisinger 包里；但运行所在 venv
# 是隔离的 gptsovits venv，主仓库的 aisinger 包未必可 import。因此只依赖
# stdlib + GPT-SoVITS 自身依赖。protocol 通过相对 import。
from .protocol import emit_error, emit_log, emit_result, read_msg, write_msg


def _setup_paths(gptsovits_dir: Path) -> None:
    sys.path.insert(0, str(gptsovits_dir))
    sys.path.insert(0, str(gptsovits_dir / "GPT_SoVITS"))


_TTS = None


def _get_tts(gpt_ckpt: str | None, sovits_ckpt: str | None):
    """懒加载 GPT-SoVITS TTS 推理器。"""
    global _TTS
    from GPT_SoVITS.TTS_infer_pack.TTS import TTS, TTS_Config  # type: ignore

    config = TTS_Config(custom_path=None)
    if gpt_ckpt:
        config.t2s_weights_path = gpt_ckpt
    if sovits_ckpt:
        config.vits_weights_path = sovits_ckpt
    if _TTS is None or gpt_ckpt or sovits_ckpt:
        _TTS = TTS(config)
    return _TTS


def cmd_ping(req_id: str, args: dict) -> None:
    emit_result(req_id, {"ok": True, "python": sys.version.split()[0]})


def cmd_synthesize(req_id: str, args: dict) -> None:
    import soundfile as sf

    ref_wav = args["ref_wav"]
    ref_text = args.get("ref_text", "")
    ref_lang = args.get("ref_lang", "zh")
    gen_text = args["gen_text"]
    gen_lang = args.get("gen_lang", "zh")
    out_path = Path(args["out_path"])
    gpt_ckpt = args.get("gpt_ckpt")
    sovits_ckpt = args.get("sovits_ckpt")

    emit_log(req_id, f"加载模型 gpt={gpt_ckpt or 'default'} sovits={sovits_ckpt or 'default'}")
    tts = _get_tts(gpt_ckpt, sovits_ckpt)

    emit_log(req_id, f"合成: ref={Path(ref_wav).name} target={gen_text[:30]}...")
    inputs = {
        "text": gen_text,
        "text_lang": gen_lang,
        "ref_audio_path": ref_wav,
        "prompt_text": ref_text,
        "prompt_lang": ref_lang,
        "top_k": 5,
        "top_p": 1.0,
        "temperature": 1.0,
        "text_split_method": "cut5",
        "batch_size": 1,
        "speed_factor": 1.0,
        "return_fragment": False,
    }
    audio_iter = tts.run(inputs)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sr_out, audio_out = None, None
    for sr, chunk in audio_iter:
        sr_out = sr
        audio_out = chunk if audio_out is None else (
            __import__("numpy").concatenate([audio_out, chunk])
        )
    if audio_out is None:
        raise RuntimeError("GPT-SoVITS 未返回任何音频")
    sf.write(str(out_path), audio_out, sr_out)
    emit_result(req_id, {"out_path": str(out_path), "sr": sr_out})


def cmd_fine_tune(req_id: str, args: dict) -> None:
    # 微调流程涉及 s1/s2 两阶段训练 + 数据格式化，留待后续实现。
    emit_error(req_id, "fine_tune 暂未实现。当前版本使用零样本推理已可达不错效果。")


HANDLERS = {
    "ping": cmd_ping,
    "synthesize": cmd_synthesize,
    "fine_tune": cmd_fine_tune,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gptsovits-dir", required=True)
    parser.add_argument("--device", default=os.environ.get("AISINGER_DEVICE", "cuda"))
    cli = parser.parse_args()

    _setup_paths(Path(cli.gptsovits_dir))
    write_msg(sys.stdout, {"event": "ready", "device": cli.device})

    while True:
        msg = read_msg(sys.stdin)
        if msg is None:
            break
        req_id = str(msg.get("id", ""))
        cmd = msg.get("cmd")
        args = msg.get("args", {})
        handler = HANDLERS.get(cmd)
        if handler is None:
            emit_error(req_id, f"unknown command: {cmd}")
            continue
        try:
            handler(req_id, args)
        except Exception as e:  # noqa: BLE001
            emit_error(req_id, f"{type(e).__name__}: {e}\n{traceback.format_exc()}")


if __name__ == "__main__":
    main()
