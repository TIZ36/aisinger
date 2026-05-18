"use client";
import { useRef, useState } from "react";
import Topbar from "@/components/Topbar";
import Modal from "@/components/Modal";
import Avatar from "@/components/Avatar";
import ErrBox from "@/components/ErrBox";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDuration } from "@/lib/format";
import { waveformHeight } from "@/lib/waveform";

export default function TracksPage() {
  const tracksQ = useApi(() => api.tracks.list());
  const [open, setOpen] = useState(false);

  return (
    <>
      <Topbar
        crumbs={<><b className="font-medium text-(--color-fg)">曲目库</b><span className="mx-1 text-(--color-fg-4)">·</span><span>{tracksQ.data?.length || 0}</span></>}
        right={<button className="btn-primary" onClick={() => setOpen(true)}>＋ 上传曲目</button>}
      />
      <div className="mx-auto max-w-[1180px] px-8 pt-7 pb-16">
        <div className="mb-7">
          <h1 className="m-0 text-[24px] font-semibold tracking-tight">曲目库</h1>
          <div className="mt-1 text-[13px] text-(--color-fg-3)">原始歌曲 · 可用于合成时被翻唱</div>
        </div>
        <div className="card p-0">
          <div className="grid grid-cols-[44px_1fr_1.4fr_110px_90px] gap-4 border-b border-(--color-line) px-4 py-2 text-[11px] uppercase tracking-wider text-(--color-fg-3)">
            <span></span><span>名称</span><span>波形</span><span>时长</span><span></span>
          </div>
          {tracksQ.data?.length ? tracksQ.data.map((t) => (
            <div key={t.id} className="grid cursor-pointer grid-cols-[44px_1fr_1.4fr_110px_90px] items-center gap-4 border-b border-(--color-line) px-4 py-3.5 transition-colors hover:bg-(--color-bg-hover)" onClick={() => { const a = new Audio(api.tracks.audioUrl(t.id)); a.play(); }}>
              <Avatar seed="track" size={36} kind="song" />
              <div className="font-medium">{t.name}<div className="mt-0.5 text-[12px] font-normal text-(--color-fg-3)">{t.artist || ""}</div></div>
              <div className="flex h-[22px] items-center gap-px">
                {Array.from({ length: 30 }, (_, i) => <i key={i} className="block flex-1 rounded-[1px] bg-(--color-fg-3)/45" style={{ height: `${waveformHeight(i, t.id, 3, 18)}px` }} />)}
              </div>
              <div className="text-right font-mono text-[12px] text-(--color-fg-3)">{fmtDuration(t.duration)}</div>
              <div className="text-right text-[12px] text-(--color-accent)">▶</div>
            </div>
          )) : (
            <div className="px-4 py-16 text-center">
              <div className="mb-1.5 text-[15px] font-medium">曲目库为空</div>
              <div className="mb-5 text-[13px] text-(--color-fg-3)">上传你想用 AI 翻唱的歌曲</div>
              <button className="btn-primary" onClick={() => setOpen(true)}>＋ 上传曲目</button>
            </div>
          )}
        </div>
      </div>

      <UploadModal open={open} onClose={() => setOpen(false)} onUploaded={() => { tracksQ.reload(); setOpen(false); }} />
    </>
  );
}

function UploadModal({ open, onClose, onUploaded }: { open: boolean; onClose: () => void; onUploaded: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current) return;
    setBusy(true); setErr(null);
    try {
      await api.tracks.upload(new FormData(formRef.current));
      onUploaded();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
    } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="上传曲目" sub="一首要被 AI 翻唱的歌">
      <form ref={formRef} onSubmit={submit} className="space-y-4 p-4.5">
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">歌曲名</label>
          <input name="name" className="input" placeholder="例：几分之几" required />
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">艺人 <span className="text-[12px] font-normal text-(--color-fg-3)">可选</span></label>
          <input name="artist" className="input" placeholder="例：王心凌" />
        </div>
        <div className="space-y-1.5">
          <label className="text-[13px] font-medium">音频文件</label>
          <input name="file" type="file" accept="audio/*" required className="text-[13px]" />
        </div>
        {err ? <ErrBox title="上传失败" msg={err} onClose={() => setErr(null)} /> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="rounded-md px-3.5 py-2 text-[13px] text-(--color-fg-2) hover:bg-(--color-bg-2) hover:text-(--color-fg)" onClick={onClose}>取消</button>
          <button type="submit" disabled={busy} className="rounded-md bg-(--color-accent) px-3.5 py-2 text-[13px] font-medium text-white hover:bg-(--color-accent-2) disabled:opacity-40">{busy ? "上传中…" : "上传"}</button>
        </div>
      </form>
    </Modal>
  );
}
