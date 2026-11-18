// Polishing pipeline: pass 0 (context) -> Sefaria -> batches -> validation (merge-polished.py rules) -> meta/title.
import { CONTEXT_SCHEMA, CONTEXT_SYSTEM, META_SCHEMA, META_SYSTEM, POLISH_SCHEMA, polishSystem } from "./prompts";
import type { JsonCall, Usage } from "./openai";
import { buildTitle, validateName, needsAmud, type Daf } from "./naming";
import { pctInaudible, type Seg } from "./segments";

export type Meta = { summary: string; tags: string[]; daf: Daf[]; title: string; newName: string; needsReview?: boolean; dafNote?: string };
export type Cache = { get<T>(k: string): T | undefined; set(k: string, v: unknown): void };
export const memCache = (): Cache => { const m = new Map<string, unknown>(); return { get: (k) => m.get(k) as never, set: (k, v) => void m.set(k, v) }; };
export type PolishDeps = {
  llm: JsonCall; sefaria: (ref: string) => Promise<string>; onUsage?: (u: Usage) => void; log?: (m: string) => void;
  cache?: Cache; batchSize?: number; batchChars?: number;
};
type Ctx = { refs: { sefaria: string; work_he: string; daf_he: string; amud_he: string }[]; topics: string[]; names: string[]; citations: string[]; notes: string };

