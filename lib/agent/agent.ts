// Site Q&A agent: principal plans the search -> unified search grouped by source -> one subagent per source reads it
// in parallel (can ask for more context of that same source) -> quotes verified by code -> principal writes the answer
// with numbered, verifiable citations. Stateless server: the client keeps the "dossier" (verified readings) per chat.
import { modelLabel, type AgentSettings } from "./models";
import { AgentError, respond, respondJson, respondStream, type FnTool } from "./openai";
import { searchSite, selectSources, type Hit, type Scope } from "./search";
import { loadSource, renderUnits, srcKey, unitHref, type SourceInfo, type SourceKind, type SourceRef } from "./sources";
import { verifyQuote } from "./verify";

export type Msg = { role: "user" | "assistant"; content: string };
export type Citation = { n: number; kind: SourceKind; id: string; title: string; sub: string; key: string; label: string; startMs?: number; quote: string; href: string };
export type Reading = { kind: SourceKind; id: string; title: string; sub: string; relevant: boolean; explanation: string; quotes: Omit<Citation, "n">[]; rejected: number; model: string };
export type Dossier = { readings: Reading[]; citations: Citation[] };
export type PendingSource = { kind: SourceKind; id: string; title: string; sub: string; anchor: string; score: number };
export type AgentEvent =
  | { type: "stage"; stage: "plan" | "search" | "select" | "read" | "write"; text: string; model?: string }
  | { type: "queries"; queries: string[]; interpretation: string }
  | { type: "sources"; sources: { key: string; kind: SourceKind; title: string; sub: string; reused: boolean }[] }
  | { type: "reading"; key: string; title: string; status: "start" | "done" | "error"; model: string; verified?: number; rejected?: number; relevant?: boolean; error?: string }
  | { type: "delta"; text: string }
  | { type: "done"; answer: string; citations: Citation[]; cited: number[]; sources: string[]; pending: PendingSource[]; dossier: Dossier; mode: "search" | "dossier" | "expand" }
  | { type: "error"; message: string };

export type AgentRequest = { messages: Msg[]; dossier: Dossier; scope: Scope; settings: AgentSettings; action: "ask" | "expand"; focus?: string[]; pending?: PendingSource[]; signal?: AbortSignal };

const MAX_SOURCES = 5;

// ---------- dossier hygiene (client-supplied: re-verified against the real sources) ----------
export function cleanDossier(raw: unknown): Dossier {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<Dossier>;
  const readings: Reading[] = [];
  for (const r of (Array.isArray(d.readings) ? d.readings : []).slice(-30)) {
    if (!r || (r.kind !== "shiur" && r.kind !== "maamar") || typeof r.id !== "string") continue;
    const src = loadSource({ kind: r.kind, id: r.id }); if (!src) continue;
    const quotes = (Array.isArray(r.quotes) ? r.quotes : []).slice(0, 12).flatMap((q) => {
      if (!q || typeof q.quote !== "string" || typeof q.key !== "string") return [];
      const v = verifyQuote(src.units, q.quote, q.key, q.key);
      return v.ok ? [mkQuote(src, q.quote, v.from)] : [];
    });
    readings.push({ kind: r.kind, id: r.id, title: src.title, sub: src.sub, relevant: !!r.relevant, explanation: String(r.explanation ?? "").slice(0, 2500), quotes, rejected: Number(r.rejected) || 0, model: String(r.model ?? "").slice(0, 40) });
  }
  return { readings, citations: numberCitations(readings, Array.isArray(d.citations) ? d.citations : []) };
}
function mkQuote(src: SourceInfo, quote: string, from: number): Omit<Citation, "n"> {
  const u = src.units[from];
  return { kind: src.kind, id: src.id, title: src.title, sub: src.sub, key: u.key, label: u.label, startMs: u.startMs, quote: quote.trim().slice(0, 600), href: unitHref(src, u) };
}
const citeKey = (c: { kind: string; id: string; key: string; quote: string }) => `${c.kind}:${c.id}:${c.key}:${c.quote.slice(0, 60)}`;
/** Keep the numbers already shown to the user; new quotes get the next numbers. */
export function numberCitations(readings: Reading[], prev: Partial<Citation>[]): Citation[] {
  const old = new Map(prev.filter((c) => typeof c?.n === "number" && c.quote && c.key).map((c) => [citeKey(c as Citation), c.n as number]));
  let next = Math.max(0, ...old.values()) + 1;
  const out: Citation[] = [];
  for (const r of readings) for (const q of r.quotes) { const k = citeKey(q); const n = old.get(k) ?? next++; old.set(k, n); out.push({ ...q, n }); }
  return out.sort((a, b) => a.n - b.n);
}

