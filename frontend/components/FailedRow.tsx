"use client";
import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { api } from "@/lib/api";
import type { Job } from "@/lib/types";

export default function FailedRow({ job, onDismiss }: { job: Job; onDismiss: () => void }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>(job.logs || []);
  useEffect(() => {
    if (!open || logs.length) return;
    api.jobs.get(job.id).then((j) => setLogs(j.logs || []));
  }, [open, job.id, logs.length]);
  const name = (job.meta?.voice_name as string) || job.id;
  const seed = name || job.id;
  return (
    <div className="border-b border-(--color-line)">
      <div
        className="grid cursor-pointer grid-cols-[44px_1fr_1.4fr_110px_90px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-(--color-bg-hover)"
        onClick={() => setOpen((x) => !x)}
      >
        <Avatar seed={seed} size={36} />
        <div>
          <div className="font-medium">{name}</div>
          <div className="mt-0.5 text-[12px] font-normal text-(--color-fg-3)">
            {String(job.meta?.tier || "")}
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[12px] text-(--color-danger)">
          <span className="h-[7px] w-[7px] rounded-full bg-(--color-danger)" />
          失败 · {job.stage || "训练"}
        </div>
        <div className="text-right font-mono text-[11px] text-(--color-fg-3)">
          {open ? "收起" : "查看错误"}
        </div>
        <div className="text-right">
          <button
            onClick={(e) => { e.stopPropagation(); api.jobs.dismiss(job.id).finally(onDismiss); }}
            className="text-[12px] text-(--color-fg-3) hover:text-(--color-fg)"
          >清除</button>
        </div>
      </div>
      {open ? (
        <div className="ml-[60px] mr-4 mb-3.5 rounded-md border border-(--color-danger)/30 bg-[#fdecec] p-3">
          <div className="mb-2 text-[12px] font-medium text-[#8e1f1f]">{job.error || "训练失败"}</div>
          {logs.length ? (
            <pre className="max-h-[260px] overflow-y-auto whitespace-pre-wrap rounded bg-[#fff] p-2.5 font-mono text-[11px] leading-relaxed text-(--color-fg-2)">
              {logs.slice(-30).join("\n")}
            </pre>
          ) : <div className="text-[11px] text-(--color-fg-3)">无日志</div>}
        </div>
      ) : null}
    </div>
  );
}
