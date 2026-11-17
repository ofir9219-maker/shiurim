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
          <li key={i} className="flex items-stretch overflow-hidden rounded-lg border border-[#c9a45c]/60 bg-[#fffaf0] text-sm">
            <button
              type="button"
              onClick={() => onPlay(r)}
              title={r.quote}
              className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-[#1c2a4a] hover:bg-[#f3e6c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8893a]"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#1c2a4a] text-[11px] text-[#f3e6c4]">{i + 1}</span>
              <span className="truncate">{r.title} · <span className="font-semibold text-[#8a6420]">{fmtTime(r.startMs)}</span></span>
              <span aria-hidden className="ml-auto text-[#b8893a]">▶</span>
            </button>
            <a
              href={`/shiur/${encodeURIComponent(r.classId)}?t=${Math.floor(r.startMs / 1000)}`}
              className="grid shrink-0 place-items-center border-l border-[#c9a45c]/60 px-3 text-xs text-[#8a6420] hover:bg-[#f3e6c4]"
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
