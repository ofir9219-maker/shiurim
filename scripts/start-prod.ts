// Production start: build the SQLite DB on the persistent volume (repo data/ + $STORAGE_DIR/data), then `next start`.
// Embeddings are reused by chunk hash, so restarts only embed new chunks.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const storage = path.resolve(process.env.STORAGE_DIR || "storage");
fs.mkdirSync(path.join(storage, "data"), { recursive: true });
if (process.env.STORAGE_DIR && !process.env.DB_PATH) process.env.DB_PATH = path.join(storage, "shiurim.db");
console.log(`start: STORAGE_DIR=${storage} DB_PATH=${process.env.DB_PATH || "data/shiurim.db"}`);

// Disk hygiene on the volume: report what uses space, drop the old ingest work dir, and if the volume is nearly
// full remove the SQLite files (fully rebuilt below from repo + $STORAGE_DIR/data; embeddings are re-created).
function duMB(p: string): number {
  try {
    const st = fs.lstatSync(p);
    if (!st.isDirectory()) return st.size / 1048576;
    return fs.readdirSync(p).reduce((a, f) => a + duMB(path.join(p, f)), 0);
  } catch { return 0; }
}
function freeMB(p: string): number { try { const s = fs.statfsSync(p); return (s.bavail * s.bsize) / 1048576; } catch { return Infinity; } }
try { fs.rmSync(path.join(storage, "work"), { recursive: true, force: true }); } catch { /* ignore */ }
try {
  const usage = fs.readdirSync(storage).map((f) => [f, duMB(path.join(storage, f))] as const).sort((a, b) => b[1] - a[1]);
  console.log(`start: volume free ${freeMB(storage).toFixed(0)} MB; usage: ${usage.map(([f, m]) => `${f}=${m.toFixed(1)}MB`).join(", ")}`);
} catch { /* ignore */ }
if (process.env.DB_PATH && freeMB(storage) < 200) {
  for (const sfx of ["", "-wal", "-shm", "-journal"]) { try { fs.rmSync(process.env.DB_PATH + sfx, { force: true }); } catch { /* ignore */ } }
  console.log(`start: volume almost full -> removed ${process.env.DB_PATH}* (rebuilding); free now ${freeMB(storage).toFixed(0)} MB`);
}

const tsx = ["--import", "tsx", "scripts/build-db.ts"];
const run = (extra: string[]) => spawnSync(process.execPath, [...tsx, ...extra], { stdio: "inherit", env: process.env }).status === 0;
if (process.env.OPENAI_API_KEY) {
  if (!run(["--embed"])) { console.log("start: build-db --embed failed; rebuilding without embeddings"); run([]); }
} else run([]);

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start", "-p", process.env.PORT || "3000"], { stdio: "inherit", env: process.env });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
