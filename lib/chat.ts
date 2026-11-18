import { getDb, listClasses, getClass, getSegments, parseJson, type Daf } from "./db";
import { completeLLM, llmConfig, streamLLM, streamWithTools, type ToolDef } from "./chat-llm";
import { buildPassages, classHeaders, classIdsForDaf, classMeta, formatPassages, passageToRef, resolveClass, searchChunks, hasNormIndex, type Passage, type WeightedQuery } from "./retrieval";
import { dafToHebrew } from "./translit";
import { hybridSearch, ftsCount, type ChunkHit } from "./search";
import { capMemory, condensePrompt, memoryPrompt, mergeNoKeyMemory, needsCondense, splitForCondense } from "./chat-memory";
import {
  SYSTEM_PROMPT, NOT_FOUND, buildContext, citedMarkers, cleanText, detectIntent, evenIndexes, fmtTime, heuristicQuery,
  hitsToRefs, keywords, noAiText, quoteOf, type ChatEvent, type ChatMsg, type ChatOpts, type ClassInfo, type Hit, type Ref,
} from "./chat-core";

const TOP_K = 8;
const ANSWER_TOKENS = 1500;
const SUMMARY_BUDGET = 9000; // chars of transcript fed for a shiur summary

function classInfos(): ClassInfo[] {
  return listClasses().map((r) => ({ id: r.id, ord: r.ord, ordLabel: r.ord_label || String(r.ord), title: r.title || "", dafLabel: r.daf_label || "", tags: parseJson<string[]>(r.tags, []) }));
}

