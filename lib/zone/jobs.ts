// AI work zone: central queue of JOBS (parts of a transcript) that AI agents claim, correct and return.
// Replaces the per-file "AI package": no prompt/instructions inside a job, only data. Validation is identical to merge-polished.py
// (+ template variables). A class whose jobs are all done is applied to the pipeline (md/json to Drive, rename, publish).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_DIR, dataPath, readJson, writeJson } from "../storage";
import * as drive from "../ingest/drive";
import { sefariaText } from "../ingest/sefaria";
import { mergeFinal, pctInaudible, type Seg } from "../ingest/segments";
import { addLog, type Item, type JobCfg } from "../ingest/state";
import { buildMetaSchema, cleanOriginal, dateOf, finalName, llmVarsFor, metaSchemaKey, sanitizeTopic, seriesKind, validateRendered, type LlmVar, type Vars } from "../center/templates";
import { baseOf } from "../center/outputs";
import { guessSefariaRef } from "../center/refs";
import { hashLegacy } from "./legacy";
import { ZONE_DIR } from "./token";

export const JOB_FORMAT = "shiurim-ai-job/v1";
export const RESULT_FORMAT = "shiurim-ai-result/v1";
export const MAX_SEGMENTS_PER_PART = 250;
const partSize = () => Number(process.env.AI_ZONE_PART_SEGMENTS) || MAX_SEGMENTS_PER_PART;
export const LEASE_MINUTES = 60;
export const MAX_BODY = 5 * 1024 * 1024;
const HEB = /[֐-׿]/;

export type Problem = { where: string; problem: string };
export type Expect = {
  indices: number[]; startMs: number[]; endMs: number[]; needsMeta: boolean; allowHebrew: boolean;
  namingMode: "keep" | "template"; template: string; fixedObra?: string; order: string; ext: string; fecha?: string; original: string; origName: string; llm: LlmVar[];
};
export type Lease = { id: string; until: string; at: string; holder?: string };
export type StoredStatus = "pending" | "received" | "invalid" | "superseded" | "discarded";
export type JobStatus = "pending" | "claimed" | "done" | "failed" | "discarded";
export type Job = {
  id: string; audioId: string; collectionId?: string; part: number; total: number; baseName: string; parentId: string; series: string; kind: string; titleHint: string;
  createdAt: string; status: StoredStatus; lease?: Lease; attempts: number;
  receivedAt?: string; via?: "api" | "page" | "drive" | "legacy"; errors?: Problem[]; errorsAt?: string; appliedAt?: string; expect: Expect;
  driveFileId?: string; correctedName?: string; driveSeen?: string;
  legacy?: { tokenHash: string; expiresAt: string };
};
export type Neighbor = { i: number; startMs: number; endMs: number; text: string };
export type JobData = {
  format: typeof JOB_FORMAT; job_id: string; group_id: string; part: number; parts: number; series: string; series_kind: string; title_hint: string;
  template: string | null; naming_mode: string; template_variables_required: string[]; needs_meta: boolean; meta_required: string[]; allow_hebrew: boolean; language?: string;
  context: { original_file_name: string; daf_guess: string | null; sefaria_ref: string | null; sefaria_text: string | null; neighbors: { before: Neighbor[]; after: Neighbor[] } };
  expected_result: { format: typeof RESULT_FORMAT; job_id: string; segments_count: number; first_i: number; last_i: number };
  segments: Neighbor[];
};

// ---------------------------------------------------------------- store

const INDEX = () => path.join(ZONE_DIR(), "jobs.json");
const DATA = (id: string) => path.join(ZONE_DIR(), "jobs", `${id}.json`);
const RESULT = (id: string) => path.join(ZONE_DIR(), "results", `${id}.json`);
const MARK = () => path.join(ZONE_DIR(), "migrated.json");
export const newJobId = () => `job_${crypto.randomBytes(8).toString("hex")}`;
export const newLeaseId = () => `lease_${crypto.randomBytes(9).toString("base64url")}`;

