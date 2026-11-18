import fs from "node:fs";
import path from "node:path";
import { getClass } from "../db";
import { callJson, openaiKey, type Msg } from "./llm";
import { MODELS, DEFAULT_MODEL, DEFAULT_EFFORT, EFFORTS, FAST_MODEL, modelInfo } from "./models";
import { fetchUnits, fetchLinks, fetchRelated, searchTerm, type Unit, type LinkRow } from "./sefaria";
import { classAmudim, classesForRefs, gatherShiurim, momentExists, type Passage } from "./shiurim";
import { loadResult, resultId, saveResult } from "./store";
import { confidentLang, detectLang, explicitLang, hookInText, heTokens, isHeStop, normRef, stripNikud, stripPrefix, tokMatch, LANG_NAME, type Lang } from "./text";
import { ANALYSIS_SCHEMA, ANALYZE_SCHEMA, HOOKS_SCHEMA, PROMPT_VERSION, type Analysis, type Input, type Meta, type StreamEvent, type Usage } from "./types";
import { validateAnalysis, type ValidateCtx } from "./validate";

// ---------- prompt (fixed, loaded from file at runtime) ----------
let promptCache: { mtime: number; text: string } | null = null;
export function systemPrompt(): string {
  const p = path.join(process.cwd(), "prompts", "champinones.md");
  const m = fs.statSync(p).mtimeMs;
  if (!promptCache || promptCache.mtime !== m) promptCache = { mtime: m, text: fs.readFileSync(p, "utf8") };
  return promptCache.text;
}

const ANALYZE_SYS = `You prepare a Torah-study search for a Gemara (Masechet Berachot) study group. Given the user's question, return JSON:
- question_language: ISO 639-1 code of the question's language ("es","en","he","fr",...).
- requested_answer_language: ISO code ONLY if the user explicitly asks for the reply in a language (e.g. "respond in English", "en español", "ענה בעברית"); otherwise null.
- hebrew_terms: 3-6 key Hebrew/Aramaic words or short phrases (no nikud) exactly as they would be written in the Talmud or Tanakh (e.g. חיורתא, עת רצון, תוכו כברו, אבא בנימין).
- refs: up to 8 Sefaria refs (English format, e.g. "Berakhot 28a", "Berakhot 5b:12", "Psalms 69:14") of the passages the question is about. Amud-level refs are fine. Only refs you are confident exist; [] if unsure.
- shiur_query: a short Spanish search query in the style of a transcribed Spanish-language Gemara class, with transliterated Hebrew terms (e.g. "jivartá barba Rabí Elazar ben Azaryá").
- shiur_keywords: 2-4 single Spanish/transliterated keywords for the same.`;

const HOOKS_SYS = `You are the hook detector of the "champiñones" method. With the chip off, list ONLY literal or structural coincidences between the given texts: same word, rare form, shared root, same phrase, same verse, same name/person, number, image/object, structure, scene role. Do NOT explain depth. Prefer rare words (use the lexical_overlap list). At most 10 candidates; each hook_text must be copied literally (nikud optional) from BOTH texts a and b, and a and b are the ids (T1, T2, ...) of two DIFFERENT texts; hook_text must be a Hebrew/Aramaic word or phrase present in both. need_refs: up to 3 refs from the LINKS list you would like to read to confirm a hook ([] if none). Strict JSON.`;

// ---------- helpers ----------
export type Item = Unit & { plain: string };
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

function lexicalOverlaps(items: Item[]): string {
  const df = new Map<string, { idx: Set<number>; forms: Set<string> }>();
  items.forEach((it, i) => {
    for (const t of new Set(heTokens(it.he))) {
      const st = stripPrefix(t);
      if (st.length < 3 || isHeStop(t)) continue;
      const k = st.length >= 5 ? st.slice(0, 4) : st; // coarse root-ish key (חיורתא / חיורי -> חיור)
      const e = df.get(k) || df.set(k, { idx: new Set(), forms: new Set() }).get(k)!;
      e.idx.add(i); e.forms.add(t);
    }
  });
  const rows = [...df.entries()].filter(([, e]) => e.idx.size >= 2 && e.idx.size <= Math.max(2, Math.ceil(items.length * 0.6)))
    .sort((a, b) => b[0].length - a[0].length || a[1].idx.size - b[1].idx.size).slice(0, 36);
  return rows.map(([k, e]) => `${k} (${[...e.forms].slice(0, 4).join(", ")}): ${[...e.idx].map((i) => "T" + (i + 1)).join(" ")}`).join("\n");
}

