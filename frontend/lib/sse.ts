"use client";
import { useEffect, useRef, useState } from "react";

export interface JobStageEvent {
  stage: string;
  pct: number;
  detail?: string;
}

export interface JobProgress {
  stage: string;
  pct: number;
  detail: string;
  finished: boolean;
  error?: string;
  logs: string[];
}

const EMPTY: JobProgress = { stage: "", pct: 0, detail: "", finished: false, logs: [] };

export function useJobSSE(jobId: string | null, initial?: Partial<JobProgress>): JobProgress {
  const [state, setState] = useState<JobProgress>({ ...EMPTY, ...initial });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) {
      setState(EMPTY);
      return;
    }
    setState({ ...EMPTY, ...initial });
    const es = new EventSource(`/sse/jobs/${jobId}`);
    esRef.current = es;
    es.addEventListener("snapshot", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setState((s) => ({
          ...s,
          stage: d.stage || s.stage,
          pct: d.pct ?? s.pct,
          detail: d.detail || s.detail,
          finished: Boolean(d.finished) || s.finished,
          error: d.error || s.error,
          logs: Array.isArray(d.logs) ? d.logs : s.logs,
        }));
      } catch {}
    });
    es.addEventListener("stage", (e) => {
      try {
        const d: JobStageEvent = JSON.parse((e as MessageEvent).data);
        setState((s) => ({ ...s, stage: d.stage, pct: d.pct, detail: d.detail || "" }));
      } catch {}
    });
    es.addEventListener("log", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data);
        setState((s) => ({ ...s, logs: [...s.logs.slice(-80), d.msg || ""] }));
      } catch {}
    });
    es.addEventListener("done", () => {
      setState((s) => ({ ...s, finished: true, pct: 100 }));
      es.close();
    });
    es.addEventListener("error", (e) => {
      let msg = "训练失败";
      try {
        const d = JSON.parse((e as MessageEvent).data);
        msg = d.msg || msg;
      } catch {}
      setState((s) => ({ ...s, finished: true, error: msg }));
      es.close();
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [jobId, initial?.stage, initial?.pct, initial?.detail, initial?.finished, initial?.error]);

  return state;
}
