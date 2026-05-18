"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "合成", icon: "♪" },
  { href: "/voices", label: "音色库", icon: "◐" },
  { href: "/tracks", label: "曲目库", icon: "▤" },
  { href: "/songs", label: "AI 歌曲库", icon: "★" },
];

export default function Sidebar() {
  const path = usePathname();
  const isActive = (href: string) => href === "/" ? path === "/" : path.startsWith(href);
  return (
    <aside className="flex flex-col gap-1 border-r border-(--color-line) bg-(--color-bg-2) px-3 py-5">
      <div className="mb-4 flex items-center gap-2 px-2">
        <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-(--color-accent) text-[12px] font-semibold text-white">a</span>
        <span className="text-sm font-medium">aisinger</span>
      </div>
      <div className="mb-4 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-(--color-fg-3) text-[13px] hover:bg-(--color-bg-hover) hover:text-(--color-fg-2)">
        <span>⌕</span>
        <span>搜索</span>
        <span className="ml-auto rounded bg-(--color-bg-3) px-1.5 py-0.5 font-mono text-[10px]">⌘K</span>
      </div>

      <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-(--color-fg-3)">Workspace</div>
      {NAV.map((n) => {
        const on = isActive(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
              on
                ? "bg-(--color-bg) text-(--color-fg) shadow-[0_0_0_1px_var(--color-line)]"
                : "text-(--color-fg-2) hover:bg-(--color-bg-hover) hover:text-(--color-fg)"
            }`}
          >
            <span className="w-4 text-center text-[12px] text-(--color-fg-3)">{n.icon}</span>
            <span className="flex-1">{n.label}</span>
          </Link>
        );
      })}

      <div className="flex-1" />
      <div className="flex items-center gap-2 rounded-lg border border-(--color-line) bg-(--color-bg) px-3 py-2.5 font-mono text-[11px] text-(--color-fg-2)">
        <span className="relative inline-block h-[7px] w-[7px] rounded-full bg-(--color-green)">
          <span className="pulse-blink absolute inset-[-3px] rounded-full bg-(--color-green) opacity-30" />
        </span>
        mps · ready
      </div>
    </aside>
  );
}
