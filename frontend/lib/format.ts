export function fmtBytes(b: number | null | undefined): string {
  if (!b) return "0 B";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export function fmtDuration(s: number | null | undefined): string {
  if (!s) return "";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "刚刚";
  if (d < 3600) return `${Math.floor(d / 60)} 分钟前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 小时前`;
  return `${Math.floor(d / 86400)} 天前`;
}

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#5e6ad2,#8b95ff)",
  "linear-gradient(135deg,#6b73a8,#8d95c2)",
  "linear-gradient(135deg,#5a6080,#7a80a0)",
  "linear-gradient(135deg,#727888,#525868)",
  "linear-gradient(135deg,#a8a070,#b89580)",
  "linear-gradient(135deg,#7a8398,#9aa2b4)",
];

export function avatarOf(seed: string | undefined | null): { color: string; letter: string } {
  const s = seed || "?";
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { color: AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length], letter: (s[0] || "?").toUpperCase() };
}
