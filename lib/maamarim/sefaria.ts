// Resolve `> @REF|idx|start|end| (label)` quote lines of the maamar markup to verbatim Sefaria text
// (same rules as the maamar-pdf-hebreo skill: nikud kept, ta'amim removed, search/trim on the nikud-less skeleton).
import { setupProxy } from "../proxy";

const cache = new Map<string, string[]>();

const flat = (x: unknown): string[] => (Array.isArray(x) ? x.flatMap(flat) : typeof x === "string" ? [x] : []);
const unescapeHtml = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&thinsp;/g, " ");

export function cleanSefaria(s: string): string {
  s = unescapeHtml(s.replace(/<[^>]+>/g, ""));
  s = s.replace(/[֑-֯]/g, ""); // ta'amim
  s = s.replace(/ׇ/g, "ָ").replace(/׀/g, "").replace(/‏|‎/g, "");
  s = s.replace(/\{[ספ]\}/g, "");
  s = s.replace(/\([^)]*\)\s*(?=\[)/g, ""); // ketiv before qere
  s = s.replace(/[[\]]/g, "").replace(/ /g, " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Nikud-less skeleton with a map back to positions in the original string. */
export function skeleton(s: string): { sk: string; map: number[] } {
  let sk = ""; const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x0591 && c <= 0x05c7 && c !== 0x05be && c !== 0x05c0 && c !== 0x05c3 && c !== 0x05c6) continue;
    sk += s[i]; map.push(i);
  }
  return { sk, map };
}
export const stripNikud = (s: string) => skeleton(s).sk;

export async function sefariaSegments(ref: string): Promise<string[]> {
  const hit = cache.get(ref);
  if (hit) return hit;
  setupProxy();
  const url = `https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}?version=hebrew`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Sefaria ${res.status} para ${ref}`);
  const j = (await res.json()) as { versions?: { text: unknown }[] };
  const segs = flat(j.versions?.[0]?.text).map(cleanSefaria);
  if (!segs.length) throw new Error(`Sefaria no devolvió texto para ${ref}`);
  if (cache.size > 300) cache.clear();
  cache.set(ref, segs);
  return segs;
}

/** Trim `text` from the first occurrence of `start` to the end of `end` (both compared without nikud; inclusive). */
export function trimBySkeleton(text: string, start?: string, end?: string): string | null {
  const { sk, map } = skeleton(text);
  const norm = (x: string) => stripNikud(x).replace(/\s+/g, " ").trim();
  let a = 0, b = text.length;
  if (start && norm(start)) {
    const i = sk.indexOf(norm(start));
    if (i < 0) return null;
    a = map[i];
  }
  if (end && norm(end)) {
    const from = start ? sk.indexOf(norm(start)) : 0;
    const j = sk.indexOf(norm(end), Math.max(0, from));
    if (j < 0) return null;
    const last = j + norm(end).length - 1;
    b = (map[last] ?? text.length - 1) + 1;
    while (b < text.length && /[֑-ׇ]/.test(text[b])) b++; // keep trailing nikud of the last letter
  }
  return text.slice(a, b).trim();
}

/** Resolve one `@REF|idx|start|end|` spec. idx: number or "*" (first segment containing `start`). */
export async function resolveQuote(spec: string): Promise<{ text: string; ref: string }> {
  const parts = spec.replace(/^@/, "").split("|");
  const [ref, idxRaw = "*", start = "", end = ""] = parts.map((p) => p.trim());
  if (!ref) throw new Error("referencia vacía");
  const segs = await sefariaSegments(ref);
  let idx: number;
  if (idxRaw === "*" || idxRaw === "") {
    if (!start) idx = 0;
    else {
      idx = segs.findIndex((s) => stripNikud(s).includes(stripNikud(start).replace(/\s+/g, " ").trim()));
      if (idx < 0) throw new Error(`no encontré «${start}» en ${ref}`);
    }
  } else {
    idx = Number(idxRaw);
    if (!Number.isInteger(idx) || idx < 0 || idx >= segs.length) throw new Error(`índice ${idxRaw} fuera de rango en ${ref} (0–${segs.length - 1})`);
  }
  // A range spec without idx may span segments: join from idx to the segment containing `end`.
  let text = segs[idx];
  if (end && !stripNikud(text).includes(stripNikud(end).trim()) && (idxRaw === "*" || idxRaw === "")) {
    for (let k = idx + 1; k < segs.length && k < idx + 12; k++) { text += " " + segs[k]; if (stripNikud(segs[k]).includes(stripNikud(end).trim())) break; }
  }
  const out = trimBySkeleton(text, start || undefined, end || undefined);
  if (out === null) {
    const has = (x: string) => stripNikud(text).includes(stripNikud(x).replace(/\s+/g, " ").trim());
    throw new Error(start && !has(start) ? `no encontré el inicio «${start}» en ${ref}` : end && !has(end) ? `no encontré el final «${end}» en ${ref} (revisa la ortografía exacta de Sefaria)` : `no pude recortar la cita en ${ref}`);
  }
  return { text: out, ref };
}
