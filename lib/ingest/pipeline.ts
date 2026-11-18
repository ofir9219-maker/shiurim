// The real steps of the ingestion state machine. Every step is idempotent and resumable (artifacts are cached on disk).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { dataPath, readJson, writeJson, WORK_DIR, storageInventory, type InvItem } from "../storage";
import { getR2Client, r2Bucket } from "../audio";
import { CT_BY_EXT, extOf, r2ObjectKey, existingKeys } from "../r2-sync";
import * as drive from "./drive";
import { falTranscribe, FAL_ENDPOINT } from "./fal";
import { cutClip, durationMs, splitAudio } from "./ffmpeg";
import { publicUrl, r2DeletePrefix, r2Put, r2Size } from "./r2";
import { openaiJson } from "./openai";
import { sefariaText } from "./sefaria";
import { polishClass, type Cache, type Meta } from "./polish";
import { polishedToMd } from "./md";
import { findGaps, findHollow, gapClipToSegments, mergeFinal, rawToSegments, type Gap, type RawDoc, type Seg } from "./segments";
import { addLog, type Item, type State } from "./state";
import type { Steps } from "./runner";

export type Ctx = { state: State; persist: () => void; log: (m: string) => void };
const workDir = (id: string) => path.join(WORK_DIR, id);
const norm = (s: string) => s.normalize("NFC").trim();
const baseName = (n: string) => norm(n.replace(/\.[A-Za-z0-9]{2,4}$/, ""));

async function ensureSource(it: Item): Promise<string> {
  const p = path.join(workDir(it.id), `src${it.ext || ".bin"}`);
  if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
  await drive.downloadToFile(it.id, p);
  return p;
}
const addUsage = (c: Ctx, it: Item, p: number, o: number) => {
  it.cost.promptTokens += p; it.cost.completionTokens += o; c.state.totals.promptTokens += p; c.state.totals.completionTokens += o; c.persist();
};
const addFal = (c: Ctx, it: Item, ms: number) => { it.cost.falMinutes += ms / 60000; c.state.totals.falMinutes += ms / 60000; c.persist(); };

async function stepUpload(c: Ctx, it: Item) {
  const src = await ensureSource(it);
  it.durationMs = await durationMs(src);
  const key = r2ObjectKey(it); const size = fs.statSync(src).size;
  if ((await r2Size(key)) !== size) { addLog(it, `subiendo a R2 ${key} (${(size / 1e6).toFixed(1)} MB)`); await r2Put(key, src, CT_BY_EXT[extOf(it)]); }
  it.r2Key = key; c.persist();
}

async function transcribeClip(c: Ctx, it: Item, file: string, key: string, label: string, cacheFile: string, ms: number) {
  const hit = readJson<unknown>(cacheFile, null);
  if (hit) return hit as import("./segments").ScribeResult;
  await r2Put(key, file, "audio/mpeg");
  const res = await falTranscribe(publicUrl(key), label);
  writeJson(cacheFile, res, undefined, 0);
  addFal(c, it, ms);
  return res;
}

