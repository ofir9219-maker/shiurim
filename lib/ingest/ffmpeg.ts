import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let bin: string | null = null;
export async function ffmpegBin(): Promise<string> {
  if (bin) return bin;
  if (process.env.FFMPEG_PATH) return (bin = process.env.FFMPEG_PATH);
  try {
    const m = (await import("ffmpeg-static")) as { default?: string | null };
    if (m.default && fs.existsSync(m.default)) return (bin = m.default);
  } catch { /* fall through */ }
  return (bin = "ffmpeg");
}
function run(args: string[]): Promise<{ code: number; err: string }> {
  return ffmpegBin().then((b) => new Promise((res, rej) => {
    const p = spawn(b, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
    p.on("error", rej); p.on("close", (code) => res({ code: code ?? 1, err }));
  }));
}
export const parseDuration = (stderr: string): number | null => {
  const m = stderr.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
  return m ? Math.round((Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000) : null;
};
/** An error retrying cannot fix (e.g. the file in Drive is empty): the item is marked failed at once. */
export class PermanentError extends Error {}
export async function durationMs(file: string): Promise<number> {
  let size = -1; try { size = fs.statSync(file).size; } catch { /* run() below reports it */ }
  if (size === 0) throw new PermanentError("el archivo de audio está vacío en Drive (0 bytes); súbelo de nuevo");
  const { err } = await run(["-hide_banner", "-i", file]);
  const d = parseDuration(err);
  if (d === null) throw new Error(`no se pudo leer la duración de ${path.basename(file)}`);
  return d;
}
export type AudioPart = { part: number; path: string; offsetMs: number; durationMs: number; size: number };
/** Split into mono mp3 parts of <= segmentSec (19 min), as scripts/split-wave.sh. */
export async function splitAudio(src: string, outDir: string, segmentSec = 1140): Promise<AudioPart[]> {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) if (/^part\d+\.mp3$/.test(f)) fs.unlinkSync(path.join(outDir, f));
  const { code, err } = await run(["-v", "error", "-y", "-i", src, "-vn", "-ac", "1", "-ar", "22050", "-b:a", "48k", "-f", "segment",
    "-segment_time", String(segmentSec), "-reset_timestamps", "1", path.join(outDir, "part%02d.mp3")]);
  if (code !== 0) throw new Error(`ffmpeg split failed: ${err.slice(-400)}`);
  const files = fs.readdirSync(outDir).filter((f) => /^part\d+\.mp3$/.test(f)).sort();
  if (!files.length) throw new Error("ffmpeg produced no parts");
  const parts: AudioPart[] = []; let off = 0;
  for (const f of files) {
    const p = path.join(outDir, f); const d = await durationMs(p);
    parts.push({ part: Number(f.slice(4, 6)), path: p, offsetMs: off, durationMs: d, size: fs.statSync(p).size }); off += d;
  }
  return parts;
}
/** Cut [startMs,endMs] to a mono mp3 clip (cut-gaps.sh). */
export async function cutClip(src: string, startMs: number, endMs: number, dest: string): Promise<string> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const { code, err } = await run(["-v", "error", "-y", "-ss", String(startMs / 1000), "-to", String(endMs / 1000), "-i", src, "-vn", "-ac", "1", "-ar", "22050", "-b:a", "48k", dest]);
  if (code !== 0) throw new Error(`ffmpeg cut failed: ${err.slice(-400)}`);
  return dest;
}
