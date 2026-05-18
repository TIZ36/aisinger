import { avatarOf } from "@/lib/format";

export default function Avatar({ seed, size = 32, kind }: { seed: string; size?: number; kind?: "song" }) {
  if (kind === "song") {
    return (
      <div
        className="grid flex-shrink-0 place-items-center rounded-md border border-(--color-line) bg-(--color-bg-2) text-(--color-fg-2)"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      >
        ♪
      </div>
    );
  }
  const a = avatarOf(seed);
  return (
    <div
      className="grid flex-shrink-0 place-items-center rounded-md font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: a.color }}
    >
      {a.letter}
    </div>
  );
}
