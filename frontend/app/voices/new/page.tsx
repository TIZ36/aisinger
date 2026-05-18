"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import Topbar from "@/components/Topbar";
import ErrBox from "@/components/ErrBox";
import { api } from "@/lib/api";
import { fmtBytes } from "@/lib/format";
import type { Tier } from "@/lib/types";
/* keep imports stable */

const TIER_INFO: Record<Tier, { title: string; time: string; desc: string; meta: string[]; limits: { min: number; max: number }; needsRef: boolean; refRequired: boolean }> = {
  simple: { title: "简易 · 说话", time: "~30s", desc: "零样本克隆说话音色，输出由文本驱动。", meta: ["10s–1min", "Mac MPS", "F5-TTS"], limits: { min: 1, max: 1 }, needsRef: true, refRequired: false },
  mid:    { title: "中等 · 唱歌", time: "~25min", desc: "1–5 段带伴奏演唱样本训练自有音色，用它翻唱任意歌曲。", meta: ["演唱 m4a/wav", "Mac MPS", "RVC v2"], limits: { min: 1, max: 5 }, needsRef: false, refRequired: false },
  pro:    { title: "高级 · 高保真", time: "~10s", desc: "最高质量歌声 / 说话克隆，需 NVIDIA GPU。", meta: ["1 min 纯净人声", "需 GPU", "GPT-SoVITS"], limits: { min: 1, max: 1 }, needsRef: true, refRequired: true },
};

const ALLOWED_EXT = new Set(["mp3", "m4a", "wav", "flac", "ogg", "aac"]);
const MAX_BYTES = 30 * 1024 * 1024;

