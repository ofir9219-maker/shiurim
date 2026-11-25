// AI answers over the maamarim library only: plan queries (Hebrew + Spanish) -> hybrid search -> long, structured answer with [n] citations.
import { completeLLM, llmConfig, streamLLM } from "../chat-llm";
import { capMemory, condensePrompt, memoryPrompt, mergeNoKeyMemory, needsCondense, splitForCondense } from "../chat-memory";
import type { ChatMsg, ChatOpts } from "../chat-core";
import { htmlToText } from "./markup";
import { searchMaamarim, type Passage } from "./search";
import { callNumber, getMaamar } from "./store";
import type { MChatEvent, MRef } from "./types";

const ANSWER_TOKENS = 4000;
const CONTEXT_CHARS = 42000;

const PLAN = `Eres el planificador de búsqueda de una biblioteca de maamarim (ensayos de Torá escritos en HEBREO: Guemará, Likutey Moharán, Jasidut, Tanaj, Halajá, Musar).
El usuario pregunta en cualquier idioma (a menudo español, con términos hebreos transliterados de forma inconsistente).
Devuelve SOLO JSON: {"queries":["…", "…"]} con 5 a 7 consultas DISTINTAS:
1) la pregunta como consulta autónoma en su idioma (resolviendo referencias del historial);
2-4) la misma idea EN HEBREO con los términos que usaría un maamar (ej. "teshuvá" -> "תשובה", "emuná" -> "אמונה", "Rabí Yojanán" -> "רבי יוחנן", "sufrimientos" -> "יסורים"), incluyendo sinónimos y conceptos vecinos;
5+) fuentes probables (ej. "ברכות ה ע״א יסורים של אהבה") o figuras/ideas relacionadas.
Nada de explicaciones.`;

export function answerSystem(scope?: { title: string }): string {
  return `Eres un erudito de Torá que responde EXCLUSIVAMENTE a partir de la biblioteca de maamarim que se te entrega abajo (fragmentos numerados [1], [2]…).
${scope ? `La conversación es sobre el maamar «${scope.title}».\n` : ""}
Cómo responder:
- Responde en el IDIOMA de la última pregunta del usuario, salvo que pida otro. Si los maamarim están en hebreo y la pregunta en español, explica en español y cita las frases clave en hebreo cuando aporten (breves, entre comillas, con su traducción o paráfrasis).
- Da una respuesta COMPLETA y bien desarrollada, como la daría un maestro que conoce estos textos a fondo: primero la respuesta directa en 1–3 frases; luego el desarrollo ordenado (usa subtítulos "### …", listas y **negritas** donde ayuden), las fuentes que el maamar cita (Guemará, pesukim, Rashí…), los pasos del argumento, las distinciones y matices, y cómo se conectan las ideas entre distintos maamarim si hay varios. Cierra con una síntesis breve cuando la respuesta es larga.
- Ajusta la extensión a la pregunta: una pregunta puntual merece una respuesta precisa (sin relleno); una pregunta amplia ("explícame", "qué enseña sobre…", "compara…") merece una respuesta extensa.
- Cada afirmación que venga de los maamarim lleva su cita [n] (puedes juntar varias: [2][5]). No cites números que no existan.
- No inventes: si algo no está en los fragmentos, dilo claramente ("los maamarim de la biblioteca no tratan…") y, si hay material cercano, ofrécelo. No completes con conocimiento externo presentado como si estuviera en los maamarim; si agregas contexto general imprescindible, márcalo como tal ("en general…") y sin cita.
- Fidelidad: distingue lo que el maamar dice explícitamente de tu explicación; no le atribuyas ideas, ejemplos ni distinciones que no estén en el texto.
- Menciona el maamar por su título cuando sea útil para que el lector lo busque.
- No termines con ofrecimientos genéricos ("si quieres, puedo…").`;
}

