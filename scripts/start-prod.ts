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

const tsx = ["--import", "tsx", "scripts/build-db.ts"];
const run = (extra: string[]) => spawnSync(process.execPath, [...tsx, ...extra], { stdio: "inherit", env: process.env }).status === 0;
if (process.env.OPENAI_API_KEY) {
  if (!run(["--embed"])) { console.log("start: build-db --embed failed; rebuilding without embeddings"); run([]); }
} else run([]);

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [next, "start", "-p", process.env.PORT || "3000"], { stdio: "inherit", env: process.env });
for (const sig of ["SIGTERM", "SIGINT"] as const) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));
