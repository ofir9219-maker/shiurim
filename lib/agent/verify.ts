// Code verification of quotes: a quote is accepted only if its text appears in the indicated units of that source
// (ignoring nikud/ta'amim, punctuation, quote marks, case and spacing). Near misses are relocated within ±3 units.
import type { Unit } from "./sources";

export const normQ = (s: string) => s.normalize("NFKC").replace(/[֑-ׇ]/g, "").toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export type Verified = { ok: true; from: number; to: number } | { ok: false; reason: string };

/** Find the quote starting at unit index `from` (spanning up to 6 units); try the indicated range first, then nearby starts. */
export function verifyQuote(units: Unit[], quote: string, fromKey?: string, toKey?: string): Verified {
  const q = normQ(quote);
  if (q.length < 8 || q.split(" ").length < 2) return { ok: false, reason: "cita demasiado corta" };
  const idx = (k?: string) => (k ? units.findIndex((u) => u.key === k) : -1);
  const f = idx(fromKey), t = idx(toKey);
  const norm = units.map((u) => normQ(u.text));
  const spanOk = (a: number, b: number) => a >= 0 && b < units.length && norm.slice(a, b + 1).join(" ").includes(q);
  if (f >= 0) {
    const end = t >= f ? Math.min(t, f + 6) : f;
    if (spanOk(f, end)) return tighten(norm, q, f, end);
    for (const d of [1, -1, 2, -2, 3, -3]) { const a = f + d; if (a < 0 || a >= units.length) continue; for (let len = 0; len <= 5; len++) if (spanOk(a, Math.min(units.length - 1, a + len))) return tighten(norm, q, a, Math.min(units.length - 1, a + len)); }
  }
  return { ok: false, reason: f < 0 ? "ubicación inexistente" : "el texto no aparece en el pasaje indicado" };
}
/** Smallest [from,to] inside the matched span that still contains the quote. */
function tighten(norm: string[], q: string, a: number, b: number): Verified {
  let x = a, y = b;
  while (x < y && norm.slice(x + 1, y + 1).join(" ").includes(q)) x++;
  while (y > x && norm.slice(x, y).join(" ").includes(q)) y--;
  return { ok: true, from: x, to: y };
}
