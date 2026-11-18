"use client";
import { fmtTime, type Ref } from "../../lib/chat-core";

export function RefChips({ refs, cited, onPlay }: { refs: Ref[]; cited?: number[]; onPlay: (r: Ref) => void }) {
  const idx = refs.map((_, i) => i).filter((i) => !cited?.length || cited.includes(i + 1));
  const show = idx.length ? idx : refs.map((_, i) => i);
  if (!show.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1.5">
      {show.map((i) => {
        const r = refs[i];
        return (
          <li key={i} className="flex items-stretch overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg)] text-sm">
            <button
              type="button"
              onClick={() => onPlay(r)}
              title={r.quote}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left  hover:bg-[var(--card)]"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--ink)] text-[11px] text-[var(--bg)]">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-right" dir="rtl" lang="he">{r.title}</span>
              <span className="shrink-0 font-semibold tabular-nums text-[var(--muted)]">{fmtTime(r.startMs)}</span>
              <span aria-hidden className="shrink-0 text-[var(--gold)]">▶</span>
            </button>
            <a
              href={`/shiur/${encodeURIComponent(r.classId)}?t=${Math.ceil(r.startMs / 100) / 10}`}
              className="grid shrink-0 place-items-center border-l border-[var(--line)] px-3 text-xs text-[var(--muted)] hover:bg-[var(--card)]"
              aria-label={`Abrir ${r.title} en ${fmtTime(r.startMs)}`}
            >
              Abrir
            </a>
          </li>
        );
      })}
    </ul>
  );
}