async function rewriteQuery(messages: ChatMsg[], opts: ChatOpts = {}, memory = ""): Promise<string> {
  const heur = heuristicQuery(messages, memory);
  if (!llmConfig() || (messages.length < 2 && !memory)) return heur;
  const hist = (memory ? `Memoria de la conversación: ${memory.slice(0, 800)}\n` : "") + messages.slice(-7).map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 400)}`).join("\n");
  const out = await completeLLM(
    "Reescribe la última pregunta del usuario como una consulta de búsqueda autónoma (5-10 palabras clave en español, sin pronombres, resolviendo referencias del historial). Devuelve SOLO la consulta.",
    [{ role: "user", content: hist }], 50, opts.effort ? { ...opts, effort: "minimal" } : opts
  );
  const kw = out ? keywords(out.replace(/["\n]/g, " "), 10).join(" ") : "";
  return kw || heur;
}

/** Search with fallbacks: full query, then each keyword alone. */
async function retrieve(q: string, k: number, classId?: string): Promise<Hit[]> {
  const run = async (query: string) => (await hybridSearch(query, classId ? 60 : k * 3)).filter((h) => !classId || h.classId === classId);
  let hits = await run(q);
  if (!hits.length) {
    // Rarest keywords first (most specific); try keyword pairs before single keywords so a
    // common word ("momento") does not drown the topic word ("Bilam").
    const kws = keywords(q, 6).map((k) => ({ k, n: ftsCount(k) })).filter((x) => x.n > 0).sort((a, b) => a.n - b.n).map((x) => x.k).slice(0, 4);
    const pairs: string[] = [];
    for (let i = 0; i < kws.length; i++) for (let j = i + 1; j < kws.length; j++) pairs.push(`${kws[i]} ${kws[j]}`);
    const seen = new Set<string>();
    const addAll = (list: ChunkHit[]) => { for (const h of list) { const key = `${h.classId}:${h.startMs}`; if (!seen.has(key)) { seen.add(key); hits.push(h); } } };
    for (const pq of pairs) addAll(await run(pq));
    if (hits.length < k) {
      // Interleave single-keyword results so no single keyword fills every slot.
      const lists = await Promise.all(kws.slice(0, 3).map(run));
      const inter: ChunkHit[] = [];
      for (let i = 0; i < Math.max(0, ...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) inter.push(l[i]);
      addAll(inter);
    }
  }
  return hits.map((h) => ({ classId: h.classId, title: h.title, startMs: h.startMs, text: h.text }));
}

/** FTS hits only carry a short snippet: expand to the surrounding transcript segments. */
function enrich(hits: Hit[]): Hit[] {
  const cache = new Map<string, ReturnType<typeof getSegments>>();
  const dafs = new Map<string, string>();
  return hits.map((h) => {
    if (!dafs.has(h.classId)) dafs.set(h.classId, getClass(h.classId)?.daf_label || "");
    let text = h.text;
    if (/<mark>/.test(text) || text.length < 250) {
      if (!cache.has(h.classId)) cache.set(h.classId, getSegments(h.classId));
      const segs = cache.get(h.classId)!;
      const i = segs.findIndex((s) => s.startMs === h.startMs);
      if (i >= 0) text = segs.slice(Math.max(0, i - 1), i + 3).map((s) => s.text).join(" ");
    }
    return { ...h, text: cleanText(text), dafLabel: dafs.get(h.classId) };
  });
}

function summaryContext(classId: string): { header: string; hits: Hit[]; refs: Ref[] } | null {
  const row = getClass(classId);
  if (!row) return null;
  const segs = getSegments(classId);
  const daf = parseJson<Daf[]>(row.daf, []).map((d) => `${d.daf}${d.amud ? ":" + d.amud : ""}`).join(", ");
  const header = `Shiur ${row.ord_label || row.ord}: «${row.title}»${row.daf_label || daf ? `, daf ${row.daf_label || daf}` : ""}, duración ${fmtTime(row.duration_ms || 0)}.\nResumen oficial: ${row.summary || "(sin resumen)"}`;
  const n = Math.min(TOP_K, segs.length);
  const perChunk = Math.floor(SUMMARY_BUDGET / Math.max(n, 1));
  const hits: Hit[] = evenIndexes(segs.length, n).map((idx) => {
    let text = "", j = idx;
    while (j < segs.length && text.length < perChunk) text += " " + segs[j++].text;
    return { classId, title: row.title, startMs: segs[idx].startMs, text: cleanText(text).slice(0, perChunk), dafLabel: row.daf_label };
  });
  const refs = hits.map((h) => ({ classId, title: row.title, startMs: h.startMs, quote: quoteOf(h.text) }));
  if (!refs.length && row.summary) refs.push({ classId, title: row.title, startMs: 0, quote: quoteOf(row.summary) });
  return { header, hits, refs };
}

/** Fold older turns into the rolling memory when the conversation is long. Never throws. */
export async function updateMemory(messages: ChatMsg[], memory: string, opts: ChatOpts = {}): Promise<{ memory: string; condensed: number } | null> {
  if (!needsCondense(messages)) return null;
  const { older } = splitForCondense(messages);
  if (!older.length) return null;
  let out: string | null = null;
  if (llmConfig()) {
    const p = condensePrompt(memory, older);
    out = await completeLLM(p.system, p.messages, 500, opts.effort ? { ...opts, effort: "minimal" } : opts);
  }
  return { memory: out ? capMemory(out) : mergeNoKeyMemory(memory, older), condensed: older.length };
}

/** Answer; when the conversation is long, the final event also carries the updated `memory` and `condensed` (messages folded into it). */
export async function* chat(messages: ChatMsg[], classId?: string, opts: ChatOpts = {}, memory = ""): AsyncGenerator<ChatEvent> {
  for await (const ev of answer(messages, classId, opts, memory)) {
    if (ev.type === "done") {
      const u = await updateMemory(messages, memory, opts).catch(() => null);
      yield u ? { ...ev, memory: u.memory, condensed: u.condensed } : ev;
    } else yield ev;
  }
}

// ---------- query planning ----------
export type Plan = { queries: string[]; dafHeb?: string; llm: boolean };

const PLAN_SYSTEM = `Eres el planificador de búsqueda de un buscador de transcripciones de shiurim (clases de Torá en español sobre Berajot/Talmud, Likutey Moharán, Maharal, Jasidut, etc.; términos hebreos/arameos transliterados con ortografía MUY inconsistente: jesed/hesed/chesed, Shemá/Shema/Sh'ma, kavaná/kavana, Rabí/Rabbi/Rav, tz/ts, k/q, h/j/ch).
Dada la conversación, devuelve SOLO un JSON como {"queries":["consulta 1","consulta 2","consulta 3","consulta 4"],"daf":null}, donde "queries" es una lista de CADENAS de texto (no objetos), con 4 a 6 consultas de búsqueda DISTINTAS entre sí:
1) la pregunta reescrita como consulta autónoma en español (resuelve pronombres con el historial/memoria);
2) los 2-4 términos clave (nombres de rabinos, pasukim, conceptos) solos, sin palabras de relleno;
3) los términos hebreos/arameos clave en 2-3 grafías transliteradas distintas;
4) una paráfrasis como lo diría el rav en clase (otras palabras, sinónimos);
5-6) conceptos relacionados o el contexto donde probablemente aparece (otro rabino, pasuk o sugiá vinculados).
Cada consulta tiene 2-12 palabras. Si la pregunta no está en español, tradúcela al español en las consultas. Si el usuario menciona un daf/folio concreto (p. ej. "daf 6b", "Berajot 13a"), pon "daf":"6b" (número y letra a/b opcional); si no, null. Sin texto adicional.`;

function parseDaf(d: unknown): string | undefined {
  if (typeof d !== "string" && typeof d !== "number") return undefined;
  const m = String(d).match(/(\d{1,3})/);
  return m ? dafToHebrew(Number(m[1])) || undefined : undefined;
}

export async function planQueries(history: ChatMsg[], question: string, memory: string, opts: ChatOpts): Promise<Plan> {
  const heur = heuristicQuery(history, memory);
  const base = [...new Set([heur, question.replace(/\s+/g, " ").trim().slice(0, 300)].filter(Boolean))];
  if (!llmConfig()) return { queries: base, llm: false };
  const hist = (memory ? `Memoria de la conversación: ${memory.slice(0, 800)}\n` : "") + history.slice(-7).map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 500)}`).join("\n");
  const cfg = llmConfig()!;
  const model = cfg.provider === "openai" ? process.env.CHAT_PLANNER_MODEL || "gpt-4.1-mini" : undefined;
  const out = await completeLLM(PLAN_SYSTEM, [{ role: "user", content: hist }], 450, { model }, true);
  if (out) {
    try {
      const j = JSON.parse(out.replace(/^```(?:json)?|```$/g, "").trim());
      const flat = (x: unknown): string[] => (typeof x === "string" ? [x] : Array.isArray(x) ? x.flatMap(flat) : x && typeof x === "object" ? Object.values(x).flatMap(flat) : []);
      const qs = (Array.isArray(j.queries) ? j.queries : []).map((x: unknown) => (typeof x === "string" ? x : flat(x).join(" "))).map((x: string) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 7);
      if (qs.length) return { queries: [...new Set([...qs, ...base])].slice(0, 8), dafHeb: parseDaf(j.daf), llm: true };
    } catch (e) { }
  }
  return { queries: base, llm: false };
}

