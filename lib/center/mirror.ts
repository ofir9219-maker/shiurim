// When a series becomes public its audios must be playable: copy the originals to R2 (Drive proxy only works for shared files).
import fs from "node:fs";
import path from "node:path";
import * as drive from "../ingest/drive";
import { WORK_DIR, storageInventory } from "../storage";
import { CT_BY_EXT, existingKeys, extOf, r2ObjectKey } from "../r2-sync";
import { r2Put, r2Ready, r2Size } from "../ingest/r2";

export async function mirrorCollectionAudio(collectionFolderId: string, log: (m: string) => void = () => {}): Promise<number> {
  if (!r2Ready()) return 0;
  let n = 0;
  for (const e of storageInventory().filter((x) => x.collectionId === collectionFolderId)) {
    const key = r2ObjectKey(e);
    if (await r2Size(key)) continue;
    const dir = path.join(WORK_DIR, `mirror-${e.id}`), src = path.join(dir, `src${e.ext || ".bin"}`);
    try { await drive.downloadToFile(e.id, src); await r2Put(key, src, CT_BY_EXT[extOf(e)]); n++; log(`mirror: ${e.name} -> ${key}`); }
    catch (err) { log(`mirror falló ${e.id}: ${(err as Error).message}`); }
    finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  if (n) await existingKeys(true).catch(() => {});
  return n;
}
