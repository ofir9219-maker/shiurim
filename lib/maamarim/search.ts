// Independent search index for the maamarim: $STORAGE_DIR/maamarim.db (rebuildable from the JSON files).
// Chunks: paragraphs grouped per section, quotes, section enrichment, maamar ficha (summary/keywords/questions).
// Hybrid retrieval: normalized FTS (nikud/prefix/transliteration-insensitive) + embeddings, fused with RRF.
import crypto from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { STORAGE_DIR } from "../storage";
import { normTokens } from "../translit";
import { blobToVec, embedTexts, hasEmbeddingKey, vecToBlob } from "../embeddings";
import { htmlToText } from "./markup";
import { callNumber, flatTree, getMaamar, listMaamarim } from "./store";
import type { Maamar } from "./types";

export const INDEX_PATH = () => process.env.MAAMARIM_DB || path.join(STORAGE_DIR, "maamarim.db");
const CHUNK_CHARS = 1100;

let db: Database.Database | null = null;
let dbPath = "";
function open(): Database.Database {
  const p = INDEX_PATH();
  if (db && dbPath === p) return db;
  db?.close();
  db = new Database(p);
  dbPath = p;
  db.pragma("journal_mode = WAL");
  db.pragma("journal_size_limit = 4000000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, maamar_id TEXT, section_id TEXT, kind TEXT, text TEXT, hash TEXT);
    CREATE INDEX IF NOT EXISTS docs_m ON docs(maamar_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(text, tokenize='unicode61');
    CREATE TABLE IF NOT EXISTS emb(hash TEXT PRIMARY KEY, v BLOB);
    CREATE TABLE IF NOT EXISTS state(maamar_id TEXT PRIMARY KEY, stamp TEXT);
  `);
  return db;
}
export function closeIndex() { db?.close(); db = null; dbPath = ""; vecs = null; }

// ---------- normalization ----------
const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
const HEB = /[א-ת]/;
/** Normalized tokens + Hebrew variants without a one-letter prefix (ו ה ב ל מ ש כ) and with ו/י matres dropped. */
export function normForIndex(text: string): string[] {
  const out: string[] = [];
  // nikud/ta'amim are combining marks: drop them first or the tokenizer splits vocalized words letter by letter
  for (let t of normTokens(text.replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "").replace(/["״]/g, ""))) {
    if (HEB.test(t)) {
      t = t.replace(/[ךםןףץ]/g, (c) => FINALS[c]);
      out.push(t);
      if (t.length >= 4 && "והבלמשכ".includes(t[0])) out.push(t.slice(1));
      const def = t.replace(/(?<=.)[וי](?=.)/g, "");
      if (def.length >= 3 && def !== t) out.push(def);
    } else out.push(t);
  }
  return out;
}
const STOP = new Set(("de la el los las un una y o que en del al por para con se su sus es lo como mas más pero sobre este esta qué que cual cuál " +
  "the of and to in is what how why על את של הוא היא זה זו כי אם לא גם כל מה אשר עם אל בין או").split(/\s+/).flatMap((w) => normForIndex(w)));

// ---------- chunking ----------
type Doc = { sectionId: string; kind: string; text: string };
export function docsFor(m: Maamar, catPath: string[]): Doc[] {
  const docs: Doc[] = [];
  const head = `${m.title}${m.subtitle ? " — " + m.subtitle : ""}`;
  const f = m.ficha;
  docs.push({ sectionId: "", kind: "meta", text: [
    `מאמר: ${head}`, catPath.length ? `קטגוריה: ${catPath.join(" / ")}` : "", m.source || "", f.rav ? `רב: ${f.rav}` : "",
    f.summary_he || "", f.summary_es ? `Resumen: ${f.summary_es}` : "", f.thesis ? `Tesis: ${f.thesis}` : "",
    m.tags.length ? `Etiquetas: ${m.tags.join(", ")}` : "", f.keywords?.length ? `Palabras clave: ${f.keywords.join(", ")}` : "",
    f.concepts?.length ? `Conceptos: ${f.concepts.join(", ")}` : "", f.people?.length ? `Personajes: ${f.people.join(", ")}` : "",
    f.sources?.length ? `Fuentes: ${f.sources.map((s) => s.label + (s.ref ? ` (${s.ref})` : "")).join("; ")}` : "",
  ].filter(Boolean).join("\n") });
  const qs = f.questions ?? [];
  for (let i = 0; i < qs.length; i += 6) docs.push({ sectionId: "", kind: "questions", text: `${head}. Preguntas que responde: ${qs.slice(i, i + 6).join(" | ")}` });
  for (const s of m.sections) {
    if (s.summary || s.keywords?.length) docs.push({ sectionId: s.id, kind: "secmeta", text: `${head} — ${s.title}: ${s.summary ?? ""} ${s.keywords?.length ? "(" + s.keywords.join(", ") + ")" : ""}`.trim() });
    let buf = "";
    const flush = () => { if (buf.trim()) docs.push({ sectionId: s.id, kind: "text", text: `${s.title ? s.title + ": " : ""}${buf.trim()}` }); buf = ""; };
    for (const b of s.blocks) {
      if (b.t === "quote") { flush(); if (b.text) docs.push({ sectionId: s.id, kind: "quote", text: `${s.title}: ${b.text}${b.label ? ` (${b.label})` : ""}` }); continue; }
      const t = b.t === "p" ? htmlToText(b.html) : b.text;
      if (buf.length + t.length > CHUNK_CHARS && buf) flush();
      buf += (buf ? " " : "") + t;
    }
    flush();
  }
  for (const n of m.notes) docs.push({ sectionId: n.section, kind: "note", text: `הערה: ${htmlToText(n.html)}` });
  return docs;
}
const sha = (s: string) => crypto.createHash("sha1").update(s).digest("hex");
const stampOf = (m: Maamar) => `${m.updatedAt}|${m.categoryId}|${m.seq}`;

// ---------- sync ----------
let syncing: Promise<{ indexed: number; embedded: number }> | null = null;
let lastSyncVersion = "";
/** Bring the index up to date with the files (and embed what is missing). Cheap when nothing changed. */
export function syncIndex(force = false): Promise<{ indexed: number; embedded: number }> {
  if (syncing) return syncing;
  syncing = (async () => {
    const d = open();
    const all = listMaamarim();
    const key = all.map(stampOf).sort().join(";");
    if (!force && key === lastSyncVersion) return { indexed: 0, embedded: 0 };
    const nodes = flatTree();
    const have = new Map((d.prepare("SELECT maamar_id, stamp FROM state").all() as { maamar_id: string; stamp: string }[]).map((r) => [r.maamar_id, r.stamp]));
    const ids = new Set(all.map((m) => m.id));
    let indexed = 0;
    const delM = (id: string) => {
      const rows = d.prepare("SELECT id FROM docs WHERE maamar_id=?").all(id) as { id: number }[];
      const delF = d.prepare("DELETE FROM docs_fts WHERE rowid=?");
      for (const r of rows) delF.run(r.id);
      d.prepare("DELETE FROM docs WHERE maamar_id=?").run(id);
      d.prepare("DELETE FROM state WHERE maamar_id=?").run(id);
    };
    d.transaction(() => {
      for (const id of have.keys()) if (!ids.has(id)) delM(id);
      const ins = d.prepare("INSERT INTO docs(maamar_id, section_id, kind, text, hash) VALUES (?,?,?,?,?)");
      const insF = d.prepare("INSERT INTO docs_fts(rowid, text) VALUES (?,?)");
      for (const m of all) {
        if (!force && have.get(m.id) === stampOf(m)) continue;
        delM(m.id);
        const node = nodes.find((n) => n.id === m.categoryId);
        for (const doc of docsFor(m, node?.path ?? [])) {
          const r = ins.run(m.id, doc.sectionId, doc.kind, doc.text, sha(doc.text));
          insF.run(r.lastInsertRowid, normForIndex(doc.text).join(" "));
        }
        d.prepare("INSERT INTO state(maamar_id, stamp) VALUES (?,?)").run(m.id, stampOf(m));
        indexed++;
      }
    })();
    let embedded = 0;
    if (hasEmbeddingKey()) {
      const todo = d.prepare("SELECT DISTINCT d.hash, d.text FROM docs d LEFT JOIN emb e ON e.hash = d.hash WHERE e.hash IS NULL").all() as { hash: string; text: string }[];
      const put = d.prepare("INSERT OR REPLACE INTO emb(hash, v) VALUES (?,?)");
      for (let i = 0; i < todo.length; i += 64) {
        const batch = todo.slice(i, i + 64);
        try {
          const v = await embedTexts(batch.map((b) => b.text.slice(0, 6000)));
          d.transaction(() => batch.forEach((b, j) => put.run(b.hash, vecToBlob(v[j]))))();
          embedded += batch.length;
        } catch (e) { console.log("maamarim: embeddings failed:", (e as Error).message); break; }
      }
      d.prepare("DELETE FROM emb WHERE hash NOT IN (SELECT hash FROM docs)").run();
    }
    if (indexed || embedded) { vecs = null; try { d.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* ignore */ } }
    lastSyncVersion = key;
    return { indexed, embedded };
  })().finally(() => { syncing = null; });
  return syncing;
}

// ---------- vectors ----------
let vecs: { ids: Int32Array; mat: Float32Array; dims: number } | null = null;
function loadVecs() {
  if (vecs) return vecs;
  const rows = open().prepare("SELECT d.id, e.v FROM docs d JOIN emb e ON e.hash = d.hash").all() as { id: number; v: Buffer }[];
  if (!rows.length) return null;
  const dims = rows[0].v.length / 4;
  const mat = new Float32Array(rows.length * dims), ids = new Int32Array(rows.length);
  rows.forEach((r, i) => {
    const v = blobToVec(r.v); let n = 0; for (let k = 0; k < dims; k++) n += v[k] * v[k]; n = Math.sqrt(n) || 1;
    for (let k = 0; k < dims; k++) mat[i * dims + k] = v[k] / n; ids[i] = r.id;
  });
  vecs = { ids, mat, dims };
  return vecs;
}
function vecTop(q: Float32Array, k: number): number[] {
  const V = loadVecs(); if (!V) return [];
  let qn = 0; for (let i = 0; i < V.dims; i++) qn += q[i] * q[i]; qn = Math.sqrt(qn) || 1;
  const scores: [number, number][] = [];
  for (let r = 0; r < V.ids.length; r++) { let s = 0; const o = r * V.dims; for (let i = 0; i < V.dims; i++) s += V.mat[o + i] * q[i]; scores.push([s / qn, V.ids[r]]); }
  scores.sort((a, b) => b[0] - a[0]);
  return scores.slice(0, k).filter((x) => x[0] > 0.2).map((x) => x[1]);
}

// ---------- search ----------
function ftsIds(q: string, k: number, op: "AND" | "OR"): number[] {
  const terms = [...new Set(normForIndex(q))].filter((t) => !STOP.has(t) && (t.length >= 2)).slice(0, 14);
  if (!terms.length) return [];
  const expr = terms.map((t) => (t.length >= 4 ? `"${t}"*` : `"${t}"`)).join(` ${op} `);
  try { return (open().prepare("SELECT rowid FROM docs_fts WHERE docs_fts MATCH ? ORDER BY bm25(docs_fts) LIMIT ?").all(expr, k) as { rowid: number }[]).map((r) => r.rowid); } catch { return []; }
}

export type Passage = { maamarId: string; title: string; callNumber: string; sectionId: string; sectionTitle: string; text: string; score: number; kinds: string[] };
type DocRow = { id: number; maamar_id: string; section_id: string; kind: string; text: string };

/** Multi-query hybrid search; returns section-level passages (best first). */
export async function searchMaamarim(queries: string[], opts: { k?: number; maamarId?: string; budget?: number } = {}): Promise<Passage[]> {
  await syncIndex().catch((e) => console.log("maamarim: sync failed:", (e as Error).message));
  const d = open();
  const scores = new Map<number, number>();
  const add = (ids: number[], w: number) => ids.forEach((id, r) => scores.set(id, (scores.get(id) ?? 0) + w / (60 + r)));
  const qs = [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 8);
  for (const [i, q] of qs.entries()) {
    const w = i === 0 ? 1.3 : 1;
    add(ftsIds(q, 60, "AND"), 1.2 * w);
    add(ftsIds(q, 80, "OR"), 0.8 * w);
  }
  if (hasEmbeddingKey() && qs.length) {
    try { const vs = await embedTexts(qs); vs.forEach((v, i) => add(vecTop(v, 60), i === 0 ? 1.4 : 1.1)); } catch (e) { console.log("maamarim: query embed failed:", (e as Error).message); }
  }
  if (!scores.size) return [];
  const ids = [...scores.keys()];
  const rows = new Map<number, DocRow>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    for (const r of d.prepare(`SELECT id, maamar_id, section_id, kind, text FROM docs WHERE id IN (${part.map(() => "?").join(",")})`).all(...part) as DocRow[]) rows.set(r.id, r);
  }
  // aggregate to sections (maamar-level hits boost every section of that maamar a little and its first section)
  const sec = new Map<string, { score: number; kinds: Set<string>; maamarId: string; sectionId: string; best: number }>();
  const mBoost = new Map<string, number>();
  for (const [id, s] of scores) {
    const r = rows.get(id); if (!r) continue;
    if (opts.maamarId && r.maamar_id !== opts.maamarId) continue;
    if (!r.section_id) { mBoost.set(r.maamar_id, (mBoost.get(r.maamar_id) ?? 0) + s); continue; }
    const key = `${r.maamar_id}#${r.section_id}`;
    const e = sec.get(key) ?? { score: 0, kinds: new Set<string>(), maamarId: r.maamar_id, sectionId: r.section_id, best: 0 };
    e.score += s; e.kinds.add(r.kind); e.best = Math.max(e.best, s);
    sec.set(key, e);
  }
  for (const e of sec.values()) e.score = e.best + 0.35 * (e.score - e.best) + 0.5 * (mBoost.get(e.maamarId) ?? 0);
  // maamarim matched only through the ficha: offer their first sections
  for (const [mid, b] of mBoost) {
    if ([...sec.values()].some((e) => e.maamarId === mid)) continue;
    const m = getMaamar(mid); if (!m?.sections[0]) continue;
    sec.set(`${mid}#${m.sections[0].id}`, { score: b * 0.9, kinds: new Set(["meta"]), maamarId: mid, sectionId: m.sections[0].id, best: b });
  }
  const nodes = flatTree();
  const budget = opts.budget ?? 4200;
  const out: Passage[] = [];
  for (const e of [...sec.values()].sort((a, b) => b.score - a.score).slice(0, opts.k ?? 10)) {
    const m = getMaamar(e.maamarId); const s = m?.sections.find((x) => x.id === e.sectionId);
    if (!m || !s) continue;
    let text = s.blocks.map((b) => (b.t === "p" ? htmlToText(b.html) : b.t === "quote" ? `«${b.text}»${b.label ? ` (${b.label})` : ""}` : `— ${b.text} —`)).join("\n");
    const notes = m.notes.filter((n) => n.section === s.id).map((n) => `[הערה ${n.n}] ${htmlToText(n.html)}`).join("\n");
    if (notes) text += "\n" + notes;
    if (text.length > budget) text = text.slice(0, budget) + " …";
    out.push({ maamarId: m.id, title: m.title, callNumber: callNumber(m, nodes), sectionId: s.id, sectionTitle: s.title, text, score: e.score, kinds: [...e.kinds] });
  }
  return out;
}

/** Simple keyword search over titles/ficha for the library filter and the MCP list tool. */
export async function quickSearch(q: string, k = 20): Promise<string[]> {
  await syncIndex().catch(() => {});
  const ids = [...ftsIds(q, 200, "AND"), ...ftsIds(q, 200, "OR")];
  if (!ids.length) return [];
  const d = open(); const seen = new Set<string>();
  for (const id of ids) {
    const r = d.prepare("SELECT maamar_id FROM docs WHERE id=?").get(id) as { maamar_id: string } | undefined;
    if (r) seen.add(r.maamar_id);
    if (seen.size >= k) break;
  }
  return [...seen];
}
