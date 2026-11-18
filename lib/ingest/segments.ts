// Scribe words -> segments (port of scripts/normalize.py scribe()), gap/hollow detection (find-gaps.py),
// gap-fill segments (gaps-to-segments.py) and the final merge used by build-db.
export type Word = { text: string; type?: string; start: number; end: number; [k: string]: unknown };
export type ScribeResult = { words: Word[]; text?: string; [k: string]: unknown };
export type RawPart = { part: number; offsetMs: number; durationMs: number; result: ScribeResult };
export type RawDoc = { model: string; parts: RawPart[] };
export type Seg = { startMs: number; endMs: number; text: string };
export type Gap = { startMs: number; endMs: number; hollow?: boolean; chars?: number };

const END_PUNCT = [".", "?", "!", "…"];

/** Words of all parts shifted by each part's offset, with a spacing word between parts (as normalize.py). */
export function stitchWords(parts: { offsetMs: number; result: ScribeResult }[]): Word[] {
  const all: Word[] = [];
  for (const part of parts) {
    const o = part.offsetMs / 1000;
    for (const w of part.result.words) all.push({ ...w, start: w.start + o, end: w.end + o });
    const last = all.length ? all[all.length - 1].end : o;
    all.push({ text: " ", type: "spacing", start: last, end: last });
  }
  return all.filter((w) => (w.type ?? "word") !== "audio_event");
}

/** Group words into segments. `offsetMs` shifts gap clips back onto the class timeline. */
export function wordsToSegments(words: Word[], offsetMs = 0): Seg[] {
  const segs: Seg[] = [];
  let cur: Seg | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (cur === null) {
      if (w.type === "spacing") continue;
      cur = { startMs: offsetMs + Math.trunc(w.start * 1000), endMs: offsetMs + Math.trunc(w.end * 1000), text: "" };
    }
    cur.text += w.text;
    cur.endMs = offsetMs + Math.trunc(w.end * 1000);
    const nxt = words[i + 1];
    const gap = nxt ? nxt.start - w.end : 99;
    const dur = cur.endMs - cur.startMs;
    const sentenceEnd = END_PUNCT.some((p) => w.text.trimEnd().endsWith(p));
    if (!nxt || gap > 1.2 || (sentenceEnd && dur > 6000) || (dur > 25000 && w.type === "spacing")) {
      cur.text = cur.text.trim();
      if (cur.text) segs.push(cur);
      cur = null;
    }
  }
  return segs;
}
export const rawToSegments = (raw: RawDoc): Seg[] => wordsToSegments(stitchWords(raw.parts));

/** Gaps >40 s between Scribe segments (incl. before the first / after the last), padded by 1 s (find-gaps.py). */
export function findGaps(segs: Seg[], durationMs: number, minMs = 40000): Gap[] {
  if (!segs.length) return durationMs > minMs ? [{ startMs: 0, endMs: durationMs }] : [];
  const edges: [number, number][] = [[0, segs[0].startMs]];
  for (let i = 0; i + 1 < segs.length; i++) edges.push([segs[i].endMs, segs[i + 1].startMs]);
  edges.push([segs[segs.length - 1].endMs, durationMs]);
  const out: Gap[] = [];
  for (const [a, b] of edges) if (b - a > minMs) out.push({ startMs: Math.max(0, a - 1000), endMs: Math.min(durationMs, b + 1000) });
  return out;
}
/** Hollow segments: >45 s long but <4 chars per second of text. */
export function findHollow(segs: Seg[]): Gap[] {
  const out: Gap[] = [];
  for (const s of segs) {
    const d = s.endMs - s.startMs;
    if (d > 45000 && s.text.length / (d / 1000) < 4) out.push({ startMs: s.startMs, endMs: s.endMs, hollow: true, chars: s.text.length });
  }
  return out;
}
const overlaps = (a: Seg, b: Seg) => a.startMs < b.endMs && b.startMs < a.endMs;

/** Segments of one transcribed clip (clipStartMs = where the clip was cut). Keeps only those not overlapping existing base segments
 * (for hollow clips the hollow segment itself is excluded from `base`). */
export function gapClipToSegments(result: ScribeResult, clipStartMs: number, base: Seg[], ignoreStartMs?: number): Seg[] {
  const words = result.words.filter((w) => (w.type ?? "word") !== "audio_event");
  const segs = wordsToSegments(words, clipStartMs);
  const b = ignoreStartMs === undefined ? base : base.filter((x) => x.startMs !== ignoreStartMs);
  return segs.filter((s) => !b.some((x) => overlaps(s, x)));
}

/** Final class timeline as in build-db: polished base minus hollow segments that gap-fill covers, plus gap-fill, sorted by start. */
export function mergeFinal(base: Seg[], extra: Seg[], hollowStarts: Set<number>): Seg[] {
  const kept = base.filter((s) => !(hollowStarts.has(s.startMs) && extra.some((e) => e.startMs >= s.startMs && e.endMs <= s.endMs + 1000)));
  return [...kept, ...extra].sort((a, b) => a.startMs - b.startMs);
}
export const pctInaudible = (texts: string[]) => (texts.length ? texts.filter((t) => t.includes("[inaudible]")).length / texts.length : 0);