// ---------- context ----------
const CONTEXT_BUDGET = 60000; // chars of transcript fed to the answer model
const EXTRA_BUDGET = 20000; // per extra `buscar` call
const NOAI_REFS = 8;

export type RetrievalState = {
  passages: Passage[]; seen: Set<number>; classId?: string; plan?: Plan; res?: Awaited<ReturnType<typeof searchChunks>>;
};

/** Multi-query retrieval -> numbered context + refs. Falls back to the legacy single-query search on DBs without the normalized index. */
export async function retrieveContext(history: ChatMsg[], question: string, classId: string | undefined, opts: ChatOpts, memory: string): Promise<{ context: string; refs: Ref[]; state?: RetrievalState }> {
  const intent = detectIntent(question, classInfos(), classId);
  if (intent.kind === "summary" && intent.cls && summaryContext(intent.cls.id)) {
    const s = summaryContext(intent.cls.id)!;
    return { refs: s.refs, context: `${s.header}\n\nEXTRACTOS (momentos clave, uniformemente espaciados):\n\n${buildContext(s.hits, s.refs, Math.floor(SUMMARY_BUDGET / TOP_K))}` };
  }
  if (!hasNormIndex()) {
    const q = await rewriteQuery(history, opts, memory);
    let hits = enrich(await retrieve(q, TOP_K, classId));
    if (classId && !hits.length) { const s = summaryContext(classId); if (s) hits = s.hits; }
    const refs = hitsToRefs(hits, TOP_K);
    return { refs, context: `EXTRACTOS:\n\n${buildContext(hits, refs)}` };
  }
  const plan = await planQueries(history, question, memory, opts);
  const light = !llmConfig();
  const wq: WeightedQuery[] = plan.queries.map((q, i) => ({ q, w: i === 0 ? 1.4 : 1 }));
  const classIds = classId ? new Set([classId]) : undefined;
  let res = await searchChunks(wq, { classIds });
  if (plan.dafHeb) {
    const dafIds = classIdsForDaf(plan.dafHeb);
    if (dafIds.size) {
      const r2 = await searchChunks(wq, { classIds: classIds ? new Set([...dafIds].filter((x) => classIds.has(x))) : dafIds, vectors: false });
      const m = new Map(res.ranked.map((r) => [r.id, r.score]));
      for (const r of r2.ranked) m.set(r.id, (m.get(r.id) || 0) + r.score * 1.5);
      res = { ...res, ranked: [...m.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score) };
    }
  }
  let passages = light ? buildPassages(res, { seeds: NOAI_REFS, expandTop: 0, budget: 12000 }) : buildPassages(res, { budget: CONTEXT_BUDGET });
  if (classId && !passages.length) {
    const s = summaryContext(classId);
    if (s) return { refs: s.refs, context: `EXTRACTOS:\n\n${buildContext(s.hits, s.refs)}` };
  }
  const refs = passages.map(passageToRef);
  const heads = light ? "" : classHeaders(res, passages);
  const state: RetrievalState = { passages, seen: new Set(passages.flatMap((p) => p.chunkIds)), classId, plan, res };
  const context = `${heads ? `CLASES MÁS RELEVANTES (resúmenes oficiales):\n${heads}\n\n` : ""}EXTRACTOS (ordenados por clase y tiempo; cada uno agrupa pasajes contiguos, con marcas de tiempo (mm:ss)):\n\n${formatPassages(passages)}`;
  return { context, refs, state };
}

