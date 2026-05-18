"""A/B 对比：用两个音色合成同一段内容并排试听。

简易档输入文本；中/高档输入歌曲文件（中档）或文本（高档）。
"""
from __future__ import annotations

from pathlib import Path

import gradio as gr

from ..voicelib import store


def _all_choices():
    return [
        (f"[{v.tier}] {v.name} ({v.id})", v.id)
        for v in store.list_voices()
    ]


def _synth_one(voice_id: str, text: str | None, song: str | None) -> str | None:
    v = store.get(voice_id)
    if v is None:
        return None
    if v.tier == "simple":
        if not text:
            return None
        from ..adapters.f5tts_adapter import F5TTSAdapter
        return str(F5TTSAdapter().synthesize(v, text))
    if v.tier == "mid":
        if not song:
            return None
        from ..adapters.rvc_adapter import RVCAdapter
        return str(RVCAdapter().synthesize(v, Path(song)))
    if v.tier == "pro":
        if not text:
            return None
        from ..adapters.gptsovits_adapter import GPTSoVITSAdapter
        return str(GPTSoVITSAdapter().synthesize(v, text))
    return None


def build():
    with gr.Group():
        gr.Markdown("## A/B 对比")
        gr.Markdown(
            "_选两个音色合成同一内容并排试听。中档使用歌曲输入；简易/高档使用文本。_"
        )
        with gr.Row():
            a = gr.Dropdown(choices=_all_choices(), label="A 音色")
            b = gr.Dropdown(choices=_all_choices(), label="B 音色")
        refresh = gr.Button("刷新", size="sm")
        text = gr.Textbox(label="文本（简易/高档用）", lines=3)
        song = gr.Audio(sources=["upload"], type="filepath", label="目标歌曲（中档用）")
        go = gr.Button("对比合成", variant="primary")
        with gr.Row():
            out_a = gr.Audio(label="A 输出")
            out_b = gr.Audio(label="B 输出")
        msg = gr.Markdown()

        refresh.click(
            lambda: (gr.update(choices=_all_choices()), gr.update(choices=_all_choices())),
            None, [a, b],
        )

        def _go(aid, bid, t, s):
            if not aid or not bid:
                return None, None, "请选择两个音色"
            ra = _synth_one(aid, t, s)
            rb = _synth_one(bid, t, s)
            return ra, rb, "完成" if (ra and rb) else "至少一边失败：检查输入与档位匹配"

        go.click(_go, [a, b, text, song], [out_a, out_b, msg])
