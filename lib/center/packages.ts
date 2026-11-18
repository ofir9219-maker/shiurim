// AI packages (alternative to OpenAI polishing): build self-contained JSON packages, token-scoped upload, validation identical to
// merge-polished.py (+ template variables), and apply of the corrected result to the pipeline.
import crypto from "node:crypto";
import path from "node:path";
import { STORAGE_DIR, dataPath, readJson, writeJson } from "../storage";
import * as drive from "../ingest/drive";
import { polishRules } from "../ingest/prompts";
import { sefariaText } from "../ingest/sefaria";
import { pctInaudible, mergeFinal, type Seg } from "../ingest/segments";
import { addLog, type Item } from "../ingest/state";
import { buildMetaSchema, finalName, llmVarsFor, metaSchemaKey, metaSystem, sanitizeTopic, seriesKind, validateRendered, cleanOriginal, dateOf, type LlmVar, type Vars } from "./templates";
import { baseOf } from "./outputs";
import { guessSefariaRef } from "./refs";
import type { JobCfg } from "../ingest/state";

export const PACKAGE_FORMAT = "shiurim-ai-package/v1";
export const RESULT_FORMAT = "shiurim-ai-result/v1";
export const MAX_SEGMENTS_PER_PART = 250;
export const TOKEN_DAYS = 30;
export const MAX_BODY = 5 * 1024 * 1024;
const HEB = /[֐-׿]/;

export const publicBase = () => (process.env.PUBLIC_BASE_URL || "https://ofirsegal.app").replace(/\/$/, "");
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export type PkgError = { where: string; message: string };
export type Expect = {
  indices: number[]; startMs: number[]; endMs: number[]; needsMeta: boolean; allowHebrew: boolean;
  namingMode: "keep" | "template"; template: string; fixedObra?: string; order: string; ext: string; fecha?: string; original: string; origName: string; llm: LlmVar[];
};
export type PackageMeta = {
  id: string; audioId: string; collectionId?: string; part: number; total: number; baseName: string; fileName: string; correctedName: string; parentId: string;
  driveFileId?: string; tokenHash: string; createdAt: string; expiresAt: string; status: "pending" | "received" | "invalid" | "superseded";
  receivedAt?: string; via?: "api" | "page" | "drive"; errors?: PkgError[]; appliedAt?: string; driveSeen?: string; expect: Expect;
};
const DIR = () => path.join(STORAGE_DIR, "packages");
const INDEX = () => path.join(DIR(), "packages.json");
const RESULT = (id: string) => path.join(DIR(), `${id}.result.json`);
export const listPackages = (): PackageMeta[] => readJson<PackageMeta[]>(INDEX(), []);
const savePackages = (l: PackageMeta[]) => writeJson(INDEX(), l);
const update = (id: string, f: (p: PackageMeta) => void) => { const l = listPackages(); const p = l.find((x) => x.id === id); if (p) { f(p); savePackages(l); } return p; };
export const activePackages = (audioId: string) => listPackages().filter((p) => p.audioId === audioId && p.status !== "superseded");
export const findByToken = (token: string): PackageMeta | null => {
  const h = hashToken(token);
  const a = Buffer.from(h);
  for (const p of listPackages()) { const b = Buffer.from(p.tokenHash); if (a.length === b.length && crypto.timingSafeEqual(a, b)) return p; }
  return null;
};
export const isExpired = (p: PackageMeta) => Date.parse(p.expiresAt) < Date.now();
export function supersede(audioId: string) { const l = listPackages(); for (const p of l) if (p.audioId === audioId && p.status !== "superseded") p.status = "superseded"; savePackages(l); }

// ---------------------------------------------------------------- build

export function outputSchema(packageId: string, n: number, needsMeta: boolean, llm: LlmVar[], namingMode: string, ids: number[]) {
  const meta = needsMeta ? buildMetaSchema(namingMode === "template" ? llm : []) : undefined;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema", title: "shiurim-ai-result/v1", type: "object", additionalProperties: false,
    required: ["format", "package_id", "segments", ...(needsMeta ? ["meta"] : [])],
    properties: {
      format: { const: RESULT_FORMAT }, package_id: { const: packageId },
      segments: { type: "array", minItems: n, maxItems: n, description: `Exactamente ${n} segmentos, en el mismo orden que el paquete (i = ${ids[0]}…${ids[ids.length - 1]}).`,
        items: { type: "object", additionalProperties: false, required: ["i", "startMs", "endMs", "text"], properties: { i: { type: "integer" }, startMs: { type: "integer" }, endMs: { type: "integer" }, text: { type: "string", minLength: 1 } } } },
      ...(needsMeta ? { meta } : {}),
    },
  };
}
const fileNames = (base: string, part: number, total: number) => total > 1
  ? { file: `${base}.ai.parte${part}de${total}.json`, corrected: `${base}.ai.parte${part}de${total}.corregido.json` }
  : { file: `${base}.ai.json`, corrected: `${base}.ai.corregido.json` };

