import type { ReactNode } from "react";

export default function Topbar({ crumbs, right }: { crumbs: ReactNode; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-[52px] items-center gap-3 border-b border-(--color-line) bg-(--color-bg) px-8">
      <div className="text-[13px] text-(--color-fg-3)">{crumbs}</div>
      <div className="flex-1" />
      <button className="rounded-md px-2.5 py-1 text-[12px] text-(--color-fg-2) hover:bg-(--color-bg-hover) hover:text-(--color-fg)">⌘K</button>
      {right}
    </header>
  );
}
