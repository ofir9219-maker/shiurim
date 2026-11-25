import { getDb } from "./db";
import { embedTexts, cosine, blobToVec } from "./embeddings";
import { classIdsOf } from "./series";

export type TextHit = { classId: string; title: string; segmentIdx: number; startMs: number; snippet: string };
export type ChunkHit = { classId: string; title: string; startMs: number; endMs: number; text: string; score: number; source: "fts" | "vector" | "both" };

/** Build a safe FTS5 query: tokens (letters/digits, incl. Hebrew) quoted with prefix *. Returns null if empty. */
export function sanitizeQuery(q: string): string | null {
  const toks = (q.normalize("NFC").match(/[\p{L}\p{N}]+/gu) || []).slice(0, 12);
  if (!toks.length) return null;
  return toks.map((t) => `"${t}"*`).join(" ");
}

export function textSearch(q: string, opts: { daf?: string; limit?: number; collections?: string[] } = {}): TextHit[] {
  const db = getDb();
  const match = sanitizeQuery(q);
  if (!db || !match) return [];
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 200);
  const params: unknown[] = [match];
  let dafSql = "";
  if (opts.daf) {
    dafSql = `AND EXISTS (SELECT 1 FROM json_each(c.daf) j WHERE json_extract(j.value,'$.daf') = ?)`;
    params.push(opts.daf);
  }
  const scope = classIdsOf(opts.collections);
  if (scope && !scope.size) return [];
  const limitSql = scope ? Math.max(limit * 6, 300) : limit; // filter by series after the FTS ranking (class ids set)
  params.push(limitSql);
  let rows = db.prepare(
    `SELECT s.class_id AS classId, c.title AS title, s.idx AS segmentIdx, s.start_ms AS startMs,
            snippet(segments_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
     FROM segments_fts f JOIN segments s ON s.id = f.rowid JOIN classes c ON c.id = s.class_id
     WHERE segments_fts MATCH ? ${dafSql}
     ORDER BY bm25(segments_fts) LIMIT ?`
  ).all(...params) as TextHit[];
  if (scope) rows = rows.filter((r) => scope.has(r.classId)).slice(0, limit);
  return rows;
}

/** Number of segments matching q (FTS, same tokenization as textSearch). */
export function ftsCount(q: string): number {
  const db = getDb();
  const match = sanitizeQuery(q);
  if (!db || !match) return 0;
  return (db.prepare(`SELECT count(*) AS n FROM segments_fts WHERE segments_fts MATCH ?`).get(match) as { n: number }).n;
}

export function hasEmbeddings(): boolean {
  const db = getDb();
  if (!db) return false;
  return !!db.prepare(`SELECT 1 FROM chunks WHERE embedding IS NOT NULL LIMIT 1`).get();
}

type ChunkRow = { id: number; class_id: string; start_ms: number; end_ms: number; text: string; embedding: Buffer; title: string };
let cache: { vecs: { row: ChunkRow; v: Float32Array }[] } | null = null;
function loadVecs() {
  if (cache) return cache;
  const db = getDb()!;
  const rows = db.prepare(
    `SELECT ch.id, ch.class_id, ch.start_ms, ch.end_ms, ch.text, ch.embedding, c.title
     FROM chunks ch JOIN classes c ON c.id = ch.class_id WHERE ch.embedding IS NOT NULL`
  ).all() as ChunkRow[];
  cache = { vecs: rows.map((row) => ({ row, v: blobToVec(row.embedding) })) };
  return cache;
}

function chunkFtsHits(q: string, limit: number, collections?: string[]): ChunkHit[] {
  // map segment hits to chunk-ish hits (segment granularity) when chunks are unavailable
  return textSearch(q, { limit, collections }).map((h, i) => ({
    classId: h.classId, title: h.title, startMs: h.startMs, endMs: h.startMs, text: h.snippet, score: 1 / (60 + i), source: "fts" as const,
  }));
}

/** FTS + vector (when embeddings and an API key exist) merged with reciprocal rank fusion. */
export async function hybridSearch(q: string, k = 10, collections?: string[]): Promise<ChunkHit[]> {
  const db = getDb();
  if (!db || !q.trim()) return [];
  const RRF = 60;
  const ftsList = chunkFtsHits(q, 50, collections);
  const scope = classIdsOf(collections);
  let vecList: ChunkHit[] = [];
  if (hasEmbeddings()) {
    try {
      const [qv] = await embedTexts([q]);
      if (qv) {
        vecList = loadVecs().vecs
          .filter(({ row }) => !scope || scope.has(row.class_id))
          .map(({ row, v }) => ({ row, s: cosine(qv, v) }))
          .sort((a, b) => b.s - a.s).slice(0, 50)
          .map(({ row, s }) => ({ classId: row.class_id, title: row.title, startMs: row.start_ms, endMs: row.end_ms, text: row.text, score: s, source: "vector" as const }));
      }
    } catch { /* no key / network: FTS only */ }
  }
  if (!vecList.length) return ftsList.slice(0, k);
  // Fuse by (class, ~time bucket 60s) so an FTS segment and its containing chunk merge.
  const merged = new Map<string, ChunkHit>();
  const add = (list: ChunkHit[], src: "fts" | "vector") => list.forEach((h, i) => {
    const key = `${h.classId}:${Math.floor(h.startMs / 60000)}`;
    const add = 1 / (RRF + i);
    const cur = merged.get(key);
    if (!cur) merged.set(key, { ...h, score: add, source: src });
    else {
      cur.score += add;
      if (cur.source !== src) cur.source = "both";
      if (src === "vector") { cur.text = h.text; cur.startMs = h.startMs; cur.endMs = h.endMs; }
    }
  });
  add(ftsList, "fts"); add(vecList, "vector");
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, k);
}