/** One-time import of per-file AI packages (STORAGE_DIR/packages/packages.json) as jobs. Job data is read lazily from their Drive file. */
function migrateLegacy(): Job[] {
  const legacy = readJson<any[]>(path.join(STORAGE_DIR, "packages", "packages.json"), []);
  const out: Job[] = [];
  for (const p of legacy) {
    if (!p || p.status === "superseded" || !p.id) continue;
    const j: Job = {
      id: p.id, audioId: p.audioId, collectionId: p.collectionId, part: p.part, total: p.total, baseName: p.baseName, parentId: p.parentId ?? "", series: "", kind: seriesKind(p.expect?.template), titleHint: p.baseName,
      createdAt: p.createdAt, status: p.status === "received" ? "received" : p.status === "invalid" ? "invalid" : "pending", attempts: 0, receivedAt: p.receivedAt, via: p.via ?? "legacy",
      errors: (p.errors ?? []).map((e: { where: string; message: string }) => ({ where: e.where, problem: e.message })), appliedAt: p.appliedAt, expect: p.expect,
      driveFileId: p.driveFileId, correctedName: p.correctedName, driveSeen: p.driveSeen, legacy: { tokenHash: p.tokenHash, expiresAt: p.expiresAt },
    };
    const res = path.join(STORAGE_DIR, "packages", `${p.id}.result.json`);
    if (fs.existsSync(res)) { fs.mkdirSync(path.dirname(RESULT(j.id)), { recursive: true }); fs.copyFileSync(res, RESULT(j.id)); }
    out.push(j);
  }
  return out;
}
export function loadJobs(): Job[] {
  if (!fs.existsSync(INDEX()) && !fs.existsSync(MARK())) {
    const migrated = migrateLegacy();
    writeJson(INDEX(), migrated); writeJson(MARK(), { at: new Date().toISOString(), imported: migrated.length });
    return migrated;
  }
  return readJson<Job[]>(INDEX(), []);
}
const saveJobs = (l: Job[]) => writeJson(INDEX(), l, undefined, 0);
const mutate = <T>(f: (l: Job[]) => T): T => { const l = loadJobs(); const r = f(l); saveJobs(l); return r; };
const update = (id: string, f: (j: Job) => void) => mutate((l) => { const j = l.find((x) => x.id === id); if (j) f(j); return j; });
export const getJob = (id: string) => loadJobs().find((j) => j.id === id) ?? null;
export const jobsOfAudio = (audioId: string) => loadJobs().filter((j) => j.audioId === audioId && j.status !== "superseded");
export function supersede(audioId: string) { mutate((l) => { for (const j of l) if (j.audioId === audioId && j.status !== "superseded") { j.status = "superseded"; j.lease = undefined; } }); }

// ---------------------------------------------------------------- status / lease

export const leaseActive = (j: Job, now = Date.now()) => !!j.lease && Date.parse(j.lease.until) > now;
export function statusOf(j: Job, now = Date.now()): JobStatus {
  if (j.status === "received") return "done";
  if (j.status === "discarded") return "discarded";
  if (leaseActive(j, now)) return "claimed";
  return j.status === "invalid" ? "failed" : "pending";
}
export const isListed = (j: Job) => j.status !== "superseded" && !(j.legacy && Date.parse(j.legacy.expiresAt) < Date.now() && j.status !== "received");
/** Drops expired leases (the job goes back to pending). Returns how many were released. */
export function sweepLeases(now = Date.now()): number {
  const l = loadJobs(); let n = 0;
  for (const j of l) if (j.lease && Date.parse(j.lease.until) <= now) { j.lease = undefined; n++; }
  if (n) saveJobs(l);
  return n;
}
export const counts = (now = Date.now()) => {
  const c = { pending: 0, claimed: 0, done: 0, failed: 0, discarded: 0 };
  for (const j of loadJobs()) if (isListed(j)) c[statusOf(j, now)]++;
  return c;
};
export type JobSummary = { job_id: string; part: number; parts: number; series: string; title_hint: string; segments_count: number; status: JobStatus; claimed_until?: string; last_errors?: number };
export const summary = (j: Job, now = Date.now()): JobSummary => {
  const st = statusOf(j, now);
  return { job_id: j.id, part: j.part, parts: j.total, series: j.series, title_hint: j.titleHint, segments_count: j.expect.indices.length, status: st, ...(st === "claimed" ? { claimed_until: j.lease!.until } : {}), ...(j.errors?.length && st !== "done" ? { last_errors: j.errors.length } : {}) };
};
/** status=pending (default) lists what can be taken: pending + failed (rejected, retryable) not under an active lease. */
export function listSummaries(status = "pending", now = Date.now()): JobSummary[] {
  sweepLeases(now);
  const all = loadJobs().filter(isListed).map((j) => summary(j, now));
  const want = (s: JobSummary) => status === "all" ? s.status !== "discarded" : status === "pending" ? s.status === "pending" || s.status === "failed" : s.status === status;
  return all.filter(want).sort((a, b) => a.title_hint.localeCompare(b.title_hint, "es", { numeric: true }) || a.part - b.part);
}

