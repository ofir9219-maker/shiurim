// High-recall retrieval: multi-query x (normalized FTS + raw FTS + vectors), RRF fusion, class-level boost,
// neighbor expansion and window merging. Server only (reads the SQLite DB).
import { getDb, parseJson, type Daf } from "./db";
import { embedTexts, cosine, blobToVec } from "./embeddings";
import { keywords, cleanText, fmtTime, quoteOf, type Ref } from "./chat-core";
import { normTokens } from "./translit";
import { countEmbed } from "./chat-llm";

export type Passage = {
  classId: string; title: string; ord: number; dafLabel: string; startMs: number; endMs: number;
  text: string; score: number; best: string; chunkIds: number[];
};
export type ClassHit = { classId: string; score: number };
export type WeightedQuery = { q: string; w?: number };

type Meta = { id: number; classId: string; startMs: number; endMs: number; pos: number };
type Store = {
  meta: Map<number, Meta>; byClass: Map<string, number[]>; ords: Map<string, { ord: number; title: string; daf: string; summary: string; tags: string[]; ordLabel: string; dafJson: string }>;
  ids: Int32Array; mat: Float32Array | null; dims: number; n: number; classVec: { id: string; v: Float32Array }[];
};
let store: Store | null = null;
let storeKey = "";

function load(): Store | null {
  const db = getDb();
  if (!db) return null;
  const key = String((db.prepare("SELECT count(*) n, coalesce(max(id),0) m FROM chunks").get() as { n: number; m: number }).n);
  if (store && storeKey === key) return store;
  const rows = db.prepare("SELECT id, class_id AS classId, start_ms AS startMs, end_ms AS endMs, embedding FROM chunks ORDER BY class_id, start_ms").all() as (Omit<Meta, "pos"> & { embedding: Buffer | null })[];
  const meta = new Map<number, Meta>(), byClass = new Map<string, number[]>();
  let dims = 0, nEmb = 0;
  for (const r of rows) { const a = byClass.get(r.classId) || []; meta.set(r.id, { id: r.id, classId: r.classId, startMs: r.startMs, endMs: r.endMs, pos: a.length }); a.push(r.id); byClass.set(r.classId, a); if (r.embedding) { nEmb++; dims = r.embedding.length / 4; } }
  let mat: Float32Array | null = null, ids = new Int32Array(0);
  if (nEmb) {
    mat = new Float32Array(nEmb * dims); ids = new Int32Array(nEmb);
    let i = 0;
    for (const r of rows) if (r.embedding) { const v = blobToVec(r.embedding); let nr = 0; for (let k = 0; k < dims; k++) nr += v[k] * v[k]; nr = Math.sqrt(nr) || 1; for (let k = 0; k < dims; k++) mat[i * dims + k] = v[k] / nr; ids[i++] = r.id; }
  }
  const ords = new Map<string, { ord: number; title: string; daf: string; summary: string; tags: string[]; ordLabel: string; dafJson: string }>();
  for (const c of db.prepare("SELECT id, ord, ord_label, title, daf, daf_label, summary, tags FROM classes").all() as { id: string; ord: number; ord_label: string; title: string; daf: string; daf_label: string; summary: string; tags: string }[])
    ords.set(c.id, { ord: c.ord, ordLabel: c.ord_label, title: c.title || "", daf: c.daf_label || "", summary: c.summary || "", tags: parseJson<string[]>(c.tags, []), dafJson: c.daf || "[]" });
  let classVec: { id: string; v: Float32Array }[] = [];
  try {
    classVec = (db.prepare("SELECT class_id, embedding FROM class_vecs").all() as { class_id: string; embedding: Buffer }[]).map((r) => ({ id: r.class_id, v: blobToVec(r.embedding) }));
  } catch { /* old DB without the table */ }
  store = { meta, byClass, ords, ids, mat, dims, n: nEmb, classVec };
  storeKey = key;
  return store;
}

export function hasNormIndex(): boolean {
  const db = getDb();
  if (!db) return false;
  try { return !!db.prepare("SELECT 1 FROM chunks_nfts LIMIT 1").get(); } catch { return false; }
}

export function classMeta(classId: string) { return load()?.ords.get(classId); }

