"use client";
import { useEffect, type ReactNode } from "react";

export default function Modal({ open, onClose, title, sub, children, footer }: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[16vh] backdrop-blur-[6px]"
      style={{ background: "rgba(15,17,23,0.20)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-[540px] max-w-[92vw] overflow-hidden rounded-xl border border-(--color-line-strong) bg-(--color-bg) shadow-2xl">
        <div className="flex items-center justify-between border-b border-(--color-line) px-4 py-3.5">
          <div>
            <div className="font-medium">{title}</div>
            {sub ? <div className="mt-0.5 text-[12px] text-(--color-fg-3)">{sub}</div> : null}
          </div>
          <button className="cursor-pointer rounded px-2 py-1 text-(--color-fg-3) hover:bg-(--color-bg-2) hover:text-(--color-fg)" onClick={onClose}>✕</button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">{children}</div>
        {footer ? <div className="flex items-center justify-between border-t border-(--color-line) px-4 py-3 text-[12px] text-(--color-fg-3)">{footer}</div> : null}
      </div>
    </div>
  );
}