export function buildPackagePrompt(o: { kind: ReturnType<typeof seriesKind>; series: string; needsMeta: boolean; llm: LlmVar[]; namingMode: string; allowHebrew: boolean; part: number; total: number }): string {
  const meta = o.needsMeta
    ? `\n# Metadatos (solo en esta parte)\nAdemás de los segmentos, completa \`meta\` (según output_schema). Reglas:\n${metaSystem(o.namingMode === "template" ? o.llm : [], o.kind)}\nEn \`meta\` las claves de la plantilla son: ${o.namingMode === "template" ? o.llm.map(metaSchemaKey).join(", ") || "(ninguna)" : "(ninguna: se conserva el nombre original)"}; \`note\` es una línea con dudas o cadena vacía.`
    : "\n# Metadatos\nEsta parte NO lleva `meta` (los metadatos se piden en la parte 1).";
  return `${polishRules(o.kind, o.series)}

# Tarea (paquete para IA${o.total > 1 ? `, parte ${o.part} de ${o.total}` : ""})
Recibes un paquete JSON con \`segments: [{i, startMs, endMs, text}]\` (transcripción cruda de un shiur). Corrige solo \`text\` siguiendo las reglas anteriores y devuelve el archivo corregido.
${o.allowHebrew ? "En esta serie se permiten letras hebreas en citas literales; fuera de ellas usa transliteración latina." : "NUNCA uses letras hebreas en `text`: todo el hebreo/arameo va en transliteración latina."}
Los segmentos de \`context.neighbors\` son de solo lectura (continuidad): NO los devuelvas.
${meta}

# Reglas estrictas de salida
- Devuelve SOLO un objeto JSON (sin texto antes ni después, sin bloque \`\`\`), que cumpla \`output_schema\`.
- \`format\` = "${RESULT_FORMAT}" y \`package_id\` idéntico al del paquete.
- \`segments\`: exactamente la misma cantidad, el mismo orden y los mismos \`i\`, \`startMs\`, \`endMs\` que el paquete; solo cambia \`text\` (nunca vacío).
- No traduzcas, no resumas, no reordenes, no inventes. Si un fragmento es irrecuperable escribe \`[inaudible]\`.`;
}

export function instructions(p: { total: number; part: number; needsMeta: boolean; corrected: string }) {
  const sendEs = `Si puedes hacer peticiones HTTP, envía el JSON con POST a upload.url (Content-Type: application/json). Si no, entrega el archivo al usuario y pídele que lo arrastre en upload.page o lo guarde en Drive como ${p.corrected}.`;
  const sendEn = `If you can make HTTP requests, send the JSON with POST to upload.url (Content-Type: application/json). If not, hand the file to the user and ask them to drag it onto upload.page or save it in Drive as ${p.corrected}.`;
  return {
    es: [
      "Lee TODO el paquete: `prompt` (reglas), `context` (serie, daf, texto de Sefaria, vecinos) y `segments`.",
      "Corrige el `text` de cada segmento según las reglas de `prompt`; no toques `i`, `startMs` ni `endMs`.",
      p.needsMeta ? "Completa `meta` (resumen, tags y las variables del nombre) según `output_schema`." : "Esta parte no lleva `meta`.",
      "Devuelve ÚNICAMENTE el JSON que cumple `output_schema` (mismo `package_id`, misma cantidad y orden de segmentos, sin texto extra ni ```).",
      sendEs,
    ],
    en: [
      "Read the WHOLE package: `prompt` (rules), `context` (series, daf, Sefaria text, neighbours) and `segments`.",
      "Correct the `text` of every segment following the rules in `prompt`; do not touch `i`, `startMs` or `endMs`.",
      p.needsMeta ? "Fill in `meta` (summary, tags and the file-name variables) as described by `output_schema`." : "This part has no `meta`.",
      "Output ONLY the JSON that satisfies `output_schema` (same `package_id`, same number and order of segments, no extra text, no ``` fences).",
      sendEn,
    ],
  };
}

