// Naming templates: variables, rendering, validation, presets, and the JSON schema asked of the LLM (pure: also used by the admin UI preview).
import { AMUD_MARK, dafSpan, type Daf } from "../ingest/naming";

export const TEMPLATE_VARS = ["n", "obra", "daf", "amud", "temas", "tema_es", "fecha", "original", "ext", "torá", "parashá"] as const;
export type TemplateVar = (typeof TEMPLATE_VARS)[number];
/** Variables the LLM has to fill (the rest are known to the server). */
export type LlmVar = "obra" | "daf" | "temas" | "tema_es" | "torá" | "parashá";
export type Vars = { n: string; obra?: string; daf?: Daf[]; temas?: string; tema_es?: string; fecha?: string; original?: string; ext?: string; torá?: string; parashá?: string };

export const VAR_HELP: Record<TemplateVar, string> = {
  n: "número de orden (del nombre del archivo, o el siguiente libre)", obra: "obra en hebreo (ברכות)", daf: "daf en letras hebreas (ג)", amud: "amud (א / ב; con ע׳׳ y rangos si va junto a {daf})",
  temas: "2–4 temas en hebreo (≤ ~50 caracteres)", tema_es: "tema en español (≤ ~50 caracteres)", fecha: "fecha del archivo (AAAA-MM-DD)", original: "nombre original sin número ni extensión",
  ext: "extensión (se agrega sola al final si no la pones)", "torá": "número de torá de Likutey Moharán", "parashá": "parashá semanal",
};
export const PRESETS: { id: string; label: string; template: string; obra?: string }[] = [
  { id: "guemara", label: "Guemará", template: "{n}. {obra} {daf} ע׳׳{amud} - {temas}" },
  { id: "lm", label: "Likutey Moharán", template: "{n}. ליקוטי מוהר״ן {torá} - {temas}" },
  { id: "parasha", label: "Parashá", template: "{n}. {parashá} - {temas}" },
  { id: "general", label: "General", template: "{n}. {temas}" },
];
export const SAMPLE: Vars = { n: "27", obra: "ברכות", daf: [{ daf: "ז", amud: "א" }], temas: "בלעם, תשובה", tema_es: "Bilam y teshuvá", fecha: "2025-03-14", original: "Clase sobre Bilam", ext: ".m4a", torá: "יט", parashá: "בלק" };

