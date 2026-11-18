// "Deshacer renombrado": restores the previous names of the audio, .md and .json of the latest rename batch.
import * as drive from "../ingest/drive";
import { scheduler } from "../ingest/scheduler";
import { reindex } from "../ingest/pipeline";
import { dataPath, readJson, writeJson } from "../storage";
import { invalidateChildren } from "./jobs";
import { baseOf } from "./outputs";
import { lastBatch, markUndone } from "./rename-log";

export async function undoRename(audioId: string): Promise<{ restored: { kind: string; from: string; to: string }[] }> {
  const whole = lastBatch(audioId).filter((e) => !e.undoneAt);
  const batch = whole.filter((e) => e.oldName);
  if (!batch.length) throw new Error("No hay un renombrado para deshacer");
  const restored: { kind: string; from: string; to: string }[] = [];
  for (const e of [...batch].reverse()) { await drive.renameFile(e.id, e.oldName); restored.push({ kind: e.kind, from: e.newName, to: e.oldName }); }
  const audio = batch.find((e) => e.kind === "audio");
  // companions created under the new name (no previous name) follow the audio back to its old base name
  if (audio) for (const e of whole.filter((x) => x.kind !== "audio" && !x.oldName)) {
    const to = `${baseOf(audio.oldName)}.${e.kind}`; await drive.renameFile(e.id, to); restored.push({ kind: e.kind, from: e.newName, to });
  }
  markUndone(batch[0].batch!, audioId);
  const s = scheduler(); const it = s.state.items[audioId];
  if (audio) {
    const pf = dataPath("polished", `${audioId}.json`); const pol = readJson<Record<string, unknown> | null>(pf, null);
    if (pol) writeJson(pf, { ...pol, title: baseOf(audio.oldName), newName: audio.oldName }, undefined, 0);
    const invf = dataPath("inventory.json"); const inv = readJson<{ id: string; name: string }[]>(invf, []);
    if (inv.some((x) => x.id === audioId)) writeJson(invf, inv.map((x) => (x.id === audioId ? { ...x, name: audio.oldName } : x)));
    if (it) { it.newName = audio.oldName; it.title = baseOf(audio.oldName); }
  }
  if (it) { const { addLog } = await import("../ingest/state"); addLog(it, `renombrado deshecho: ${restored.map((r) => `${r.from} → ${r.to}`).join("; ")}`); s.persist(); }
  if (it?.parentId) invalidateChildren(it.parentId);
  if (it?.cfg?.published) void reindex(() => {}).catch(() => {});
  return { restored };
}