export type BuiltPackage = { meta: PackageMeta; json: Record<string, unknown>; token: string };
/** Builds the package(s) for an item from its final raw segments. Pure except for the optional Sefaria fetch (injectable). */
export async function buildPackages(it: Pick<Item, "id" | "name" | "ext" | "order" | "fileDate" | "collectionId" | "parentId">, cfg: JobCfg, segments: Seg[], o: { baseName?: string; sefaria?: (ref: string) => Promise<string>; maxPerPart?: number; origin?: string } = {}): Promise<BuiltPackage[]> {
  const max = o.maxPerPart ?? MAX_SEGMENTS_PER_PART;
  const total = Math.max(1, Math.ceil(segments.length / max));
  const kind = seriesKind(cfg.template), base = o.baseName ?? baseOf(it.name), origin = o.origin ?? publicBase();
  const llm = cfg.namingMode === "template" ? llmVarsFor(cfg.template, !!cfg.obra) : [];
  const ref = kind === "talmud" ? guessSefariaRef(it.name, cfg.obra) : null;
  const excerpt = ref ? await (o.sefaria ?? sefariaText)(ref).catch(() => "") : "";
  const out: BuiltPackage[] = [];
  for (let part = 1; part <= total; part++) {
    const from = (part - 1) * max, slice = segments.slice(from, from + max);
    const idx = slice.map((_, k) => from + k);
    const id = `pkg_${crypto.randomBytes(8).toString("hex")}`, token = newToken();
    const names = fileNames(base, part, total);
    const needsMeta = part === 1;
    const url = `${origin}/api/paquete/${token}`, page = `${origin}/subir/${token}`;
    const prompt = buildPackagePrompt({ kind, series: cfg.collectionName, needsMeta, llm, namingMode: cfg.namingMode, allowHebrew: !!cfg.allowHebrew, part, total });
    const nb = (arr: Seg[], offset: number) => arr.map((s, k) => ({ i: offset + k, startMs: s.startMs, endMs: s.endMs, text: s.text }));
    const json = {
      format: PACKAGE_FORMAT, package_id: id, ...(total > 1 ? { part: { index: part, total } } : {}),
      upload: { url, method: "POST", content_type: "application/json", page, drive_fallback: `Guarda el resultado en la misma carpeta de Drive como ${names.corrected}${total > 1 ? "" : " (o .parteNdeM.corregido.json si el paquete viene en partes)"}` },
      prompt,
      output_schema: outputSchema(id, slice.length, needsMeta, llm, cfg.namingMode, idx),
      context: {
        series: cfg.collectionName, kind, original_file_name: it.name, audio_id: it.id, language: cfg.language,
        daf_guess: ref, sefaria_ref: ref, sefaria_text: excerpt || null,
        neighbors: { before: nb(segments.slice(Math.max(0, from - 3), from), Math.max(0, from - 3)), after: nb(segments.slice(from + max, from + max + 3), from + max) },
      },
      segments: nb(slice, from),
      instructions_for_ai: instructions({ total, part, needsMeta, corrected: names.corrected }),
    };
    const expect: Expect = {
      indices: idx, startMs: slice.map((s) => s.startMs), endMs: slice.map((s) => s.endMs), needsMeta, allowHebrew: !!cfg.allowHebrew, namingMode: cfg.namingMode, template: cfg.template,
      fixedObra: cfg.obra || undefined, order: it.order, ext: it.ext, fecha: dateOf(it.fileDate), original: cleanOriginal(it.name), origName: it.name, llm,
    };
    const meta: PackageMeta = {
      id, audioId: it.id, collectionId: it.collectionId, part, total, baseName: base, fileName: names.file, correctedName: names.corrected, parentId: it.parentId ?? "",
      tokenHash: hashToken(token), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TOKEN_DAYS * 86400_000).toISOString(), status: "pending", expect,
    };
    out.push({ meta, json, token });
  }
  return out;
}

