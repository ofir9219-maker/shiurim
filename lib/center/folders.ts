// Subfolders of a series as site categories: folder tree per collection (exact Drive names), Drive-like ordering
// with Hebrew numerals compared by value ("תורה יד" before "תורה טו"), and each class's folder chain.
import path from "node:path";
import { STORAGE_DIR, readJson, writeJson } from "../storage";

export type FolderNode = { id: string; name: string; parentId: string };
type TreeFile = Record<string, { at: string; folders: FolderNode[] }>;
const FILE = () => path.join(STORAGE_DIR, "center", "folder-tree.json");
export const readTrees = (): TreeFile => readJson<TreeFile>(FILE(), {});

const GEM: Record<string, number> = { "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9, "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50, "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90, "ק": 100, "ר": 200, "ש": 300, "ת": 400 };
/** Value of a Hebrew numeral token ("טו", "ע''ט", "קכ״ג"), or null if it does not look like one. */
export function gematria(tok: string): number | null {
  const t = tok.replace(/['"׳״’`]/g, "");
  if (!t || t.length > 4 || !/^[א-ת]+$/.test(t)) return null;
  let v = 0, last = Infinity;
  for (const ch of t) { const n = GEM[ch]; if (!n || n > last && !(last === 9 && n <= 7)) return null; v += n; last = n; } // descending, allowing טו/טז
  return v;
}
const toks = (s: string) => s.normalize("NFC").split(/[\s\-–—|,_.]+/).filter(Boolean);
/** Compare folder names like Drive's natural order, but Hebrew numerals by value (and digits numerically). */
export function compareNames(a: string, b: string): number {
  const A = toks(a), B = toks(b);
  for (let i = 0; i < Math.min(A.length, B.length); i++) {
    const x = A[i], y = B[i];
    if (x === y) continue;
    const nx = /^\d+$/.test(x) ? Number(x) : gematria(x), ny = /^\d+$/.test(y) ? Number(y) : gematria(y);
    if (nx != null && ny != null && nx !== ny) return nx - ny;
    const c = x.localeCompare(y, "he", { numeric: true });
    if (c) return c;
  }
  return A.length - B.length || a.localeCompare(b, "he", { numeric: true });
}

/** Walk the subfolders (folders only) of a collection; nested series (other collections) are skipped. Returns true if it changed. */
export async function syncFolderTree(collectionId: string, listChildren: (id: string) => Promise<{ id: string; name: string; mimeType: string }[]>, skip: Set<string> = new Set()): Promise<boolean> {
  const folders: FolderNode[] = [];
  const stack = [{ id: collectionId, depth: 0 }];
  for (let guard = 0; stack.length && guard < 3000; guard++) {
    const cur = stack.pop()!;
    for (const k of await listChildren(cur.id)) {
      if (k.mimeType !== "application/vnd.google-apps.folder" || skip.has(k.id)) continue;
      folders.push({ id: k.id, name: k.name, parentId: cur.id });
      if (cur.depth < 8) stack.push({ id: k.id, depth: cur.depth + 1 });
    }
  }
  const all = readTrees();
  const prev = JSON.stringify(all[collectionId]?.folders ?? []);
  folders.sort((x, y) => x.id.localeCompare(y.id));
  if (prev === JSON.stringify(folders)) return false;
  all[collectionId] = { at: new Date().toISOString(), folders };
  writeJson(FILE(), all);
  return true;
}

/** [{id,name}] from the first subfolder under the collection down to `parentId` ([] when directly in the collection or unknown). */
export function folderChain(collectionId: string, parentId: string | undefined, trees = readTrees()): { id: string; name: string }[] {
  const fs = trees[collectionId]?.folders; if (!fs || !parentId || parentId === collectionId) return [];
  const by = new Map(fs.map((f) => [f.id, f]));
  const out: { id: string; name: string }[] = [];
  for (let cur = by.get(parentId), i = 0; cur && i < 12; cur = by.get(cur.parentId), i++) { out.unshift({ id: cur.id, name: cur.name }); if (cur.parentId === collectionId) return out; }
  return out.length && by.get(out[0].id)?.parentId === collectionId ? out : [];
}

/** Sort key of each folder: position among siblings, joined along the path (e.g. "0002.0001"). */
export function folderOrder(collectionId: string, trees = readTrees()): Map<string, string> {
  const fs = trees[collectionId]?.folders ?? [];
  const kids = new Map<string, FolderNode[]>();
  for (const f of fs) { const l = kids.get(f.parentId) ?? []; l.push(f); kids.set(f.parentId, l); }
  const out = new Map<string, string>();
  const walk = (pid: string, prefix: string) => (kids.get(pid) ?? []).sort((a, b) => compareNames(a.name, b.name)).forEach((f, i) => { const k = `${prefix}${prefix ? "." : ""}${String(i + 1).padStart(4, "0")}`; out.set(f.id, k); walk(f.id, k); });
  walk(collectionId, "");
  return out;
}
