import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import type { Input, StoredResult } from "./types";
import { PROMPT_VERSION } from "./types";

let dir: string | null = null;
/** Writable cache dir: $CHAMPINONES_DIR, else data/.cache/champinones (gitignored), else os tmp. */
export function dataDir(): string {
  if (dir) return dir;
  const cands = [process.env.CHAMPINONES_DIR, path.join(process.cwd(), "data", ".cache", "champinones"), path.join(os.tmpdir(), "champinones")].filter(Boolean) as string[];
  for (const c of cands) {
    try { fs.mkdirSync(c, { recursive: true }); fs.accessSync(c, fs.constants.W_OK); dir = c; return c; } catch {}
  }
  dir = cands[cands.length - 1];
  return dir;
}

export const RESULT_TTL_MS = 30 * 86400_000;
const mem = new Map<string, StoredResult>();

export function resultId(inp: { question: string; language?: string; model: string; effort: string; scope: string; classId?: string }): string {
  const norm = inp.question.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  return crypto.createHash("sha256").update([norm, inp.language || "auto", inp.model, inp.effort, inp.scope, inp.classId || "", PROMPT_VERSION].join("\u0001")).digest("hex").slice(0, 16);
}

const fileFor = (id: string) => path.join(dataDir(), "results", id + ".json");
export const validId = (id: string) => /^[a-f0-9]{16}$/.test(id);

export function saveResult(r: StoredResult) {
  mem.set(r.id, r);
  try { fs.mkdirSync(path.dirname(fileFor(r.id)), { recursive: true }); fs.writeFileSync(fileFor(r.id), JSON.stringify(r)); } catch {}
}
export function loadResult(id: string): StoredResult | null {
  if (!validId(id)) return null;
  const now = Date.now();
  const m = mem.get(id);
  if (m && now - m.meta.createdAt < RESULT_TTL_MS) return m;
  try {
    const r = JSON.parse(fs.readFileSync(fileFor(id), "utf8")) as StoredResult;
    if (now - r.meta.createdAt >= RESULT_TTL_MS) return null;
    mem.set(id, r); return r;
  } catch { return null; }
}
export type { Input };