const HEB = /[֐-׿]/;
const mmss = (ms: number) => `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export const compact = (segs: Seg[], max = 260) => segs.map((s, i) => `${i} | ${mmss(s.startMs)} | ${s.text.slice(0, max)}`).join("\n");

/** Same validation as merge-polished.py for a set of polished texts (count, indexes, non-empty, no Hebrew script). */
export function validateTexts(expected: number[], got: { i: number; text: string }[]): string[] {
  const errs: string[] = [];
  const seen = new Map<number, string>();
  for (const g of got) { if (seen.has(g.i)) errs.push(`índice duplicado ${g.i}`); seen.set(g.i, (g.text ?? "").trim()); }
  const exp = new Set(expected);
  const missing = expected.filter((i) => !seen.has(i)), extra = [...seen.keys()].filter((i) => !exp.has(i));
  if (missing.length) errs.push(`faltan índices: ${missing.slice(0, 30).join(",")}`);
  if (extra.length) errs.push(`índices fuera del lote: ${extra.slice(0, 20).join(",")}`);
  const empty = [...seen].filter(([, t]) => !t).map(([i]) => i);
  if (empty.length) errs.push(`textos vacíos: ${empty.slice(0, 20).join(",")}`);
  const heb = [...seen].filter(([, t]) => HEB.test(t)).map(([i]) => i);
  if (heb.length) errs.push(`letras hebreas en los segmentos ${heb.slice(0, 20).join(",")} (debe ser transliteración latina)`);
  return errs;
}

export function makeBatches(texts: string[], size = 100, maxChars = 16000): number[][] {
  const out: number[][] = []; let cur: number[] = [], chars = 0;
  texts.forEach((t, i) => {
    if (cur.length && (cur.length >= size || chars + t.length > maxChars)) { out.push(cur); cur = []; chars = 0; }
    cur.push(i); chars += t.length;
  });
  if (cur.length) out.push(cur);
  return out;
}

async function polishTexts(label: string, src: Seg[], ctxText: string, sefaria: string, d: PolishDeps): Promise<string[]> {
  const out: string[] = new Array(src.length);
  const cache = d.cache;
  const batches = makeBatches(src.map((s) => s.text), d.batchSize ?? 100, d.batchChars ?? 16000);
  for (let b = 0; b < batches.length; b++) {
    const idx = batches[b], ck = `${label}-batch-${b}`;
    const hit = cache?.get<string[]>(ck);
    if (hit && hit.length === idx.length) { idx.forEach((i, k) => (out[i] = hit[k])); continue; }
    const prev = idx[0] > 0 ? Array.from({ length: Math.min(3, idx[0]) }, (_, k) => idx[0] - Math.min(3, idx[0]) + k) : [];
    const next = Array.from({ length: 3 }, (_, k) => idx[idx.length - 1] + 1 + k).filter((i) => i < src.length);
    const system = polishSystem(ctxText, sefaria);
    const user = [
      prev.length ? `Segmentos previos (solo lectura, ya pulidos):\n${prev.map((i) => `${i}: ${out[i] ?? src[i].text}`).join("\n")}\n` : "",
      `Segmentos a pulir:\n${JSON.stringify(idx.map((i) => ({ i, text: src[i].text })))}`,
      next.length ? `\nSegmentos siguientes (solo lectura, crudos):\n${next.map((i) => `${i}: ${src[i].text}`).join("\n")}` : "",
    ].join("\n");
    let items: { i: number; text: string }[] = [], errs: string[] = [], prevJson = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const u = attempt === 0 ? user : `${user}\n\nTU INTENTO ANTERIOR TUVO ERRORES: ${errs.join("; ")}.\nIntento anterior: ${prevJson.slice(0, 20000)}\nCorrígelo y devuelve el lote completo (todos los índices pedidos, sin letras hebreas, sin textos vacíos).`;
      const r = await d.llm<{ items: { i: number; text: string }[] }>({ system, user: u, schema: POLISH_SCHEMA, name: "polished_batch" });
      d.onUsage?.(r.usage);
      items = r.data.items; prevJson = JSON.stringify(items);
      errs = validateTexts(idx, items);
      if (!errs.length) break;
      d.log?.(`${label} lote ${b + 1}/${batches.length}: ${errs.join("; ")}${attempt === 0 ? " — reintento de reparación" : ""}`);
    }
    if (errs.length) throw new Error(`pulido ${label} lote ${b + 1}: ${errs.join("; ")}`);
    const m = new Map(items.map((x) => [x.i, x.text.trim()]));
    idx.forEach((i) => (out[i] = m.get(i)!));
    cache?.set(ck, idx.map((i) => out[i]));
    d.log?.(`${label}: lote ${b + 1}/${batches.length} pulido (${idx.length} segmentos)`);
  }
  return out;
}

export async function getContext(src: Seg[], inv: { name: string; order: string }, d: PolishDeps): Promise<{ ctx: Ctx; ctxText: string; sefaria: string }> {
  let ctx = d.cache?.get<Ctx>("context");
  if (!ctx) {
    const r = await d.llm<Ctx>({ system: CONTEXT_SYSTEM, user: `Nombre original del archivo: ${inv.name}\n\nTranscripción cruda:\n${compact(src)}`, schema: CONTEXT_SCHEMA, name: "class_context" });
    d.onUsage?.(r.usage); ctx = r.data; d.cache?.set("context", ctx);
    d.log?.(`contexto: ${ctx.refs.map((x) => x.sefaria).join(", ") || "(sin daf)"}`);
  }
  let sefaria = d.cache?.get<string>("sefaria");
  if (sefaria === undefined) {
    const parts = await Promise.all(ctx.refs.slice(0, 4).map((r) => d.sefaria(r.sefaria)));
    sefaria = parts.filter(Boolean).join("\n\n"); d.cache?.set("sefaria", sefaria);
  }
  const ctxText = [`Daf/amud: ${ctx.refs.map((r) => `${r.work_he} ${r.daf_he}${r.amud_he ? " ע׳׳" + r.amud_he : ""} (${r.sefaria})`).join("; ") || "no determinado"}`,
    `Temas: ${ctx.topics.join("; ")}`, `Nombres: ${ctx.names.join("; ")}`, `Citas: ${ctx.citations.join(" | ")}`, ctx.notes ? `Notas: ${ctx.notes}` : ""].filter(Boolean).join("\n");
  return { ctx, ctxText, sefaria };
}

export async function makeMeta(polished: Seg[], inv: { name: string; order: string; ext: string }, d: PolishDeps): Promise<Meta> {
  const base = `Nombre original del archivo: ${inv.name}\n\nTranscripción pulida:\n${compact(polished, 200)}`;
  let errs: string[] = [], prev = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = attempt === 0 ? base : `${base}\n\nTU INTENTO ANTERIOR (${prev}) TUVO ERRORES: ${errs.join("; ")}. Corrígelo.`;
    const r = await d.llm<{ summary: string; tags: string[]; daf: Daf[]; work_he: string; topics_he: string; daf_note: string }>({ system: META_SYSTEM, user, schema: META_SCHEMA, name: "class_meta" });
    d.onUsage?.(r.usage);
    const m = r.data; prev = JSON.stringify(m);
    errs = [];
    const topics = m.topics_he.replace(/[\/:"]/g, " ").replace(/\s+([,.])/g, "$1").replace(/\s+/g, " ").trim();
    const daf = m.daf.map((x) => ({ daf: x.daf.trim(), amud: x.amud.trim() }));
    if (!daf.length) errs.push("daf vacío");
    if (!m.summary?.trim()) errs.push("summary vacío");
    if (m.tags.length < 3) errs.push("tags insuficientes");
    if (!topics) errs.push("topics_he vacío");
    if (HEB.test(m.summary) || m.tags.some((t) => HEB.test(t))) { /* Hebrew allowed in tags/summary? keep: tags are Spanish per rules */ errs.push("summary y tags deben estar en español (sin letras hebreas)"); }
    if (daf.length && needsAmud(m.work_he) && daf.some((x) => !x.amud)) errs.push("falta amud (א/ב)");
    const title = errs.length ? "" : buildTitle(inv.order, m.work_he.trim(), daf, topics);
    const newName = title + inv.ext;
    if (title) errs.push(...validateName({ order: inv.order, ext: inv.ext, newName, title, daf }));
    if (!errs.length) return { summary: m.summary.trim(), tags: m.tags.map((t) => t.trim()).filter(Boolean), daf, title, newName, dafNote: m.daf_note || undefined };
    d.log?.(`meta: ${errs.join("; ")}`);
  }
  throw new Error(`meta inválida: ${errs.join("; ")}`);
}

export type PolishResult = { polished: Seg[]; gapPolished: Seg[]; meta: Meta };
export async function polishClass(o: { segments: Seg[]; gapSegments: Seg[]; inv: { name: string; order: string; ext: string } }, d: PolishDeps): Promise<PolishResult> {
  const { ctxText, sefaria } = await getContext(o.segments, o.inv, d);
  const texts = await polishTexts("main", o.segments, ctxText, sefaria, d);
  const polished = o.segments.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, text: texts[i] }));
  const gt = o.gapSegments.length ? await polishTexts("gap", o.gapSegments, ctxText, sefaria, d) : [];
  const gapPolished = o.gapSegments.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, text: gt[i] }));
  const metaCached = d.cache?.get<Meta>("meta");
  const meta = metaCached ?? (await makeMeta([...polished, ...gapPolished].sort((a, b) => a.startMs - b.startMs), o.inv, d));
  d.cache?.set("meta", meta);
  if (pctInaudible([...polished, ...gapPolished].map((s) => s.text)) > 0.2) meta.needsReview = true;
  return { polished, gapPolished, meta };
}