function ctxText(items: Item[], lang: string, he = 1500, en = 800, ids = false): string {
  return items.map((it, i) => {
    const trn = lang !== "he" && it.tr && it.trLang === lang ? it.tr : it.en;
    return `  <text${ids ? ` id="T${i + 1}"` : ""} ref="${it.ref}" work="${it.work}">hebrew: ${cut(it.plain, he)}${trn ? ` | ${trn === it.en ? "english" : lang}: ${cut(trn, en)}` : ""}</text>`;
  }).join("\n");
}
function shiurText(ps: Passage[], n = 900): string {
  return ps.map((p) => `  <excerpt classId="${p.classId}" startMs="${p.startMs}" class="${p.title.replace(/"/g, "'")}" time="${p.time}">${cut(p.text, n)}</excerpt>`).join("\n");
}
const toItem = (u: Unit): Item => ({ ...u, plain: stripNikud(u.he) });

type Ana = { question_language: string; requested_answer_language: string | null; hebrew_terms: string[]; refs: string[]; shiur_query: string; shiur_keywords: string[] };
function heuristicAna(q: string): Ana {
  const heb = (q.match(/[֐-׿]+/g) || []).slice(0, 6);
  const refs = [...q.matchAll(/\b(Ber[a-z]*h?[a-z]*|Berajot|Berakhot)\s+(\d{1,2})\s*([ab])\b/gi)].map((m) => `Berakhot ${m[2]}${m[3].toLowerCase()}`);
  const kws = (q.toLowerCase().match(/[\p{L}]{5,}/gu) || []).slice(0, 4);
  return { question_language: detectLang(q), requested_answer_language: explicitLang(q), hebrew_terms: heb, refs, shiur_query: q, shiur_keywords: kws };
}

type Gathered = { items: Item[]; pool: Map<string, string>; notes: string[] };
function pickFromSection(units: Unit[], termToks: string[], maxN: number, requireHit: boolean): Unit[] {
  if (units.length <= 1) return units;
  const score = (u: Unit) => { const ts = heTokens(u.he); return termToks.filter((h) => ts.some((t) => tokMatch(h, t))).length; };
  const sc = units.map((u, i) => ({ u, i, s: score(u) }));
  const hits = sc.filter((x) => x.s > 0).sort((a, b) => b.s - a.s || a.i - b.i);
  if (!hits.length) return requireHit ? [] : units.slice(0, Math.min(2, maxN));
  const chosen = new Set<number>();
  for (const h of hits.slice(0, Math.ceil(maxN / 2))) chosen.add(h.i);
  const top = hits[0].i;
  for (const d of [1, -1, 2]) { if (chosen.size < maxN && units[top + d]) chosen.add(top + d); }
  for (const h of hits) { if (chosen.size >= maxN) break; chosen.add(h.i); }
  return [...chosen].sort((a, b) => a - b).map((i) => units[i]);
}

