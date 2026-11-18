import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "shiurim.db");

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS classes(
  id TEXT PRIMARY KEY, ord REAL, ord_label TEXT, title TEXT, file_name TEXT,
  daf TEXT, daf_label TEXT, duration_ms INTEGER, summary TEXT, tags TEXT,
  audio_url TEXT, r2_key TEXT, has_transcript INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS segments(
  id INTEGER PRIMARY KEY, class_id TEXT NOT NULL, idx INTEGER, start_ms INTEGER, end_ms INTEGER, text TEXT
);
CREATE INDEX IF NOT EXISTS segments_class ON segments(class_id, idx);
CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
  text, content='segments', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TABLE IF NOT EXISTS chunks(
  id INTEGER PRIMARY KEY, class_id TEXT NOT NULL, start_ms INTEGER, end_ms INTEGER, text TEXT,
  hash TEXT, embedding BLOB
);
CREATE INDEX IF NOT EXISTS chunks_class ON chunks(class_id, start_ms);
-- Retrieval shadow indexes (rebuilt by build-db): chunk text raw + transliteration-normalized (lib/translit.ts), class title/tags/summary, class embeddings.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, tokenize='unicode61 remove_diacritics 2');
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_nfts USING fts5(text, tokenize='unicode61');
CREATE VIRTUAL TABLE IF NOT EXISTS classes_nfts USING fts5(class_id UNINDEXED, text, tokenize='unicode61');
CREATE TABLE IF NOT EXISTS class_vecs(class_id TEXT PRIMARY KEY, hash TEXT, embedding BLOB);
`;

export type ClassRow = {
  id: string; ord: number; ord_label: string; title: string; file_name: string;
  daf: string; daf_label: string; duration_ms: number; summary: string; tags: string;
  audio_url: string | null; r2_key: string | null; has_transcript: number;
};

export function openDb(opts: { readonly?: boolean; create?: boolean } = {}): Database.Database {
  if (opts.create) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH, { readonly: !!opts.readonly && !opts.create, fileMustExist: !opts.create });
  if (opts.create) {
    db.pragma("journal_mode = WAL");
    db.exec(SCHEMA);
  }
  return db;
}

let _db: Database.Database | null = null;
/** Shared read-only connection for the web server. Returns null when the DB hasn't been built yet. */
export function getDb(): Database.Database | null {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) return null;
  _db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return _db;
}

export function parseJson<T>(s: string | null | undefined, d: T): T {
  try { return s ? (JSON.parse(s) as T) : d; } catch { return d; }
}

export type Daf = { daf: string; amud: string };
export type ClassSummary = {
  id: string; ord: number; ordLabel: string; title: string; fileName: string; daf: Daf[]; dafLabel: string;
  durationMs: number; summary: string; tags: string[]; audioUrl: string; hasTranscript: boolean;
};
export type Segment = { idx: number; startMs: number; endMs: number; text: string };

export function rowToClass(r: ClassRow, audioUrl: string): ClassSummary {
  return {
    id: r.id, ord: r.ord, ordLabel: r.ord_label, title: r.title, fileName: r.file_name,
    daf: parseJson<Daf[]>(r.daf, []), dafLabel: r.daf_label || "", durationMs: r.duration_ms || 0,
    summary: r.summary || "", tags: parseJson<string[]>(r.tags, []), audioUrl, hasTranscript: !!r.has_transcript,
  };
}

export function listClasses(opts: { daf?: string } = {}): ClassRow[] {
  const db = getDb();
  if (!db) return [];
  if (opts.daf) {
    return db.prepare(
      `SELECT * FROM classes c WHERE EXISTS (SELECT 1 FROM json_each(c.daf) j WHERE json_extract(j.value,'$.daf') = ?) ORDER BY ord, id`
    ).all(opts.daf) as ClassRow[];
  }
  return db.prepare(`SELECT * FROM classes ORDER BY ord, id`).all() as ClassRow[];
}

export function getClass(id: string): ClassRow | undefined {
  return getDb()?.prepare(`SELECT * FROM classes WHERE id = ?`).get(id) as ClassRow | undefined;
}

export function getSegments(classId: string): Segment[] {
  const db = getDb();
  if (!db) return [];
  return db.prepare(
    `SELECT idx, start_ms AS startMs, end_ms AS endMs, text FROM segments WHERE class_id = ? ORDER BY idx`
  ).all(classId) as Segment[];
}
