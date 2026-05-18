"use client";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { avatarOf, fmtBytes, fmtRelative } from "@/lib/format";
import { waveformHeight } from "@/lib/waveform";

export default function SongsPage() {
  const songsQ = useApi(() => api.songs.list());
  const voicesQ = useApi(() => api.voices.list());
  const tracksQ = useApi(() => api.tracks.list());

  return (
    <>
      <Topbar
        crumbs={<><b className="font-medium text-(--color-fg)">AI 歌曲库</b><span className="mx-1 text-(--color-fg-4)">·</span><span>{songsQ.data?.length || 0}</span></>}
        right={<Link href="/" className="btn-primary">＋ 去合成</Link>}
      />
      <div className="mx-auto max-w-[1180px] px-8 pt-7 pb-16">
        <div className="mb-7">
          <h1 className="m-0 text-[24px] font-semibold tracking-tight">AI 歌曲库</h1>
          <div className="mt-1 text-[13px] text-(--color-fg-3)">所有用 AI 音色生成的作品</div>
        </div>
        <div className="card p-0">
          <div className="grid grid-cols-[44px_1fr_1.4fr_110px_90px] gap-4 border-b border-(--color-line) px-4 py-2 text-[11px] uppercase tracking-wider text-(--color-fg-3)">
            <span></span><span>作品</span><span>音色 × 曲目</span><span>生成时间</span><span></span>
          </div>
          {songsQ.data?.length ? songsQ.data.map((s) => {
            const v = voicesQ.data?.find((vv) => vv.id === s.voice_id);
            const t = s.track_id ? tracksQ.data?.find((tt) => tt.id === s.track_id) : null;
            const a = v ? avatarOf(v.id) : { color: "var(--color-bg-3)", letter: "?" };
            return (
              <div key={s.id} className="grid cursor-pointer grid-cols-[44px_1fr_1.4fr_110px_90px] items-center gap-4 border-b border-(--color-line) px-4 py-3.5 transition-colors hover:bg-(--color-bg-hover)" onClick={() => { const au = new Audio(api.songs.audioUrl(s.id)); au.play(); }}>
                <div className="grid h-9 w-9 place-items-center rounded-md text-white text-[13px] font-semibold" style={{ background: a.color }}>{a.letter}</div>
                <div className="font-medium">{t ? t.name : s.text || "文本合成"}<div className="mt-0.5 text-[12px] font-normal text-(--color-fg-3)">{v?.name || "?"}{t ? ` × ${t.artist || ""}` : " · TTS"}</div></div>
                <div className="flex h-[22px] items-center gap-px">
                  {Array.from({ length: 30 }, (_, i) => <i key={i} className="block flex-1 rounded-[1px] bg-(--color-fg-3)/45" style={{ height: `${waveformHeight(i, s.id, 3, 18)}px` }} />)}
                </div>
                <div className="text-right font-mono text-[12px] text-(--color-fg-3)">{fmtRelative(s.created_at)}<div className="mt-0.5 text-[10px] opacity-70">{fmtBytes(s.size_bytes || 0)}</div></div>
                <div className="text-right text-[12px] text-(--color-accent)">▶</div>
              </div>
            );
          }) : (
            <div className="px-4 py-16 text-center">
              <div className="mb-1.5 text-[15px] font-medium">还没有作品</div>
              <div className="mb-5 text-[13px] text-(--color-fg-3)">去合成页生成第一首吧</div>
              <Link href="/" className="btn-primary">→ 去合成</Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