const CAP = 16;
async function gatherSefaria(ana: Ana, passages: Passage[], scope: string, trLang: string, classId: string | undefined, say: (d: string) => void): Promise<Gathered> {
  const items: Item[] = []; const seen = new Set<string>(); const pool = new Map<string, string>(); const notes: string[] = [];
  const add = (us: Unit[], max = CAP) => { for (const u of us) { const k = normRef(u.ref); if (seen.has(k) || items.length >= max) continue; seen.add(k); items.push(toItem(u)); } };
  const termToks = [...new Set(ana.hebrew_terms.flatMap((t) => heTokens(t)).filter((t) => t.length >= 3 && !isHeStop(t)))];
  const safe = async <T,>(p: Promise<T>, d: T): Promise<T> => { try { return await p; } catch (e: any) { notes.push("Sefaria: " + String(e?.message || e)); return d; } };

  // A: explicit refs from the question analysis
  const explicit = [...new Set(ana.refs)].slice(0, 8);
  // B: dafim of the shiur passages (the requested class first)
  const amudim: string[] = [];
  if (classId) { const c = getClass(classId); if (c) { amudim.push(...classAmudim(c.title, c.daf)); } }
  for (const p of passages.slice(0, 4)) for (const r of p.refs) if (!amudim.includes(r)) amudim.push(r);
  const bRefs = amudim.filter((r) => !explicit.some((e) => normRef(e) === normRef(r))).slice(0, 3);
  say(`${explicit.length + bRefs.length} refs`);
  const [aSets, bSets] = await Promise.all([
    Promise.all(explicit.map((r) => safe(fetchUnits(r, trLang), [] as Unit[]))),
    Promise.all(bRefs.map((r) => safe(fetchUnits(r, trLang), [] as Unit[]))),
  ]);
  aSets.forEach((us) => add(pickFromSection(us, termToks, 5, false), 8));
  bSets.forEach((us) => add(pickFromSection(us, termToks, 3, true), 12));

  // C: Sefaria search for the key terms (Bavli within scope + Tanakh)
  const filt = scope === "berakhot" ? "Talmud/Bavli/Seder Zeraim/Berakhot" : "Talmud/Bavli";
  const terms = ana.hebrew_terms.filter(Boolean).slice(0, 3);
  const searches = await Promise.all(terms.flatMap((t) => [
    safe(searchTerm(t, filt, 8), { total: 0, hits: [] }), safe(searchTerm(t, "Tanakh", 5), { total: 0, hits: [] }),
  ]));
  const talmudHits = new Map<string, number>(), tanakhHits = new Map<string, number>();
  searches.forEach((s, i) => s.hits.forEach((h, j) => {
    const m = i % 2 === 0 ? talmudHits : tanakhHits; m.set(h.ref, (m.get(h.ref) || 0) + 1 + (s.hits.length - j) / 100);
    pool.set(normRef(h.ref), h.ref);
  }));
  const topOf = (m: Map<string, number>, n: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r).filter((r) => !seen.has(normRef(r))).slice(0, n);
  const cRefs = [...topOf(talmudHits, 4), ...topOf(tanakhHits, 3)];
  const cSets = await Promise.all(cRefs.map((r) => safe(fetchUnits(r, trLang), [] as Unit[])));
  cSets.forEach((us) => add(us.slice(0, 1), 14));
  say(`${items.length} refs`);

  // D: links/related from the first Bavli anchors (verses quoted, parallels)
  const anchors = items.filter((i) => i.work === "Bavli").slice(0, 2);
  const linkSets = await Promise.all(anchors.map(async (a, i) => {
    if (i === 0) { const r = await safe(fetchRelated(a.ref), { links: [] as LinkRow[], topics: [] as string[] }); const l = await safe(fetchLinks(a.ref), [] as LinkRow[]); return [...r.links, ...l]; }
    return safe(fetchLinks(a.ref), [] as LinkRow[]);
  }));
  const own = new Set(anchors.map((a) => a.ref.split(":")[0]));
  const linkRows = linkSets.flat().filter((l) => !/commentary|reference/i.test(l.type) && /^(Tanakh|Talmud|Midrash|Mishnah)$/.test(l.category) && ![...own].some((o) => l.ref.startsWith(o)));
  const uniq = [...new Map(linkRows.map((l) => [normRef(l.ref), l])).values()];
  const rank = (l: LinkRow) => (l.category === "Tanakh" ? 0 : l.category === "Talmud" ? (scope === "berakhot" && !/^Berakhot/.test(l.ref) ? 9 : 1) : 2);
  uniq.sort((a, b) => rank(a) - rank(b));
  uniq.forEach((l) => pool.set(normRef(l.ref), l.ref));
  const dRefs = [...uniq.filter((l) => l.category === "Tanakh" && !seen.has(normRef(l.ref))).slice(0, 3), ...uniq.filter((l) => l.category !== "Tanakh" && rank(l) < 9 && !seen.has(normRef(l.ref))).slice(0, 2)].map((l) => l.ref);
  const dSets = await Promise.all(dRefs.map((r) => safe(fetchUnits(r, trLang), [] as Unit[])));
  dSets.forEach((us) => add(us.slice(0, 1), CAP));
  return { items, pool, notes };
}