/** `buscar` tool: another retrieval round that skips what the model already has; appends numbered passages. */
async function runBuscar(state: RetrievalState, refs: Ref[], args: Record<string, unknown>): Promise<string> {
  const q = typeof args.query === "string" ? args.query.trim().slice(0, 300) : "";
  if (!q) return "Falta el parámetro query.";
  let classIds: Set<string> | undefined = state.classId ? new Set([state.classId]) : undefined;
  if (!classIds && typeof args.clase === "string" && args.clase.trim()) { const c = resolveClass(args.clase); if (c.size) classIds = c; }
  const dafHeb = parseDaf(args.daf);
  const dafIds = dafHeb ? classIdsForDaf(dafHeb) : undefined;
  if (dafIds?.size) classIds = classIds ? new Set([...classIds].filter((x) => dafIds.has(x))) : dafIds;
  const res = await searchChunks([{ q, w: 1.3 }, { q: q.split(/\s+/).slice(0, 4).join(" "), w: 1 }], { classIds, exclude: state.seen });
  const ps = buildPassages(res, { seeds: 14, expandTop: 8, budget: EXTRA_BUDGET, exclude: state.seen });
  if (!ps.length) return "Sin resultados nuevos para esa búsqueda.";
  const start = refs.length + 1;
  for (const p of ps) { refs.push(passageToRef(p)); state.passages.push(p); p.chunkIds.forEach((i) => state.seen.add(i)); }
  return `EXTRACTOS NUEVOS (numerados a continuación de los anteriores):\n\n${formatPassages(ps, start)}`;
}