// ---------- principal: plan ----------
type Plan = { modo: "buscar" | "citas_previas"; interpretacion: string; idioma: string; consultas: string[] };
const PLAN_SCHEMA = {
  type: "object", additionalProperties: false, required: ["modo", "interpretacion", "idioma", "consultas"],
  properties: {
    modo: { type: "string", enum: ["buscar", "citas_previas"] }, interpretacion: { type: "string" }, idioma: { type: "string" },
    consultas: { type: "array", items: { type: "string" } },
  },
};
const PLAN_INSTR = `Eres el agente principal del buscador de un sitio de Torá: clases (shiurim) transcritas en español con mucho hebreo/arameo transliterado (Berajot, Likutey Moharán…) y maamarim escritos en hebreo.
Interpreta la última pregunta del usuario dentro de la conversación y decide:
- modo "citas_previas" si la pregunta se refiere a algo ya respondido y basta con las lecturas verificadas que ya existen (p. ej. "¿dónde dice eso exactamente?", "dame la cita", "¿en qué minuto?").
- modo "buscar" en cualquier otro caso (pregunta nueva o que necesita más material).
"consultas": 4 a 8 búsquedas DISTINTAS: la pregunta autónoma (resuelve pronombres con el historial); variantes con sinónimos; las mismas ideas EN HEBREO (los maamarim están en hebreo y las clases citan hebreo) y en transliteración española habitual (teshuvá, yisurim, Rabí Yojanán); fuentes probables (ej. "ברכות ה ע״א", "Likutey Moharán 25"). Cortas (3–10 palabras).
"idioma": idioma de la pregunta del usuario (ej. "español", "hebreo", "inglés").
"interpretacion": una frase con lo que el usuario quiere saber.`;

