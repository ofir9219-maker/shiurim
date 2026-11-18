// Markdown transcript, same format as scripts/polished-to-md.py.
import type { Daf } from "./naming";
import type { Seg } from "./segments";

const ts = (ms: number) => `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
export function polishedToMd(p: { title: string; daf: Daf[]; summary: string; tags: string[]; segments: Seg[] }): string {
  const L = [`# ${p.title}`, "", `- **Daf:** ${p.daf.map((d) => `${d.daf} ${d.amud}`).join(", ")}`, `- **Resumen:** ${p.summary}`, `- **Tags:** ${p.tags.join(", ")}`, "", "---", ""];
  for (const s of p.segments) L.push(`**[${ts(s.startMs)}]** ${s.text}\n`);
  return L.join("\n");
}
