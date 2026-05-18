"""音色库 UI 组件。"""
from __future__ import annotations

import gradio as gr

from ..voicelib import store


def render_library_table(tier_filter: str | None = None):
    voices = store.list_voices(tier=tier_filter if tier_filter in ("simple", "mid", "pro") else None)
    return [[v.id, v.name, v.tier] for v in voices]


def build_library_panel():
    with gr.Column():
        gr.Markdown("### 音色库")
        tier_filter = gr.Dropdown(
            choices=["all", "simple", "mid", "pro"], value="all", label="过滤档位",
        )
        table = gr.Dataframe(
            headers=["id", "name", "tier"],
            value=render_library_table(),
            interactive=False,
            wrap=True,
        )
        refresh = gr.Button("刷新", size="sm")
        delete_id = gr.Textbox(label="删除音色 id")
        delete_btn = gr.Button("删除", variant="stop", size="sm")
        status = gr.Markdown("")

        def _refresh(f):
            return render_library_table(f if f != "all" else None)

        def _delete(vid, f):
            ok = store.delete(vid)
            msg = "已删除" if ok else "未找到该 id"
            return msg, render_library_table(f if f != "all" else None)

        tier_filter.change(_refresh, [tier_filter], [table])
        refresh.click(_refresh, [tier_filter], [table])
        delete_btn.click(_delete, [delete_id, tier_filter], [status, table])
    return table