async function plan(req: AgentRequest): Promise<Plan> {
  const last = req.messages[req.messages.length - 1]?.content ?? "";
  const hist = req.messages.slice(-8, -1).map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 900)}`).join("\n");
  const dos = req.dossier.citations.slice(-30).map((c) => `[${c.n}] ${c.title} (${c.label}): «${c.quote.slice(0, 140)}»`).join("\n");
  const input = `${hist ? `Conversación previa:\n${hist}\n\n` : ""}${dos ? `Citas verificadas ya disponibles:\n${dos}\n\n` : ""}Pregunta actual: ${last}`;
  const { data } = await respondJson<Plan>({ role: "principal", cfg: req.settings.principal, instructions: PLAN_INSTR, input, schema: { name: "plan", schema: PLAN_SCHEMA }, maxOutput: 2500, signal: req.signal });
  const consultas = [last, ...(Array.isArray(data.consultas) ? data.consultas : [])].map((s) => String(s).slice(0, 200)).filter(Boolean);
  return { modo: data.modo === "citas_previas" && req.dossier.citations.length ? "citas_previas" : "buscar", interpretacion: String(data.interpretacion ?? "").slice(0, 400), idioma: String(data.idioma ?? "español").slice(0, 40), consultas: [...new Set(consultas)].slice(0, 9) };
}

// ---------- subagent: read one source ----------
type ReadOut = { relevante: boolean; explicacion: string; citas: { texto: string; desde: string; hasta: string }[] };
const READ_SCHEMA = {
  type: "object", additionalProperties: false, required: ["relevante", "explicacion", "citas"],
  properties: {
    relevante: { type: "boolean" }, explicacion: { type: "string" },
    citas: { type: "array", items: { type: "object", additionalProperties: false, required: ["texto", "desde", "hasta"], properties: { texto: { type: "string" }, desde: { type: "string" }, hasta: { type: "string" } } } },
  },
};
const CONTEXT_TOOL: FnTool = {
  type: "function", name: "ver_contexto", strict: true,
  description: "Muestra más texto de ESTA MISMA fuente, antes o después del fragmento que ya tienes, para entender el argumento completo.",
  parameters: { type: "object", additionalProperties: false, required: ["direccion", "unidades"], properties: { direccion: { type: "string", enum: ["antes", "despues"] }, unidades: { type: "integer", description: "cuántos fragmentos más (1-25)" } } },
};
const readInstr = (lang: string, kind: SourceKind) => `Eres un subagente lector. Lees UNA sola fuente de un sitio de Torá (${kind === "shiur" ? "transcripción de una clase en español con hebreo transliterado; cada fragmento lleva su minuto" : "maamar escrito en hebreo; cada fragmento es un párrafo"}) para responder la pregunta del usuario.
Cada fragmento empieza con [id | ubicación]. Empieza por el pasaje que recibiste; si el argumento empieza antes o sigue después, usa la herramienta ver_contexto (como máximo 3 veces) hasta entenderlo.
Devuelve JSON:
- relevante: si esta fuente aporta realmente algo a la pregunta.
- explicacion (en ${lang}): qué dice esta fuente sobre la pregunta, paso a paso, con precisión; sin inventar nada que no esté en el texto.
- citas: 1 a 4 citas TEXTUALES, copiadas EXACTAMENTE del texto (mismas palabras, en su idioma original; entre 6 y 60 palabras), las más útiles para la respuesta. "desde" = id del fragmento donde empieza la cita; "hasta" = id donde termina (igual a "desde" si cabe en uno). No parafrasees dentro de una cita.`;

export async function readSource(hit: { kind: SourceKind; id: string; anchor: string }, question: string, interp: string, lang: string, req: AgentRequest): Promise<Reading> {
  const src = loadSource(hit);
  if (!src) throw new AgentError("fuente no encontrada");
  const units = src.units;
  const a = Math.max(0, units.findIndex((u) => u.key === hit.anchor));
  let lo: number, hi: number;
  if (src.kind === "maamar") { const sec = units[a].section; lo = a; hi = a; while (lo > 0 && units[lo - 1].section === sec && a - lo < 12) lo--; while (hi < units.length - 1 && units[hi + 1].section === sec && hi - a < 14) hi++; }
  else { lo = Math.max(0, a - 6); hi = Math.min(units.length - 1, a + 16); }
  const head = `Pregunta del usuario: ${question}\nLo que busca: ${interp}\nFuente: «${src.title}» — ${src.sub}\n\nFragmento encontrado (${src.units[lo].label} → ${src.units[hi].label}):\n`;
  let r = await respond({ role: "sub", cfg: req.settings.sub, instructions: readInstr(lang, src.kind), input: head + renderUnits(units.slice(lo, hi + 1)), tools: [CONTEXT_TOOL], schema: { name: "lectura", schema: READ_SCHEMA }, maxOutput: 5000, signal: req.signal });
  for (let round = 0; r.calls.length && round < 3; round++) {
    const outputs = r.calls.map((c) => {
      let args: { direccion?: string; unidades?: number } = {};
      try { args = JSON.parse(c.arguments); } catch { /* ignore */ }
      const n = Math.max(1, Math.min(25, Number(args.unidades) || 10));
      let more;
      if (args.direccion === "antes") { const nl = Math.max(0, lo - n); more = units.slice(nl, lo); lo = nl; }
      else { const nh = Math.min(units.length - 1, hi + n); more = units.slice(hi + 1, nh + 1); hi = nh; }
      return { type: "function_call_output", call_id: c.call_id, output: more.length ? renderUnits(more) : "(no hay más texto en esa dirección)" };
    });
    r = await respond({ role: "sub", cfg: req.settings.sub, instructions: readInstr(lang, src.kind), input: outputs, previousId: r.id, tools: round < 2 ? [CONTEXT_TOOL] : undefined, schema: { name: "lectura", schema: READ_SCHEMA }, maxOutput: 5000, signal: req.signal });
  }
  let out: ReadOut;
  try { out = JSON.parse(r.text); } catch { throw new AgentError(`El subagente (${modelLabel(req.settings.sub.model)}) devolvió una lectura no válida.`, "sub", req.settings.sub.model); }
  const quotes: Omit<Citation, "n">[] = []; let rejected = 0;
  for (const c of (out.citas ?? []).slice(0, 6)) {
    const v = verifyQuote(units, c.texto, c.desde, c.hasta);
    if (v.ok) quotes.push(mkQuote(src, c.texto, v.from)); else rejected++;
  }
  return { kind: src.kind, id: src.id, title: src.title, sub: src.sub, relevant: !!out.relevante && (quotes.length > 0 || !!out.explicacion), explanation: String(out.explicacion ?? "").slice(0, 2500), quotes, rejected, model: req.settings.sub.model };
}

// ---------- principal: write ----------
const writeInstr = (lang: string) => `Eres el agente principal: redactas la respuesta final para el usuario a partir de LECTURAS VERIFICADAS de fuentes del sitio (clases transcritas y maamarim).
- Responde en ${lang} (el idioma de la pregunta), salvo que el usuario pida otro. Las citas textuales van en su idioma original (hebreo, arameo o español), entre comillas «».
- Contesta directamente la pregunta al principio; luego desarrolla con orden (subtítulos "### " y listas solo si ayudan). Si hay varias fuentes, explica cómo se relacionan (coinciden, se complementan, difieren).
- Cada afirmación basada en una fuente lleva su número de cita [n] (puedes juntar [1][3]). Usa SOLO los números de la lista; nunca inventes números ni citas.
- Si el usuario pregunta dónde dice algo exactamente, indica la fuente, la ubicación (minuto o capítulo) y la cita [n] exacta.
- Si la evidencia es insuficiente o las fuentes no tratan la pregunta, dilo con claridad y explica qué sí encontraste. No completes con conocimiento externo presentado como si estuviera en las fuentes.
- No termines con ofrecimientos genéricos.`;

function evidence(readings: Reading[], cites: Citation[]): string {
  return readings.map((r, i) => {
    const qs = cites.filter((c) => c.kind === r.kind && c.id === r.id).map((c) => `  [${c.n}] (${c.label}) «${c.quote}»`).join("\n");
    return `### Fuente ${i + 1}: «${r.title}» — ${r.sub} (${r.kind === "shiur" ? "clase con audio" : "maamar"})${r.relevant ? "" : " [el lector la considera poco relevante]"}\nLectura del subagente: ${r.explanation || "(sin explicación)"}\nCitas verificadas:\n${qs || "  (ninguna)"}`;
  }).join("\n\n");
}