async function planQueries(messages: ChatMsg[], memory: string, opts: ChatOpts): Promise<string[]> {
  const last = messages[messages.length - 1]?.content ?? "";
  if (!llmConfig()) return [last];
  const hist = (memory ? `Memoria: ${memory.slice(0, 800)}\n` : "") + messages.slice(-6).map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 500)}`).join("\n");
  const out = await completeLLM(PLAN, [{ role: "user", content: hist }], 400, { ...opts, effort: opts.effort ? "minimal" : undefined }, true);
  try {
    const j = JSON.parse(out ?? "{}") as { queries?: unknown };
    const qs = (Array.isArray(j.queries) ? j.queries : []).filter((q): q is string => typeof q === "string" && !!q.trim()).slice(0, 8);
    return qs.length ? [last, ...qs] : [last];
  } catch { return [last]; }
}

function fullMaamarContext(id: string): { passages: Passage[] } | null {
  const m = getMaamar(id);
  if (!m) return null;
  const cn = callNumber(m);
  const passages: Passage[] = m.sections.map((s) => ({
    maamarId: m.id, title: m.title, callNumber: cn, sectionId: s.id, sectionTitle: s.title, score: 1, kinds: ["full"],
    text: [...s.blocks.map((b) => (b.t === "p" ? htmlToText(b.html) : b.t === "quote" ? `«${b.text}»${b.label ? ` (${b.label})` : ""}` : `— ${b.text} —`)),
      ...m.notes.filter((n) => n.section === s.id).map((n) => `[הערה ${n.n}] ${htmlToText(n.html)}`)].join("\n"),
  }));
  const total = passages.reduce((a, p) => a + p.text.length, 0);
  return total <= CONTEXT_CHARS ? { passages } : null;
}

const quoteOf = (t: string) => { const s = t.replace(/\s+/g, " ").trim(); return s.length > 160 ? s.slice(0, 157) + "…" : s; };

export function buildContext(passages: Passage[]): string {
  let used = 0; const parts: string[] = [];
  passages.forEach((p, i) => {
    if (used > CONTEXT_CHARS) return;
    const m = getMaamar(p.maamarId);
    const head = `[${i + 1}] «${p.title}» (סימן ${p.callNumber})${m?.ficha.rav ? `, ${m.ficha.rav}` : ""} — פרק: ${p.sectionTitle || "(sin título)"}`;
    const t = p.text.slice(0, Math.max(800, CONTEXT_CHARS - used));
    used += t.length; parts.push(`${head}\n${t}`);
  });
  return parts.join("\n\n---\n\n");
}

const cited = (text: string, n: number) => [...new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])).filter((x) => x >= 1 && x <= n))];

export async function* answerMaamarim(messages: ChatMsg[], opts: ChatOpts & { maamarId?: string } = {}, memory = ""): AsyncGenerator<MChatEvent> {
  const last = messages[messages.length - 1]?.content ?? "";
  yield { type: "status", text: "Buscando en la biblioteca…" };
  let passages: Passage[] = [];
  const scope = opts.maamarId ? getMaamar(opts.maamarId) : null;
  const full = scope ? fullMaamarContext(scope.id) : null;
  if (full) passages = full.passages;
  else {
    const queries = await planQueries(messages, memory, opts);
    passages = await searchMaamarim(queries, { k: 10, maamarId: scope?.id });
  }
  const refs: MRef[] = passages.map((p) => ({ maamarId: p.maamarId, title: p.title, sectionId: p.sectionId, sectionTitle: p.sectionTitle, quote: quoteOf(p.text), callNumber: p.callNumber }));
  if (!passages.length) {
    yield { type: "delta", text: /[א-ת]/.test(last) ? "לא מצאתי בספריית המאמרים חומר על השאלה הזאת." : "No encontré en la biblioteca de maamarim material sobre esta pregunta. Prueba con otras palabras (también en hebreo) o pregunta por un tema o fuente concreta." };
    yield { type: "done", refs: [], cited: [], mode: llmConfig() ? "ai" : "noai" };
    return;
  }
  if (!llmConfig()) {
    yield { type: "delta", text: "La IA no está configurada; estos son los pasajes más relevantes de la biblioteca:\n\n" + passages.slice(0, 6).map((p, i) => `[${i + 1}] «${p.title}» — ${p.sectionTitle}`).join("\n") };
    yield { type: "done", refs, cited: refs.map((_, i) => i + 1).slice(0, 6), mode: "noai" };
    return;
  }
  yield { type: "status", text: "Escribiendo la respuesta…" };
  const system = `${answerSystem(scope ? { title: scope.title } : undefined)}${memory ? "\n\n" + memoryPrompt(memory) : ""}\n\nBIBLIOTECA (fragmentos):\n\n${buildContext(passages)}`;
  let text = "";
  try {
    for await (const d of streamLLM(system, messages.slice(-12), ANSWER_TOKENS, opts)) { text += d; yield { type: "delta", text: d }; }
  } catch (e) {
    console.log("maamarim chat:", (e as Error).message);
    if (!text) { yield { type: "delta", text: "Hubo un error al generar la respuesta. Inténtalo de nuevo." }; yield { type: "done", refs, cited: [], mode: "error" }; return; }
  }
  let mem: { memory?: string; condensed?: number } = {};
  if (needsCondense(messages)) {
    const { older } = splitForCondense(messages);
    if (older.length) {
      const p = condensePrompt(memory, older);
      const out = await completeLLM(p.system, p.messages, 500, { ...opts, effort: opts.effort ? "minimal" : undefined });
      mem = { memory: out ? capMemory(out) : mergeNoKeyMemory(memory, older), condensed: older.length };
    }
  }
  yield { type: "done", refs, cited: cited(text, refs.length), mode: "ai", ...mem };
}
