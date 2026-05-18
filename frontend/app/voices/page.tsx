"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import Topbar from "@/components/Topbar";
import Avatar from "@/components/Avatar";
import TrainingRow from "@/components/TrainingRow";
import FailedRow from "@/components/FailedRow";
import { api } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import type { Job, Voice } from "@/lib/types";

export default function VoicesPage() {
  const voicesQ = useApi(() => api.voices.list());
  const [runningJobs, setRunningJobs] = useState<Job[]>([]);
  const [failedJobs, setFailedJobs] = useState<Job[]>([]);

  const refreshJobs = () =>
    api.jobs
      .list()
      .then((js) => {
        const train = js.filter((j) => j.kind === "train");
        setRunningJobs(train.filter((j) => j.status === "running"));
        setFailedJobs(train.filter((j) => j.status === "error").sort((a, b) => (b.finished_at || 0) - (a.finished_at || 0)));
      })
      .catch(() => {});

  // 独立 mount 拉一次 + 每 3 秒轮询，直到组件卸载
  useEffect(() => {
    refreshJobs();
    const t = setInterval(refreshJobs, 3000);
    return () => clearInterval(t);
  }, []);

  const onDone = () => { voicesQ.reload(); refreshJobs(); };

  return (
    <>
      <Topbar
        crumbs={<><b className="font-medium text-(--color-fg)">音色库</b><span className="mx-1 text-(--color-fg-4)">·</span><span>{voicesQ.data?.length || 0}</span></>}
        right={<Link href="/voices/new" className="btn-primary">＋ 新建音色</Link>}
      />
      <div className="mx-auto max-w-[1180px] px-8 pt-7 pb-16">
        <div className="mb-7">
          <h1 className="m-0 text-[24px] font-semibold tracking-tight">音色库</h1>
          <div className="mt-1 text-[13px] text-(--color-fg-3)">已训音色与训练中的任务</div>
        </div>

        <div className="card p-0">
          <div className="grid grid-cols-[44px_1fr_1.4fr_110px_90px] gap-4 border-b border-(--color-line) px-4 py-2 text-[11px] uppercase tracking-wider text-(--color-fg-3)">
            <span></span><span>名称</span><span>状态</span><span>更新</span><span></span>
          </div>
          <List voices={voicesQ.data || []} jobs={runningJobs} failed={failedJobs} onDone={onDone} />
        </div>
      </div>
    </>
  );
}

function List({ voices, jobs, failed, onDone }: { voices: Voice[]; jobs: Job[]; failed: Job[]; onDone: () => void }) {
  if (!voices.length && !jobs.length && !failed.length) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="mb-1.5 text-[15px] font-medium">还没有音色</div>
        <div className="mb-5 text-[13px] text-(--color-fg-3)">上传 1–5 段歌唱或说话音频，开始训练</div>
        <Link href="/voices/new" className="btn-primary">＋ 新建音色</Link>
      </div>
    );
  }
  return (
    <>
      {jobs.map((j) => {
        const voiceName = (j.meta?.voice_name as string) || "训练中";
        const voiceTier = (j.meta?.tier as string) || "mid";
        const stub: Voice = { id: j.id, name: voiceName, tier: voiceTier as Voice["tier"] };
        return <TrainingRow key={j.id} voice={stub} job={j} onDone={onDone} />;
      })}
      {failed.map((j) => (
        <FailedRow key={j.id} job={j} onDismiss={onDone} />
      ))}
      {voices.map((v) => (
        <Link
          key={v.id}
          href="/"
          className="grid grid-cols-[44px_1fr_1.4fr_110px_90px] cursor-pointer items-center gap-4 border-b border-(--color-line) px-4 py-3.5 transition-colors hover:bg-(--color-bg-hover)"
        >
          <Avatar seed={v.id} size={36} />
          <div className="font-medium">{v.name}<div className="mt-0.5 text-[12px] font-normal text-(--color-fg-3)">{v.tier}</div></div>
          <div className="inline-flex items-center gap-1.5 text-[12px]"><span className="h-[7px] w-[7px] rounded-full bg-(--color-green)" />就绪</div>
          <div className="text-right font-mono text-[11px] text-(--color-fg-3)"></div>
          <div className="text-right text-[12px] text-(--color-accent)">使用 →</div>
        </Link>
      ))}
    </>
  );
}