export type ClaimResult = { ok: true; job: Job; lease: Lease; renewed: boolean } | { ok: false; code: number; error: string; claimed_until?: string };
export function claim(id: string, o: { leaseId?: string; holder?: string; now?: number } = {}): ClaimResult {
  const now = o.now ?? Date.now(); const j = getJob(id);
  if (!j || !isListed(j) || j.status === "discarded") return { ok: false, code: 404, error: "Job no encontrado." };
  if (j.status === "received") return { ok: false, code: 409, error: "Este job ya está terminado (done). Si necesitas rehacerlo pide al admin «Reabrir»." };
  if (leaseActive(j, now) && j.lease!.id !== o.leaseId) return { ok: false, code: 409, error: "Otro agente ya tomó este job (claimed). Elige otro de GET /jobs?status=pending o espera a que venza su lease.", claimed_until: j.lease!.until };
  const renewed = leaseActive(j, now);
  const lease: Lease = { id: renewed ? j.lease!.id : newLeaseId(), at: renewed ? j.lease!.at : new Date(now).toISOString(), until: new Date(now + LEASE_MINUTES * 60_000).toISOString(), holder: o.holder?.slice(0, 80) };
  const job = update(id, (x) => { x.lease = lease; })!;
  return { ok: true, job, lease, renewed };
}
export function release(id: string, o: { leaseId?: string; now?: number } = {}): { ok: boolean; code: number; error?: string } {
  const now = o.now ?? Date.now(); const j = getJob(id);
  if (!j || !isListed(j)) return { ok: false, code: 404, error: "Job no encontrado." };
  if (leaseActive(j, now) && o.leaseId && j.lease!.id !== o.leaseId) return { ok: false, code: 409, error: "El lease pertenece a otro agente." };
  update(id, (x) => { x.lease = undefined; });
  return { ok: true, code: 200 };
}
/** Admin: back to pending (clears lease, errors and the received result). */
export function reopen(id: string): boolean {
  const j = update(id, (x) => { x.status = "pending"; x.lease = undefined; x.errors = undefined; x.receivedAt = undefined; x.via = undefined; x.attempts = 0; });
  try { fs.rmSync(RESULT(id), { force: true }); } catch { /* ignore */ }
  return !!j;
}
export const discard = (id: string): boolean => !!update(id, (x) => { x.status = "discarded"; x.lease = undefined; });

// ---------------------------------------------------------------- build

