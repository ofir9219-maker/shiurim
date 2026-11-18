// Order parsing and title/newName rules (port of scripts/build-inventory.py order() and scripts/merge-polished.py checks).
export type Daf = { daf: string; amud: string };

/** Leading number of the file name ("27. x" -> "27", "4.2. x" -> "4.2"); falls back to a trailing number before the extension. */
export function parseOrder(name: string): string | null {
  let m = name.match(/^\s*(\d+(?:\.\d+)?)/);
  if (m) return m[1];
  m = name.trim().match(/(\d+(?:\.\d+)?)\s*\.\w+$/);
  return m ? m[1] : null;
}
/** Next integer after the max existing order (integer part). */
export function nextOrder(existing: (string | null | undefined)[]): string {
  let max = 0;
  for (const o of existing) { const n = parseFloat(o ?? ""); if (Number.isFinite(n) && n < 9000) max = Math.max(max, Math.floor(n)); }
  return String(max + 1);
}
export function splitExt(name: string): { base: string; ext: string } {
  const m = name.match(/^(.*?)(\.[A-Za-z0-9]{2,4})$/);
  return m ? { base: m[1], ext: m[2].toLowerCase() } : { base: name, ext: "" };
}
export const AMUD_MARK = "׳׳"; // U+05F3 twice
const NO_AMUD_WORKS = /ליקוטי|זוהר|תניא/;

/** Hebrew daf label from {daf, amud}: "ג ע׳׳א". */
const one = (d: Daf) => (d.amud ? `${d.daf} ע${AMUD_MARK}${d.amud}` : d.daf);
export function dafSpan(daf: Daf[]): string {
  const a = daf[0], b = daf[daf.length - 1];
  if (!b || (a.daf === b.daf && a.amud === b.amud)) return one(a);
  if (a.daf === b.daf) return `${a.daf} ע${AMUD_MARK}${a.amud}-ע${AMUD_MARK}${b.amud}`;
  return `${one(a)}-${one(b)}`;
}
export function buildTitle(order: string, work: string, daf: Daf[], topics: string): string {
  return `${order}. ${work} ${dafSpan(daf)} - ${topics.trim()}`;
}

/** Same checks as merge-polished.py for newName/title (+ topics length, daf shape). Returns error list. */
export function validateName(o: { order: string; ext: string; newName: string; title: string; daf?: Daf[] }): string[] {
  const errs: string[] = [];
  const nn = o.newName;
  if (!nn) return ["newName missing"];
  if (!nn.startsWith(o.order + ". ")) errs.push(`newName must start with '${o.order}. '`);
  if (o.ext && !nn.endsWith(o.ext)) errs.push(`newName must end with ${o.ext}`);
  if (!/ ע׳׳[אב]/.test(nn) && !NO_AMUD_WORKS.test(nn)) errs.push("newName needs amud as ע׳׳א / ע׳׳ב (U+05F3 twice)");
  if (!nn.includes(" - ")) errs.push("newName needs ' - ' before topics");
  if (/[\/:"]/.test(nn)) errs.push('newName contains / : or "');
  if (o.title && o.title !== (o.ext ? nn.slice(0, -o.ext.length) : nn)) errs.push("title must equal newName without extension");
  const topics = nn.split(" - ").slice(1).join(" - ").replace(o.ext ? new RegExp(`${o.ext.replace(".", "\\.")}$`) : /$^/, "");
  if (topics.length > 60) errs.push(`topics too long (${topics.length} chars, max ~50)`);
  for (const d of o.daf ?? []) {
    if (!/^[א-ת]{1,3}$/.test(d.daf)) errs.push(`daf '${d.daf}' must be Hebrew letters`);
    if (d.amud && !/^[אב]$/.test(d.amud)) errs.push(`amud '${d.amud}' must be א or ב`);
  }
  return errs;
}
export const needsAmud = (work: string) => !NO_AMUD_WORKS.test(work);
