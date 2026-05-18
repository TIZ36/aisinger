"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import Avatar from "@/components/Avatar";
import ErrBox from "@/components/ErrBox";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { fmtDuration } from "@/lib/format";
import { STAGE_LABEL, type Job, type Song, type Track, type Voice } from "@/lib/types";

const RUN_STAGES = ["input", "voice", "source", "synthesize", "finalize"];

type RunEvent = { type: "log" | "stage" | "done" | "error"; text: string; time: number };

function runEvent(type: RunEvent["type"], text: string): RunEvent {
  return { type, text, time: Date.now() };
}

export default function SynthPage() {
  const voicesQ = useApi(() => api.voices.list());
  const tracksQ = useApi(() => api.tracks.list());
  const songsQ = useApi(() => api.songs.list());
  const jobsQ = useApi(() => api.jobs.list());

  const [voiceId, setVoiceId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [text, setText] = useState("床前明月光，疑是地上霜。");
  const [pitch, setPitch] = useState(0);
  const [indexRate, setIndexRate] = useState(0);
  const [f0Method, setF0Method] = useState("pm");
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [result, setResult] = useState<Song | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const voice = voicesQ.data?.find((v) => v.id === voiceId) ?? null;
  const isTextMode = voice ? voice.tier !== "mid" : false;
  const track = tracksQ.data?.find((t) => t.id === trackId) ?? null;
  const canRun = Boolean(voice && (isTextMode ? text.trim() : trackId));
  const running = job?.status === "running";

  useEffect(() => {
    if (!voiceId && voicesQ.data?.length) setVoiceId(voicesQ.data[0].id);
  }, [voiceId, voicesQ.data]);

  useEffect(() => {
    if (!trackId && tracksQ.data?.length) setTrackId(tracksQ.data[0].id);
  }, [trackId, tracksQ.data]);

  useEffect(() => {
    if (!voice) return;
    if (voice.tier !== "mid") return;
    if (!trackId && tracksQ.data?.length) setTrackId(tracksQ.data[0].id);
  }, [trackId, tracksQ.data, voice]);

  async function startRun() {
    if (!voice) return;
    setErr(null);
    setResult(null);
    setEvents([runEvent("log", "提交合成任务")]);

    const form = new FormData();
    form.append("voice_id", voice.id);
    if (voice.tier === "mid") form.append("track_id", trackId);
    else form.append("text", text.trim());
    form.append("pitch", String(pitch));
    form.append("index_rate", String(indexRate));
    form.append("f0_method", f0Method);

    try {
      const { job_id } = await api.songs.createJob(form);
      const snapshot: Job = {
        id: job_id,
        kind: "synthesize",
        status: "running",
        stage: "input",
        pct: 0,
        started_at: Date.now() / 1000,
        meta: {},
      };
      setJob(snapshot);
      listenJob(job_id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setJob(null);
    }
  }

  async function cancelRun() {
    if (!job || job.status !== "running") return;
    await api.jobs.cancel(job.id);
    setEvents((prev) => [...prev, runEvent("log", "已请求终止任务")].slice(-80));
    jobsQ.reload();
  }

  function listenJob(jobId: string) {
    const es = new EventSource(`/sse/jobs/${jobId}`);
    es.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as Partial<Job>;
      setJob((prev) => prev ? { ...prev, ...data } : prev);
    });
    es.addEventListener("stage", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { stage: string; pct: number; detail?: string };
      setJob((prev) => prev ? { ...prev, stage: data.stage, pct: data.pct, status: "running" } : prev);
      setEvents((prev) => [...prev, runEvent("stage", data.detail || STAGE_LABEL[data.stage] || data.stage)].slice(-80));
    });
    es.addEventListener("log", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { msg: string };
      setEvents((prev) => [...prev, runEvent("log", data.msg)].slice(-80));
    });
    es.addEventListener("done", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { result?: Song };
      setJob((prev) => prev ? { ...prev, status: "done", pct: 100, finished_at: Date.now() / 1000 } : prev);
      setEvents((prev) => [...prev, runEvent("done", "生成完成，结果已写入歌曲库")].slice(-80));
      setResult(data.result ?? null);
      songsQ.reload();
      jobsQ.reload();
      es.close();
    });
    es.addEventListener("error", (event) => {
      const data = (event as MessageEvent).data ? JSON.parse((event as MessageEvent).data) as { msg?: string; cancelled?: boolean } : {};
      const msg = data.msg || "任务连接中断";
      setJob((prev) => prev ? { ...prev, status: data.cancelled ? "cancelled" : "error", error: msg, finished_at: Date.now() / 1000 } : prev);
      setEvents((prev) => [...prev, runEvent("error", msg)].slice(-80));
      if (!data.cancelled) setErr(msg);
      es.close();
    });
  }

  return (
    <>
      <Topbar crumbs={<b className="font-medium text-(--color-fg)">跑通链路</b>} />
      <main className="mx-auto max-w-[900px] px-8 pb-16 pt-7">
        <header className="mb-7 flex items-end justify-between gap-6">
          <div>
            <h1 className="m-0 text-[24px] font-semibold tracking-tight">跑一首 AI 翻唱</h1>
            <p className="mt-1 max-w-[620px] text-[13px] text-(--color-fg-3)">先不管理素材，先确认链路：音色、曲目、合成、产物播放全部走通。</p>
          </div>
          <div className="hidden text-right font-mono text-[11px] text-(--color-fg-3) sm:block">
            voices {voicesQ.data?.length || 0}<br />tracks {tracksQ.data?.length || 0}<br />songs {songsQ.data?.length || 0}
          </div>
        </header>

        <div className="grid gap-4 xl:grid-cols-[340px_1fr_360px]">
          <section className="card overflow-hidden">
            <div className="border-b border-(--color-line) px-4 py-3.5">
              <div className="text-[13px] font-medium">输入</div>
              <div className="mt-0.5 text-[12px] text-(--color-fg-3)">只选必须项。高级参数暂时保持默认。</div>
            </div>
            <div className="space-y-4 p-4">
              <Picker
                label="音色"
                value={voiceId}
                items={voicesQ.data || []}
                loading={voicesQ.loading}
                emptyHref="/voices/new"
                emptyLabel="先创建音色"
                onChange={setVoiceId}
                render={(v) => <VoiceOption voice={v} />}
              />

              {isTextMode ? (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-medium text-(--color-fg-2)">文本</label>
                  <textarea className="input min-h-[112px] resize-y" value={text} onChange={(e) => setText(e.target.value)} />
                </div>
              ) : (
                <Picker
                  label="曲目"
                  value={trackId}
                  items={tracksQ.data || []}
                  loading={tracksQ.loading}
                  emptyHref="/tracks"
                  emptyLabel="先上传曲目"
                  onChange={setTrackId}
                  render={(t) => <TrackOption track={t} />}
                />
              )}

              <details className="rounded-lg border border-(--color-line) bg-(--color-bg-2) px-3 py-2.5">
                <summary className="cursor-pointer text-[12px] font-medium text-(--color-fg-2)">高级参数</summary>
                <div className="mt-3 space-y-3">
                  <Range label="变调" value={pitch} min={-12} max={12} suffix=" 半音" onChange={setPitch} />
                  <Range label="音色强度" value={Math.round(indexRate * 100)} min={0} max={100} suffix="%" onChange={(v) => setIndexRate(v / 100)} />
                  <div className="rounded-md bg-(--color-bg-3) px-2.5 py-2 text-[11px] leading-5 text-(--color-fg-3)">
                    Mac 安全模式会禁用 index 并单线程推理，避免 faiss/libomp 卡死；音色强度会被后端置为 0。
                  </div>
                  <div className="grid grid-cols-[72px_1fr] items-center gap-3">
                    <div className="text-[12px] text-(--color-fg-2)">音高算法</div>
                    <select className="input" value={f0Method} onChange={(e) => setF0Method(e.target.value)}>
                      <option value="pm">PM · 快速稳定</option>
                      <option value="harvest">Harvest · 慢但稳</option>
                      <option value="rmvpe">RMVPE · 质量高但 Mac 可能卡</option>
                    </select>
                  </div>
                </div>
              </details>

              {err ? <ErrBox title="执行失败" msg={err} onClose={() => setErr(null)} /> : null}

              <button className="cta w-full justify-center" disabled={!canRun || running} onClick={startRun}>
                {running ? "执行中…" : "开始跑链路"}
              </button>
            </div>
          </section>

          <ExecutionPanel job={job} events={events} result={result} voice={voice} track={track} onCancel={cancelRun} />
          <HistoryPanel
            jobs={jobsQ.data || []}
            songs={songsQ.data || []}
            voices={voicesQ.data || []}
            tracks={tracksQ.data || []}
            loading={jobsQ.loading || songsQ.loading}
            onRefresh={() => { jobsQ.reload(); songsQ.reload(); voicesQ.reload(); tracksQ.reload(); }}
          />
        </div>
      </main>
    </>
  );
}