export function outputSchema(needsMeta: boolean, llm: LlmVar[]) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", title: RESULT_FORMAT, type: "object", additionalProperties: false,
    required: ["format", "job_id", "segments", ...(needsMeta ? ["meta"] : [])],
    properties: {
      format: { const: RESULT_FORMAT }, job_id: { type: "string", description: "identical to the job's job_id" },
      segments: { type: "array", description: "exactly the job's segments, same order, same i/startMs/endMs; only `text` is corrected",
        items: { type: "object", additionalProperties: false, required: ["i", "startMs", "endMs", "text"], properties: { i: { type: "integer" }, startMs: { type: "integer" }, endMs: { type: "integer" }, text: { type: "string", minLength: 1 } } } },
      ...(needsMeta ? { meta: buildMetaSchema(llm) } : {}),
    },
  };
}
const fileNames = (base: string, part: number, total: number) => total > 1
  ? { file: `${base}.ai.parte${part}de${total}.json`, corrected: `${base}.ai.parte${part}de${total}.corregido.json` }
  : { file: `${base}.ai.json`, corrected: `${base}.ai.corregido.json` };

export type BuiltJob = { job: Job; data: JobData };
/** Splits a class's final raw segments into jobs (parts of <=250 segments). Pure except for the optional Sefaria fetch (injectable). */
export async function buildJobs(it: Pick<Item, "id" | "name" | "ext" | "order" | "fileDate" | "collectionId" | "parentId">, cfg: JobCfg, segments: Seg[], o: { baseName?: string; sefaria?: (ref: string) => Promise<string>; maxPerPart?: number } = {}): Promise<BuiltJob[]> {
  const max = o.maxPerPart ?? partSize();
  const total = Math.max(1, Math.ceil(segments.length / max));
  const kind = seriesKind(cfg.template), base = o.baseName ?? baseOf(it.name);
  const llm = cfg.namingMode === "template" ? llmVarsFor(cfg.template, !!cfg.obra) : [];
  const ref = kind === "talmud" ? guessSefariaRef(it.name, cfg.obra) : null;
  const excerpt = ref ? await (o.sefaria ?? sefariaText)(ref).catch(() => "") : "";
  const nb = (arr: Seg[], offset: number): Neighbor[] => arr.map((s, k) => ({ i: offset + k, startMs: s.startMs, endMs: s.endMs, text: s.text }));
  const out: BuiltJob[] = [];
  for (let part = 1; part <= total; part++) {
    const from = (part - 1) * max, slice = segments.slice(from, from + max);
    const idx = slice.map((_, k) => from + k), id = newJobId(), names = fileNames(base, part, total), needsMeta = part === 1;
    const expect: Expect = {
      indices: idx, startMs: slice.map((s) => s.startMs), endMs: slice.map((s) => s.endMs), needsMeta, allowHebrew: !!cfg.allowHebrew, namingMode: cfg.namingMode, template: cfg.template,
      fixedObra: cfg.obra || undefined, order: it.order, ext: it.ext, fecha: dateOf(it.fileDate), original: cleanOriginal(it.name), origName: it.name, llm,
    };
    const data: JobData = {
      format: JOB_FORMAT, job_id: id, group_id: it.id, part, parts: total, series: cfg.collectionName, series_kind: kind, title_hint: base,
      template: cfg.namingMode === "template" ? cfg.template : null, naming_mode: cfg.namingMode,
      template_variables_required: needsMeta ? llm.map(metaSchemaKey) : [], needs_meta: needsMeta, meta_required: needsMeta ? ["summary", "tags", "note", ...llm.map(metaSchemaKey)] : [],
      allow_hebrew: !!cfg.allowHebrew, language: cfg.language,
      context: { original_file_name: it.name, daf_guess: ref, sefaria_ref: ref, sefaria_text: excerpt || null, neighbors: { before: nb(segments.slice(Math.max(0, from - 3), from), Math.max(0, from - 3)), after: nb(segments.slice(from + max, from + max + 3), from + max) } },
      expected_result: { format: RESULT_FORMAT, job_id: id, segments_count: slice.length, first_i: idx[0], last_i: idx[idx.length - 1] },
      segments: nb(slice, from),
    };
    const job: Job = {
      id, audioId: it.id, collectionId: it.collectionId, part, total, baseName: base, parentId: it.parentId ?? "", series: cfg.collectionName, kind, titleHint: base,
      createdAt: new Date().toISOString(), status: "pending", attempts: 0, expect, correctedName: names.corrected,
    };
    out.push({ job, data });
  }
  return out;
}
const saveData = (id: string, d: JobData) => writeJson(DATA(id), d, undefined, 0);