async function stepTranscribe(c: Ctx, it: Item) {
  const rawFile = dataPath("raw", `${it.id}.json`), dir = workDir(it.id);
  let raw = readJson<RawDoc | null>(rawFile, null);
  let src: string | null = null;
  if (!raw) {
    src = await ensureSource(it);
    const parts = await splitAudio(src, path.join(dir, "parts"));
    addLog(it, `${parts.length} parte(s) de audio para Scribe`);
    const done: RawDoc["parts"] = [];
    for (const p of parts) {
      const nn = String(p.part).padStart(2, "0");
      const result = await transcribeClip(c, it, p.path, `tmp/${it.id}/part${nn}.mp3`, `${it.order} parte ${nn}`, path.join(dir, `fal-${nn}.json`), p.durationMs);
      done.push({ part: p.part, offsetMs: p.offsetMs, durationMs: p.durationMs, result });
      addLog(it, `Scribe parte ${nn}/${parts.length} lista (${result.words.length} palabras)`); c.persist();
    }
    raw = { model: FAL_ENDPOINT, parts: done };
    writeJson(rawFile, raw, undefined, 0); // raw, untouched
  }
  const segments = rawToSegments(raw);
  if (!segments.length) throw new Error("Scribe no devolvió texto");
  writeJson(dataPath("segments", `${it.id}.json`), { source: "fal", model: FAL_ENDPOINT, segments }, undefined, 0);
  // Gap / hollow recovery (find-gaps.py + gaps-to-segments.py)
  const dur = it.durationMs ?? raw.parts.reduce((a, p) => a + p.durationMs, 0);
  const gaps: Gap[] = [...findGaps(segments, dur), ...findHollow(segments)];
  writeJson(dataPath("gaps", `${it.id}.json`), gaps);
  const extra: Seg[] = [];
  if (gaps.length) {
    addLog(it, `${gaps.length} hueco(s)/segmento(s) vacío(s) para recuperar`);
    src ??= await ensureSource(it);
    const MAXW = 19 * 60_000;
    for (const g of gaps) {
      for (let s = g.startMs; s < g.endMs; s += MAXW) {
        const e = Math.min(g.endMs, s + MAXW);
        if (e - s < 2000) continue;
        const clip = path.join(dir, `gap${g.startMs}_${s}.mp3`);
        if (!fs.existsSync(clip)) await cutClip(src, s, e, clip);
        const res = await transcribeClip(c, it, clip, `tmp/${it.id}/gap${g.startMs}_${s}.mp3`, `${it.order} hueco ${s}`, dataPath("fal-results-gaps", `${it.id}_g${s}.json`), e - s);
        extra.push(...gapClipToSegments(res, s, segments, g.hollow ? g.startMs : undefined));
      }
    }
    extra.sort((a, b) => a.startMs - b.startMs);
  }
  writeJson(dataPath("gapfill-raw", `${it.id}.json`), extra);
  const hollow = gaps.filter((g) => g.hollow).map((g) => ({ id: it.id, order: it.order, startMs: g.startMs, endMs: g.endMs, hollow: true, chars: g.chars }));
  const hf = dataPath("gaps-hollow.json");
  writeJson(hf, [...readJson<{ id: string }[]>(hf, []).filter((h) => h.id !== it.id), ...hollow]);
  await r2DeletePrefix(`tmp/${it.id}/`).catch(() => {});
  addLog(it, `${segments.length} segmentos, ${extra.length} recuperados de huecos`);
}

function fileCache(file: string): Cache {
  let m: Record<string, unknown> = readJson(file, {});
  return { get: <T,>(k: string) => m[k] as T | undefined, set: (k, v) => { m[k] = v; writeJson(file, m, undefined, 0); } };
}

async function stepPolish(c: Ctx, it: Item) {
  const segments = readJson<{ segments: Seg[] }>(dataPath("segments", `${it.id}.json`), { segments: [] }).segments;
  const gapSegments = readJson<Seg[]>(dataPath("gapfill-raw", `${it.id}.json`), []);
  const r = await polishClass({ segments, gapSegments, inv: { name: it.name, order: it.order, ext: it.ext } }, {
    llm: openaiJson, sefaria: sefariaText, cache: fileCache(path.join(workDir(it.id), "polish-cache.json")),
    onUsage: (u) => addUsage(c, it, u.promptTokens, u.completionTokens), log: (m) => { addLog(it, m); c.persist(); },
  });
  writeJson(dataPath("polished", `${it.id}.json`), { id: it.id, segments: r.polished, ...r.meta }, undefined, 0);
  writeJson(dataPath("gapfill", `${it.id}.json`), r.gapPolished, undefined, 0);
  it.newName = r.meta.newName; it.title = r.meta.title; it.needsReview = r.meta.needsReview; it.dafNote = r.meta.dafNote;
  addLog(it, `título: ${r.meta.newName}${r.meta.needsReview ? " (needsReview: >20% [inaudible])" : ""}`);
}

function logRename(e: { id: string; kind: "audio" | "md"; oldName: string; newName: string }) {
  const f = dataPath("rename-log.json");
  const log = readJson<{ id: string; kind: string; newName: string }[]>(f, []);
  if (log.some((x) => x.id === e.id && x.kind === e.kind && x.newName === e.newName)) return;
  writeJson(f, [...log, { ...e, at: new Date().toISOString() }]);
}