// ---------- FTS ----------
const dfCache = new Map<string, number>();
function matchExpr(terms: string[], op: "OR" | "AND", prefix = true): string {
  return terms.map((t) => (prefix && t.length >= 4 ? `"${t}"*` : `"${t}"`)).join(` ${op} `);
}
function df(table: "chunks_nfts" | "chunks_fts", term: string): number {
  const k = `${table}:${term}`;
  let v = dfCache.get(k);
  if (v == null) {
    try { v = (getDb()!.prepare(`SELECT count(*) n FROM ${table} WHERE ${table} MATCH ?`).get(matchExpr([term], "OR")) as { n: number }).n; } catch { v = 0; }
    dfCache.set(k, v);
  }
  return v;
}
function ftsIds(table: string, expr: string, limit: number): number[] {
  if (!expr) return [];
  try { return (getDb()!.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ? ORDER BY bm25(${table}) LIMIT ?`).all(expr, limit) as { rowid: number }[]).map((r) => r.rowid); } catch { return []; }
}

/** Drop terms that are too common (> maxDf of chunks) so they do not drown the rare topic terms; keep at least one. */
function pickTerms(table: "chunks_nfts" | "chunks_fts", terms: string[], total: number): string[] {
  const uniq = [...new Set(terms)];
  const scored = uniq.map((t) => ({ t, n: df(table, t) })).filter((x) => x.n > 0);
  const good = scored.filter((x) => x.n <= total * 0.12);
  const use = good.length ? good : scored.sort((a, b) => a.n - b.n).slice(0, 2);
  return use.sort((a, b) => a.n - b.n).slice(0, 10).map((x) => x.t);
}

function vecTop(qv: Float32Array, k: number, allowed?: Set<string>): number[] {
  const s = load();
  if (!s || !s.mat) return [];
  let nq = 0; for (let i = 0; i < qv.length; i++) nq += qv[i] * qv[i]; nq = Math.sqrt(nq) || 1;
  const top: { id: number; s: number }[] = [];
  let min = -Infinity;
  const d = s.dims;
  for (let i = 0; i < s.n; i++) {
    const id = s.ids[i];
    if (allowed && !allowed.has(s.meta.get(id)!.classId)) continue;
    let dot = 0; const o = i * d;
    for (let j = 0; j < d; j++) dot += s.mat[o + j] * qv[j];
    dot /= nq;
    if (top.length < k || dot > min) {
      top.push({ id, s: dot });
      if (top.length > k) { top.sort((a, b) => b.s - a.s); top.pop(); }
      min = top.length >= k ? top[top.length - 1].s : -Infinity;
    }
  }
  return top.sort((a, b) => b.s - a.s).map((x) => x.id);
}

export function classIdsForDaf(hebrewDaf: string): Set<string> {
  const out = new Set<string>();
  const s = load();
  if (!s || !hebrewDaf) return out;
  for (const [id, c] of s.ords) if (parseJson<Daf[]>(c.dafJson, []).some((d) => d.daf === hebrewDaf)) out.add(id);
  return out;
}

/** Resolve a class reference ("23", "shiur 23", title fragment) to class ids. */
export function resolveClass(ref: string): Set<string> {
  const out = new Set<string>();
  const s = load();
  const r = ref.trim();
  if (!s || !r) return out;
  const num = r.match(/\d+(?:\.\d+)?/)?.[0];
  if (num) for (const [id, c] of s.ords) if (c.ordLabel === num) out.add(id);
  if (!out.size) {
    const nr = normTokens(r).join(" ");
    if (nr.length >= 4) for (const [id, c] of s.ords) if (normTokens(c.title).join(" ").includes(nr)) out.add(id);
  }
  return out;
}

export type SearchOpts = { classIds?: Set<string>; dafIds?: Set<string>; exclude?: Set<number>; vectors?: boolean };
export type SearchResult = { ranked: { id: number; score: number }[]; classes: ClassHit[]; vectorUsed: boolean };

const RRF = 60;

/** Run every query through the lists (normalized FTS OR/AND, raw FTS, vectors, class-level), fuse with RRF. */
export async function searchChunks(queries: WeightedQuery[], opts: SearchOpts = {}): Promise<SearchResult> {
  const s = load();
  const db = getDb();
  if (!s || !db) return { ranked: [], classes: [], vectorUsed: false };
  const qs = queries.map((x) => ({ q: x.q.trim(), w: x.w ?? 1 })).filter((x) => x.q);
  const total = s.meta.size;
  const useNorm = hasNormIndex();

  let qvecs: Float32Array[] = [];
  let vectorUsed = false;
  if ((opts.vectors ?? true) && (s.mat || s.classVec.length) && process.env.OPENAI_API_KEY) {
    try { qvecs = await embedTexts(qs.map((x) => x.q.slice(0, 1500))); vectorUsed = true; countEmbed(); } catch { qvecs = []; }
  }

  const scores = new Map<number, number>();
  const allowedSets = [opts.classIds].filter(Boolean) as Set<string>[];
  const passAllowed = (id: number) => {
    const m = s.meta.get(id);
    if (!m) return false;
    for (const a of allowedSets) if (!a.has(m.classId)) return false;
    return !opts.exclude?.has(id);
  };
  const addList = (ids: number[], w: number, mult = 1) => {
    let r = 0;
    for (const id of ids) { if (!passAllowed(id)) continue; scores.set(id, (scores.get(id) || 0) + (w * mult) / (RRF + r)); r++; }
  };
  const lim = opts.classIds ? 400 : 60;
  const allTermsN: string[] = [];

  qs.forEach((x, qi) => {
    const kw = keywords(x.q, 16);
    const terms = (kw.length ? kw : (x.q.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8)).map((t) => t.toLowerCase());
    const nterms = [...new Set(terms.flatMap((t) => normTokens(t)))];
    allTermsN.push(...nterms);
    if (useNorm) {
      const nt = pickTerms("chunks_nfts", nterms, total);
      addList(ftsIds("chunks_nfts", matchExpr(nt, "OR"), lim), x.w);
      if (nt.length >= 2 && nt.length <= 5) addList(ftsIds("chunks_nfts", matchExpr(nt, "AND"), lim), x.w, 1.3);
      // pairs of the two rarest terms: catches "Rabí Tarfón" + "camino" style co-occurrence
      if (nt.length >= 3) addList(ftsIds("chunks_nfts", matchExpr(nt.slice(0, 2), "AND"), lim), x.w, 0.8);
    }
    const rt = pickTerms("chunks_fts", terms.map((t) => t.normalize("NFD").replace(/[̀-ͯ]/g, "")), total);
    if (rt.length) addList(ftsIds("chunks_fts", matchExpr(rt, "OR"), lim), x.w, 0.6);
    if (qvecs[qi]) addList(vecTop(qvecs[qi], opts.classIds ? 60 : 50, opts.classIds), x.w);
  });

  // class-level stage: title + tags + summary (normalized FTS + embeddings)
  const cls = new Map<string, number>();
  const bump = (id: string, v: number) => cls.set(id, (cls.get(id) || 0) + v);
  if (useNorm && allTermsN.length) {
    try {
      const terms = [...new Set(allTermsN)].filter((t) => t.length >= 3).slice(0, 14);
      const rows = db.prepare(`SELECT class_id FROM classes_nfts WHERE classes_nfts MATCH ? ORDER BY bm25(classes_nfts) LIMIT 8`).all(matchExpr(terms, "OR")) as { class_id: string }[];
      rows.forEach((r, i) => bump(r.class_id, 1 / (RRF + i)));
    } catch { /* ignore */ }
  }
  qvecs.forEach((qv, qi) => {
    const top = s.classVec.map((c) => ({ id: c.id, s: cosine(qv, c.v) })).sort((a, b) => b.s - a.s).slice(0, 8);
    top.forEach((c, i) => bump(c.id, (qs[qi].w) / (RRF + i)));
  });
  const classes = [...cls.entries()].filter(([id]) => !opts.classIds || opts.classIds.has(id)).map(([classId, score]) => ({ classId, score })).sort((a, b) => b.score - a.score).slice(0, 6);
  // light boost for chunks of the best classes
  classes.slice(0, 4).forEach((c, i) => {
    const boost = 0.012 / (1 + i);
    for (const id of s.byClass.get(c.classId) || []) if (scores.has(id)) scores.set(id, scores.get(id)! + boost);
  });

  const ranked = [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  return { ranked, classes, vectorUsed };
}

// ---------- passages ----------
const chunkText = (ids: number[]): Map<number, { text: string; startMs: number; endMs: number }> => {
  const out = new Map<number, { text: string; startMs: number; endMs: number }>();
  if (!ids.length) return out;
  const rows = getDb()!.prepare(`SELECT id, text, start_ms AS startMs, end_ms AS endMs FROM chunks WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: number; text: string; startMs: number; endMs: number }[];
  for (const r of rows) out.set(r.id, r);
  return out;
};

export type PassageOpts = { seeds?: number; expandTop?: number; budget?: number; exclude?: Set<number>; minScoreRatio?: number };

/** Top chunks -> windows: seeds (+-1 neighbor for the best ones), merged when contiguous, within a char budget. */
export function buildPassages(res: SearchResult, o: PassageOpts = {}): Passage[] {
  const s = load();
  if (!s) return [];
  const seeds = o.seeds ?? 36, expandTop = o.expandTop ?? 14, budget = o.budget ?? 60000;
  const top = res.ranked.filter((r) => !o.exclude?.has(r.id)).slice(0, seeds);
  if (!top.length) return [];
  const lens = new Map<number, number>();
  const textOf = (ids: number[]) => { const need = ids.filter((i) => !lens.has(i)); chunkText(need).forEach((v, k) => lens.set(k, v.text.length)); };
  // choose chunk ids within the budget
  const chosen = new Set<number>(), seedScore = new Map<number, number>();
  let used = 0;
  const diversity = new Set<string>();
  const order = [...top];
  // make sure the top chunk of each top class is present early
  for (let i = 0; i < order.length; i++) {
    const seed = order[i], m = s.meta.get(seed.id)!;
    const arr = s.byClass.get(m.classId)!;
    const want = [seed.id];
    if (i < expandTop) for (const p of [m.pos - 1, m.pos + 1]) { const id = arr[p]; if (id != null && !o.exclude?.has(id)) want.push(id); }
    textOf(want);
    const add = want.filter((id) => !chosen.has(id));
    const cost = add.reduce((n, id) => n + (lens.get(id) || 0) + 20, 0);
    if (used + cost > budget) { if (!diversity.size && used === 0) { /* nothing yet: take it anyway */ } else continue; }
    for (const id of add) chosen.add(id);
    used += cost;
    seedScore.set(seed.id, seed.score);
    diversity.add(m.classId);
  }
  // group into contiguous runs
  const byClass = new Map<string, number[]>();
  for (const id of chosen) { const m = s.meta.get(id)!; const a = byClass.get(m.classId) || []; a.push(m.pos); byClass.set(m.classId, a); }
  const runs: { classId: string; ids: number[] }[] = [];
  for (const [classId, poss] of byClass) {
    poss.sort((a, b) => a - b);
    let cur: number[] = [];
    for (const p of poss) { if (cur.length && p !== cur[cur.length - 1] + 1) { runs.push({ classId, ids: cur.map((q) => s.byClass.get(classId)![q]) }); cur = []; } cur.push(p); }
    if (cur.length) runs.push({ classId, ids: cur.map((q) => s.byClass.get(classId)![q]) });
  }
  const texts = chunkText(runs.flatMap((r) => r.ids));
  const out: Passage[] = runs.map((r) => {
    const c = s.ords.get(r.classId)!;
    const parts = r.ids.map((id) => texts.get(id)!).filter(Boolean);
    let bestId = r.ids[0], bs = -1;
    for (const id of r.ids) { const sc = seedScore.get(id) ?? -0.5; if (sc > bs) { bs = sc; bestId = id; } }
    const best = texts.get(bestId)?.text || parts[0]?.text || "";
    return {
      classId: r.classId, title: c.title, ord: c.ord, dafLabel: c.daf, startMs: parts[0]?.startMs ?? 0, endMs: parts[parts.length - 1]?.endMs ?? 0,
      text: parts.map((p) => `(${fmtTime(p.startMs)}) ${cleanText(p.text)}`).join(" "), score: Math.max(bs, 0), best: cleanText(best), chunkIds: r.ids,
    };
  });
  out.sort((a, b) => a.ord - b.ord || a.startMs - b.startMs);
  return out;
}

export function passageToRef(p: Passage): Ref & { score: number } {
  return { classId: p.classId, title: p.title, startMs: p.startMs, endMs: p.endMs, quote: quoteOf(p.best), score: p.score };
}

/** Numbered context block for the LLM. */
export function formatPassages(ps: Passage[], startNum = 1): string {
  return ps.map((p, i) => `[${startNum + i}] Shiur ${classMeta(p.classId)?.ordLabel ?? ""} «${p.title}»${p.dafLabel ? `, daf ${p.dafLabel}` : ""}, ${fmtTime(p.startMs)}–${fmtTime(p.endMs)}\n${p.text}`).join("\n\n");
}

/** Short summaries of the most relevant classes (class-level stage + chunk mass). */
export function classHeaders(res: SearchResult, passages: Passage[], max = 4): string {
  const s = load();
  if (!s) return "";
  const mass = new Map<string, number>();
  for (const c of res.classes) mass.set(c.classId, (mass.get(c.classId) || 0) + c.score * 20);
  for (const p of passages) mass.set(p.classId, (mass.get(p.classId) || 0) + p.score * 8);
  const top = [...mass.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
  return top.map(([id]) => {
    const c = s.ords.get(id)!;
    return `• Shiur ${c.ordLabel}: «${c.title}»${c.daf ? `, daf ${c.daf}` : ""}. Resumen: ${c.summary.replace(/\s+/g, " ").slice(0, 600)}`;
  }).join("\n");
}
