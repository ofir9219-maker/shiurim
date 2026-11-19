// Audio duration on demand: ffmpeg reads the Drive file by URL (bearer header) and prints its Duration; cached on the volume.
import { spawn } from "node:child_process";
import path from "node:path";
import { STORAGE_DIR, readJson, writeJson } from "../storage";
import { ffmpegBin, parseDuration } from "../ingest/ffmpeg";
import * as drive from "../ingest/drive";

const F = () => path.join(STORAGE_DIR, "center", "durations.json");
export const cachedDuration = (id: string): number | null => readJson<Record<string, number>>(F(), {})[id] ?? null;
export const cachedDurations = () => readJson<Record<string, number>>(F(), {});
export function saveDuration(id: string, ms: number) { const m = readJson<Record<string, number>>(F(), {}); m[id] = ms; writeJson(F(), m); }

export async function probeDuration(id: string): Promise<number> {
  const hit = cachedDuration(id); if (hit) return hit;
  const tok = await drive.bearer();
  const bin = await ffmpegBin();
  const err = await new Promise<string>((res, rej) => {
    const p = spawn(bin, ["-hide_banner", "-headers", `Authorization: Bearer ${tok}\r\n`, "-i", drive.mediaUrl(id)], { stdio: ["ignore", "ignore", "pipe"] });
    let out = ""; const t = setTimeout(() => p.kill("SIGKILL"), 60_000);
    p.stderr.on("data", (d) => { out += d; if (parseDuration(out) !== null) { clearTimeout(t); p.kill("SIGKILL"); } });
    p.on("error", rej); p.on("close", () => { clearTimeout(t); res(out); });
  });
  const d = parseDuration(err);
  if (d === null) throw new Error("no se pudo leer la duración");
  saveDuration(id, d); return d;
}