function HistoryPanel({ jobs, songs, voices, tracks, loading, onRefresh }: {
  jobs: Job[];
  songs: Song[];
  voices: Voice[];
  tracks: Track[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const synthJobs = jobs
    .filter((j) => j.kind === "synthesize" && j.status !== "done")
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0));
  const recentSongs = [...songs].sort((a, b) => b.created_at - a.created_at).slice(0, 12);
  const empty = !synthJobs.length && !recentSongs.length;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-(--color-line) px-4 py-3.5">
        <div>
          <div className="text-[13px] font-medium">历史合成</div>
          <div className="mt-0.5 text-[12px] text-(--color-fg-3)">{loading ? "刷新中" : `${synthJobs.length + recentSongs.length} 条记录`}</div>
        </div>
        <button className="btn-ghost px-2.5 py-1 text-[12px]" onClick={onRefresh}>刷新</button>
      </div>
      <div className="max-h-[620px] overflow-y-auto p-3">
        {empty ? (
          <div className="rounded-lg border border-dashed border-(--color-line-strong) px-4 py-10 text-center">
            <div className="mb-1 text-[13px] font-medium">暂无历史</div>
            <div className="text-[12px] text-(--color-fg-3)">合成后会在这里回显</div>
          </div>
        ) : null}
        <div className="space-y-2">
          {synthJobs.map((j) => <HistoryJob key={j.id} job={j} voices={voices} tracks={tracks} onRefresh={onRefresh} />)}
          {recentSongs.map((s) => <HistorySong key={s.id} song={s} voices={voices} tracks={tracks} />)}
        </div>
        {recentSongs.length ? (
          <Link href="/songs" className="mt-3 flex justify-center rounded-lg border border-(--color-line) px-3 py-2 text-[12px] text-(--color-accent) hover:bg-(--color-bg-hover)">查看全部歌曲库</Link>
        ) : null}
      </div>
    </section>
  );
}

