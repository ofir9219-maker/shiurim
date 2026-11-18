// Persistent storage for data created at runtime (ingest state, new classes, tokens, DB).
// STORAGE_DIR: Railway volume mount (/data) in production, ./storage locally. New classes mirror the repo's data/ layout under $STORAGE_DIR/data.
import fs from "node:fs";
import path from "node:path";

export const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));
export const STORAGE_DATA = path.join(STORAGE_DIR, "data");
export const REPO_DATA = path.join(process.cwd(), "data");
export const INGEST_DIR = path.join(STORAGE_DIR, "ingest");
export const WORK_DIR = path.join(STORAGE_DIR, "work");

export type InvItem = {
  id: string; name: string; order: string; ext: string; mimeType: string; sizeBytes: number; durationMs: number;
  mdId: string | null; mdName: string | null; transcript: string; inShiurim: boolean; r2Key?: string; ingested?: boolean; collectionId?: string;
};

export function readJson<T>(p: string, d: T): T {
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as T; } catch { return d; }
}
export function writeJson(p: string, v: unknown, mode?: number, indent: number | undefined = 1) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, indent), mode ? { mode } : undefined);
  fs.renameSync(tmp, p);
}
export const dataPath = (...p: string[]) => path.join(STORAGE_DATA, ...p);

export const repoInventory = (): InvItem[] => readJson(path.join(REPO_DATA, "inventory.json"), []);
export const storageInventory = (): InvItem[] => readJson(dataPath("inventory.json"), []);
export const allInventory = (): InvItem[] => [...repoInventory(), ...storageInventory()];

/** Look for data/<sub>/<id>.json in the repo, then in storage. */
export function findDataFile(sub: string, id: string): string | null {
  for (const base of [REPO_DATA, STORAGE_DATA]) {
    const f = path.join(base, sub, `${id}.json`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}