async function* write(req: AgentRequest, lang: string, readings: Reading[], cites: Citation[], note = ""): AsyncGenerator<string> {
  const hist = req.messages.slice(-9, -1).map((m) => ({ role: m.role, content: m.content.slice(0, 3500) }));
  const last = req.messages[req.messages.length - 1]?.content ?? "";
  const input = [...hist, { role: "user", content: `${last}\n\n---\n${note}EVIDENCIA (solo esto cuenta como fuente):\n\n${evidence(readings, cites) || "(no se encontró material)"}` }];
  yield* respondStream({ role: "principal", cfg: req.settings.principal, instructions: writeInstr(lang), input, maxOutput: 9000, signal: req.signal });
}

// ---------- orchestration ----------
async function readAll(hits: { kind: SourceKind; id: string; anchor: string; title: string }[], question: string, interp: string, lang: string, req: AgentRequest, emit: (e: AgentEvent) => void): Promise<Reading[]> {
  const model = modelLabel(req.settings.sub.model);
  const res = await Promise.all(hits.map(async (h) => {
    const key = srcKey(h);
    emit({ type: "reading", key, title: h.title, status: "start", model });
    try {
      const r = await readSource(h, question, interp, lang, req);
      emit({ type: "reading", key, title: h.title, status: "done", model, verified: r.quotes.length, rejected: r.rejected, relevant: r.relevant });
      return r;
    } catch (e) {
      emit({ type: "reading", key, title: h.title, status: "error", model, error: (e as Error).message });
      if (e instanceof AgentError && e.status && [401, 403, 404].includes(e.status)) throw e; // configuration problem: stop
      return null;
    }
  }));
  return res.filter((r): r is Reading => !!r);
}

/** Event queue so parallel readers can report progress while the generator yields. */
function channel<T>() {
  const q: T[] = []; let wake: (() => void) | null = null;
  return { push: (x: T) => { q.push(x); wake?.(); wake = null; }, async *drain(until: Promise<unknown>) {
    let done = false; until.finally(() => { done = true; wake?.(); wake = null; });
    for (;;) { while (q.length) yield q.shift()!; if (done) break; await new Promise<void>((r) => { wake = r; }); }
    while (q.length) yield q.shift()!;
  } };
}