/** Build + register in the zone queue (optionally also a plain `<name>.ai.json` data file in Drive when the series asks for it). */
export async function createJobs(it: Item, cfg: JobCfg, segments: Seg[], o: { sefaria?: (ref: string) => Promise<string>; maxPerPart?: number } = {}): Promise<Job[]> {
  supersede(it.id);
  const built = await buildJobs(it, cfg, segments, o);
  for (const b of built) {
    saveData(b.job.id, b.data);
    if (cfg.aiCopyToDrive && b.job.parentId) {
      const names = fileNames(b.job.baseName, b.job.part, b.job.total);
      b.job.driveFileId = await drive.createTextFile(b.job.parentId, names.file, JSON.stringify(b.data, null, 1), "application/json");
    }
  }
  mutate((l) => { l.push(...built.map((b) => b.job)); });
  return built.map((b) => b.job);
}

/** Job data; jobs imported from the old per-file packages read it from their Drive file the first time. */
export async function getJobData(j: Job): Promise<JobData> {
  const d = readJson<JobData | null>(DATA(j.id), null);
  if (d) return d;
  if (!j.driveFileId) throw new Error("datos del job no disponibles");
  const old = JSON.parse(await drive.readTextFile(j.driveFileId)) as { context?: any; segments: Neighbor[] };
  const c = old.context ?? {}; const x = j.expect;
  const data: JobData = {
    format: JOB_FORMAT, job_id: j.id, group_id: j.audioId, part: j.part, parts: j.total, series: c.series ?? j.series, series_kind: c.kind ?? j.kind, title_hint: j.titleHint,
    template: x.namingMode === "template" ? x.template : null, naming_mode: x.namingMode, template_variables_required: x.needsMeta ? x.llm.map(metaSchemaKey) : [], needs_meta: x.needsMeta,
    meta_required: x.needsMeta ? ["summary", "tags", "note", ...x.llm.map(metaSchemaKey)] : [], allow_hebrew: x.allowHebrew, language: c.language,
    context: { original_file_name: c.original_file_name ?? x.origName, daf_guess: c.daf_guess ?? null, sefaria_ref: c.sefaria_ref ?? null, sefaria_text: c.sefaria_text ?? null, neighbors: c.neighbors ?? { before: [], after: [] } },
    expected_result: { format: RESULT_FORMAT, job_id: j.id, segments_count: x.indices.length, first_i: x.indices[0], last_i: x.indices[x.indices.length - 1] },
    segments: old.segments,
  };
  saveData(j.id, data); update(j.id, (z) => { z.series = data.series; z.kind = data.series_kind; });
  return data;
}

// ---------------------------------------------------------------- validation (merge-polished.py rules + template variables)