type HookCand = { a: string; b: string; hook_type: string; hook_text: string; why: string };

// ---------- main ----------
export function normalizeInput(input: Input) {
  const model = MODELS.some((m) => m.id === input.model) ? input.model! : DEFAULT_MODEL;
  const effort = (EFFORTS as readonly string[]).includes(input.effort || "") ? input.effort! : DEFAULT_EFFORT;
  const scope = input.scope === "berakhot" ? "berakhot" : "shas";
  const language = input.language && input.language !== "auto" && LANG_NAME[input.language] ? input.language : undefined;
  return { question: input.question.trim().slice(0, 600), model, effort, scope, language, classId: input.classId || undefined };
}

export async function* runChampinones(raw: Input): AsyncGenerator<StreamEvent> {
  const T0 = Date.now();
  const inp = normalizeInput(raw);
  if (inp.question.length < 3) { yield { type: "error", message: "La pregunta es demasiado corta." }; return; }
  const id = resultId({ ...inp, language: inp.language });
  if (!raw.refresh) {
    const hit = loadResult(id);
    if (hit) {
      yield { type: "status", stage: "cache", label: "Resultado en caché", t: 0 };
      yield { type: "result", id, data: hit.data, meta: hit.meta, question: hit.question, cached: true };
      return;
    }
  }
  if (!openaiKey()) { yield { type: "error", message: "Falta OPENAI_API_KEY en el servidor." }; return; }
  const stages: Record<string, number> = {}; const calls: Usage[] = [];
  let tStage = Date.now(), cur = "";
  const t = () => Date.now() - T0;
  const mark = (s: string) => { if (s === cur) return; if (cur) stages[cur] = Date.now() - tStage; cur = s; tStage = Date.now(); };
  const status = (stage: string, label: string, detail?: string): StreamEvent => { mark(stage); return { type: "status", stage, label, detail, t: t() }; };

  try {
    // 0. language + terms
    yield status("lang", "Entendiendo la pregunta");
    let ana: Ana = heuristicAna(inp.question);
    try {
      const r = await callJson<Ana>({ model: FAST_MODEL, schema: ANALYZE_SCHEMA, schemaName: "analyze", maxOut: 900, messages: [{ role: "system", content: ANALYZE_SYS }, { role: "user", content: inp.question }] });
      calls.push(r.usage); ana = { ...ana, ...r.json, refs: r.json.refs || [], hebrew_terms: (r.json.hebrew_terms || []).concat(ana.hebrew_terms).slice(0, 7) };
    } catch {}
    const heur = detectLang(inp.question);
    const qLang = ((ana.question_language || "").slice(0, 2).toLowerCase() as Lang);
    const questionLang: string = heur === "he" ? "he" : confidentLang(inp.question) || (LANG_NAME[qLang] ? qLang : heur);
    const asked = inp.language || explicitLang(inp.question) || (LANG_NAME[ana.requested_answer_language || ""] ? ana.requested_answer_language! : null);
    const answerLang = asked || questionLang;
    const forced = !!asked && asked !== questionLang;
    yield status("lang", `Pregunta en ${LANG_NAME[questionLang] || questionLang}; respuesta en ${LANG_NAME[answerLang] || answerLang}`, ana.hebrew_terms.join(" · "));

    // 1. shiurim
    yield status("shiurim", "Buscando en los shiurim");
    const passages = await gatherShiurim({ question: inp.question, query: ana.shiur_query || inp.question, keywords: ana.shiur_keywords || [], classId: inp.classId, boostClassIds: classesForRefs(ana.refs || []), limit: 6 });
    yield status("shiurim", `${passages.length} pasajes de shiur`, passages.filter((p) => p.champ).length ? `${passages.filter((p) => p.champ).length} con champiñones del rabino` : undefined);

    // 2. sefaria
    yield status("sefaria", "Leyendo textos en Sefaria");
    const events: StreamEvent[] = [];
    const g = await gatherSefaria(ana, passages, inp.scope, answerLang, inp.classId, (d) => events.push(status("sefaria", "Leyendo textos en Sefaria", d)));
    for (const e of events) yield e;
    yield status("sefaria", `${g.items.length} textos reunidos`, g.items.map((i) => i.ref).slice(0, 6).join(" · "));
    if (g.items.length < 2) throw new Error("No se pudieron obtener textos de Sefaria para esta pregunta. Intenta nombrar una referencia (p. ej. «Berajot 28a») o un término en hebreo.");

    // 3. pass 1: hooks
    yield status("hooks", "Detectando ganchos textuales");
    let cands: HookCand[] = [], items = g.items;
    try {
      const user = `<question>${inp.question}</question>\n<texts>\n${ctxText(items, "en", 1200, 0, true)}\n</texts>\n<lexical_overlap>\n${lexicalOverlaps(items)}\n</lexical_overlap>\n<links>\n${[...g.pool.values()].slice(0, 20).join("\n")}\n</links>\n<shiur>\n${shiurText(passages, 300)}\n</shiur>`;
      const r = await callJson<{ candidates: HookCand[]; need_refs: string[] }>({ model: FAST_MODEL, schema: HOOKS_SCHEMA, schemaName: "hooks", maxOut: 2500, messages: [{ role: "system", content: HOOKS_SYS }, { role: "user", content: user }] });
      calls.push(r.usage);
      const byRef = new Map(items.map((i) => [normRef(i.ref), i]));
      if (process.env.CHAMP_DEBUG) console.error("PASS1", JSON.stringify(r.json));
      const byId = (x: string) => { const m = /^T(\d+)$/i.exec(x.trim()); return m ? items[Number(m[1]) - 1] : byRef.get(normRef(x)); };
      cands = (r.json.candidates || []).map((c) => ({ ...c, a: byId(c.a)?.ref ?? c.a, b: byId(c.b)?.ref ?? c.b })).filter((c) => { const A = byRef.get(normRef(c.a)), B = byRef.get(normRef(c.b)); return A && B && A !== B && hookInText(c.hook_text, A.he) && hookInText(c.hook_text, B.he); });
      const need = (r.json.need_refs || []).map((x) => g.pool.get(normRef(x))).filter((x): x is string => !!x && !byRef.has(normRef(x))).slice(0, 3);
      if (need.length && items.length < 18) {
        const sets = await Promise.all(need.map((x) => fetchUnits(x, answerLang).catch(() => [] as Unit[])));
        sets.forEach((us) => us.slice(0, 1).forEach((u) => { if (!items.some((i) => normRef(i.ref) === normRef(u.ref))) items = [...items, toItem(u)]; }));
      }
    } catch (e: any) { g.notes.push("hooks pass failed: " + String(e?.message || e)); }
    yield status("hooks", `${cands.length} ganchos candidatos verificados`, cands.slice(0, 5).map((c) => c.hook_text).join(" · "));

    // 4. pass 2: depth
    const sys = systemPrompt();
    const langNote = forced ? `\n[Explicit user request: write the answer in ${LANG_NAME[answerLang]} (answer_language "${answerLang}").]` : "";
    const user2 = `<question>${inp.question}${langNote}</question>\n<sefaria>\n${ctxText(items, answerLang)}\n</sefaria>\n<shiur>\n${shiurText(passages)}\n</shiur>\n<candidates>\n${cands.map((c) => `${c.a} <-> ${c.b} | ${c.hook_type} | ${c.hook_text} | ${c.why}`).join("\n") || "(none)"}\n</candidates>`;
    const messages: Msg[] = [{ role: "system", content: sys }, { role: "user", content: user2 }];
    yield status("depth", `Profundizando con ${inp.model}${modelInfo(inp.model).reasoning ? " · " + inp.effort : ""}`);
    let lastEmit = 0; const prog: StreamEvent[] = [];
    const deepP = callJson<Analysis>({ model: inp.model, effort: inp.effort, schema: ANALYSIS_SCHEMA, schemaName: "champinones", maxOut: 16000, stream: true, messages, onProgress: (n) => { if (Date.now() - lastEmit > 1500) { lastEmit = Date.now(); prog.push({ type: "progress", stage: "depth", chars: n, t: t() }); } } });
    let deep: Awaited<typeof deepP> | null = null, deepErr: any = null;
    deepP.then((r) => (deep = r), (e) => (deepErr = e));
    while (!deep && !deepErr) { await new Promise((r) => setTimeout(r, 700)); while (prog.length) yield prog.shift()!; if (!deep && !deepErr && Date.now() - lastEmit > 4000) { lastEmit = Date.now(); yield { type: "progress", stage: "depth", chars: 0, t: t() }; } }
    if (deepErr) throw deepErr;
    const d1 = deep as unknown as Awaited<typeof deepP>;
    calls.push(d1.usage);

    // 5. validate (+ one repair retry)
    yield status("validate", "Verificando refs, citas y ganchos");
    const vctx: ValidateCtx = {
      items: items.map((i) => ({ ref: i.ref, he: i.he })), passages, moment: momentExists, expectedLang: answerLang,
      classInfo: (cid) => { const c = getClass(cid); return c ? { title: c.title, ordLabel: c.ord_label } : null; },
    };
    let v = validateAnalysis(d1.json, vctx), retried = false;
    if (v.invalidRatio > 0.25 || (v.data.links.length === 0 && d1.json.links.length > 0)) {
      yield status("repair", "Corrigiendo elementos inválidos (un reintento)", `${v.problems.length} problemas`);
      retried = true;
      try {
        const fix: Msg[] = [...messages, { role: "assistant", content: d1.raw }, { role: "user", content: `Validation found problems:\n- ${v.problems.slice(0, 14).join("\n- ")}\nReturn the COMPLETE corrected JSON again. Use only refs and verbatim Hebrew from CONTEXT; hook_text must appear in both excerpts; shiur_refs only from CONTEXT. Keep all prose in ${LANG_NAME[answerLang]}.` }];
        const r2 = await callJson<Analysis>({ model: inp.model, effort: inp.effort, schema: ANALYSIS_SCHEMA, schemaName: "champinones", maxOut: 16000, stream: true, messages: fix });
        calls.push(r2.usage);
        const v2 = validateAnalysis(r2.json, vctx);
        if (v2.invalidRatio < v.invalidRatio || v2.data.links.length > v.data.links.length) v = v2;
      } catch (e: any) { g.notes.push("repair failed: " + String(e?.message || e)); }
    }
    mark("done");
    const data = v.data;
    data.question_language = questionLang;
    data.answer_language = answerLang; // enforced (validation flags a mismatch)
    if (g.notes.length) data.caveats = [...data.caveats, ...g.notes.map((n) => "(system) " + n)];
    const meta: Meta = {
      model: inp.model, effort: modelInfo(inp.model).reasoning ? inp.effort : "", scope: inp.scope, classId: inp.classId, promptVersion: PROMPT_VERSION, createdAt: Date.now(),
      totalMs: t(), costUsd: calls.reduce((s, c) => s + c.costUsd, 0), calls, stages,
      validation: { dropped: v.dropped, flagged: v.flagged, repaired: v.repaired, retried },
      sources: { sefariaRefs: items.length, shiurPassages: passages.length },
    };
    saveResult({ id, question: inp.question, data, meta });
    yield { type: "result", id, data, meta, question: inp.question, cached: false };
  } catch (e: any) {
    yield { type: "error", message: String(e?.message || e).slice(0, 400) };
  }
}
