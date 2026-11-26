// Unified search over the real corpus of the site (shiurim transcripts + maamarim), grouped by source and ranked.
import { buildPassages, searchChunks } from "../retrieval";
import { classIdsOf } from "../series";
import { searchMaamarim } from "../maamarim/search";
import { loadSource, type SourceRef } from "./sources";
import { normQ } from "./verify";

export type Scope = { type: "all" } | { type: "series"; slug: string } | { type: "maamarim" } | { type: "shiur"; id: string } | { type: "maamar"; id: string };
export type Hit = SourceRef & { title: string; sub: string; score: number; anchor: string; snippet: string };

export function parseScope(x: unknown): Scope {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const id = typeof o.id === "string" && /^[\w-]{3,80}$/.test(o.id) ? o.id : "";
  const slug = typeof o.slug === "string" && /^[a-z0-9-]{1,60}$/.test(o.slug) ? o.slug : "";
  if (o.type === "series" && slug) return { type: "series", slug };
  if (o.type === "maamarim") return { type: "maamarim" };
  if (o.type === "shiur" && id) return { type: "shiur", id };
  if (o.type === "maamar" && id) return { type: "maamar", id };
  return { type: "all" };
}

/** Best unit of a source for a set of queries (term overlap), near the hint position when given. */
function bestUnit(ref: SourceRef, queries: string[], hintMs?: number, hintSection?: string): { anchor: string; snippet: string } {
  const src = loadSource(ref);
  if (!src?.units.length) return { anchor: "", snippet: "" };
  const terms = [...new Set(queries.flatMap((q) => normQ(q).split(" ")).filter((t) => t.length >= 3))];
  let pool = src.units.map((u, i) => ({ u, i }));
  if (hintMs != null) pool = pool.filter(({ u }) => (u.startMs ?? 0) >= hintMs - 5000 && (u.startMs ?? 0) <= hintMs + 70000);
  if (hintSection) pool = pool.filter(({ u }) => u.section === hintSection);
  if (!pool.length) pool = src.units.map((u, i) => ({ u, i }));
  let best = pool[0], bs = -1;
  for (const p of pool) { const t = normQ(p.u.text); const s = terms.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0); if (s > bs) { bs = s; best = p; } }
  return { anchor: best.u.key, snippet: best.u.text.slice(0, 220) };
}

export async function searchSite(queries: string[], scope: Scope): Promise<Hit[]> {
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 10);
  if (!qs.length) return [];
  const out: Hit[] = [];
  // shiurim (transcripts with timestamps)
  if (scope.type === "all" || scope.type === "series" || scope.type === "shiur") {
    const classIds = scope.type === "series" ? classIdsOf([scope.slug]) : scope.type === "shiur" ? new Set([scope.id]) : undefined;
    const res = await searchChunks(qs.map((q, i) => ({ q, w: i === 0 ? 1.2 : 1 })), { classIds });
    const ps = buildPassages(res, { seeds: 60, expandTop: 0, budget: 400000 });
    const by = new Map<string, { score: number; best: (typeof ps)[number] }>();
    for (const p of ps) { const e = by.get(p.classId); if (!e) by.set(p.classId, { score: p.score, best: p }); else { e.score += 0.35 * p.score; if (p.score > e.best.score) e.best = p; } }
    for (const c of res.classes) { const e = by.get(c.classId); if (e) e.score += 0.5 * c.score; }
    for (const [id, e] of by) {
      const ref: SourceRef = { kind: "shiur", id }; const src = loadSource(ref); if (!src) continue;
      out.push({ ...ref, title: src.title, sub: src.sub, score: e.score, ...bestUnit(ref, qs, e.best.startMs) });
    }
  }
  // maamarim (paragraphs)
  if (scope.type === "all" || scope.type === "maamarim" || scope.type === "maamar") {
    const ps = await searchMaamarim(qs, { k: 14, maamarId: scope.type === "maamar" ? scope.id : undefined });
    const by = new Map<string, { score: number; section: string; top: number }>();
    for (const p of ps) { const e = by.get(p.maamarId); if (!e) by.set(p.maamarId, { score: p.score, section: p.sectionId, top: p.score }); else { e.score += 0.35 * p.score; if (p.score > e.top) { e.top = p.score; e.section = p.sectionId; } } }
    for (const [id, e] of by) {
      const ref: SourceRef = { kind: "maamar", id }; const src = loadSource(ref); if (!src) continue;
      out.push({ ...ref, title: src.title, sub: src.sub, score: e.score, ...bestUnit(ref, qs, undefined, e.section) });
    }
  }
  return out.filter((h) => h.anchor).sort((a, b) => b.score - a.score);
}

/** First round: up to `max` sources; weak tails are cut (if only one source really contributes, only that one). */
export function selectSources(hits: Hit[], max = 5): { selected: Hit[]; pending: Hit[] } {
  if (!hits.length) return { selected: [], pending: [] };
  const top = hits[0].score;
  const strong = hits.filter((h) => h.score >= top * 0.4);
  const selected = strong.slice(0, max);
  const pending = hits.filter((h) => !selected.includes(h) && h.score >= top * 0.22).slice(0, 15);
  return { selected, pending };
}