export type Validated = { ok: boolean; errors: Problem[]; segments?: Seg[]; meta?: { summary: string; tags: string[]; daf: { daf: string; amud: string }[]; title: string; newName: string; dafNote?: string; vars?: Record<string, string> } };
const MAXERR = 80;
export function validateResult(m: Pick<Job, "id" | "expect">, raw: unknown): Validated {
  const errs: Problem[] = []; const e = (where: string, problem: string) => { if (errs.length < MAXERR) errs.push({ where, problem }); };
  const x = m.expect;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ where: "body", problem: "El contenido debe ser un objeto JSON { format, job_id, segments, meta? }" }] };
  const r = raw as Record<string, unknown>;
  const jid = r.job_id ?? r.package_id;
  if (jid !== m.id) e("job_id", `No coincide: se esperaba "${m.id}" y llegó ${JSON.stringify(jid ?? null)}. Envía el resultado a la URL de su propio job.`);
  if (r.format !== undefined && r.format !== RESULT_FORMAT && r.format !== "shiurim-ai-result/v1") e("format", `Debe ser "${RESULT_FORMAT}"`);
  const segs = Array.isArray(r.segments) ? (r.segments as Record<string, unknown>[]) : null;
  if (!segs) e("segments", "Falta la lista `segments`");
  else {
    if (segs.length !== x.indices.length) e("segments", `Cantidad incorrecta: llegaron ${segs.length} segmentos y se esperaban ${x.indices.length}`);
    const byI = new Map<number, Record<string, unknown>>(); const dup: number[] = [];
    for (const s of segs) { const i = Number((s as { i?: unknown }).i); if (!Number.isInteger(i)) { e("segments", "Un segmento no tiene índice `i` entero"); continue; } if (byI.has(i)) dup.push(i); byI.set(i, s); }
    if (dup.length) e("segments", `Índices duplicados: ${dup.slice(0, 20).join(", ")}`);
    const missing = x.indices.filter((i) => !byI.has(i)), extra = [...byI.keys()].filter((i) => !x.indices.includes(i));
    if (missing.length) e("segments", `Faltan los segmentos i = ${missing.slice(0, 30).join(", ")}${missing.length > 30 ? "…" : ""}`);
    if (extra.length) e("segments", `Segmentos fuera de este job: i = ${extra.slice(0, 20).join(", ")}`);
    const order = segs.map((s) => Number((s as { i?: unknown }).i));
    const bad = order.findIndex((v, k) => k > 0 && v < order[k - 1]);
    if (bad > 0 && !missing.length && !extra.length) e("segments", `Los segmentos no están en orden (posición ${bad}: i=${order[bad]} después de i=${order[bad - 1]})`);
    x.indices.forEach((i, k) => {
      const s = byI.get(i); if (!s) return;
      if (s.startMs !== x.startMs[k]) e(`segments[i=${i}].startMs`, `${JSON.stringify(s.startMs ?? null)} ≠ ${x.startMs[k]} (los tiempos no se tocan)`);
      if (s.endMs !== x.endMs[k]) e(`segments[i=${i}].endMs`, `${JSON.stringify(s.endMs ?? null)} ≠ ${x.endMs[k]} (los tiempos no se tocan)`);
      const t = typeof s.text === "string" ? s.text.trim() : "";
      if (!t) e(`segments[i=${i}].text`, "texto vacío (si es irrecuperable escribe [inaudible])");
      else if (!x.allowHebrew && HEB.test(t)) e(`segments[i=${i}].text`, "tiene letras hebreas (todo el hebreo/arameo va en transliteración latina)");
    });
  }
  let meta: Validated["meta"];
  if (x.needsMeta) {
    const m0 = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? (r.meta as Record<string, unknown>) : null;
    if (!m0) e("meta", "Falta `meta` (esta parte debe incluir summary, tags y las variables del nombre: ver template_variables_required del job)");
    else {
      const str = (k: string) => (typeof m0[k] === "string" ? (m0[k] as string).trim() : "");
      const tags = Array.isArray(m0.tags) ? (m0.tags as unknown[]).filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
      if (!str("summary")) e("meta.summary", "Falta el resumen (2-3 oraciones en español)");
      else if (HEB.test(str("summary"))) e("meta.summary", "El resumen no puede tener letras hebreas");
      if (tags.length < 3) e("meta.tags", `Hacen falta al menos 3 tags (llegaron ${tags.length})`);
      tags.filter((t) => HEB.test(t)).forEach((t) => e("meta.tags", `El tag «${t}» tiene letras hebreas (usa transliteración latina)`));
      const vars: Vars = { n: x.order, ext: x.ext, fecha: x.fecha, original: x.original };
      let title = baseOf(x.origName), newName = x.origName, daf: { daf: string; amud: string }[] = [];
      if (x.namingMode === "template") {
        vars.obra = x.fixedObra || (x.llm.includes("obra") ? str("obra") : undefined);
        if (x.llm.includes("daf")) { daf = Array.isArray(m0.daf) ? (m0.daf as { daf?: unknown; amud?: unknown }[]).map((d) => ({ daf: String(d?.daf ?? "").trim(), amud: String(d?.amud ?? "").trim() })) : []; vars.daf = daf; }
        for (const v of x.llm) if (v === "temas" || v === "tema_es") (vars as Record<string, unknown>)[v] = sanitizeTopic(str(v));
        if (x.llm.includes("torá")) vars["torá"] = str(metaSchemaKey("torá"));
        if (x.llm.includes("parashá")) vars["parashá"] = str(metaSchemaKey("parashá"));
        const ves = validateRendered(x.template, vars);
        for (const v of ves) e(`meta.${/daf|amud/.test(v) ? "daf" : /temas/.test(v) ? "temas" : /tema_es/.test(v) ? "tema_es" : /obra/.test(v) ? "obra" : /torá/.test(v) ? "tora" : /parashá/.test(v) ? "parasha" : "nombre"}`, v);
        if (!ves.length) ({ title, newName } = finalName(x.template, vars));
      }
      if (!errs.length) {
        const flat: Record<string, string> = {}; for (const [k, v] of Object.entries(vars)) if (typeof v === "string") flat[k] = v;
        meta = { summary: str("summary"), tags, daf, title, newName, dafNote: str("note") || undefined, vars: flat };
      }
    }
  }
  if (errs.length) return { ok: false, errors: errs };
  const byI = new Map((segs ?? []).map((s) => [Number(s.i), s]));
  const segments = x.indices.map((i, k) => ({ startMs: x.startMs[k], endMs: x.endMs[k], text: String(byI.get(i)!.text).trim() }));
  return { ok: true, errors: [], segments, meta };
}

