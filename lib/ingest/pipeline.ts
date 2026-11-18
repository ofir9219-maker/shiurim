// The real steps of the ingestion state machine. Every step is idempotent and resumable (artifacts are cached on disk).
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { dataPath, readJson, writeJson, WORK_DIR, storageInventory, repoInventory, type InvItem } from "../storage";
import { berajotCollection } from "../center/collections";
import { getR2Client, r2Bucket } from "../audio";
import { CT_BY_EXT, extOf, r2ObjectKey, existingKeys } from "../r2-sync";
import * as drive from "./drive";
import { falTranscribe } from "./fal";
import { modelInfo } from "../center/fal-models";
import { buildTranscriptJson, baseOf, safeName } from "../center/outputs";
import { legacyCfg, invalidateChildren } from "../center/jobs";
import { cleanOriginal, dateOf, seriesKind } from "../center/templates";
import { logRename } from "../center/rename-log";
import type { JobCfg } from "./state";
import { cutClip, durationMs, splitAudio } from "./ffmpeg";
import { publicUrl, r2DeletePrefix, r2Put, r2Size } from "./r2";
import { openaiJsonWith, openaiPrice } from "./openai";
import { sefariaText } from "./sefaria";
import { polishClass, type Cache, type Meta } from "./polish";
import { polishedToMd } from "./md";
import { findGaps, findHollow, gapClipToSegments, mergeFinal, rawToSegments, type Gap, type RawDoc, type Seg } from "./segments";
import { addLog, WaitError, type Item, type State } from "./state";
import * as packages from "../center/packages";
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
export const cfgOf = (it: Item): JobCfg => it.cfg ?? legacyCfg();
const addUsage = (c: Ctx, it: Item, p: number, o: number) => {
  const pr = openaiPrice(cfgOf(it).openaiModel), usd = (p * pr.inM + o * pr.outM) / 1e6;
  it.cost.promptTokens += p; it.cost.completionTokens += o; it.cost.openaiUsd = (it.cost.openaiUsd ?? 0) + usd;
  c.state.totals.promptTokens += p; c.state.totals.completionTokens += o; c.state.totals.openaiUsd = (c.state.totals.openaiUsd ?? 0) + usd; c.persist();
};
const addFal = (c: Ctx, it: Item, ms: number) => {
  const m = modelInfo(cfgOf(it).model), min = ms / 60000;
  const usd = m.usdPerMin ? m.usdPerMin * min : (m.usdPerComputeSec ?? 0) * (m.computeSecPerAudioMin ?? 0) * min;
  it.cost.falMinutes += min; it.cost.falUsd = (it.cost.falUsd ?? 0) + usd;
  c.state.totals.falMinutes += min; c.state.totals.falUsd = (c.state.totals.falUsd ?? 0) + usd; c.persist();
};
const BERAJOT_ID = () => berajotCollection().folderId;
export const parentOf = (it: Item) => it.parentId ?? drive.FOLDER_ID();

async function stepUpload(c: Ctx, it: Item) {
  const src = await ensureSource(it);
  it.durationMs = await durationMs(src);
  const key = r2ObjectKey(it); const size = fs.statSync(src).size;
  if (!cfgOf(it).published) { c.persist(); return; } // unpublished series: the original is not mirrored to R2 (Fal parts still are)
  if ((await r2Size(key)) !== size) { addLog(it, `subiendo a R2 ${key} (${(size / 1e6).toFixed(1)} MB)`); await r2Put(key, src, CT_BY_EXT[extOf(it)]); }
  it.r2Key = key; c.persist();
}