export async function* runAgent(req: AgentRequest): AsyncGenerator<AgentEvent> {
  const P = modelLabel(req.settings.principal.model), S = modelLabel(req.settings.sub.model);
  const question = req.messages[req.messages.length - 1]?.content ?? "";
  try {
    let lang = /[א-ת]{3}/.test(question) && !/[a-záéíóúñ]{4}/i.test(question) ? "hebreo" : "el idioma de la pregunta";
    let readings: Reading[] = []; let pending: PendingSource[] = []; let mode: "search" | "dossier" | "expand" = "search";
    const prior = new Map(req.dossier.readings.map((r) => [srcKey(r), r]));
    const ch = channel<AgentEvent>();

    if (req.action === "expand") {
      mode = "expand";
      const focus = new Set(req.focus ?? []);
      readings = req.dossier.readings.filter((r) => focus.has(srcKey(r)));
      const todo = (req.pending ?? []).filter((p) => !focus.has(srcKey(p)) && loadSource(p)).slice(0, MAX_SOURCES);
      pending = (req.pending ?? []).filter((p) => !todo.includes(p) && !focus.has(srcKey(p)));
      if (!todo.length) { yield { type: "error", message: "No quedan más fuentes relevantes por leer." }; return; }
      yield { type: "stage", stage: "select", text: `Ampliando con ${todo.length} fuente(s) más` };
      yield { type: "sources", sources: todo.map((h) => ({ key: srcKey(h), kind: h.kind, title: h.title, sub: h.sub, reused: false })) };
      yield { type: "stage", stage: "read", text: `Leyendo ${todo.length} fuente(s) en paralelo`, model: S };
      const job = readAll(todo, question, "ampliar la respuesta anterior con más fuentes", lang, req, ch.push);
      yield* ch.drain(job);
      readings = [...readings, ...(await job)];
    } else {
      yield { type: "stage", stage: "plan", text: "Preparando la búsqueda", model: P };
      const pl = await plan(req);
      lang = pl.idioma || lang;
      if (pl.modo === "citas_previas") {
        mode = "dossier";
        readings = req.dossier.readings.slice(-8);
        yield { type: "queries", queries: [], interpretation: pl.interpretacion };
      } else {
        yield { type: "queries", queries: pl.consultas, interpretation: pl.interpretacion };
        yield { type: "stage", stage: "search", text: `Buscando en el sitio (${pl.consultas.length} búsquedas)` };
        const hits = await searchSite(pl.consultas, req.scope);
        const { selected, pending: rest } = selectSources(hits, MAX_SOURCES);
        pending = rest.map((h: Hit) => ({ kind: h.kind, id: h.id, title: h.title, sub: h.sub, anchor: h.anchor, score: h.score }));
        yield { type: "stage", stage: "select", text: selected.length ? `Fuentes elegidas: ${selected.length}${rest.length ? ` (quedan ${rest.length} relevantes)` : ""}` : "No se encontraron fuentes" };
        const reuse = selected.filter((h) => prior.has(srcKey(h)));
        const fresh = selected.filter((h) => !prior.has(srcKey(h)));
        yield { type: "sources", sources: selected.map((h) => ({ key: srcKey(h), kind: h.kind, title: h.title, sub: h.sub, reused: prior.has(srcKey(h)) })) };
        if (fresh.length) {
          yield { type: "stage", stage: "read", text: `Leyendo ${fresh.length} fuente(s) en paralelo`, model: S };
          const job = readAll(fresh, question, pl.interpretacion, lang, req, ch.push);
          yield* ch.drain(job);
          readings = [...reuse.map((h) => prior.get(srcKey(h))!), ...(await job)];
        } else readings = reuse.map((h) => prior.get(srcKey(h))!);
      }
    }

    // merge into the dossier (latest reading of each source wins), number the citations
    const merged = new Map(req.dossier.readings.map((r) => [srcKey(r), r]));
    for (const r of readings) merged.set(srcKey(r), r);
    const all = [...merged.values()].slice(-25);
    const citations = numberCitations(all, req.dossier.citations);
    const turnKeys = new Set(readings.map(srcKey));
    const turnCites = citations.filter((c) => turnKeys.has(`${c.kind}:${c.id}`));
    const useful = readings.filter((r) => r.relevant || r.quotes.length);

    yield { type: "stage", stage: "write", text: "Redactando la respuesta", model: P };
    let answer = "";
    const note = mode === "expand" ? "Reescribe la respuesta anterior integrando TODAS estas fuentes (las ya leídas y las nuevas).\n" : mode === "dossier" ? "Responde con las citas verificadas que ya existen.\n" : "";
    for await (const d of write(req, lang, useful.length ? useful : readings, turnCites, note)) { answer += d; yield { type: "delta", text: d }; }
    const valid = new Set(citations.map((c) => c.n));
    const cited = [...new Set([...answer.matchAll(/\[(\d{1,3})\]/g)].map((m) => Number(m[1])).filter((n) => valid.has(n)))];
    yield { type: "done", answer, citations: citations.filter((c) => turnKeys.has(`${c.kind}:${c.id}`) || cited.includes(c.n)), cited, sources: [...turnKeys], pending, dossier: { readings: all, citations }, mode };
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    console.log("agent error:", (e as Error).message);
    yield { type: "error", message: e instanceof AgentError ? e.message : `Error interno: ${(e as Error).message}` };
  }
}
