"""简易档：F5-TTS UI（仅说话）。"""
from __future__ import annotations

from pathlib import Path

import gradio as gr

from ..adapters.f5tts_adapter import F5TTSAdapter
from ..voicelib import store

_adapter: F5TTSAdapter | None = None


def _get_adapter() -> F5TTSAdapter:
    global _adapter
    if _adapter is None:
        _adapter = F5TTSAdapter()
    return _adapter


def _voice_choices():
    return [(f"{v.name} ({v.id})", v.id) for v in store.list_voices(tier="simple")]


def build():
    with gr.Group():
        gr.Markdown("## 简易档（说话音色克隆 · F5-TTS）")
        with gr.Tabs():
            with gr.Tab("创建音色"):
                name = gr.Textbox(label="音色名称", placeholder="例：我的声音")
                samples = gr.Audio(sources=["upload", "microphone"], type="filepath", label="参考说话音频（10s~1min）")
                ref_text = gr.Textbox(label="参考音频对应文字（建议填写，否则需 Whisper 自动识别）")
                create_btn = gr.Button("创建音色", variant="primary")
                create_msg = gr.Markdown()

                def _create(n, s, t):
                    if not n or not s:
                        return "请填写名称并提供音频"
                    v = _get_adapter().create_voice(name=n, samples=[Path(s)], ref_text=t or "")
                    return f"已创建：{v.name} (id={v.id})"

                create_btn.click(_create, [name, samples, ref_text], [create_msg])

            with gr.Tab("合成说话"):
                voice_sel = gr.Dropdown(choices=_voice_choices(), label="选择音色")
                refresh_voices = gr.Button("刷新音色列表", size="sm")
                text_input = gr.Textbox(label="要合成的文本", lines=3)
                synth_btn = gr.Button("合成", variant="primary")
                out_audio = gr.Audio(label="输出")

                refresh_voices.click(lambda: gr.update(choices=_voice_choices()), None, [voice_sel])

                def _synth(vid, txt):
                    if not vid or not txt:
                        return None
                    v = store.get(vid)
                    if v is None:
                        return None
                    return str(_get_adapter().synthesize(v, txt))

                synth_btn.click(_synth, [voice_sel, text_input], [out_audio])
