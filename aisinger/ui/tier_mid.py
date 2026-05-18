"""中等档：RVC UI。Phase 1 仅支持导入 .pth / .index 后做翻唱。"""
from __future__ import annotations

from pathlib import Path

import gradio as gr

from ..adapters.rvc_adapter import RVCAdapter
from ..voicelib import store

_adapter: RVCAdapter | None = None


def _get_adapter() -> RVCAdapter:
    global _adapter
    if _adapter is None:
        _adapter = RVCAdapter()
    return _adapter


def _voice_choices():
    return [(f"{v.name} ({v.id})", v.id) for v in store.list_voices(tier="mid")]


def build():
    with gr.Group():
        gr.Markdown("## 中等档（歌声转换 · RVC v2）")
        gr.Markdown("_支持两种创建路径：导入已有 `.pth`/`.index`，或从 1–5 首歌训练自有音色。_")
        with gr.Tabs():
            with gr.Tab("从样本训练"):
                t_name = gr.Textbox(label="音色名称", placeholder="例：我的声音")
                t_samples = gr.File(
                    label="样本歌曲（1–5 首，带伴奏也行，自动分离）",
                    file_count="multiple",
                    file_types=["audio"],
                )
                with gr.Row():
                    t_epochs = gr.Slider(5, 100, value=20, step=5, label="训练轮数 (epochs)")
                    t_bs = gr.Slider(1, 16, value=4, step=1, label="batch size")
                t_train_btn = gr.Button("开始训练", variant="primary")
                t_log = gr.Textbox(label="训练日志", lines=18, max_lines=18, autoscroll=True)

                def _train(n, files, ep, bs):
                    if not n or not files:
                        yield "请填写名称并上传至少一份样本"
                        return
                    adapter = _get_adapter()
                    paths = [Path(f.name) for f in files]
                    buf: list[str] = []
                    try:
                        for item in adapter.train_voice(n, paths, epochs=int(ep), batch_size=int(bs)):
                            if isinstance(item, str):
                                buf.append(item)
                                # 仅保留尾部 200 行，避免 UI 卡顿
                                if len(buf) > 200:
                                    buf = buf[-200:]
                                yield "\n".join(buf)
                    except Exception as e:
                        buf.append(f"❌ 失败：{e}")
                        yield "\n".join(buf)

                t_train_btn.click(_train, [t_name, t_samples, t_epochs, t_bs], [t_log])

            with gr.Tab("导入音色"):
                name = gr.Textbox(label="音色名称")
                pth_file = gr.File(label="RVC .pth 模型文件", file_types=[".pth"])
                index_file = gr.File(label="RVC .index 文件（可选）", file_types=[".index"])
                samples = gr.File(label="参考样本（可选，仅留档）", file_count="multiple")
                create_btn = gr.Button("导入", variant="primary")
                create_msg = gr.Markdown()

                def _create(n, p, i, ss):
                    if not n or not p:
                        return "请填写名称并上传 .pth"
                    sample_paths = [Path(s.name) for s in (ss or [])]
                    v = _get_adapter().create_voice(
                        name=n,
                        samples=sample_paths,
                        pth_file=Path(p.name),
                        index_file=Path(i.name) if i else None,
                    )
                    return f"已导入：{v.name} (id={v.id})"

                create_btn.click(_create, [name, pth_file, index_file, samples], [create_msg])

            with gr.Tab("翻唱歌曲"):
                voice_sel = gr.Dropdown(choices=_voice_choices(), label="选择音色")
                refresh_voices = gr.Button("刷新音色列表", size="sm")
                song = gr.Audio(sources=["upload"], type="filepath", label="目标歌曲（含伴奏）")
                transpose = gr.Slider(-12, 12, value=0, step=1, label="变调（半音）")
                f0_method = gr.Dropdown(
                    choices=["rmvpe", "pm", "harvest", "crepe"], value="rmvpe", label="音高提取算法",
                )
                index_rate = gr.Slider(0, 1, value=0.75, step=0.05, label="index 强度")
                synth_btn = gr.Button("翻唱", variant="primary")
                out_audio = gr.Audio(label="输出（已回混伴奏）")

                refresh_voices.click(lambda: gr.update(choices=_voice_choices()), None, [voice_sel])

                def _synth(vid, s, t, fm, ir):
                    if not vid or not s:
                        return None
                    v = store.get(vid)
                    if v is None:
                        return None
                    return str(_get_adapter().synthesize(
                        v, Path(s), transpose=t, f0_method=fm, index_rate=ir,
                    ))

                synth_btn.click(_synth, [voice_sel, song, transpose, f0_method, index_rate], [out_audio])
