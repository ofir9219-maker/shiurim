import { getDb, getClass, getSegments, parseJson, type Daf, type Segment } from "../db";
import { hybridSearch, textSearch } from "../search";
import { fmtMs } from "./text";

export type Passage = {
  classId: string; startMs: number; endMs: number; title: string; ordLabel: string; time: string; text: string;
  champ: boolean; score: number; refs: string[];
};

const HE_NUM: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90, ק: 100 };
export function gematria(s: string): number { return [...s.replace(/[׳״'"]/g, "")].reduce((a, c) => a + (HE_NUM[c] || 0), 0); }
const MASECHET: [RegExp, string][] = [
  [/ברכות/, "Berakhot"], [/מגילה/, "Megillah"], [/נדרים/, "Nedarim"], [/ראש השנה/, "Rosh Hashanah"], [/הוריות/, "Horayot"],
];
/** Talmud refs (amud level) for a class: "Berakhot 28a". Skips non-Talmud classes (e.g. Likutei Moharan). */
export function classAmudim(title: string, dafJson: string): string[] {
  const m = MASECHET.find(([re]) => re.test(title));
  if (!m) return [];
  return parseJson<Daf[]>(dafJson, []).map((d) => `${m[1]} ${gematria(d.daf)}${d.amud === "א" ? "a" : "b"}`);
}

const CHAMP = /champi[ñn]|champ[ií]ñ/i;
function kwRegex(kws: string[]): RegExp | null {
  const k = kws.map((x) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter((x) => x.length >= 3);
  return k.length ? new RegExp(k.map((x) => x.slice(0, Math.max(4, x.length - 2))).join("|"), "g") : null;
}
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function windowAt(segs: Segment[], idx: number, before = 1, after = 6): { startMs: number; endMs: number; text: string } {
  const a = Math.max(0, idx - before), b = Math.min(segs.length - 1, idx + after);
  const sl = segs.slice(a, b + 1);
  return { startMs: sl[0].startMs, endMs: sl[sl.length - 1].endMs, text: sl.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim() };
}
function segIndexAt(segs: Segment[], ms: number): number {
  let lo = 0, hi = segs.length - 1, ans = 0;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (segs[mid].startMs <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans;
}

/** Find shiur passages on the topic. Combines hybrid search, keyword+"champiñ" FTS and (optionally) a specific class. */
export async function gatherShiurim(opts: { question: string; query: string; keywords: string[]; classId?: string; boostClassIds?: string[]; limit?: number }): Promise<Passage[]> {
  const db = getDb();
  if (!db) return [];
  const limit = opts.limit ?? 6;
  type Cand = { classId: string; ms: number; score: number };
  const cands: Cand[] = [];
  const add = (classId: string, ms: number, score: number) => cands.push({ classId, ms, score });

  const kws = opts.keywords.filter(Boolean).slice(0, 4);
  try {
    for (const q of [opts.query, opts.question].filter(Boolean)) {
      const hs = await hybridSearch(q, 12);
      hs.forEach((h, i) => add(h.classId, h.startMs + Math.min(15000, Math.max(0, (h.endMs - h.startMs) / 4)), 1 / (60 + i) + (CHAMP.test(h.text) ? 0.012 : 0)));
    }
  } catch {}
  const ftsQs = [...kws.slice(0, 3).map((k) => `champiñ ${k}`), kws.slice(0, 2).join(" "), "champiñones " + (kws[0] || "")].filter((x) => x.trim().length > 3);
  ftsQs.forEach((q, qi) => {
    try { textSearch(q, { limit: 10 }).forEach((h, i) => add(h.classId, h.startMs, (qi < 3 ? 1.6 : 1) / (60 + i))); } catch {}
  });
  // windows of the requested class (and of classes on the same dafim as the refs) best matching the keywords
  const boost = new Set([...(opts.classId ? [opts.classId] : []), ...(opts.boostClassIds || [])]);
  const re = kwRegex(kws);
  for (const cid of boost) {
    const segs = getSegments(cid);
    if (!segs.length || !re) continue;
    const scored = segs.map((s, i) => ({ i, c: (fold(s.text).match(re) || []).length + (CHAMP.test(s.text) ? 2 : 0) })).filter((x) => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 4);
    scored.forEach((x, i) => add(cid, segs[x.i].startMs, 0.05 / (1 + i) + x.c * 0.004));
  }
  // aggregate by (class, 60 s bucket)
  const agg = new Map<string, { classId: string; ms: number; score: number }>();
  for (const c of cands) {
    const key = c.classId + ":" + Math.floor(c.ms / 60000);
    const cur = agg.get(key);
    if (cur) { cur.score += c.score; cur.ms = Math.min(cur.ms, c.ms); } else agg.set(key, { ...c });
  }
  const ranked = [...agg.values()].map((a) => ({ ...a, score: a.score * (opts.classId && a.classId === opts.classId ? 3 : boost.has(a.classId) ? 1.8 : 1) })).sort((a, b) => b.score - a.score);

  const out: Passage[] = [];
  const segCache = new Map<string, Segment[]>();
  for (const r of ranked) {
    if (out.length >= limit) break;
    const cls = getClass(r.classId);
    if (!cls) continue;
    let segs = segCache.get(r.classId);
    if (!segs) { segs = getSegments(r.classId); segCache.set(r.classId, segs); }
    if (!segs.length) continue;
    const w = windowAt(segs, segIndexAt(segs, r.ms));
    // skip windows overlapping an already chosen one
    if (out.some((o) => o.classId === r.classId && w.startMs < o.endMs && w.endMs > o.startMs)) continue;
    out.push({
      classId: r.classId, startMs: w.startMs, endMs: w.endMs, title: cls.title, ordLabel: cls.ord_label, time: fmtMs(w.startMs),
      text: w.text.slice(0, 1000), champ: CHAMP.test(w.text), score: r.score, refs: classAmudim(cls.title, cls.daf),
    });
  }
  // keep champiñón passages near the top
  return out.sort((a, b) => Number(b.champ) - Number(a.champ) || b.score - a.score);
}

/** Classes whose dafim include any of the given refs' amudim (e.g. "Berakhot 28a:3" -> class on 28a). */
export function classesForRefs(refs: string[], max = 3): string[] {
  const db = getDb(); if (!db) return [];
  const want = new Set(refs.map((r) => r.replace(/:.*$/, "").replace(/\s+/g, " ").trim().toLowerCase()));
  const rows = db.prepare("SELECT id, title, daf FROM classes ORDER BY ord").all() as { id: string; title: string; daf: string }[];
  return rows.filter((r) => classAmudim(r.title, r.daf).some((a) => want.has(a.toLowerCase()))).slice(0, max).map((r) => r.id);
}

/** Does classId exist and does startMs fall inside one of its transcript segments? */
export function momentExists(classId: string, startMs: number): boolean {
  if (!getClass(classId)) return false;
  const segs = getSegments(classId);
  return segs.some((s) => startMs >= s.startMs && startMs <= s.endMs + 1);
}