export default function NewVoicePage() {
  const router = useRouter();
  const [tier, setTier] = useState<Tier>("mid");
  const [name, setName] = useState("");
  const [refText, setRefText] = useState("");
  const [refLang, setRefLang] = useState("zh");
  const [files, setFiles] = useState<File[]>([]);
  const [epochs, setEpochs] = useState(20);
  const [batchSize, setBatchSize] = useState(4);
  const [f0Method, setF0Method] = useState<"rmvpe" | "harvest" | "crepe" | "pm">("rmvpe");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ ok?: boolean; title: string; msg?: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  const lim = TIER_INFO[tier].limits;
  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  function addFiles(fl: FileList | File[]) {
    const rejected: string[] = [];
    const added = [...files];
    for (const f of fl) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXT.has(ext)) { rejected.push(`${f.name}：格式不支持`); continue; }
      if (f.size > MAX_BYTES) { rejected.push(`${f.name}：超过 30 MB`); continue; }
      if (added.length >= lim.max) { rejected.push(`${f.name}：最多 ${lim.max} 个`); continue; }
      if (added.some((x) => x.name === f.name && x.size === f.size)) continue;
      added.push(f);
    }
    setFiles(added);
    if (rejected.length) setErr({ title: "部分文件未加入", msg: rejected.join("；") });
    else setErr(null);
  }

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr({ title: "请填写音色名称" });
    if (files.length === 0) return setErr({ title: "请上传样本音频" });
    if (TIER_INFO[tier].refRequired && !refText.trim()) return setErr({ title: "高级档需要填写参考音频对应文字" });

    setBusy(true);
    const form = new FormData();
    form.append("name", name);
    form.append("tier", tier);
    if (refText.trim()) { form.append("ref_text", refText); form.append("ref_lang", refLang); }
    if (tier === "mid") { form.append("epochs", String(epochs)); form.append("batch_size", String(batchSize)); }
    for (const f of files) form.append("samples", f);
    try {
      await api.voices.create(form);
      router.push("/voices");
    } catch (e) {
      setErr({ title: "启动失败", msg: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const etaText = files.length === 0 ? "—" : tier === "simple" ? "约 30 秒" : tier === "pro" ? "约 10 秒" : "约 25–30 分钟";
  const fitOk = files.length >= lim.min && files.length <= lim.max;

  return (
    <>
      <Topbar
        crumbs={
          <>
            <Link href="/voices" className="cursor-pointer hover:text-(--color-fg)">音色库</Link>
            <span className="mx-1.5 text-(--color-fg-4)">/</span>
            <b className="font-medium text-(--color-fg)">新建音色</b>
          </>
        }
      />
      <div className="mx-auto max-w-[1180px] px-8 pt-7 pb-32">
        <div className="mb-2 flex items-center gap-2 text-[13px] text-(--color-fg-3)">
          <Link href="/voices" className="flex cursor-pointer items-center gap-1.5 hover:text-(--color-fg)">‹ 返回音色库</Link>
        </div>
        <div className="mb-6">
          <h1 className="m-0 text-[24px] font-semibold tracking-tight">新建音色</h1>
          <div className="mt-1 text-[13px] text-(--color-fg-3)">上传 1–5 段样本 → 自动预处理 → 训练 → 提取音色</div>
        </div>

        {/* stepper */}
        <div className="mb-6 flex flex-wrap items-center gap-1.5">
          {[["1", "档位"], ["2", "样本"], ["3", "预处理"], ["4", "训练参数"]].map(([n, l], i, all) => (
            <span key={n} className="flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] ${i === 0 ? "border-(--color-line-strong) bg-(--color-accent-tint) text-(--color-fg)" : "border-(--color-line) text-(--color-fg-3)"}`}>
                <span className={`grid h-[18px] w-[18px] place-items-center rounded-full text-[10px] font-semibold ${i === 0 ? "bg-(--color-accent) text-white" : "bg-(--color-bg-3) text-(--color-fg-2)"}`}>{n}</span>
                {l}
              </span>
              {i < all.length - 1 ? <span className="text-[10px] text-(--color-fg-4)">—</span> : null}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_320px] items-start gap-6">
          {/* main form */}
          <div className="card p-0">
            <div className="space-y-6 px-7 py-6">

              {/* tier */}
              <Section title="选择档位" sub="不同档位的样本要求与训练时长差别很大">
                <div className="grid grid-cols-3 gap-2.5">
                  {(Object.keys(TIER_INFO) as Tier[]).map((t) => {
                    const info = TIER_INFO[t];
                    const sel = tier === t;
                    return (
                      <div key={t} className={`cursor-pointer rounded-[10px] border bg-(--color-bg) p-4 transition-colors ${sel ? "border-(--color-accent) bg-(--color-accent-tint)" : "border-(--color-line) hover:border-(--color-line-strong)"}`}
                        onClick={() => { setTier(t); setFiles([]); }}>
                        <div className="mb-1.5 flex items-baseline justify-between"><b className="font-medium">{info.title}</b><span className="font-mono text-[11px] text-(--color-fg-3)">{info.time}</span></div>
                        <div className="mb-3 text-[12px] leading-relaxed text-(--color-fg-2)">{info.desc}</div>
                        <div className="flex flex-wrap gap-1">
                          {info.meta.map((m) => <span key={m} className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${sel ? "bg-(--color-accent)/10 text-(--color-accent-2)" : "bg-(--color-bg-3) text-(--color-fg-3)"}`}>{m}</span>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* name + samples */}
              <Section title="命名 · 上传样本">
                <div className="space-y-2">
                  <label className="text-[13px] font-medium">音色名称</label>
                  <input className="input" placeholder="例：我的声音" value={name} onChange={(e) => setName(e.target.value)} />
                </div>

                {TIER_INFO[tier].needsRef ? (
                  <div className="mt-4 space-y-2">
                    <label className="text-[13px] font-medium">参考音频对应文字 <span className="ml-1.5 text-[12px] font-normal text-(--color-fg-3)">{tier === "pro" ? "高级档必填" : "简易档建议填写"}</span></label>
                    <textarea className="input resize-y" rows={2} placeholder="例：在这片广阔的星空下…" value={refText} onChange={(e) => setRefText(e.target.value)} />
                  </div>
                ) : null}

                <div className="mt-4 space-y-2">
                  <label className="text-[13px] font-medium">{tier === "simple" ? "说话样本" : tier === "pro" ? "纯净人声样本" : "演唱歌曲/片段样本"}
                    <span className="ml-1.5 text-[12px] font-normal text-(--color-fg-3)">
                      {tier === "simple" ? "10s–1min · 一段即可" : tier === "pro" ? "5–20 秒 · 无伴奏无混响" : "1–5 段 · 可带伴奏 · 建议总时长 30 秒以上"}
                    </span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
                  />
                  <div
                    className={`cursor-pointer rounded-[10px] border-[1.5px] border-dashed py-7 text-center transition-colors ${drag ? "border-(--color-accent) bg-(--color-accent-soft)" : "border-(--color-line-strong) bg-(--color-bg) hover:border-(--color-accent) hover:bg-(--color-accent-soft)"}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
                  >
                    <div className="mb-1.5 text-[22px] text-(--color-accent)">↑</div>
                    <div className="text-[13px] text-(--color-fg-2)">拖拽音频到这里 或 <span className="text-(--color-accent) underline">点击选择文件</span></div>
                    <div className="mt-1.5 font-mono text-[11px] text-(--color-fg-3)">mp3 / m4a / wav / flac / ogg · 单文件 &lt; 30 MB</div>
                  </div>
                </div>

                {files.length > 0 ? (
                  <div className="mt-3 space-y-1">
                    {files.map((f, i) => (
                      <div key={i} className="grid grid-cols-[32px_1fr_auto] items-center gap-3 rounded-lg border border-(--color-line) bg-(--color-bg) px-3.5 py-2.5">
                        <div className="grid h-8 w-8 place-items-center rounded-md bg-(--color-accent-soft) text-(--color-accent)">♪</div>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-medium">{f.name}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-(--color-fg-3)">{fmtBytes(f.size)}</div>
                        </div>
                        <button className="rounded p-1.5 text-[11px] text-(--color-fg-3) hover:bg-(--color-bg-3) hover:text-(--color-danger)" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                      </div>
                    ))}
                    <div className="mt-3 flex justify-between rounded-lg border border-(--color-line) bg-(--color-bg-2) px-3.5 py-3 font-mono text-[12px] text-(--color-fg-2)">
                      <span><b className="text-(--color-fg)">{files.length}</b> 个样本 · 总大小 <b className="text-(--color-fg)">{fmtBytes(totalBytes)}</b></span>
                      <span className={fitOk ? "text-(--color-green)" : "text-(--color-amber)"}>{fitOk ? "✓ 符合要求" : files.length < lim.min ? `还需 ${lim.min - files.length} 个` : `超出 ${files.length - lim.max} 个`}</span>
                    </div>
                  </div>
                ) : null}
              </Section>

              {/* preprocess preview */}
              <Section title="预处理预览" sub={tier === "mid" ? "系统会先分离人声，再过滤无效片段、切片并归一化" : "系统会按当前档位处理音频"}>
                <div className="grid grid-cols-3 gap-2.5">
                  <PrepCard n="1." h="人声分离" d="Demucs htdemucs_ft · 提取主唱" time="≈ 14 min" />
                  <PrepCard n="2." h="降噪归一化" d="目标 −23 LUFS · 过滤静音" time="≈ 1 min" />
                  <PrepCard n="3." h="静音切片" d="阈值 −40 dB · 最短 1 秒" time="≈ 30 s" />
                </div>
              </Section>

              {/* params (only mid) */}
              {tier === "mid" ? (
                <Section title="训练参数">
                  <div className="space-y-3">
                    <ParamCard label="训练轮数" value={`${epochs} epochs`} hint="建议 20–40。轮数越多越像样本，但过多容易过拟合。">
                      <input type="range" min={5} max={100} step={5} value={epochs} onChange={(e) => setEpochs(+e.target.value)} className="w-full accent-(--color-accent)" />
                    </ParamCard>
                    <ParamCard label="Batch size" value={String(batchSize)} hint="Mac MPS 建议 4。显存大可调高加快训练。">
                      <input type="range" min={1} max={16} value={batchSize} onChange={(e) => setBatchSize(+e.target.value)} className="w-full accent-(--color-accent)" />
                    </ParamCard>
                    <ParamCard label="音高提取算法" value={f0Method.toUpperCase()} hint="RMVPE 速度与质量平衡最佳。Harvest 慢但稳。CREPE 准但耗算力。PM 简易快速。">
                      <div className="flex flex-wrap gap-1.5">
                        {(["rmvpe", "harvest", "crepe", "pm"] as const).map((m) => {
                          const on = f0Method === m;
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => setF0Method(m)}
                              className={`rounded-md border px-3 py-1 text-[12px] transition-colors ${on ? "border-(--color-accent) bg-(--color-accent-soft) text-(--color-accent-2)" : "border-(--color-line) bg-(--color-bg-2) text-(--color-fg-2) hover:border-(--color-line-strong) hover:text-(--color-fg)"}`}
                            >{m.toUpperCase()}</button>
                          );
                        })}
                      </div>
                    </ParamCard>
                  </div>
                </Section>
              ) : null}

              {err ? <ErrBox ok={err.ok} title={err.title} msg={err.msg} onClose={() => setErr(null)} /> : null}
            </div>
          </div>

          {/* aside summary */}
          <aside className="sticky top-[68px] space-y-3.5">
            <div className="card p-4.5">
              <div className="mb-3 text-[11px] uppercase tracking-wider text-(--color-fg-3)">训练摘要</div>
              <KV k="档位" v={TIER_INFO[tier].title} />
              <KV k="名称" v={name || "—"} />
              <KV k="样本" v={String(files.length)} />
              <KV k="大小" v={fmtBytes(totalBytes)} />
              {tier === "mid" ? <KV k="epochs" v={String(epochs)} /> : null}
              {tier === "mid" ? <KV k="batch" v={String(batchSize)} /> : null}
              <KV k="设备" v="MPS" />
              <KV k="预计耗时" v={etaText} />
            </div>
            <div className="flex flex-col gap-2">
              <button className="cta w-full justify-center" disabled={busy || !fitOk || !name.trim()} onClick={submit}>
                {busy ? "提交中…" : "开始训练 →"}
              </button>
              <Link href="/voices" className="btn-ghost w-full justify-center text-center">取消</Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-(--color-line) pb-6 last:border-0">
      <h2 className="mb-4 flex items-baseline gap-2.5 text-[15px] font-medium">
        {title}
        {sub ? <span className="text-[12px] font-normal text-(--color-fg-3)">{sub}</span> : null}
      </h2>
      {children}
    </section>
  );
}

function PrepCard({ n, h, d, time }: { n: string; h: string; d: string; time: string }) {
  return (
    <div className="rounded-lg border border-(--color-line) bg-(--color-bg) p-3.5">
      <div className="mb-1 text-[13px] font-medium"><b className="mr-1 font-medium text-(--color-accent)">{n}</b>{h}</div>
      <div className="mb-2 text-[11px] text-(--color-fg-3)">{d}</div>
      <div className="font-mono text-[11px] text-(--color-fg-2)">{time}</div>
    </div>
  );
}

function ParamCard({ label, value, hint, children }: { label: string; value: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-(--color-line) bg-(--color-bg) px-4 py-3.5">
      <div className="mb-2 flex items-baseline justify-between">
        <label className="text-[13px] font-medium">{label}</label>
        <span className="font-mono text-[12px] text-(--color-accent)">{value}</span>
      </div>
      {children}
      {hint ? <div className="mt-1.5 text-[11px] text-(--color-fg-3)">{hint}</div> : null}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2 py-1.5 text-[13px] [&+&]:border-t [&+&]:border-(--color-line)">
      <span className="text-(--color-fg-3)">{k}</span>
      <span className="font-mono text-(--color-fg)">{v}</span>
    </div>
  );
}
