export function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Parse "90", "90s", "1:30" or "1:02:03" into milliseconds; null if invalid. */
export function parseT(v: string | null | undefined): number | null {
  if (!v) return null;
  const p = v.trim().replace(/s$/, "");
  if (/^\d+(\.\d+)?$/.test(p)) return Math.round(parseFloat(p) * 1000);
  if (/^\d+(:\d{1,2}){1,2}$/.test(p)) {
    const parts = p.split(":").map(Number);
    return parts.reduce((a, n) => a * 60 + n, 0) * 1000;
  }
  return null;
}

export type ClassSummary = {
  id: string; ord: number; ordLabel: string; title: string; fileName: string;
  daf: { daf: string; amud: string }[]; dafLabel: string; durationMs: number;
  summary: string; tags: string[]; audioUrl: string; hasTranscript: boolean; collection?: string;
};
export type Segment = { idx: number; startMs: number; endMs: number; text: string };
export type ClassFull = ClassSummary & { segments: Segment[] };

/** Display title: drops the leading "51. " and the redundant "ברכות י ע״א - " prefix (daf shows as a chip). */
export function cleanTitle(t: string): string {
  const a = t.replace(/^\s*\d+(?:\.\d+)?\s*[.\-–]\s*/, "");
  const b = a.replace(/^ברכות\s(?:(?!\s[-–]\s)[א-ת׳״'"’\-–\s]){1,40}\s[-–]\s+/, "");
  return (b.trim() || a.trim() || t).trim();
}
/** Leading daf letter of a class (used to group the list). */
export function firstDaf(c: { daf: { daf: string }[] }): string { return c.daf[0]?.daf ?? ""; }
