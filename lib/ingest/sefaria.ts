import { fetchRetry } from "./http";

export const validRef = (r: string) => /^[A-Za-z_]+(?:_[A-Za-z]+)*\.\d+[ab]?(?:\.\d+)?$/.test(r);
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;|&thinsp;/g, " ").replace(/\s+/g, " ").trim();
const flat = (t: unknown): string[] => (Array.isArray(t) ? t.flatMap(flat) : typeof t === "string" ? [t] : []);

/** Hebrew text of a ref as numbered lines; "" when not available. Retries 5xx (fetchRetry). */
export async function sefariaText(ref: string, maxChars = 14000): Promise<string> {
  if (!validRef(ref)) return "";
  try {
    const r = await fetchRetry(`https://www.sefaria.org/api/v3/texts/${ref}?version=hebrew`, {}, { tries: 5, baseMs: 1500 });
    if (!r.ok) return "";
    const j = (await r.json()) as { versions?: { text?: unknown }[] };
    const lines = flat(j.versions?.[0]?.text).map(strip).filter(Boolean).map((t, i) => `${i} ${t}`);
    return `## ${ref}\n${lines.join("\n")}`.slice(0, maxChars);
  } catch { return ""; }
}
