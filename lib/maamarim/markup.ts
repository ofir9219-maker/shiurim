// Parse the maamar markup used by the maamar-pdf-hebreo skill into sections/blocks/notes.
//
//   TITLE: …            SUBTITLE: …          SOURCE: …          DATE: …
//   (optional) DATE_ISO: 2026-11-02   CATEGORY: גמרא / הוריות   TAGS: a, b   RAV: …
//   # פרק title                       -> new section
//   ## subtitle                       -> internal heading
//   plain line                        -> paragraph ({{note}} = footnote, <b>…</b> = bold)
//   > verbatim text (label)           -> quote box (already resolved)
//   > @REF|idx|start|end| (label)     -> quote box resolved from Sefaria at upload time
//   a quote labelled (שם) right after another quote joins the same box.
import type { Block, Note, Section } from "./types";

export type ParsedHeader = { title?: string; subtitle?: string; source?: string; date?: string; dateIso?: string; category?: string[]; tags?: string[]; rav?: string };
export type Parsed = { header: ParsedHeader; sections: Section[]; notes: Note[]; pending: { section: number; block: number; spec: string; label?: string }[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Escape everything, then re-allow <b>/<i>/<strong>/<em>/<br>. */
export function safeInline(s: string): string {
  return esc(s)
    .replace(/&lt;(\/?)(b|strong)&gt;/gi, "<$1b>")
    .replace(/&lt;(\/?)(i|em)&gt;/gi, "<$1i>")
    .replace(/&lt;br\s*\/?&gt;/gi, "<br>");
}
export const htmlToText = (h: string) => h.replace(/<sup[^>]*>.*?<\/sup>/g, "").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

const HEADER_RE = /^(TITLE|SUBTITLE|SOURCE|DATE|DATE_ISO|CATEGORY|TAGS|RAV|AUTHOR)\s*:\s*(.*)$/i;

/** Split "text (label)" -> {text, label}. The label is the last parenthesized group at the end of the line. */
export function splitLabel(s: string): { text: string; label?: string } {
  const m = s.match(/^(.*?)[\s—–-]*\(([^()]{1,80})\)\s*$/s);
  if (!m || !m[1].trim()) return { text: s.trim() };
  return { text: m[1].trim(), label: m[2].trim() };
}

export function parseMarkup(src: string): Parsed {
  const header: ParsedHeader = {};
  const sections: Section[] = [];
  const notes: Note[] = [];
  const pending: Parsed["pending"] = [];
  let cur: Section | null = null;
  const ensure = () => { if (!cur) { cur = { id: `s${sections.length + 1}`, title: "", blocks: [] }; sections.push(cur); } return cur; };
  const lines = src.replace(/\r\n?/g, "\n").replace(/^﻿/, "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const h = !sections.length ? line.match(HEADER_RE) : null;
    if (h) {
      const k = h[1].toUpperCase(), v = h[2].trim();
      if (k === "TITLE") header.title = v;
      else if (k === "SUBTITLE") header.subtitle = v;
      else if (k === "SOURCE") header.source = v;
      else if (k === "DATE") header.date = v;
      else if (k === "DATE_ISO") header.dateIso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
      else if (k === "CATEGORY") header.category = v.split(/\s*[/>›»]\s*/).map((x) => x.trim()).filter(Boolean);
      else if (k === "TAGS") header.tags = v.split(/[,،;]/).map((x) => x.trim()).filter(Boolean);
      else header.rav = v;
      continue;
    }
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      cur = { id: `s${sections.length + 1}`, title: line.replace(/^#\s+/, "").trim(), blocks: [] };
      sections.push(cur);
      continue;
    }
    const sec = ensure();
    if (/^##+\s+/.test(line)) { sec.blocks.push({ t: "h", text: line.replace(/^##+\s+/, "").trim() }); continue; }
    if (line.startsWith(">")) {
      const body = line.replace(/^>\s*/, "");
      const { text, label } = splitLabel(body);
      const prev = sec.blocks[sec.blocks.length - 1];
      const isSham = !!label && /^שם[\s,.]*$/.test(label);
      if (text.startsWith("@")) {
        const spec = text;
        if (isSham && prev?.t === "quote") { pending.push({ section: sections.length - 1, block: sec.blocks.length - 1, spec, label: "__append__" }); continue; }
        sec.blocks.push({ t: "quote", text: "", label, ref: spec.slice(1).split("|")[0].trim(), unresolved: true });
        pending.push({ section: sections.length - 1, block: sec.blocks.length - 1, spec, label });
        continue;
      }
      if (isSham && prev?.t === "quote") { prev.text = `${prev.text} ${text}`.trim(); continue; }
      sec.blocks.push({ t: "quote", text, label });
      continue;
    }
    // paragraph with footnotes
    let html = "";
    let rest = line;
    for (;;) {
      const i = rest.indexOf("{{");
      if (i < 0) { html += safeInline(rest); break; }
      const j = rest.indexOf("}}", i + 2);
      if (j < 0) { html += safeInline(rest); break; }
      html += safeInline(rest.slice(0, i));
      const n = notes.length + 1;
      notes.push({ n, html: safeInline(rest.slice(i + 2, j).trim()), section: sec.id });
      html += `<sup class="fn" data-n="${n}">${n}</sup>`;
      rest = rest.slice(j + 2);
    }
    sec.blocks.push({ t: "p", html });
  }
  // drop an empty leading section (header-only text)
  return { header, sections: sections.filter((s) => s.title || s.blocks.length), notes, pending };
}

/** Resolve the @REF quotes (Sefaria). Unresolvable ones keep a visible placeholder and are reported. */
export async function resolvePending(p: Parsed, resolve: (spec: string) => Promise<{ text: string; ref: string }>): Promise<string[]> {
  const warnings: string[] = [];
  for (const q of p.pending) {
    const block = p.sections[q.section]?.blocks[q.block];
    if (!block || block.t !== "quote") continue;
    try {
      const r = await resolve(q.spec);
      if (q.label === "__append__") block.text = `${block.text} ${r.text}`.trim();
      else { block.text = r.text; block.unresolved = false; }
    } catch (e) {
      warnings.push(`Cita ${q.spec}: ${(e as Error).message}`);
      if (q.label !== "__append__" && !block.text) block.text = `[cita pendiente: ${q.spec.slice(1).split("|")[0]}]`;
    }
  }
  return warnings;
}

export function wordCount(sections: Section[]): number {
  let n = 0;
  for (const s of sections) for (const b of s.blocks) n += (b.t === "p" ? htmlToText(b.html) : b.text).split(/\s+/).filter(Boolean).length;
  return n;
}
