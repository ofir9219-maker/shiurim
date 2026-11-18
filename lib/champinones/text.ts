// Pure text helpers (no Node-only imports): usable on server and client.

const NIKUD = /[֑-ׇ]/g;
const HTML = /<[^>]+>/g;

export function stripHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, " ").replace(HTML, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&(?:[a-z]+|#\d+);/gi, " ").replace(/\s+/g, " ").trim();
}

/** Remove nikud/cantillation, keep Hebrew letters. */
export function stripNikud(s: string): string {
  return s.replace(NIKUD, "");
}

const FINALS: Record<string, string> = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
/** Normalized Hebrew/Aramaic: no nikud, no punctuation, final letters folded, single spaces. */
export function normHe(s: string): string {
  return stripNikud(stripHtml(s))
    .replace(/[־‐-―\-–—]/g, " ")
    .replace(/[׳״'"`´‘’“”„«»()\[\]{}<>.,;:!?¿¡…*|/\\_~^=+%$#@&]/g, " ")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/\s+/g, " ")
    .trim();
}

const PREFIX = new Set(["ו", "ה", "ב", "ל", "מ", "ש", "כ", "ד"]);
/** Strip up to 2 leading clitic letters (ו ה ב ל מ ש כ ד) while at least 3 letters remain. */
export function stripPrefix(w: string): string {
  let r = w;
  for (let i = 0; i < 2; i++) {
    if (r.length >= 4 && PREFIX.has(r[0])) r = r.slice(1);
    else break;
  }
  return r;
}

export function heTokens(s: string): string[] {
  return normHe(s).split(" ").filter(Boolean);
}

export function tokMatch(h: string, t: string): boolean {
  if (h === t) return true;
  const hs = stripPrefix(h), ts = stripPrefix(t);
  if (hs === ts) return true;
  if (hs.length >= 3 && (ts.startsWith(hs) || (ts.length >= 3 && hs.startsWith(ts)))) return true;
  if (h.length >= 3 && t.includes(h)) return true;
  return false;
}

/** Index of the first token of `hook` inside `text` (tokens contiguous, modulo nikud/prefix), or -1. */
export function findHook(hook: string, text: string): number {
  const h = heTokens(hook), t = heTokens(text);
  if (!h.length || !t.length) return -1;
  for (let i = 0; i + h.length <= t.length; i++) {
    let ok = true;
    for (let k = 0; k < h.length; k++) if (!tokMatch(h[k], t[i + k])) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}
export function hookInText(hook: string, text: string): boolean {
  return findHook(hook, text) >= 0;
}

/** Is `excerpt` (may contain "…" gaps) a verbatim substring of `source`, ignoring nikud/punctuation? */
export function excerptInSource(excerpt: string, source: string): boolean {
  const src = normHe(source);
  const parts = excerpt.split(/…|\.{3}/).map((p) => normHe(p)).filter(Boolean);
  return parts.length > 0 && parts.every((p) => src.includes(p));
}

/** Best ~`win`-word window of `source` by token overlap with `excerpt`. Returns {text, score 0..1}. */
export function bestWindow(excerpt: string, source: string, win = 20): { text: string; score: number } {
  const ex = new Set(heTokens(excerpt));
  const raw = stripNikud(stripHtml(source)).split(/\s+/).filter(Boolean);
  if (!ex.size || !raw.length) return { text: "", score: 0 };
  const toks = raw.map((w) => normHe(w));
  const w = Math.min(win, raw.length);
  let best = -1, bi = 0;
  for (let i = 0; i + w <= raw.length; i++) {
    let c = 0;
    for (let k = i; k < i + w; k++) if (ex.has(toks[k])) c++;
    if (c > best) { best = c; bi = i; }
  }
  return { text: raw.slice(bi, bi + w).join(" "), score: best / ex.size };
}

const HE_STOP = new Set(("אמר אמרו אמרי ליה להו לה לי לך לא כל מאי אי אלא ההוא ההיא הוא היא הוו הוה הא הני הנך דלא ולא שלא אם או אף גם כי על אל עם מן את זה זו אין יש ויש ואין הכי כדי כמו לו לו אלו אלה מה מי איזה אבל ואם שאם אלא היה היו הוא ואמר אמרה ואמרו דאמר אמר רב רבי רבא אביי כיון כגון מנא להו תנא תנן תניא דתניא ומנא מתיב איתמר קאמר קא האי דהוה והא ובין בין מאן דאמר שאמר שהוא יהא יהיה לאו לית מיהת נמי ודאי").split(" "));
export function isHeStop(t: string): boolean { return HE_STOP.has(t) || HE_STOP.has(stripPrefix(t)); }

// ---------- language ----------
export type Lang = "es" | "en" | "he" | "fr";
const STOP: Record<string, string[]> = {
  es: "el la los las de del que y en un una es por con para qué cómo cuál hay entre sobre se su al lo como más pero sus este esta tiene tienen qué conecta barba sueño".split(" "),
  en: "the of and to in is are what how about with for that this on as by from between does do which it its at an be or not have has".split(" "),
  fr: "le la les de des du et en un une est que qui dans pour avec sur par au aux ce cette quel quelle entre comment".split(" "),
};
export function langScores(q: string): Record<string, number> {
  const words = q.toLowerCase().match(/[a-záéíóúüñàâçèêëîïôùûœ]+/g) || [];
  const sc: Record<string, number> = { es: 0, en: 0, fr: 0 };
  for (const w of words) for (const l of Object.keys(sc)) if (STOP[l].includes(w)) sc[l]++;
  if (/[¿¡]/.test(q)) sc.es += 3;
  if (/[àâçèêëîïôùûœ]/i.test(q)) sc.fr += 2;
  if (/[áéíóú]/i.test(q)) sc.es += 1;
  return sc;
}
export function detectLang(q: string): Lang {
  const heb = (q.match(/[\u0590-\u05FF]/g) || []).length;
  if (heb / ((q.match(/\p{L}/gu) || []).length || 1) > 0.4) return "he";
  const sc = langScores(q);
  const best = (Object.keys(sc) as Lang[]).sort((a, b) => sc[b] - sc[a])[0];
  return sc[best] === 0 ? "es" : best;
}
/** Heuristic verdict only when clear (top score >= 2 and double the runner-up). */
export function confidentLang(q: string): Lang | null {
  const sc = langScores(q); const o = Object.keys(sc).sort((a, b) => sc[b] - sc[a]);
  return sc[o[0]] >= 2 && sc[o[0]] >= 2 * sc[o[1]] ? (o[0] as Lang) : null;
}

const LANG_WORDS: Record<string, Lang> = {
  english: "en", inglés: "en", ingles: "en", anglais: "en", באנגלית: "en", אנגלית: "en",
  spanish: "es", español: "es", espanol: "es", castellano: "es", espagnol: "es", בספרדית: "es", ספרדית: "es",
  hebrew: "he", hebreo: "he", hébreu: "he", בעברית: "he", עברית: "he",
  french: "fr", francés: "fr", frances: "fr", français: "fr", francais: "fr", בצרפתית: "fr", צרפתית: "fr",
};
/** Explicit "respond in English / responde en hebreo / ענה בעברית" request inside the question. */
export function explicitLang(q: string): Lang | null {
  const s = q.toLowerCase();
  const m = s.match(/(?:respond|answer|reply|write|explain|speak|respuesta|responde|responda|contesta|escribe|explica|réponds|répondez|ענה|תענה|תשיב|כתוב)[^.?!\n]{0,40}?\b(?:in|into|en|à|ב)?\s*(english|inglés|ingles|anglais|spanish|español|espanol|castellano|espagnol|hebrew|hebreo|hébreu|french|francés|frances|français|francais|באנגלית|בספרדית|בעברית|בצרפתית)/i)
    || s.match(/\b(?:in|en)\s+(english|inglés|ingles|spanish|español|hebrew|hebreo|french|francés|français)\s*(?:please|por favor|$|[.?!])/i)
    || s.match(/(באנגלית|בספרדית|בעברית|בצרפתית)/);
  if (!m) return null;
  return LANG_WORDS[m[1].toLowerCase()] ?? null;
}

export const LANG_NAME: Record<string, string> = { es: "Spanish", en: "English", he: "Hebrew", fr: "French" };

// ---------- misc ----------
export function sha(s: string): string {
  // small non-crypto hash (FNV-1a 64 via two 32-bit lanes) for client+server use
  let h1 = 0x811c9dc5, h2 = 0xdeadbeef;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0; h2 ^= h2 >>> 13;
  }
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

export function normRef(r: string): string {
  return r.replace(/_/g, " ").replace(/\s+/g, " ").replace(/[–—]/g, "-").trim().toLowerCase();
}

export function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
}