// ---------------------------------------------------------------- receive + apply

export type ReceiveResult = { ok: boolean; applied: boolean; errors: Problem[]; waitingForParts?: number[]; message: string };
export function parseLoose(body: string): unknown {
  let t = body.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); if (fence) t = fence[1];
  return JSON.parse(t);
}
/** A result arrived (API, HTML form or Drive). Invalid results are recorded and NOT applied; the previous valid one stays active. */
export async function receiveResult(j: Job, rawBody: string | unknown, via: "api" | "page" | "drive"): Promise<ReceiveResult> {
  const reject = (errors: Problem[], message: string): ReceiveResult => {
    update(j.id, (x) => { x.errors = errors; x.errorsAt = new Date().toISOString(); x.via = via; x.attempts++; if (x.status !== "received") x.status = x.status === "discarded" ? "discarded" : "invalid"; });
    return { ok: false, applied: false, errors, message };
  };
  let parsed: unknown;
  try { parsed = typeof rawBody === "string" ? parseLoose(rawBody) : rawBody; }
  catch (err) { return reject([{ where: "body", problem: `No es JSON válido: ${(err as Error).message}. Envía solo el objeto JSON (sin texto antes/después ni bloque \`\`\`).` }], "El cuerpo no es un JSON válido."); }
  const v = validateResult(j, parsed);
  if (!v.ok) return reject(v.errors, `Resultado rechazado: ${v.errors.length} problema(s). No se aplicó nada; corrige y vuelve a enviar a la misma URL.`);
  writeJson(RESULT(j.id), { segments: v.segments, meta: v.meta }, undefined, 0);
  update(j.id, (x) => { x.status = "received"; x.errors = undefined; x.receivedAt = new Date().toISOString(); x.via = via; x.appliedAt = undefined; x.lease = undefined; });
  const r = await applyIfComplete(j.audioId);
  return { ok: true, applied: r.applied, errors: [], waitingForParts: r.waiting, message: r.applied ? "Resultado válido: aplicado. La clase continúa (renombrado, publicación)." : r.waiting.length ? `Parte recibida. Faltan las partes: ${r.waiting.join(", ")}.` : "Resultado válido recibido; se aplicará en cuanto el servidor termine el paso en curso." };
}

