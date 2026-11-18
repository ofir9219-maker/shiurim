import fs from "node:fs";
import path from "node:path";
import { STORAGE_DATA, WORK_DIR } from "../storage";

/** Remove the cached pipeline artifacts of one audio so it is processed from scratch (Drive files and audio are untouched). */
export function clearArtifacts(id: string) {
  for (const d of ["raw", "segments", "polished", "gapfill", "gapfill-raw", "gaps", "md-out"]) {
    for (const ext of [".json", ".md"]) { try { fs.rmSync(path.join(STORAGE_DATA, d, `${id}${ext}`), { force: true }); } catch { /* ignore */ } }
  }
  fs.rmSync(path.join(WORK_DIR, id), { recursive: true, force: true });
}