function HistoryJob({ job, voices, tracks, onRefresh }: { job: Job; voices: Voice[]; tracks: Track[]; onRefresh: () => void }) {
  const voice = voices.find((v) => v.id === job.meta?.voice_id);
  const track = tracks.find((t) => t.id === job.meta?.track_id);
  const label = track?.name || String(job.meta?.text || "文本合成");
  async function cancelJob() {
    await api.jobs.cancel(job.id);
    onRefresh();
  }
  return (
    <div className="rounded-lg border border-(--color-line) bg-(--color-bg) p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{label}</div>
          <div className="mt-0.5 truncate text-[11px] text-(--color-fg-3)">{voice?.name || "未知音色"} · job {job.id}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {job.status === "running" ? <button className="btn-ghost px-2 py-0.5 text-[11px] text-(--color-danger)" onClick={cancelJob}>终止</button> : null}
          <RunBadge status={job.status} />
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-(--color-bg-3)"><div className="h-full bg-(--color-accent)" style={{ width: `${job.pct || 0}%` }} /></div>
      <div className={`mt-2 truncate font-mono text-[11px] ${job.status === "error" ? "text-(--color-danger)" : "text-(--color-fg-3)"}`}>
        {job.status === "error" ? job.error || "合成失败" : job.detail || STAGE_LABEL[job.stage] || "等待中"}
      </div>
    </div>
  );
}

