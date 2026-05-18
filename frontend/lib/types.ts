export type Tier = "simple" | "mid" | "pro";

export interface Voice {
  id: string;
  name: string;
  tier: Tier;
  artifacts?: Record<string, string>;
  meta?: Record<string, unknown>;
}

export interface Track {
  id: string;
  name: string;
  artist?: string;
  audio: string;
  duration?: number | null;
  separated?: boolean;
}

export interface Song {
  id: string;
  voice_id: string;
  track_id?: string | null;
  text?: string | null;
  audio: string;
  size_bytes?: number;
  params?: Record<string, unknown>;
  created_at: number;
}

export interface Job {
  id: string;
  kind: string;
  status: "running" | "done" | "error" | "cancelled";
  stage: string;
  pct: number;
  detail?: string;
  meta?: Record<string, unknown>;
  started_at: number;
  finished_at?: number | null;
  error?: string | null;
  logs?: string[];
}

export const STAGE_ORDER = [
  "source",
  "separate",
  "slice",
  "rvc-pp",
  "rvc-f0",
  "rvc-feat",
  "rvc-train",
  "rvc-index",
] as const;

export const STAGE_LABEL: Record<string, string> = {
  input: "校验输入",
  voice: "载入音色",
  source: "载入曲目",
  synthesize: "推理合成",
  finalize: "写入结果",
  separate: "人声分离",
  slice: "切片归一化",
  "rvc-pp": "RVC 预处理",
  "rvc-f0": "f0 提取",
  "rvc-feat": "语义特征",
  "rvc-train": "训练主网络",
  "rvc-index": "构建索引",
};
