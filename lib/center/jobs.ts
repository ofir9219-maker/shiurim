// Building jobs: Drive path / ancestry helpers, recursive audio walk, job settings snapshot.
import * as drive from "../ingest/drive";
import { berajotCollection, getCenter, listCollections, resolveSettings, type Resolution } from "./collections";
import type { JobCfg } from "../ingest/state";

export const NO_COLLECTION = "_none";
export const jobCfg = (r: Resolution): JobCfg => ({ ...r.settings, published: r.published, collectionName: r.collection?.name ?? "(sin serie)", slug: r.collection?.slug ?? "" });
/** Settings for items queued before collections existed (the Berajot folder). */
export const legacyCfg = (): JobCfg => jobCfg(resolveSettings([berajotCollection().folderId]));

const parentCache = new Map<string, { parent: string | null; name: string }>();
export async function folderInfo(id: string): Promise<{ parent: string | null; name: string }> {
  const hit = parentCache.get(id); if (hit) return hit;
  const m = await drive.getMeta(id);
  const v = { parent: m.parents?.[0] ?? null, name: m.name };
  parentCache.set(id, v); return v;
}
/** [top ... id] chain of folder ids; stops after the General folder, and never loops. */
export async function ancestorPath(id: string): Promise<string[]> {
  const root = getCenter().rootFolderId; const out: string[] = []; let cur: string | null = id;
  for (let i = 0; i < 15 && cur; i++) {
    out.unshift(cur);
    if (cur === root) break;
    try { cur = (await folderInfo(cur)).parent; } catch { break; }
  }
  return out;
}
export type Candidate = { file: drive.DriveFile; parentId: string; path: string[]; hasJson: boolean; hasMd: boolean };

const walkCache = new Map<string, { at: number; files: drive.DriveFile[] }>();
export async function childrenCached(folderId: string, ttlMs = 20_000): Promise<drive.DriveFile[]> {
  const h = walkCache.get(folderId);
  if (h && Date.now() - h.at < ttlMs) return h.files;
  const files = await drive.listChildren(folderId);
  walkCache.set(folderId, { at: Date.now(), files }); return files;
}
export const invalidateChildren = (folderId?: string) => (folderId ? walkCache.delete(folderId) : walkCache.clear());

/** Audio files under a folder (recursive). `stopAt` = folder ids that are other collections (skipped when `skipCollections`). */
export async function walkAudio(folderId: string, path: string[], o: { skipCollections?: boolean; maxFiles?: number; cached?: boolean } = {}): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const colls = new Set(listCollections().map((c) => c.folderId));
  const stack = [{ id: folderId, path }];
  const max = o.maxFiles ?? 5000;
  for (let guard = 0; stack.length && guard < 2000 && out.length < max; guard++) {
    const cur = stack.pop()!;
    const kids = o.cached ? await childrenCached(cur.id) : await drive.listChildren(cur.id);
    const key = (n: string) => n.replace(/\.[A-Za-z0-9]{2,5}$/, "").normalize("NFC").toLowerCase();
    const jsons = new Set(kids.filter((k) => /\.json$/i.test(k.name) && !/\.ai(\.|$)/i.test(k.name)).map((k) => key(k.name)));
    const mds = new Set(kids.filter((k) => /\.md$/i.test(k.name)).map((k) => key(k.name)));
    for (const k of kids) {
      if (drive.isFolder(k)) { if (cur.path.length < 14 && !(o.skipCollections && colls.has(k.id))) stack.push({ id: k.id, path: [...cur.path, k.id] }); }
      else if (drive.isAudio(k)) out.push({ file: k, parentId: cur.id, path: cur.path, hasJson: jsons.has(key(k.name)), hasMd: mds.has(key(k.name)) });
    }
  }
  return out;
}