function HistorySong({ song, voices, tracks }: { song: Song; voices: Voice[]; tracks: Track[] }) {
  const voice = voices.find((v) => v.id === song.voice_id);
  const track = song.track_id ? tracks.find((t) => t.id === song.track_id) : null;
  const label = track?.name || song.text || "文本合成";
  return (
    <div className="rounded-lg border border-(--color-line) bg-(--color-bg) p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium">{label}</div>
          <div className="mt-0.5 truncate text-[11px] text-(--color-fg-3)">{voice?.name || "未知音色"} · {new Date(song.created_at * 1000).toLocaleString()}</div>
        </div>
        <span className="rounded-full border border-(--color-line) bg-(--color-bg-2) px-2 py-0.5 font-mono text-[10px] text-(--color-green)">done</span>
      </div>
      <audio controls src={api.songs.audioUrl(song.id)} className="h-8 w-full" />
    </div>
  );
}

function Picker<T extends { id: string }>({ label, value, items, loading, emptyHref, emptyLabel, onChange, render }: {
  label: string;
  value: string;
  items: T[];
  loading: boolean;
  emptyHref: string;
  emptyLabel: string;
  onChange: (id: string) => void;
  render: (item: T) => React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-[12px] font-medium text-(--color-fg-2)">{label}</label>
        {!items.length && !loading ? <Link className="text-[12px] text-(--color-accent)" href={emptyHref}>{emptyLabel}</Link> : null}
      </div>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)} disabled={!items.length}>
        {loading ? <option>加载中</option> : null}
        {!loading && !items.length ? <option>暂无可用项</option> : null}
        {items.map((item) => <option key={item.id} value={item.id}>{optionLabel(item)}</option>)}
      </select>
      {items.find((item) => item.id === value) ? render(items.find((item) => item.id === value) as T) : null}
    </div>
  );
}

function optionLabel(item: { name?: string; id: string; artist?: string; tier?: string }) {
  return [item.name || item.id, item.artist || item.tier].filter(Boolean).join(" · ");
}

function VoiceOption({ voice }: { voice: Voice }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-(--color-line) bg-(--color-bg-2) p-2.5">
      <Avatar seed={voice.id} size={32} />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{voice.name}</div>
        <div className="font-mono text-[11px] text-(--color-fg-3)">{voice.tier}</div>
      </div>
    </div>
  );
}

function TrackOption({ track }: { track: Track }) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-(--color-line) bg-(--color-bg-2) p-2.5">
      <Avatar seed="track" size={32} kind="song" />
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium">{track.name}</div>
        <div className="truncate font-mono text-[11px] text-(--color-fg-3)">{track.artist || "unknown"} · {fmtDuration(track.duration)}</div>
      </div>
    </div>
  );
}

function Range({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <div className="grid grid-cols-[72px_1fr_64px] items-center gap-3">
      <div className="text-[12px] text-(--color-fg-2)">{label}</div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-(--color-accent)" />
      <div className="text-right font-mono text-[11px] text-(--color-fg-3)">{value >= 0 && suffix.includes("半音") ? "+" : ""}{value}{suffix}</div>
    </div>
  );
}

