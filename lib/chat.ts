import { getDb, listClasses, getClass, getSegments, parseJson, type Daf } from "./db";
import { hybridSearch, ftsCount, type ChunkHit } from "./search";
import { completeLLM, llmConfig, streamLLM } from "./chat-llm";
import { capMemory, condensePrompt, memoryPrompt, mergeNoKeyMemory, needsCondense, splitForCondense } from "./chat-memory";
import {
  SYSTEM_PROMPT, NOT_FOUND, buildContext, citedMarkers, cleanText, detectIntent, evenIndexes, fmtTime, heuristicQuery,
  hitsToRefs, keywords, noAiText, quoteOf, type ChatEvent, type ChatMsg, type ChatOpts, type ClassInfo, type Hit, type Ref,
} from "./chat-core";

const TOP_K = 8;
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

async function* answer(messages: ChatMsg[], classId: string | undefined, opts: ChatOpts, memory: string): AsyncGenerator<ChatEvent> {
  const question = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  if (!getDb() || !question) {
    const text = !question ? "Escribe una pregunta sobre los shiurim." : `${NOT_FOUND}. La base de datos aún no está disponible.`;
    yield { type: "delta", text };
    yield { type: "done", refs: [], cited: [], mode: "noai" };
    return;
  }
  const history = messages.slice(0, messages.lastIndexOf(messages.filter((m) => m.role === "user").pop()!) + 1);
  const intent = detectIntent(question, classInfos(), classId);

  let context: string, refs: Ref[];
  try {
    if (intent.kind === "summary" && intent.cls && summaryContext(intent.cls.id)) {
      const s = summaryContext(intent.cls.id)!;
      refs = s.refs;
      context = `${s.header}\n\nEXTRACTOS (momentos clave, uniformemente espaciados):\n\n${buildContext(s.hits, refs, Math.floor(SUMMARY_BUDGET / TOP_K))}`;
    } else {
      const q = await rewriteQuery(history, opts, memory);
      let hits = enrich(await retrieve(q, TOP_K, classId));
      if (classId && !hits.length) {
        const s = summaryContext(classId);
        if (s) hits = s.hits;
      }
      refs = hitsToRefs(hits, TOP_K);
      context = `EXTRACTOS:\n\n${buildContext(hits, refs)}`;
    }
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
    for await (const d of streamLLM(SYSTEM_PROMPT + memoryPrompt(memory), convo, 600, opts)) { full += d; yield { type: "delta", text: d }; }
  } catch (e) {
    const note = `${full ? "\n\n" : ""}(Error al contactar la IA; muestro los pasajes encontrados.)\n${refs.map((r, i) => `[${i + 1}] ${r.title} · ${fmtTime(r.startMs)}`).join("\n")}`;
    yield { type: "delta", text: note };
    yield { type: "done", refs, cited: refs.map((_, i) => i + 1), mode: "error" };
    return;
  }
  const cited = citedMarkers(full, refs.length);
  yield { type: "done", refs, cited, mode: "ai" };
}