/** Build + register + write to Drive (`<name>.ai.json`, `<name>.ai.parte1de4.json`…). */
export async function createPackages(it: Item, cfg: JobCfg, segments: Seg[]): Promise<PackageMeta[]> {
  supersede(it.id);
  const built = await buildPackages(it, cfg, segments);
  const metas: PackageMeta[] = [];
  for (const b of built) {
    b.meta.driveFileId = await drive.createTextFile(b.meta.parentId, b.meta.fileName, JSON.stringify(b.json, null, 1), "application/json");
    metas.push(b.meta);
  }
  savePackages([...listPackages(), ...metas]);
  return metas;
}
/** New token for a package (old one stops working); rewrites its Drive file. */
export async function regenerate(id: string): Promise<{ url: string; page: string }> {
  const p = listPackages().find((x) => x.id === id); if (!p) throw new Error("paquete no encontrado");
  const json = JSON.parse(await drive.readTextFile(p.driveFileId!)) as { upload: { url: string; page: string } };
  const token = newToken(), origin = publicBase();
  json.upload.url = `${origin}/api/paquete/${token}`; json.upload.page = `${origin}/subir/${token}`;
  await drive.updateTextFile(p.driveFileId!, JSON.stringify(json, null, 1), "application/json");
  update(id, (x) => { x.tokenHash = hashToken(token); x.expiresAt = new Date(Date.now() + TOKEN_DAYS * 86400_000).toISOString(); });
  return json.upload;
}

// ---------------------------------------------------------------- validation (merge-polished.py rules + template variables)

export type Validated = { ok: boolean; errors: PkgError[]; segments?: Seg[]; meta?: { summary: string; tags: string[]; daf: { daf: string; amud: string }[]; title: string; newName: string; dafNote?: string; vars?: Record<string, string> } };
const MAXERR = 80;
export function validateResult(m: Pick<PackageMeta, "id" | "expect">, raw: unknown): Validated {
  const errs: PkgError[] = []; const e = (where: string, message: string) => { if (errs.length < MAXERR) errs.push({ where, message }); };
  const x = m.expect;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ where: "archivo", message: "El contenido debe ser un objeto JSON" }] };
  const r = raw as Record<string, unknown>;
  if (r.package_id !== m.id) e("package_id", `No coincide: se esperaba "${m.id}" y llegó ${JSON.stringify(r.package_id ?? null)}. ¿Es el archivo de otro paquete?`);
  if (r.format !== undefined && r.format !== RESULT_FORMAT) e("format", `Debe ser "${RESULT_FORMAT}"`);
  const segs = Array.isArray(r.segments) ? (r.segments as Record<string, unknown>[]) : null;
  if (!segs) e("segments", "Falta la lista `segments`");
  else {
    if (segs.length !== x.indices.length) e("segments", `Cantidad incorrecta: llegaron ${segs.length} segmentos y se esperaban ${x.indices.length}`);
    const byI = new Map<number, Record<string, unknown>>(); const dup: number[] = [];
    for (const s of segs) { const i = Number((s as { i?: unknown }).i); if (!Number.isInteger(i)) { e("segments", "Un segmento no tiene índice `i` entero"); continue; } if (byI.has(i)) dup.push(i); byI.set(i, s); }
    if (dup.length) e("segments", `Índices duplicados: ${dup.slice(0, 20).join(", ")}`);
    const missing = x.indices.filter((i) => !byI.has(i)), extra = [...byI.keys()].filter((i) => !x.indices.includes(i));
    if (missing.length) e("segments", `Faltan los segmentos i = ${missing.slice(0, 30).join(", ")}${missing.length > 30 ? "…" : ""}`);
    if (extra.length) e("segments", `Segmentos fuera de este paquete: i = ${extra.slice(0, 20).join(", ")}`);
    const order = segs.map((s) => Number((s as { i?: unknown }).i));
    const bad = order.findIndex((v, k) => k > 0 && v < order[k - 1]);
    if (bad > 0 && !missing.length && !extra.length) e("segments", `Los segmentos no están en orden (posición ${bad}: i=${order[bad]} después de i=${order[bad - 1]})`);
    x.indices.forEach((i, k) => {
      const s = byI.get(i); if (!s) return;
      if (s.startMs !== x.startMs[k]) e(`segmento ${i}`, `startMs ${JSON.stringify(s.startMs ?? null)} ≠ ${x.startMs[k]} (los tiempos no se tocan)`);
      if (s.endMs !== x.endMs[k]) e(`segmento ${i}`, `endMs ${JSON.stringify(s.endMs ?? null)} ≠ ${x.endMs[k]} (los tiempos no se tocan)`);
      const t = typeof s.text === "string" ? s.text.trim() : "";
      if (!t) e(`segmento ${i}`, "texto vacío");
      else if (!x.allowHebrew && HEB.test(t)) e(`segmento ${i}`, "tiene letras hebreas (debe ir en transliteración latina)");
    });
  }
  let meta: Validated["meta"];
  if (x.needsMeta) {
    const m0 = r.meta && typeof r.meta === "object" ? (r.meta as Record<string, unknown>) : null;
    if (!m0) e("meta", "Falta `meta` (esta parte debe incluir resumen, tags y las variables del nombre)");
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

export type ReceiveResult = { ok: boolean; applied: boolean; errors: PkgError[]; waitingForParts?: number[]; message: string };
export function parseLoose(body: string): unknown {
  let t = body.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i); if (fence) t = fence[1];
  return JSON.parse(t);
}
/** A result arrived (API, page or Drive). Invalid results are recorded and NOT applied; the previous valid one stays active. */
export async function receiveResult(p: PackageMeta, rawBody: string | unknown, via: "api" | "page" | "drive"): Promise<ReceiveResult> {
  let parsed: unknown;
  try { parsed = typeof rawBody === "string" ? parseLoose(rawBody) : rawBody; }
  catch (err) { const errors = [{ where: "archivo", message: `No es JSON válido: ${(err as Error).message}` }]; update(p.id, (x) => { if (x.status !== "received") x.status = "invalid"; x.errors = errors; x.via = via; }); return { ok: false, applied: false, errors, message: "El archivo no es un JSON válido." }; }
  const v = validateResult(p, parsed);
  if (!v.ok) {
    update(p.id, (x) => { x.errors = v.errors; x.via = via; x.receivedAt = new Date().toISOString(); if (x.status !== "received") x.status = "invalid"; });
    return { ok: false, applied: false, errors: v.errors, message: `Resultado rechazado: ${v.errors.length} problema(s). No se aplicó nada.` };
  }
  writeJson(RESULT(p.id), { segments: v.segments, meta: v.meta }, undefined, 0);
  update(p.id, (x) => { x.status = "received"; x.errors = undefined; x.receivedAt = new Date().toISOString(); x.via = via; x.appliedAt = undefined; });
  const r = await applyIfComplete(p.audioId);
  return { ok: true, applied: r.applied, errors: [], waitingForParts: r.waiting, message: r.applied ? "Resultado válido: aplicado. La clase continúa (renombrado, publicación)." : r.waiting.length ? `Parte recibida. Faltan las partes: ${r.waiting.join(", ")}.` : "Resultado válido recibido; se aplicará en cuanto el servidor termine el paso en curso." };
}

