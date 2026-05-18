"""高级档：GPT-SoVITS UI（零样本 + 文本/歌词驱动）。"""
from __future__ import annotations

from pathlib import Path

import gradio as gr

from ..adapters.gptsovits_adapter import GPTSoVITSAdapter
from ..voicelib import store

_adapter: GPTSoVITSAdapter | None = None


def _get_adapter() -> GPTSoVITSAdapter:
    global _adapter
    if _adapter is None:
        _adapter = GPTSoVITSAdapter()
    return _adapter


def _voice_choices():
    return [(f"{v.name} ({v.id})", v.id) for v in store.list_voices(tier="pro")]


def build():
    with gr.Group():
        gr.Markdown("## 高级档（GPT-SoVITS · 零样本高保真）")
        gr.Markdown(
            "_推荐使用 5–20 秒**纯净人声**作参考片段（无伴奏、无混响）。"
            "首次合成需启动隔离 worker，约 10–30 秒加载。_"
        )
        with gr.Tabs():
            with gr.Tab("创建音色"):
                name = gr.Textbox(label="音色名称")
                ref = gr.Audio(
                    sources=["upload", "microphone"], type="filepath",
                    label="参考音频（5–20s 纯净人声）",
                )
                ref_text = gr.Textbox(label="参考音频的对应文字（必填）", lines=2)
                ref_lang = gr.Dropdown(
                    choices=["zh", "en", "ja", "yue", "ko"], value="zh", label="参考语言",
                )
                create_btn = gr.Button("创建", variant="primary")
                msg = gr.Markdown()

                def _create(n, r, t, lang):
                    if not n or not r or not t:
                        return "请填写名称、上传参考音频并填写对应文字"
                    v = _get_adapter().create_voice(
                        name=n, samples=[Path(r)], ref_text=t, ref_lang=lang,
                    )
                    return f"已创建：{v.name} (id={v.id})"

                create_btn.click(_create, [name, ref, ref_text, ref_lang], [msg])

            with gr.Tab("合成"):
                voice_sel = gr.Dropdown(choices=_voice_choices(), label="选择音色")
                refresh = gr.Button("刷新", size="sm")
                text_in = gr.Textbox(label="要合成的文本/歌词", lines=5)
                gen_lang = gr.Dropdown(
                    choices=["zh", "en", "ja", "yue", "ko"], value="zh", label="生成语言",
                )
                go = gr.Button("合成", variant="primary")
                out = gr.Audio(label="输出")

                refresh.click(lambda: gr.update(choices=_voice_choices()), None, [voice_sel])

                def _synth(vid, txt, lang):
                    if not vid or not txt:
                        return None
                    v = store.get(vid)
                    if v is None:
                        return None
                    return str(_get_adapter().synthesize(v, txt, gen_lang=lang))

                go.click(_synth, [voice_sel, text_in, gen_lang], [out])