function ExecutionPanel({ job, events, result, voice, track, onCancel }: { job: Job | null; events: RunEvent[]; result: Song | null; voice: Voice | null; track: Track | null; onCancel: () => void }) {
  const activeIndex = job?.stage ? Math.max(0, RUN_STAGES.indexOf(job.stage)) : -1;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-(--color-line) px-4 py-3.5">
        <div>
          <div className="text-[13px] font-medium">执行过程</div>
          <div className="mt-0.5 text-[12px] text-(--color-fg-3)">{job ? `job ${job.id}` : "点击开始后，这里显示每一步"}</div>
        </div>
        <div className="flex items-center gap-2">
          {job?.status === "running" ? <button className="btn-ghost px-2.5 py-1 text-[12px] text-(--color-danger)" onClick={onCancel}>终止</button> : null}
          <RunBadge status={job?.status} />
        </div>
      </div>

      <div className="p-4">
        <div className="mb-4 h-1 overflow-hidden rounded-full bg-(--color-bg-3)">
          <div className="h-full rounded-full bg-(--color-accent) transition-[width] duration-200" style={{ width: `${job?.pct || 0}%` }} />
        </div>

        <div className="grid gap-2">
          {RUN_STAGES.map((stage, index) => {
            const state = !job ? "wait" : job.status === "error" && index === activeIndex ? "error" : index < activeIndex || job.status === "done" ? "done" : index === activeIndex ? "run" : "wait";
            return <StageRow key={stage} label={STAGE_LABEL[stage] || stage} state={state} />;
          })}
        </div>

        <div className="mt-5 rounded-lg border border-(--color-line) bg-(--color-bg-2)">
          <div className="border-b border-(--color-line) px-3 py-2 font-mono text-[11px] text-(--color-fg-3)">runtime log</div>
          <div className="max-h-[210px] min-h-[150px] overflow-auto p-3 font-mono text-[11px] leading-5 text-(--color-fg-2)">
            {events.length ? events.map((event, i) => (
              <div key={`${event.time}-${i}`} className={event.type === "error" ? "text-(--color-danger)" : event.type === "done" ? "text-(--color-green)" : ""}>
                <span className="text-(--color-fg-3)">{new Date(event.time).toLocaleTimeString()}</span> {event.text}
              </div>
            )) : <div className="text-(--color-fg-3)">等待任务开始</div>}
          </div>
        </div>

        {result ? <ResultCard song={result} voice={voice} track={track} /> : null}
      </div>
    </section>
  );
}

function StageRow({ label, state }: { label: string; state: "wait" | "run" | "done" | "error" }) {
  const mark = state === "done" ? "✓" : state === "run" ? "…" : state === "error" ? "!" : "";
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${state === "run" ? "border-(--color-accent)/35 bg-(--color-accent-soft)" : "border-(--color-line) bg-(--color-bg)"}`}>
      <span className={`grid h-5 w-5 place-items-center rounded-full border font-mono text-[10px] ${state === "done" ? "border-(--color-green) bg-(--color-green-soft) text-(--color-green)" : state === "error" ? "border-(--color-danger) text-(--color-danger)" : state === "run" ? "border-(--color-accent) text-(--color-accent)" : "border-(--color-line-strong) text-(--color-fg-4)"}`}>{mark}</span>
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

function RunBadge({ status }: { status?: Job["status"] }) {
  const label = status === "running" ? "running" : status === "done" ? "done" : status === "error" ? "error" : status === "cancelled" ? "cancelled" : "idle";
  return <div className="rounded-full border border-(--color-line) bg-(--color-bg-2) px-2.5 py-1 font-mono text-[11px] text-(--color-fg-3)">{label}</div>;
}

function ResultCard({ song, voice, track }: { song: Song; voice: Voice | null; track: Track | null }) {
  return (
    <div className="mt-5 rounded-lg border border-(--color-line) bg-(--color-bg) p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium">结果已生成</div>
          <div className="mt-0.5 text-[12px] text-(--color-fg-3)">{voice?.name || "音色"} · {track?.name || song.text || "文本"}</div>
        </div>
        <Link className="btn-ghost" href="/songs">歌曲库</Link>
      </div>
      <audio controls src={api.songs.audioUrl(song.id)} className="w-full" />
    </div>
  );
}