async function stepRename(c: Ctx, it: Item) {
  const pol = readJson<{ title: string; newName: string; daf: { daf: string; amud: string }[]; summary: string; tags: string[]; segments: Seg[] } | null>(dataPath("polished", `${it.id}.json`), null);
  if (!pol) throw new Error("falta polished json");
  const gap = readJson<Seg[]>(dataPath("gapfill", `${it.id}.json`), []);
  const hollow = new Set(readJson<{ id: string; startMs: number }[]>(dataPath("gaps-hollow.json"), []).filter((h) => h.id === it.id).map((h) => h.startMs));
  const md = polishedToMd({ ...pol, segments: mergeFinal(pol.segments, gap, hollow) });
  fs.mkdirSync(dataPath("md-out"), { recursive: true }); fs.writeFileSync(dataPath("md-out", `${it.id}.md`), md);
  const folder = drive.FOLDER_ID();
  // audio
  const meta = await drive.getMeta(it.id);
  if (meta.name !== pol.newName) { await drive.renameFile(it.id, pol.newName); addLog(it, `audio renombrado en Drive`); }
  logRename({ id: it.id, kind: "audio", oldName: it.name, newName: pol.newName });
  // markdown
  const mdName = `${pol.title}.md`;
  if (it.mdId) { await drive.renameFile(it.mdId, mdName).catch(() => {}); }
  else {
    const files = await drive.listFolder(folder);
    const old = files.find((f) => f.name.toLowerCase().endsWith(".md") && baseName(f.name) === baseName(it.name));
    if (old) { await drive.renameFile(old.id, mdName); it.mdId = old.id; addLog(it, "md existente renombrado"); logRename({ id: old.id, kind: "md", oldName: old.name, newName: mdName }); }
    else { it.mdId = await drive.createTextFile(folder, mdName, md); addLog(it, "md creado en Drive"); logRename({ id: it.mdId, kind: "md", oldName: "", newName: mdName }); }
  }
  c.persist();
}

let building: Promise<void> | null = null;
/** Rebuild the DB with build-db (incremental for embeddings: unchanged chunks keep theirs). */
export function reindex(log: (m: string) => void): Promise<void> {
  building ??= new Promise<void>((res, rej) => {
    const args = ["--import", "tsx", "scripts/build-db.ts", ...(process.env.OPENAI_API_KEY ? ["--embed"] : [])];
    const p = spawn(process.execPath, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; const add = (d: Buffer) => { out = (out + d).slice(-4000); };
    p.stdout.on("data", add); p.stderr.on("data", add);
    p.on("error", rej);
    p.on("close", (code) => { log(`build-db: ${out.trim().split("\n").slice(-3).join(" | ")}`); code === 0 ? res() : rej(new Error(`build-db exit ${code}: ${out.slice(-400)}`)); });
  }).finally(() => { building = null; });
  return building;
}

async function stepIndex(c: Ctx, it: Item) {
  const inv = storageInventory();
  if (!inv.some((x) => x.id === it.id)) {
    const e: InvItem = {
      id: it.id, name: it.name, order: it.order, ext: it.ext, mimeType: it.mimeType, sizeBytes: it.sizeBytes, durationMs: it.durationMs ?? 0,
      mdId: it.mdId ?? null, mdName: it.title ? `${it.title}.md` : null, transcript: "drive_md", inShiurim: false, r2Key: it.r2Key, ingested: true,
    };
    writeJson(dataPath("inventory.json"), [...inv, e]);
  }
  await reindex(c.log);
  if (getR2Client() && r2Bucket()) await existingKeys(true).catch(() => {});
  fs.rmSync(workDir(it.id), { recursive: true, force: true });
}

export function makeSteps(c: Ctx): Steps {
  return {
    detected: (it) => stepUpload(c, it), uploaded: (it) => stepTranscribe(c, it), transcribed: (it) => stepPolish(c, it),
    polished: (it) => stepRename(c, it), renamed: (it) => stepIndex(c, it),
  };
}
export type { Meta };
