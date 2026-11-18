// Background scheduler: polls the Drive folder, queues stable new audios, runs the pipeline one item at a time.
import fs from "node:fs";
import path from "node:path";
import { INGEST_DIR, allInventory } from "../storage";
import * as drive from "./drive";
import { berajotCollection, listCollections, resolveSettings } from "../center/collections";
import { NO_COLLECTION, ancestorPath, jobCfg, walkAudio, type Candidate } from "../center/jobs";
import { parseOrder, nextOrder, splitExt } from "./naming";
import { clearArtifacts } from "./artifacts";
import { makeSteps } from "./pipeline";
import { runItem } from "./runner";
import { isRunnable, loadState, newItem, observeFile, retryItem, saveState, addLog, type Item, type State } from "./state";

const g = globalThis as unknown as { __ingest?: Scheduler };
const LOCK = () => path.join(INGEST_DIR, "ingest.lock");
const log = (m: string) => console.log(`ingest: ${m}`);
export const pollMinutes = () => Math.max(1, Number(process.env.INGEST_POLL_MINUTES || 10));

class Scheduler {
  state: State = loadState();
  running: string | null = null;
  checking = false;
  nextPollAt = 0;
  timer: NodeJS.Timeout | null = null;
  started = false;
  retryTimer: NodeJS.Timeout | null = null;

  persist = () => saveState(this.state);

  /** Single-instance guard across processes sharing the volume (heartbeat lock). */
  private lock(): boolean {
    try {
      fs.mkdirSync(INGEST_DIR, { recursive: true });
      const f = LOCK();
      try { const j = JSON.parse(fs.readFileSync(f, "utf8")) as { pid: number; at: number }; if (j.pid !== process.pid && Date.now() - j.at < 3 * 60_000) return false; } catch { /* no lock */ }
      fs.writeFileSync(f, JSON.stringify({ pid: process.pid, at: Date.now() }));
      return true;
    } catch { return true; }
  }

  start() {
    if (this.started) return;
    if (!this.lock()) {
      if (!this.retryTimer) { log("otra instancia mantiene el lock (reinicio reciente); reintento en 30 s"); this.retryTimer = setTimeout(() => { this.retryTimer = null; this.start(); }, 30_000); this.retryTimer.unref?.(); }
      return;
    }
    this.started = true;
    // items interrupted mid-run (restart) go back to the queue
    for (const it of Object.values(this.state.items)) if (it.status === "running") { it.status = "queued"; addLog(it, "reanudado tras reinicio"); }
    this.persist();
    this.nextPollAt = Date.now() + 15_000;
    this.timer = setInterval(() => void this.tick(), 20_000);
    this.timer.unref?.();
    log(`scheduler iniciado (poll cada ${pollMinutes()} min, drive ${drive.driveConnected() ? "conectado" : "NO conectado"})`);
  }

  private async tick() {
    try { fs.writeFileSync(LOCK(), JSON.stringify({ pid: process.pid, at: Date.now() })); } catch { /* ignore */ }
    if (Date.now() >= this.nextPollAt && !this.checking) await this.poll().catch(() => {});
    await this.work();
  }

  /** Auto-sync: every collection whose resolved autoSync is on is walked (recursively, except sub-collections that sync on their own). */
  async poll(): Promise<{ files: number; newFiles: number }> {
    if (this.checking) return { files: 0, newFiles: 0 };
    this.checking = true;
    const s = this.state;
    try {
      if (!drive.driveConnected()) throw new Error("Google Drive no conectado");
      let files = 0, unstable = 0, queued = 0;
      for (const col of listCollections()) {
        const path = await ancestorPath(col.folderId);
        if (!resolveSettings(path).settings.autoSync) continue;
        const cands = await walkAudio(col.folderId, path, { skipCollections: true });
        files += cands.length;
        const known = new Set([...allInventory().map((i) => i.id), ...Object.keys(s.items)]);
        for (const cand of cands) {
          const f = cand.file;
          if (known.has(f.id)) { delete s.seen[f.id]; continue; }
          if (cand.hasJson) continue; // already has our <name>.json next to it
          const size = Number(f.size || 0);
          if (!size || !observeFile(s.seen, f.id, size)) { unstable++; continue; }
          const it = this.makeItem(cand);
          addLog(it, `detectado: ${f.name} (${(size / 1e6).toFixed(1)} MB), orden ${it.order}, serie ${it.cfg?.collectionName}`);
          s.items[f.id] = it; delete s.seen[f.id]; queued++;
          log(`nuevo audio ${f.name} -> ${f.id}`);
        }
      }
      s.lastPoll = { at: new Date().toISOString(), ok: true, files, newFiles: queued };
      // re-check soon while uploads are in progress
      this.nextPollAt = Date.now() + (unstable ? 90_000 : pollMinutes() * 60_000);
      this.persist();
      return { files, newFiles: queued };
    } catch (e) {
      s.lastPoll = { at: new Date().toISOString(), ok: false, files: 0, newFiles: 0, error: (e as Error).message };
      this.nextPollAt = Date.now() + pollMinutes() * 60_000;
      this.persist(); log(`poll falló: ${(e as Error).message}`);
      throw e;
    } finally { this.checking = false; }
  }

