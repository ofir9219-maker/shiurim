// Markdown transcript, same format as scripts/polished-to-md.py.
import type { Daf } from "./naming";
import type { Seg } from "./segments";

const ts = (ms: number) => `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export function polishedToMd(p: { title: string; daf?: Daf[]; summary?: string; tags?: string[]; segments: Seg[] }): string {
  // Same layout as polished-to-md.py; header lines without data (raw, not polished transcripts) are left out.
  const L = [`# ${p.title}`, ""];
  if (p.daf?.length) L.push(`- **Daf:** ${p.daf.map((d) => `${d.daf} ${d.amud}`).join(", ")}`);
  if (p.summary) L.push(`- **Resumen:** ${p.summary}`);
  if (p.tags?.length) L.push(`- **Tags:** ${p.tags.join(", ")}`);
  if (L.length > 2) L.push("");
  L.push("---", "");
  for (const s of p.segments) L.push(`**[${ts(s.startMs)}]** ${s.text}\n`);
  return L.join("\n");
}