/** When every part of an audio has a valid result, merge them and move the item past the polishing step. */
export async function applyIfComplete(audioId: string): Promise<{ applied: boolean; waiting: number[] }> {
  const pk = activePackages(audioId).sort((a, b) => a.part - b.part);
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
  const now = new Date().toISOString(); const l = listPackages(); for (const p of l) if (p.audioId === audioId && p.status === "received") p.appliedAt = now; savePackages(l);
  s.persist(); void s.work();
  return { applied: true, waiting: [] };
}
/** Received results that could not be applied yet (item was busy). */
export async function applyPending() {
  const ids = new Set(listPackages().filter((p) => p.status === "received" && !p.appliedAt).map((p) => p.audioId));
  for (const id of ids) await applyIfComplete(id).catch(() => {});
}
/** Look in Drive for `<name>.ai.corregido.json` files (auto-sync pickup). */
export async function scanDrive(): Promise<{ checked: number; received: number }> {
  const pend = listPackages().filter((p) => p.status !== "superseded" && !isExpired(p) && p.parentId);
  const byParent = new Map<string, PackageMeta[]>(); for (const p of pend) byParent.set(p.parentId, [...(byParent.get(p.parentId) ?? []), p]);
  let received = 0;
  for (const [parent, list] of byParent) {
    const files = await drive.listChildren(parent);
    for (const p of list) {
      const f = files.find((x) => x.name.toLowerCase() === p.correctedName.toLowerCase());
      const seen = f?.modifiedTime ?? f?.id;
      if (!f || (p.driveSeen && p.driveSeen === seen)) continue;
      update(p.id, (x) => { x.driveSeen = seen; });
      try { const r = await receiveResult(p, await drive.readTextFile(f.id), "drive"); if (r.ok) received++; } catch { /* retried next scan when the file changes */ }
    }
  }
  return { checked: pend.length, received };
}
export const publicInfo = (p: PackageMeta) => ({ package_id: p.id, part: p.part, total: p.total, status: p.status, expiresAt: p.expiresAt, segments: p.expect.indices.length, needsMeta: p.expect.needsMeta });