/** When every part of an audio has a valid result, merge them and move the item past the polishing step. */
export async function applyIfComplete(audioId: string): Promise<{ applied: boolean; waiting: number[] }> {
  const pk = jobsOfAudio(audioId).sort((a, b) => a.part - b.part);
  if (!pk.length) return { applied: false, waiting: [] };
  const waiting = pk.filter((p) => p.status !== "received").map((p) => p.part);
  if (waiting.length) return { applied: false, waiting };
  const { scheduler } = await import("../ingest/scheduler");
  const s = scheduler(); const it = s.state.items[audioId];
  if (!it || it.status === "running") return { applied: false, waiting: [] };
  const segments: Seg[] = []; let meta: NonNullable<Validated["meta"]> | undefined;
  for (const p of pk) { const r = readJson<{ segments: Seg[]; meta?: Validated["meta"] } | null>(RESULT(p.id), null); if (!r) return { applied: false, waiting: [p.part] }; segments.push(...r.segments); if (p.part === 1) meta = r.meta; }
  if (!meta) throw new Error("falta meta en la parte 1");
  writeJson(dataPath("polished", `${audioId}.json`), { id: audioId, pkg: true, segments, summary: meta.summary, tags: meta.tags, daf: meta.daf, title: meta.title, newName: meta.newName, vars: meta.vars, needsReview: pctInaudible(segments.map((x) => x.text)) > 0.2 || undefined }, undefined, 0);
  writeJson(dataPath("gapfill", `${audioId}.json`), [], undefined, 0);
  it.newName = meta.newName; it.title = meta.title; it.dafNote = meta.dafNote; it.needsReview = pctInaudible(segments.map((x) => x.text)) > 0.2;
  it.state = "polished"; it.status = "queued"; it.attempts = 0; it.error = undefined; it.nextAttemptAt = undefined; it.finishedAt = undefined;
  addLog(it, `resultado de la IA aplicado (${pk.length} parte(s), ${segments.length} segmentos): ${meta.newName}`);
  console.log(`ingest: zona IA aplicada a ${audioId} (${pk.length} parte(s)): ${meta.newName}`);
  const now = new Date().toISOString(); mutate((l) => { for (const p of l) if (p.audioId === audioId && p.status === "received") p.appliedAt = now; });
  s.persist(); void s.work();
  return { applied: true, waiting: [] };
}
/** Received results that could not be applied yet (item was busy). */
export async function applyPending() {
  const ids = new Set(loadJobs().filter((p) => p.status === "received" && !p.appliedAt).map((p) => p.audioId));
  for (const id of ids) await applyIfComplete(id).catch(() => {});
}
/** Jobs that also have a Drive data file: look for `<name>.ai.corregido.json` next to it (optional, only with "copiar también a Drive" or imported packages). */
export async function scanDrive(): Promise<{ checked: number; received: number }> {
  const pend = loadJobs().filter((p) => isListed(p) && p.status !== "discarded" && p.driveFileId && p.correctedName && p.parentId && p.status !== "received");
  const byParent = new Map<string, Job[]>(); for (const p of pend) byParent.set(p.parentId, [...(byParent.get(p.parentId) ?? []), p]);
  let received = 0;
  for (const [parent, list] of byParent) {
    const files = await drive.listChildren(parent);
    for (const p of list) {
      const f = files.find((x) => x.name.toLowerCase() === p.correctedName!.toLowerCase());
      const seen = f?.modifiedTime ?? f?.id;
      if (!f || (p.driveSeen && p.driveSeen === seen)) continue;
      update(p.id, (x) => { x.driveSeen = seen; });
      try { const r = await receiveResult(p, await drive.readTextFile(f.id), "drive"); if (r.ok) received++; } catch { /* retried next scan when the file changes */ }
    }
  }
  return { checked: pend.length, received };
}
export const hasDriveJobs = () => loadJobs().some((p) => isListed(p) && p.driveFileId && p.status !== "received" && p.status !== "discarded");
export const findByLegacyToken = (token: string): Job | null => { const h = hashLegacy(token); return loadJobs().find((j) => j.legacy && j.legacy.tokenHash === h) ?? null; };