async function transcribeClip(c: Ctx, it: Item, file: string, key: string, label: string, cacheFile: string, ms: number) {
  const hit = readJson<unknown>(cacheFile, null);
  if (hit) return hit as import("./segments").ScribeResult;
  await r2Put(key, file, "audio/mpeg");
  const cfg = cfgOf(it);
  const res = await falTranscribe(publicUrl(key), label, { model: cfg.model, language: cfg.language });
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
    const parts = await splitAudio(src, path.join(dir, "parts"), modelInfo(cfgOf(it).model).splitSec);
    addLog(it, `${parts.length} parte(s) de audio para ${cfgOf(it).model}`);
    const done: RawDoc["parts"] = [];
    for (const p of parts) {
      const nn = String(p.part).padStart(2, "0");
      const result = await transcribeClip(c, it, p.path, `tmp/${it.id}/part${nn}.mp3`, `${it.order} parte ${nn}`, path.join(dir, `fal-${nn}.json`), p.durationMs);
      done.push({ part: p.part, offsetMs: p.offsetMs, durationMs: p.durationMs, result });
      addLog(it, `parte ${nn}/${parts.length} lista (${result.words?.length ?? (result.chunks as unknown[] | undefined)?.length ?? 0} ${result.words ? "palabras" : "segmentos"})`); c.persist();
    }
    raw = { model: cfgOf(it).model, parts: done };
    writeJson(rawFile, raw, undefined, 0); // raw, untouched
  }
  const segments = rawToSegments(raw);
  if (!segments.length) throw new Error("La transcripción no devolvió texto");
  writeJson(dataPath("segments", `${it.id}.json`), { source: "fal", model: raw.model, segments }, undefined, 0);
  // Gap / hollow recovery (find-gaps.py + gaps-to-segments.py)
  const dur = it.durationMs ?? raw.parts.reduce((a, p) => a + p.durationMs, 0);
  const gaps: Gap[] = [...findGaps(segments, dur), ...findHollow(segments)];
  writeJson(dataPath("gaps", `${it.id}.json`), gaps);
  const extra: Seg[] = [];
  if (gaps.length) {
    addLog(it, `${gaps.length} hueco(s)/segmento(s) vacío(s) para recuperar`);
    src ??= await ensureSource(it);
    const MAXW = modelInfo(cfgOf(it).model).splitSec * 1000;
    for (const g of gaps) {
      for (let s = g.startMs; s < g.endMs; s += MAXW) {
        const e = Math.min(g.endMs, s + MAXW);
        if (e - s < 2000) continue;
        const clip = path.join(dir, `gap${g.startMs}_${s}.mp3`);
        if (!fs.existsSync(clip)) await cutClip(src, s, e, clip);
        const res = await transcribeClip(c, it, clip, `tmp/${it.id}/gap${g.startMs}_${s}.mp3`, `${it.order} hueco ${s}`, dataPath("fal-results-gaps", `${it.id}_g${s}.json`), e - s);
        extra.push(...gapClipToSegments(res, s, segments, g.hollow ? g.startMs : undefined, raw.model));
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
  const cfg = cfgOf(it);
  const segments = readJson<{ segments: Seg[] }>(dataPath("segments", `${it.id}.json`), { segments: [] }).segments;
  const gapSegments = readJson<Seg[]>(dataPath("gapfill-raw", `${it.id}.json`), []);
  if (cfg.postprocess === "none") {
    // Raw transcript: stored in the same layout as a polished class so indexing and Drive outputs treat both alike.
    writeJson(dataPath("polished", `${it.id}.json`), { id: it.id, raw: true, segments, title: baseOf(it.name), newName: it.name, summary: "", tags: [], daf: [] }, undefined, 0);
    writeJson(dataPath("gapfill", `${it.id}.json`), gapSegments, undefined, 0);
    it.title = baseOf(it.name); it.newName = it.name;
    addLog(it, "sin pulido (transcripción cruda)");
    return;
  }
  if (cfg.postprocess === "ai_package") {
    // Alternative to OpenAI: write packages next to the audio and wait until a validated result arrives (API, upload page or Drive).
    const done = readJson<{ pkg?: boolean } | null>(dataPath("polished", `${it.id}.json`), null);
    if (done?.pkg) return;
    let pk = packages.activePackages(it.id);
    if (!pk.length) {
      const hollow = new Set(readJson<{ id: string; startMs: number }[]>(dataPath("gaps-hollow.json"), []).filter((h) => h.id === it.id).map((h) => h.startMs));
      pk = await packages.createPackages(it, cfg, mergeFinal(segments, gapSegments, hollow));
      addLog(it, `${pk.length} paquete(s) para IA creados en Drive: ${pk.map((x) => x.fileName).join(", ")}`);
    }
    throw new WaitError(`paquete pendiente: ${pk.map((x) => x.fileName).join(", ")} (esperando el resultado corregido)`);
  }
  const kind = seriesKind(cfg.template);
  const naming = cfg.namingMode === "template" ? { template: cfg.template, fixedObra: cfg.obra || undefined, fecha: dateOf(it.fileDate), original: cleanOriginal(it.name) } : undefined;
  const r = await polishClass({ segments, gapSegments, inv: { name: it.name, order: it.order, ext: it.ext }, keepName: cfg.namingMode === "keep", naming }, {
    kind, allowHebrew: !!cfg.allowHebrew, series: kind === "talmud" && cfg.slug === "berajot" ? undefined : cfg.collectionName,
    llm: openaiJsonWith({ model: cfg.openaiModel, effort: cfg.openaiEffort }), sefaria: sefariaText, cache: fileCache(path.join(workDir(it.id), "polish-cache.json")),
    onUsage: (u) => addUsage(c, it, u.promptTokens, u.completionTokens), log: (m) => { addLog(it, m); c.persist(); },
  });
  writeJson(dataPath("polished", `${it.id}.json`), { id: it.id, segments: r.polished, ...r.meta }, undefined, 0);
  writeJson(dataPath("gapfill", `${it.id}.json`), r.gapPolished, undefined, 0);
  it.newName = r.meta.newName; it.title = r.meta.title; it.needsReview = r.meta.needsReview; it.dafNote = r.meta.dafNote;
  addLog(it, `título: ${r.meta.newName}${r.meta.needsReview ? " (needsReview: >20% [inaudible])" : ""}`);
}

/** Writes <name>.md and <name>.json next to the audio in Drive (same base name), renaming the audio when the collection renames. */
async function stepRename(c: Ctx, it: Item) {
  const cfg = cfgOf(it);
  const pol = readJson<{ title: string; newName: string; raw?: boolean; daf: { daf: string; amud: string }[]; summary: string; tags: string[]; segments: Seg[] } | null>(dataPath("polished", `${it.id}.json`), null);
  if (!pol) throw new Error("falta polished json");
  const gap = readJson<Seg[]>(dataPath("gapfill", `${it.id}.json`), []);
  const hollow = new Set(readJson<{ id: string; startMs: number }[]>(dataPath("gaps-hollow.json"), []).filter((h) => h.id === it.id).map((h) => h.startMs));
  const segments = mergeFinal(pol.segments, gap, hollow);
  const rename = !pol.raw && cfg.namingMode === "template" && !!pol.newName && pol.newName !== it.name;
  const newName = safeName(rename ? pol.newName : it.name), base = baseOf(newName), oldBase = baseOf(it.name);
  const md = polishedToMd({ title: rename ? pol.title : base, daf: pol.daf, summary: pol.summary, tags: pol.tags, segments });
  fs.mkdirSync(dataPath("md-out"), { recursive: true }); fs.writeFileSync(dataPath("md-out", `${it.id}.md`), md);
  const json = buildTranscriptJson({
    audioId: it.id, model: cfg.model, segments, summary: pol.summary, tags: pol.tags,
    meta: { title: base, collection: cfg.slug || undefined, postprocess: cfg.postprocess, polished: !pol.raw, durationMs: it.durationMs, needsReview: it.needsReview, daf: pol.daf?.length ? pol.daf : undefined, originalName: it.name },
  });
  const folder = parentOf(it);
  const batch = new Date().toISOString();
  const rl = (id: string, kind: "audio" | "md" | "json", oldName: string, nn: string) => logRename({ id, kind, oldName, newName: nn, audioId: it.id, batch });
  // audio
  const meta = await drive.getMeta(it.id);
  const curBase = baseOf(meta.name);
  if (meta.name !== newName) { await drive.renameFile(it.id, newName); addLog(it, `audio renombrado: ${meta.name} → ${newName}`); rl(it.id, "audio", meta.name, newName); }
  invalidateChildren(folder);
  // md + json: reuse same-name companions (e.g. a Plaud .md, or the files of a previous run), renaming them with the audio; content is always replaced
  const files = await drive.listChildren(folder);
  const n1 = (n: string) => n.normalize("NFC").trim();
  const companion = async (ext: "md" | "json", content: string, mime: string, prevId?: string) => {
    const want = `${base}.${ext}`;
    const old = files.find((f) => f.name === want) ?? files.find((f) => f.id === prevId) ?? files.find((f) => new RegExp(`\\.${ext}$`, "i").test(f.name) && !/\.ai(\.|$)/i.test(f.name) && [curBase, oldBase].some((b) => n1(baseOf(f.name)) === n1(b)));
    if (old) {
      if (old.name !== want) { await drive.renameFile(old.id, want); rl(old.id, ext, old.name, want); }
      await drive.updateTextFile(old.id, content, mime); addLog(it, `${want} actualizado en Drive`); return old.id;
    }
    const id = await drive.createTextFile(folder, want, content, mime); rl(id, ext, "", want); addLog(it, `${want} creado en Drive`); return id;
  };
  it.mdId = await companion("md", md, "text/markdown", it.mdId);
  it.jsonId = await companion("json", JSON.stringify(json), "application/json", it.jsonId);
  invalidateChildren(folder);
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
  const cfg = cfgOf(it);
  const e: InvItem = {
    id: it.id, name: it.newName || it.name, order: it.order, ext: it.ext, mimeType: it.mimeType, sizeBytes: it.sizeBytes, durationMs: it.durationMs ?? 0,
    mdId: it.mdId ?? null, mdName: it.title ? `${it.title}.md` : null, transcript: "drive_md", inShiurim: false, r2Key: it.r2Key, ingested: true,
    collectionId: it.collectionId ?? BERAJOT_ID(),
  };
  if (!inv.some((x) => x.id === it.id)) writeJson(dataPath("inventory.json"), [...inv, e]);
  else if (!repoInventory().some((x) => x.id === it.id)) writeJson(dataPath("inventory.json"), inv.map((x) => (x.id === it.id ? { ...x, ...e } : x)));
  if (cfg.published) {
    await reindex(c.log);
    if (getR2Client() && r2Bucket()) await existingKeys(true).catch(() => {});
  }
  fs.rmSync(workDir(it.id), { recursive: true, force: true });
}

export function makeSteps(c: Ctx): Steps {
  return {
    detected: (it) => stepUpload(c, it), uploaded: (it) => stepTranscribe(c, it), transcribed: (it) => stepPolish(c, it),
    polished: (it) => stepRename(c, it), renamed: (it) => stepIndex(c, it),
  };
}
export type { Meta };
