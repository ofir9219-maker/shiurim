// Sources of the site as ordered "units" with an exact location: shiur = transcript segments (second in the audio),
// maamar = blocks of each chapter (paragraph anchor) + footnotes. Server only.
import { getClass, getSegments, parseJson } from "../db";
import { collectionBySlug } from "../center/collections";
import { htmlToText } from "../maamarim/markup";
import { callNumber, getMaamar } from "../maamarim/store";
import { fmtTime } from "../chat-core";

export type SourceKind = "shiur" | "maamar";
export type SourceRef = { kind: SourceKind; id: string };
export type Unit = { key: string; text: string; label: string; startMs?: number; section?: string };
export type SourceInfo = SourceRef & { title: string; sub: string; lang: "he" | "es" | "mixed"; units: Unit[] };

const cache = new Map<string, { at: number; v: SourceInfo | null }>();
export const srcKey = (s: SourceRef) => `${s.kind}:${s.id}`;

export function loadSource(s: SourceRef): SourceInfo | null {
  const k = srcKey(s), hit = cache.get(k);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  let v: SourceInfo | null = null;
  if (s.kind === "shiur") {
    const c = getClass(s.id);
    if (c) {
      const folders = parseJson<{ name: string }[]>(c.folder_path, []).map((f) => f.name);
      const series = collectionBySlug(c.collection_id || "berajot");
      v = { ...s, title: c.title, sub: [series?.settings.publish?.title || series?.name || "ברכות שר לשמחה", ...folders, c.daf_label].filter(Boolean).join(" › "), lang: "es",
        units: getSegments(s.id).map((g) => ({ key: `seg-${g.idx}`, text: g.text, label: fmtTime(g.startMs), startMs: g.startMs })) };
    }
  } else {
    const m = getMaamar(s.id);
    if (m) {
      const units: Unit[] = [];
      for (const sec of m.sections) sec.blocks.forEach((b, i) => {
        const text = b.t === "p" ? htmlToText(b.html) : b.text;
        if (text.trim()) units.push({ key: `${sec.id}-b${i}`, text: b.t === "quote" && b.label ? `${text} (${b.label})` : text, label: sec.title || sec.id, section: sec.id });
      });
      for (const n of m.notes) units.push({ key: `fn-${n.n}`, text: htmlToText(n.html), label: `הערה ${n.n}`, section: n.section });
      v = { ...s, title: m.title, sub: `סימן ${callNumber(m)}`, lang: "he", units };
    }
  }
  cache.set(k, { at: Date.now(), v });
  return v;
}

/** Public link to one unit: shiur -> class page at that second (player opens there); maamar -> paragraph anchor. */
export function unitHref(s: SourceRef, u: Unit): string {
  // tenth of a second, rounded up: the player lands inside the cited segment (not at the end of the previous one)
  return s.kind === "shiur" ? `/shiur/${s.id}?t=${Math.ceil((u.startMs ?? 0) / 100) / 10}` : `/maamarim/${s.id}#${u.key}`;
}
/** Units rendered for a reader prompt: "[seg-12 | 03:15] text". */
export const renderUnits = (us: Unit[]) => us.map((u) => `[${u.key} | ${u.label}] ${u.text}`).join("\n");
