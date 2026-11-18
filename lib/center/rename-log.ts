// Rename log (data/rename-log.json) with batches per audio so a rename of audio + .md + .json can be undone together.
import { dataPath, readJson, writeJson } from "../storage";

export type RenameEntry = { id: string; kind: "audio" | "md" | "json"; oldName: string; newName: string; at: string; audioId?: string; batch?: string; undoneAt?: string };
const F = () => dataPath("rename-log.json");
export const readRenameLog = () => readJson<RenameEntry[]>(F(), []);
export function logRename(e: Omit<RenameEntry, "at">) {
  const log = readRenameLog();
  if (log.some((x) => x.id === e.id && x.kind === e.kind && x.newName === e.newName && x.batch === e.batch)) return;
  writeJson(F(), [...log, { ...e, at: new Date().toISOString() }]);
}
/** Latest not-undone batch of renames (with a real previous name) of an audio. */
export function lastBatch(audioId: string, log: RenameEntry[] = readRenameLog()): RenameEntry[] {
  const mine = log.filter((e) => e.audioId === audioId && e.batch);
  const batches = [...new Set(mine.map((e) => e.batch!))].sort();
  for (let i = batches.length - 1; i >= 0; i--) {
    const b = mine.filter((e) => e.batch === batches[i]);
    if (b.some((e) => !e.undoneAt && e.oldName)) return b;
    if (b.some((e) => e.undoneAt)) return []; // the newest batch was already undone
  }
  return [];
}
export function markUndone(batch: string, audioId: string) {
  const at = new Date().toISOString();
  writeJson(F(), readRenameLog().map((e) => (e.batch === batch && e.audioId === audioId ? { ...e, undoneAt: at } : e)));
}
export const hasUndoable = (audioId: string) => lastBatch(audioId).some((e) => !e.undoneAt && e.oldName);
/** Audio ids whose latest rename can be undone. */
export function undoableSet(): Set<string> {
  const log = readRenameLog(); const out = new Set<string>();
  for (const id of new Set(log.filter((e) => e.audioId).map((e) => e.audioId!))) if (lastBatch(id, log).some((e) => !e.undoneAt && e.oldName)) out.add(id);
  return out;
}