const BUSCAR_TOOL: ToolDef = {
  name: "buscar",
  description: "Busca más pasajes en las transcripciones de los shiurim. Úsalo (máximo 2 veces) cuando los extractos no basten: prueba otras grafías transliteradas, sinónimos, el nombre del rabino, el pasuk o un concepto relacionado. Devuelve extractos nuevos numerados a continuación.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Consulta de búsqueda en español (2-10 palabras clave)." },
      daf: { type: "string", description: "Opcional: daf (p. ej. \"6b\" o \"13\") para limitar la búsqueda." },
      clase: { type: "string", description: "Opcional: número de shiur (p. ej. \"23\") o parte del título para limitar la búsqueda." },
    },
    required: ["query"],
  },
};

async function* answer(messages: ChatMsg[], classId: string | undefined, opts: ChatOpts, memory: string): AsyncGenerator<ChatEvent> {
  const question = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  if (!getDb() || !question) {
    const text = !question ? "Escribe una pregunta sobre los shiurim." : `${NOT_FOUND}. La base de datos aún no está disponible.`;
    yield { type: "delta", text };
    yield { type: "done", refs: [], cited: [], mode: "noai" };
    return;
  }
  const history = messages.slice(0, messages.lastIndexOf(messages.filter((m) => m.role === "user").pop()!) + 1);
  let context: string, refs: Ref[], state: RetrievalState | undefined;
  try {
    ({ context, refs, state } = await retrieveContext(history, question, classId, opts, memory));
  } catch (e) {
    yield { type: "delta", text: "Ocurrió un error al buscar en los shiurim." };
    yield { type: "done", refs: [], cited: [], mode: "error" };
    return;
  }

  if (!llmConfig()) {
    yield { type: "delta", text: noAiText(refs) };
    yield { type: "done", refs, cited: refs.map((_, i) => i + 1), mode: "noai" };
    return;
  }
  if (!refs.length) {
    yield { type: "delta", text: `${NOT_FOUND}.` };
    yield { type: "done", refs: [], cited: [], mode: "ai" };
    return;
  }

  const convo: ChatMsg[] = history.slice(-7, -1).map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  // Anthropic requires the first message to be a user message.
  while (convo.length && convo[0].role !== "user") convo.shift();
  convo.push({ role: "user", content: `${context}\n\nPREGUNTA: ${question}` });

  let full = "";
  try {
    const gen = state && llmConfig()?.provider === "openai"
      ? streamWithTools(SYSTEM_PROMPT + memoryPrompt(memory), convo, [BUSCAR_TOOL], (_n, a) => runBuscar(state!, refs, a), ANSWER_TOKENS, opts, 2)
      : streamLLM(SYSTEM_PROMPT + memoryPrompt(memory), convo, ANSWER_TOKENS, opts);
    for await (const d of gen) { full += d; yield { type: "delta", text: d }; }
  } catch (e) {
    const note = `${full ? "\n\n" : ""}(Error al contactar la IA; muestro los pasajes encontrados.)\n${refs.map((r, i) => `[${i + 1}] ${r.title} · ${fmtTime(r.startMs)}`).join("\n")}`;
    yield { type: "delta", text: note };
    yield { type: "done", refs, cited: refs.map((_, i) => i + 1), mode: "error" };
    return;
  }
  const cited = citedMarkers(full, refs.length);
  yield { type: "done", refs, cited, mode: "ai" };
}