const VAR_RE = /\{([\p{L}_]+)\}/gu;
export const templateVars = (t: string): string[] => [...new Set([...t.matchAll(VAR_RE)].map((m) => m[1]))];
const FORBIDDEN = /[\/\\:"\u0000-\u001f]/;
export const hasForbidden = (s: string) => FORBIDDEN.test(s);

export function validateTemplate(t: string): string[] {
  const errs: string[] = [];
  if (!t.trim()) return ["la plantilla está vacía"];
  const vars = templateVars(t);
  const unknown = vars.filter((v) => !(TEMPLATE_VARS as readonly string[]).includes(v));
  if (unknown.length) errs.push(`variable(s) desconocida(s): ${unknown.map((u) => `{${u}}`).join(", ")}`);
  const literal = t.replace(VAR_RE, "");
  if (hasForbidden(literal)) errs.push('la plantilla contiene / \\ : o comillas dobles, no permitidos en nombres de Drive');
  if (/[{}]/.test(literal)) errs.push("llaves sin cerrar");
  if (vars.includes("amud") && !vars.includes("daf")) errs.push("{amud} necesita {daf}");
  if (t.length > 160) errs.push("plantilla demasiado larga");
  return errs;
}
/** Which variables the LLM must provide for this template. `fixedObra` = the series sets {obra} itself. */
export function llmVarsFor(t: string, fixedObra = false): LlmVar[] {
  const v = new Set(templateVars(t)); const out: LlmVar[] = [];
  if (v.has("obra") && !fixedObra) out.push("obra");
  if (v.has("daf") || v.has("amud")) out.push("daf");
  for (const k of ["torá", "parashá", "temas", "tema_es"] as const) if (v.has(k)) out.push(k);
  return out;
}
export type SeriesKind = "talmud" | "lm" | "tanaj" | "general";
/** Series type from its template: decides the polishing prompt and whether Sefaria is consulted (only Talmud / Likutey Moharán / Tanaj). */
export function seriesKind(t: string | undefined): SeriesKind {
  const v = new Set(templateVars(t ?? ""));
  return v.has("daf") ? "talmud" : v.has("torá") ? "lm" : v.has("parashá") ? "tanaj" : "general";
}
export const metaSchemaKey = (v: LlmVar) => (v === "torá" ? "tora" : v === "parashá" ? "parasha" : v);

/** JSON schema (strict) of the meta pass: summary, tags, note + exactly the variables the template needs. */
export function buildMetaSchema(llm: LlmVar[]) {
  const props: Record<string, unknown> = {
    summary: { type: "string" }, tags: { type: "array", items: { type: "string" } }, note: { type: "string" },
  };
  for (const v of llm) {
    if (v === "daf") props.daf = { type: "array", items: { type: "object", additionalProperties: false, required: ["daf", "amud"], properties: { daf: { type: "string" }, amud: { type: "string" } } } };
    else props[metaSchemaKey(v)] = { type: "string" };
  }
  return { type: "object", additionalProperties: false, required: Object.keys(props), properties: props };
}
export function metaSystem(llm: LlmVar[], kind: SeriesKind): string {
  const R: Record<LlmVar, string> = {
    obra: "obra: nombre de la obra en hebreo (Berajot = ברכות; si la clase es de otra obra, la obra real: נדרים, הוריות, מגילה…).",
    daf: "daf: lista [{daf, amud}] en orden, con daf en letras hebreas sin puntuación (ג, יא, יג) y amud \"א\" o \"ב\" (cadena vacía solo para obras sin amud). Si abarca dos amudim, dos entradas. Basado en el CONTENIDO real; si el fragmento no permite determinarlo, conserva el daf del nombre original y dilo en note.",
    temas: "temas: 2-4 temas principales EN HEBREO, breves (máx ~50 caracteres en total), separados por coma o punto. Ej: \"רבי יוסי חורבה, גלות גאולה. תפילה\". Sin / ni : ni comillas dobles ASCII.",
    tema_es: "tema_es: el tema principal EN ESPAÑOL, breve (máx ~50 caracteres), sin / ni : ni comillas dobles.",
    "torá": "tora: número de la torá de Likutey Moharán en letras hebreas (יט, ס״ה), sin la palabra «תורה».",
    "parashá": "parasha: nombre de la parashá semanal que se estudia, en hebreo (בראשית, נח, בלק…).",
  };
  return `Generas los metadatos de una clase a partir de su transcripción ya pulida${kind === "general" ? "" : ""}.

- summary: 2-3 oraciones en español.
- tags: 5-10 tags cortos en español (en minúsculas salvo nombres propios).
${llm.map((v) => `- ${R[v]}`).join("\n")}
- note: "" o una línea con dudas (p. ej. del daf).
summary y tags: ESPAÑOL con los términos hebreos/arameos en transliteración latina (Shemá, Guemará, Berajot, Rabí Yojanán…); NUNCA letras hebreas en esos dos campos (las letras hebreas solo se usan en los campos del nombre del archivo).`;
}

const dafOnly = (d?: Daf[]) => { if (!d?.length) return ""; const a = d[0].daf, b = d[d.length - 1].daf; return a === b ? a : `${a}-${b}`; };
const amudOnly = (d?: Daf[]) => { if (!d?.length) return ""; const a = d[0].amud, b = d[d.length - 1].amud; return !a ? "" : a === b || !b ? a : `${a}-${b}`; };
/** Template -> text (no extension handling). "{daf} ע׳׳{amud}" is rendered as a unit, so ranges become "ג ע׳׳א-ע׳׳ב" / "ט ע׳׳ב-י ע׳׳א". */
export function renderTemplate(t: string, v: Vars): string {
  const pair = new RegExp(`\\{daf\\}\\s*ע${AMUD_MARK}\\{amud\\}`, "gu");
  let s = t.replace(pair, () => (v.daf?.length ? dafSpan(v.daf) : ""));
  s = s.replace(VAR_RE, (_, k: string) => {
    switch (k) {
      case "n": return v.n ?? ""; case "obra": return v.obra ?? ""; case "daf": return dafOnly(v.daf); case "amud": return amudOnly(v.daf);
      case "temas": return v.temas ?? ""; case "tema_es": return v.tema_es ?? ""; case "fecha": return v.fecha ?? ""; case "original": return v.original ?? "";
      case "ext": return v.ext ?? ""; case "torá": return v["torá"] ?? ""; case "parashá": return v["parashá"] ?? ""; default: return "";
    }
  });
  return s.replace(/\s+/g, " ").trim();
}
/** Rendered name split into title (no extension) and file name (extension appended when the template did not include it). */
export function finalName(t: string, v: Vars): { title: string; newName: string } {
  const r = renderTemplate(t, v); const ext = v.ext ?? "";
  if (ext && r.toLowerCase().endsWith(ext.toLowerCase())) return { title: r.slice(0, -ext.length), newName: r };
  return { title: r, newName: r + ext };
}
/** Strip the order prefix and extension from an original file name. */
export const cleanOriginal = (name: string) => name.replace(/\.[A-Za-z0-9]{2,4}$/, "").replace(/^\s*[\d.]+\s*[.\-–]\s*/, "").trim();
export const dateOf = (iso?: string) => (iso && /^\d{4}-\d\d-\d\d/.test(iso) ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10));
export const sanitizeTopic = (s: string) => s.replace(/[\/\\:"]/g, " ").replace(/\s+([,.])/g, "$1").replace(/\s+/g, " ").trim();

/** Server-side validation of the LLM variables and the rendered name (order prefix, extension, forbidden characters, per-variable rules). */
export function validateRendered(t: string, v: Vars): string[] {
  const errs: string[] = []; const used = new Set(templateVars(t));
  const HEBL = /^[א-ת׳״"']{1,6}$/;
  if (used.has("obra") && !v.obra?.trim()) errs.push("obra vacía");
  if (used.has("daf") || used.has("amud")) {
    if (!v.daf?.length) errs.push("daf vacío");
    for (const d of v.daf ?? []) {
      if (!/^[א-ת]{1,3}$/.test(d.daf)) errs.push(`daf '${d.daf}' debe ser letras hebreas sin puntuación`);
      if (used.has("amud") && !/^[אב]$/.test(d.amud)) errs.push(`amud '${d.amud}' debe ser א o ב`);
    }
  }
  for (const k of ["temas", "tema_es"] as const) if (used.has(k)) {
    const x = (v[k] ?? "").trim();
    if (!x) errs.push(`${k} vacío`); else if (x.length > 60) errs.push(`${k} demasiado largo (${x.length} caracteres, máx ~50)`);
    if (k === "temas" && x && !/[א-ת]/.test(x)) errs.push("temas debe estar en hebreo");
    if (k === "tema_es" && /[א-ת]/.test(x)) errs.push("tema_es debe estar en español");
  }
  if (used.has("torá") && !(v["torá"] && /[א-ת]/.test(v["torá"]))) errs.push("torá debe ir en letras hebreas");
  if (used.has("parashá") && !(v["parashá"] && /[א-ת]/.test(v["parashá"]))) errs.push("parashá debe ir en hebreo");
  void HEBL;
  const { title, newName } = finalName(t, v);
  if (!title) errs.push("el nombre quedó vacío");
  if (hasForbidden(newName)) errs.push('el nombre contiene / \\ : o comillas dobles');
  if (t.trimStart().startsWith("{n}") && v.n && !newName.startsWith(v.n)) errs.push(`el nombre debe empezar por el número de orden '${v.n}'`);
  if (v.ext && !newName.toLowerCase().endsWith(v.ext.toLowerCase())) errs.push(`el nombre debe terminar en ${v.ext}`);
  if (/\{|\}/.test(newName)) errs.push("quedó una variable sin reemplazar");
  if (newName.length > 200) errs.push("nombre demasiado largo");
  return errs;
}
