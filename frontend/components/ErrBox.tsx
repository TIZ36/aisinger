export default function ErrBox({ ok, title, msg, onClose }: { ok?: boolean; title: string; msg?: string; onClose?: () => void }) {
  return (
    <div
      className={`mt-3 flex items-start gap-2.5 rounded-lg border p-2.5 text-[13px] ${
        ok
          ? "border-(--color-green)/30 bg-(--color-green)/10 text-[#1a5b3d]"
          : "border-[#f5c2c2] bg-[#fdecec] text-[#8e1f1f]"
      }`}
    >
      <div
        className={`mt-0.5 grid h-[18px] w-[18px] flex-shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
          ok ? "bg-(--color-green)" : "bg-(--color-danger)"
        }`}
      >
        {ok ? "✓" : "!"}
      </div>
      <div className="flex-1">
        <b className="mb-0.5 block">{title}</b>
        {msg ? <span>{msg}</span> : null}
      </div>
      {onClose ? (
        <button
          className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-[11px] ${
            ok ? "text-[#1a5b3d] hover:bg-(--color-green)/15" : "text-[#8e1f1f] hover:bg-[#8e1f1f]/10"
          }`}
          onClick={onClose}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