  makeItem(cand: Candidate): Item {
    const f = cand.file, s = this.state;
    const res = resolveSettings(cand.path);
    const collectionId = res.collection?.folderId ?? NO_COLLECTION;
    const inv = allInventory().filter((i) => (i.collectionId ?? berajotCollection().folderId) === collectionId).map((i) => i.order);
    const mine = Object.values(s.items).filter((i) => (i.collectionId ?? berajotCollection().folderId) === collectionId).map((i) => i.order);
    const order = parseOrder(f.name) ?? nextOrder([...inv, ...mine]);
    const it = newItem({ id: f.id, name: f.name, ext: splitExt(f.name).ext, mimeType: f.mimeType, sizeBytes: Number(f.size || 0), order, collectionId, parentId: cand.parentId, cfg: jobCfg(res),
      durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : undefined });
    return it;
  }

  /** Manual enqueue from the Drive browser. `force` re-runs files that are done or failed (artifacts are cleared; the audio is never deleted). */
  enqueue(cands: Candidate[], force = true): { queued: number; skipped: number } {
    let queued = 0, skipped = 0;
    for (const cand of cands) {
      const ex = this.state.items[cand.file.id];
      if (ex && (ex.status === "running" || (ex.status === "queued" && !force))) { skipped++; continue; }
      if (ex && !force) { skipped++; continue; }
      const it = this.makeItem(cand);
      if (ex) { // keep history and cumulative costs
        it.log = ex.log; it.cost = ex.cost; it.createdAt = ex.createdAt; it.mdId = ex.mdId; it.jsonId = ex.jsonId;
        clearArtifacts(ex.id);
        addLog(it, "reencolado manualmente");
      } else addLog(it, `en cola desde el explorador: ${cand.file.name}`);
      it.manual = true;
      this.state.items[it.id] = it; queued++;
    }
    this.persist(); void this.work();
    return { queued, skipped };
  }
  /** Remove a queued (not running) job from the queue. */
  cancel(id: string): boolean {
    const it = this.state.items[id];
    if (!it || it.status === "running") return false;
    if (it.state === "detected" || it.status !== "done") { delete this.state.items[id]; this.persist(); return true; }
    return false;
  }

  async work() {
    if (this.running) return;
    const it = Object.values(this.state.items).filter((i) => isRunnable(i)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!it) return;
    this.running = it.id;
    try { await runItem(it, makeSteps({ state: this.state, persist: this.persist, log }), this.persist, log); }
    finally { this.running = null; }
  }

  retry(id: string) { const it = this.state.items[id]; if (it && it.state !== "indexed") { retryItem(it); addLog(it, "reintento manual"); this.persist(); void this.work(); } }
  /** "Revisar ahora": poll immediately and start working. A new file is accepted after 2 polls, so poll twice 5 s apart when something is unstable. */
  async checkNow() {
    const r = await this.poll();
    if (Object.keys(this.state.seen).length) { await new Promise((r2) => setTimeout(r2, 5000)); const r2 = await this.poll(); r.newFiles += r2.newFiles; }
    void this.work();
    return r;
  }
}

export function scheduler(): Scheduler { return (g.__ingest ??= new Scheduler()); }
export function startIngest() {
  if (process.env.INGEST_ENABLED === "0") return;
  scheduler().start();
}
