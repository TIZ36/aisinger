"use client";
import { type MouseEvent, useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import { useJobSSE } from "@/lib/sse";
import { STAGE_LABEL, STAGE_ORDER, type Job, type Voice } from "@/lib/types";

export default function TrainingRow({ voice, job, onDone }: { voice: Voice; job: Job; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const prog = useJobSSE(job.id, {
    stage: job.stage,
    pct: job.pct,
    detail: job.detail || "",
    finished: job.status !== "running",
    error: job.error || undefined,
    logs: job.logs || [],
  });

  // 训练完成时通知父级刷新（用 effect 避免在 render 中触发副作用）
  const finishedOk = prog.finished && !prog.error;
  useEffect(() => {
    if (finishedOk) onDone();
  }, [finishedOk, onDone]);

  const stageIdx = STAGE_ORDER.indexOf(prog.stage as (typeof STAGE_ORDER)[number]);
  const stageLabel = STAGE_LABEL[prog.stage] || "准备中";
  const running = !prog.finished && !prog.error;
  const eta = (() => {
    if (!prog.pct) return "—";
    const remaining = ((100 - prog.pct) * 1.4);
    if (remaining < 30) return "即将完成";
    return `约 ${Math.max(1, Math.round(remaining / 60))} 分钟`;
  })();

  async function cancelJob(event: MouseEvent) {
    event.stopPropagation();
    setCancelling(true);
    try {
      await api.jobs.cancel(job.id);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div
      className={`cursor-pointer border-b border-(--color-line) px-4 py-3.5 transition-colors hover:bg-(--color-bg-hover) ${
        prog.error ? "[&_.dot]:bg-(--color-danger) [&_.dot]:animate-none [&_.bar_i]:bg-(--color-danger)" : ""
      }`}
      onClick={() => setOpen((x) => !x)}
    >
      <div className="grid grid-cols-[44px_1fr_auto_auto] items-center gap-4">
        <Avatar seed={voice.id} size={36} />
        <div>
          <div className="font-medium">{voice.name}</div>
          <div className={`mt-1 flex items-center gap-2 text-[12px] ${prog.error ? "text-(--color-danger)" : "text-(--color-accent)"}`}>
            <span className={`dot inline-block h-[7px] w-[7px] rounded-full bg-(--color-accent) pulse-blink`} />
            {prog.error ? "失败：" + prog.error : `训练中 · ${stageLabel}`}
          </div>
          {!prog.error && prog.detail ? (
            <div className="mt-1 max-w-[520px] truncate font-mono text-[11px] text-(--color-fg-3)">{prog.detail}</div>
          ) : null}
        </div>
        {running ? (
          <button className="btn-ghost px-2.5 py-1 text-[12px] text-(--color-danger)" disabled={cancelling} onClick={cancelJob}>
            {cancelling ? "终止中" : "终止"}
          </button>
        ) : null}
        <div className={`font-mono text-[14px] font-medium tabular-nums ${prog.error ? "text-(--color-danger)" : "text-(--color-accent)"}`}>{Math.floor(prog.pct)}%</div>
      </div>
      <div className="bar mt-3 mb-1.5 ml-[60px] h-[2px] overflow-hidden bg-(--color-bg-3)">
        <i className="block h-full bg-(--color-accent) transition-[width] duration-300" style={{ width: `${prog.pct}%` }} />
      </div>
      <div className="flex justify-between pl-[60px] font-mono text-[11px] text-(--color-fg-3)">
        <span>{eta}</span><span>{voice.tier}</span>
      </div>
      {open ? (
        <div className="ml-[60px] mt-3.5 border-t border-(--color-line) pt-3.5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
            {STAGE_ORDER.map((s, i) => {
              const done = i < stageIdx;
              const active = i === stageIdx;
              return (
                <div key={s} className={`flex items-center gap-2.5 py-1.5 text-[12px] ${done || active ? "text-(--color-fg)" : "text-(--color-fg-3)"}`}>
                  <div
                    className={`relative h-3 w-3 rounded-full border-[1.5px] ${
                      done ? "border-(--color-green) bg-(--color-green)" : active ? "border-(--color-accent) border-dashed spin-slow" : "border-(--color-bg-3)"
                    }`}
                  >
                    {done ? <span className="absolute inset-0 grid place-items-center text-[7px] font-bold text-white">✓</span> : null}
                  </div>
                  <span className="flex-1">{STAGE_LABEL[s]}</span>
                  <span className={`font-mono text-[10px] ${done ? "text-(--color-green)" : active ? "text-(--color-accent)" : "text-(--color-fg-3)"}`}>
                    {done ? "完成" : active ? `${Math.floor(prog.pct)}%` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
