// Background scheduler: polls the Drive folder, queues stable new audios, runs the pipeline one item at a time.
import fs from "node:fs";
import path from "node:path";
import { INGEST_DIR, LEGACY_WORK_DIR, WORK_DIR, allInventory } from "../storage";
import * as drive from "./drive";
import { berajotCollection, listCollections, resolveSettings } from "../center/collections";
import { NO_COLLECTION, ancestorPath, jobCfg, walkAudio, type Candidate } from "../center/jobs";
import { parseOrder, nextOrder, splitExt } from "./naming";
import { clearArtifacts } from "./artifacts";
import * as zone from "../zone/jobs";
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
  nextPkgScanAt = 0;
  timer: NodeJS.Timeout | null = null;
  started = false;
  retryTimer: NodeJS.Timeout | null = null;

  // Never let a failed write (e.g. disk full) crash the queue: log it and keep going.
  persist = () => { try { saveState(this.state); } catch (e) { log(`no se pudo guardar el estado: ${(e as Error).message}`); } };

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
    // failures caused by a full disk are not the file's fault: retry them from scratch once space is back
    for (const it of Object.values(this.state.items)) {
      if (it.state !== "indexed" && (it.status === "failed" || it.status === "queued") && /ENOSPC|no space left|disk is full|SQLITE_FULL|HTTP 410|deprecated/i.test(it.error ?? "")) {
        retryItem(it); addLog(it, /410|deprecated/i.test(it.error ?? "") ? "reintento automático: el modelo retirado por Fal se reemplazó por Wizper" : "reintento automático: el error fue falta de espacio en disco");
      }
    }
    this.persist();
    this.nextPollAt = Date.now() + 15_000;
    this.timer = setInterval(() => void this.tick().catch((e) => log(`tick: ${(e as Error).message}`)), 20_000);
    this.timer.unref?.();
    try { fs.rmSync(LEGACY_WORK_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    this.persist();
    log(`scheduler iniciado (poll cada ${pollMinutes()} min, drive ${drive.driveConnected() ? "conectado" : "NO conectado"})`);
    try { this.diagnose(); } catch (e) { log(`diagnóstico: ${(e as Error).message}`); }
  }

  /** One-line-per-series summary in the server log: items by state/status, AI-zone jobs, whether the series is published. */
  diagnose() {
    const cols = new Map(listCollections().map((c) => [c.folderId, c]));
    const by = new Map<string, Record<string, number>>();
    for (const it of Object.values(this.state.items)) {
      const k = it.collectionId ?? "?"; const r = by.get(k) ?? {}; const key = `${it.state}/${it.status}`; r[key] = (r[key] ?? 0) + 1; by.set(k, r);
    }
    const jobs = new Map<string, Record<string, number>>();
    for (const j of zone.loadJobs()) { const it = this.state.items[j.audioId]; const k = it?.collectionId ?? "?"; const r = jobs.get(k) ?? {}; const st = zone.statusOf(j) + (j.status === "received" && !j.appliedAt ? "(sin aplicar)" : ""); r[st] = (r[st] ?? 0) + 1; jobs.set(k, r); }
    for (const k of new Set([...by.keys(), ...jobs.keys()])) {
      const c = cols.get(k);
      log(`diagnóstico serie «${c?.name ?? k}» publicada=${c ? (c.published ? "sí" : "NO") : "?"} items=${JSON.stringify(by.get(k) ?? {})} zonaIA=${JSON.stringify(jobs.get(k) ?? {})}`);
    }
  }

  private async tick() {
    try { fs.writeFileSync(LOCK(), JSON.stringify({ pid: process.pid, at: Date.now() })); } catch { /* ignore */ }
    if (Date.now() >= this.nextPollAt && !this.checking) await this.poll().catch(() => {});
    zone.sweepLeases(); await zone.applyPending().catch(() => {});
    if (Date.now() >= this.nextPkgScanAt && zone.hasDriveJobs()) {
      this.nextPkgScanAt = Date.now() + 2 * 60_000; await zone.scanDrive().catch((e) => log(`scan de la Zona IA falló: ${(e as Error).message}`));
    }
    await this.work().catch((e) => log(`cola: ${(e as Error).message}`));
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
      fileDate: f.modifiedTime, durationMs: f.videoMediaMetadata?.durationMillis ? Number(f.videoMediaMetadata.durationMillis) : undefined });
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
        clearArtifacts(ex.id); zone.supersede(ex.id);
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
    // Oldest runnable item first; failed items wait for their backoff (nextAttemptAt), so the rest of the queue keeps moving.
    const it = Object.values(this.state.items).filter((i) => isRunnable(i)).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!it) return;
    this.running = it.id;
    try { await runItem(it, makeSteps({ state: this.state, persist: this.persist, log }), this.persist, log); }
    catch (e) { log(`error inesperado en ${it.id}: ${(e as Error).message}`); }
    finally {
      // Free temporary space whenever the item is not done (done items already clean up), so a failure never fills the disk.
      if (it.status !== "done") { try { fs.rmSync(path.join(WORK_DIR, it.id), { recursive: true, force: true }); } catch { /* ignore */ } }
      this.running = null;
      setTimeout(() => void this.work().catch((e) => log(`cola: ${(e as Error).message}`)), 1000);
    }
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
