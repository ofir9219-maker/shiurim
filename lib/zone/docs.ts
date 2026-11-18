// Content of the AI work zone page (/ia/<token>): one source for HTML, llms.txt (plain text) and ?format=json.
// The correction rules come from prompts/polish.md as implemented in lib/ingest/prompts.ts (POLISH_RULES) and are written ONCE here, not in each job.
import { POLISH_RULES } from "../ingest/prompts";
import { BERAJOT_TEMPLATE } from "../center/collections";
import { PRESETS, SAMPLE, VAR_HELP, finalName, metaSystem } from "../center/templates";
import { JOB_FORMAT, LEASE_MINUTES, MAX_BODY, MAX_SEGMENTS_PER_PART, RESULT_FORMAT, outputSchema, type JobSummary } from "./jobs";

export type Block =
  | { t: "h2" | "h3"; id?: string; text: string }
  | { t: "p"; text: string }
  | { t: "ol" | "ul"; items: string[] }
  | { t: "pre"; text: string }
  | { t: "table"; head: string[]; rows: string[][]; links?: (string | null)[][] };

export const WORKFLOW_ES = [
  "Lista los jobs pendientes: GET /api/ia/<token>/jobs?status=pending (arreglo vacío = no queda trabajo: termina).",
  "Toma uno: POST /api/ia/<token>/jobs/<job_id>/claim. Te da un lease de 60 minutos (renovable repitiendo el claim con tu lease_id) y evita que otra IA tome el mismo job. Si responde 409 elige otro.",
  "Obtén los datos: GET /api/ia/<token>/jobs/<job_id> (el claim ya los devuelve). Los datos son solo `context` y `segments`; las reglas están en esta página, no en el job.",
  "Corrige el `text` de cada segmento siguiendo las reglas de la sección «Reglas de corrección»; si el job trae `needs_meta: true` completa también `meta` (resumen, tags y las variables del nombre listadas en `template_variables_required`). No cambies `i`, `startMs`, `endMs` ni la cantidad/orden de segmentos.",
  "Envía el resultado: POST /api/ia/<token>/jobs/<job_id>/result con Content-Type: application/json y como cuerpo SOLO el JSON del esquema «Resultado» (sin texto extra ni ```).",
  "Lee la respuesta de validación: {\"ok\":true,\"applied\":...} = aceptado; {\"ok\":false,\"errors\":[{\"where\",\"problem\"}]} = rechazado, no se aplicó nada: corrige exactamente lo que dicen los errores y vuelve a enviar a la misma URL (puedes reintentar las veces necesarias dentro del lease).",
  "Repite desde el paso 1 hasta que la lista de pendientes esté vacía. Si no puedes terminar un job: POST /api/ia/<token>/jobs/<job_id>/release.",
  "Si solo puedes navegar (sin POST con JSON): abre /ia/<token>/job/<job_id>, copia el bloque JSON, corrígelo y pega el resultado en el formulario de esa misma página.",
];
export const WORKFLOW_EN = [
  "List pending jobs: GET /api/ia/<token>/jobs?status=pending (an empty array means no work left: stop).",
  "Claim one: POST /api/ia/<token>/jobs/<job_id>/claim. You get a 60-minute lease (renewable by repeating the claim with your lease_id) so no other AI takes the same job. On 409 pick another.",
  "Fetch the data: GET /api/ia/<token>/jobs/<job_id> (the claim response already contains it). A job holds only `context` and `segments`; the rules live on this page, not in the job.",
  "Correct each segment's `text` following the section \"Correction rules\"; when the job has `needs_meta: true` also fill `meta` (summary, tags and the file-name variables listed in `template_variables_required`). Never change `i`, `startMs`, `endMs`, nor the number/order of segments.",
  "Submit: POST /api/ia/<token>/jobs/<job_id>/result with Content-Type: application/json and ONLY the JSON of the \"Result\" schema as body (no extra text, no ``` fences).",
  "Read the validation response: {\"ok\":true,\"applied\":...} = accepted; {\"ok\":false,\"errors\":[{\"where\",\"problem\"}]} = rejected, nothing was applied: fix exactly what the errors say and POST again to the same URL (retry as many times as needed within the lease).",
  "Repeat from step 1 until the pending list is empty. If you cannot finish a job: POST /api/ia/<token>/jobs/<job_id>/release.",
  "If you can only browse (no JSON POST): open /ia/<token>/job/<job_id>, copy the JSON block, correct it and paste the result into the form on that same page.",
];

const rulesBody = () => POLISH_RULES.split("\n").slice(1).join("\n").replace(/\\`/g, "`").trim();
export const RULES_ES = () => `Eres el editor de transcripciones de shiurim (clases de Torá) dados en ESPAÑOL con muchas frases en hebreo y arameo. El reconocimiento de voz destrozó las frases hebreas/arameas convirtiéndolas en palabras latinas sin sentido. Cada job es un tramo de una de esas transcripciones; su serie y tipo vienen en \`series\` y \`series_kind\`.

${rulesBody()}

### Reglas específicas por tipo de serie (\`series_kind\` del job)
- talmud (Guemará): \`context.sefaria_text\` trae el texto hebreo del daf cuando se pudo determinar; úsalo para reconstruir con exactitud las citas que el rabino lee (transliteradas).
- lm (Likutey Moharán): se estudia una torá de Likutey Moharán; reconstruye las citas con el contexto y con \`sefaria_text\` si viene.
- tanaj (parashá / Tanaj): se estudia un pasaje de la parashá; reconstruye los versículos leídos con el contexto y con \`sefaria_text\` si viene.
- general: no hay texto de Sefaria; si el rabino lee un texto en voz alta, reconstrúyelo con el contexto (transliterado).

### Reglas de seguridad del formato
- Mismo número de segmentos, mismo orden y mismos \`i\`, \`startMs\`, \`endMs\` que el job; solo cambias \`text\` (nunca vacío).
- Si \`allow_hebrew\` es false (lo normal): NUNCA letras hebreas en \`text\`, \`summary\` ni \`tags\`. Si es true se permiten solo en citas literales.
- \`context.neighbors\` (segmentos antes/después, también de la parte anterior/siguiente) es solo lectura para dar continuidad: NO los devuelvas.
- Un job con \`part\` > 1 no lleva \`meta\`.`;
export const RULES_EN = `Summary in English (the Spanish text above is authoritative): you correct speech-recognition errors of Spanish-language Torah classes with many Hebrew/Aramaic phrases. Be CONSERVATIVE: fix recognition errors, punctuation, word splits, capitalization, names and terms; keep the same number of segments in the same order; never translate, summarize, reorder, invent or add explanations; keep fillers (you may clean obvious stutters). All Hebrew/Aramaic must be in standard Latin transliteration (Sephardi, Spanish style: Hashem, Kadosh Baruj Hu, tefilá, Shemá, guemará, mishná, Rabí Yojanán…), NEVER Hebrew letters (unless the job says allow_hebrew=true). Unrecoverable fragments become \`[inaudible]\`. Do not include speaker labels. Use \`context.sefaria_text\` (when present) to reconstruct quoted passages. \`context.neighbors\` is read-only; do not return it.`;

export const NAMING_ES = () => {
  const ex = finalName(BERAJOT_TEMPLATE, { ...SAMPLE, n: "27", ext: ".m4a" });
  return `El job trae \`template\` (null = el nombre original se conserva y no hay variables de nombre). Tú NO escribes el nombre: rellenas variables en \`meta\` y el servidor lo renderiza y valida. Solo se piden las claves de \`template_variables_required\` (solo en la parte 1):
${(["obra", "daf", "temas", "tema_es", "torá", "parashá"] as const).map((v) => `- {${v}} → meta.${v === "torá" ? "tora" : v === "parashá" ? "parasha" : v}: ${VAR_HELP[v]}`).join("\n")}
- meta.daf es una lista [{"daf":"ג","amud":"א"}] (daf en letras hebreas sin puntuación, amud "א" o "ב"; si la clase abarca dos amudim, dos entradas; se renderiza «ג ע׳׳א», «ג ע׳׳א-ע׳׳ב», «ט ע׳׳ב-י ע׳׳א»). Se basa en el CONTENIDO real; si el fragmento no permite determinarlo, conserva el daf que sugiere \`context.daf_guess\` y explícalo en \`meta.note\`.
- meta.temas: 2-4 temas EN HEBREO, breves (≤ ~50 caracteres en total), separados por coma o punto, sin / \\ : ni comillas dobles ASCII.
- meta.tema_es: tema principal en español (≤ ~50 caracteres), sin / \\ : ni comillas dobles.
- meta.tora: número de la torá en letras hebreas (יט, ס״ה) sin la palabra «תורה». meta.parasha: nombre de la parashá en hebreo.
- Las pone el servidor (no las inventes): {n} número de orden, {fecha}, {original}, {ext} (extensión).
- Validaciones: sin / \\ : ni comillas dobles; daf en letras hebreas, amud א/ב; temas en hebreo, tema_es en español; el nombre debe empezar por el número de orden y terminar en la extensión original.
Plantillas predefinidas: ${PRESETS.map((p) => `${p.label}: ${p.template}`).join(" · ")}.
Ejemplo con la plantilla ${BERAJOT_TEMPLATE} y daf ז ע׳׳א, temas «בלעם, תשובה», n=27, ext=.m4a → ${ex.newName}`;
};

export const META_RULES = () => metaSystem(["obra", "daf", "temas", "tema_es", "torá", "parashá"], "talmud");

const exampleJob = {
  format: JOB_FORMAT, job_id: "job_0123456789abcdef", group_id: "<audio id>", part: 1, parts: 1, series: "ברכות שר לשמחה", series_kind: "talmud", title_hint: "27. clase", template: BERAJOT_TEMPLATE, naming_mode: "template",
  template_variables_required: ["obra", "daf", "temas"], needs_meta: true, meta_required: ["summary", "tags", "note", "obra", "daf", "temas"], allow_hebrew: false,
  context: { original_file_name: "27. clase.m4a", daf_guess: null, sefaria_ref: null, sefaria_text: null, neighbors: { before: [], after: [] } },
  expected_result: { format: RESULT_FORMAT, job_id: "job_0123456789abcdef", segments_count: 2, first_i: 0, last_i: 1 },
  segments: [{ i: 0, startMs: 1660, endMs: 8039, text: "Hoy estudiamos el daf guimel, meematai korin et shema beARvit." }, { i: 1, startMs: 8100, endMs: 12000, text: "Y el rabino pregunta por que empieza con la noche." }],
};
const exampleResult = {
  format: RESULT_FORMAT, job_id: "job_0123456789abcdef",
  segments: [{ i: 0, startMs: 1660, endMs: 8039, text: "Hoy estudiamos el daf guimel: «meematai korín et Shemá beArvit»." }, { i: 1, startMs: 8100, endMs: 12000, text: "Y el rabino pregunta: ¿por qué empieza con la noche?" }],
  meta: { summary: "Se estudia la primera mishná de Berajot y por qué el día comienza con la noche.", tags: ["Berajot", "Shemá", "mishná", "noche"], note: "", obra: "ברכות", daf: [{ daf: "ג", amud: "א" }], temas: "קריאת שמע, ערבית" },
};
export const EXAMPLE = { job: exampleJob, result: exampleResult };
export const RESULT_SCHEMA = () => outputSchema(true, ["obra", "daf", "temas", "tema_es", "torá", "parashá"]);

export type ApiRow = { method: string; path: string; what: string; curl: string };
export const apiRows = (api: string): ApiRow[] => [
  { method: "GET", path: "/jobs?status=pending", what: "Lista jobs. status = pending (default: lo que se puede tomar) | claimed | done | failed | all. Respuesta: [{job_id, part, parts, series, title_hint, segments_count, status, claimed_until?, last_errors?}]", curl: `curl -s "${api}/jobs?status=pending"` },
  { method: "POST", path: "/jobs/<job_id>/claim", what: `Toma el job con un lease de ${LEASE_MINUTES} min y devuelve el job + {lease_id, claimed_until}. Repite con {"lease_id":"…"} para renovar. 409 si otro lo tiene. job_id = next toma el primero disponible.`, curl: `curl -s -X POST "${api}/jobs/<job_id>/claim" -H "content-type: application/json" -d '{"holder":"mi-agente"}'` },
  { method: "GET", path: "/jobs/<job_id>", what: "Datos del job: {job_id, part, parts, series, series_kind, template, template_variables_required, needs_meta, allow_hebrew, context, segments:[{i,startMs,endMs,text}], expected_result}.", curl: `curl -s "${api}/jobs/<job_id>"` },
  { method: "POST", path: "/jobs/<job_id>/result", what: "Envía el JSON corregido (esquema «Resultado»). 200 {ok:true, applied, message, waiting_for_parts} o 422 {ok:false, errors:[{where, problem}], message}. Máx 5 MB.", curl: `curl -s -X POST "${api}/jobs/<job_id>/result" -H "content-type: application/json" --data-binary @resultado.json` },
  { method: "POST", path: "/jobs/<job_id>/release", what: "Suelta el lease (el job vuelve a pending). Opcional {\"lease_id\":\"…\"}.", curl: `curl -s -X POST "${api}/jobs/<job_id>/release"` },
];
export const ERROR_CODES = [
  "404: enlace/token inválido o job inexistente (no se revela cuál). 409: job ya tomado (claimed_until) o ya terminado. 413: cuerpo > 5 MB. 422: resultado rechazado (errors). 429: demasiadas peticiones; espera unos segundos (Retry-After).",
];

export type DocCtx = { zonePage: string; api: string; counts: { pending: number; claimed: number; done: number; failed: number }; jobs: JobSummary[]; jobPage: (id: string) => string };

/** Workflow steps with the real URLs of this zone instead of the <token> placeholder. */
export const abs = (s: string, c: Pick<DocCtx, "api" | "zonePage">) => s.replaceAll("/api/ia/<token>", c.api).replaceAll("/ia/<token>", c.zonePage);

export function buildDoc(c: DocCtx): Block[] {
  const b: Block[] = [];
  const total = c.counts.pending + c.counts.claimed + c.counts.done + c.counts.failed;
  b.push({ t: "h2", id: "estado", text: "Estado de la cola / Queue status" });
  b.push({ t: "table", head: ["pending", "claimed", "done", "failed", "total"], rows: [[c.counts.pending, c.counts.claimed, c.counts.done, c.counts.failed, total].map(String)] });
  b.push({ t: "p", text: "pending = disponible · claimed = otro agente lo tiene (lease vigente) · done = resultado válido recibido · failed = último envío rechazado (se puede volver a tomar). Los jobs se listan al final." });
  b.push({ t: "h2", id: "que-es", text: "1. Qué es esta zona y el flujo de trabajo / What this zone is and the workflow" });
  b.push({ t: "p", text: "ES: Esta es la Zona IA de las clases (shiurim) de Ofir Segal: una cola central de trabajos. Cada job es un tramo de una transcripción cruda (hasta 250 segmentos; las clases largas vienen en varias partes). Tú, una IA con acceso HTTP, tomas un job, corriges el texto con las reglas de esta página y lo devuelves; el servidor valida y, cuando todas las partes de una clase están listas, la aplica (archivos en Drive, renombrado y publicación). No necesitas login: el enlace secreto de esta página es la autorización; no lo compartas." });
  b.push({ t: "p", text: "EN: This is the AI work zone of Ofir Segal's Torah classes (shiurim): a central job queue. Each job is a slice of a raw transcript (up to 250 segments; long classes come in several parts). You, an AI with HTTP access, claim a job, correct its text with the rules on this page and return it; the server validates it and, once every part of a class is done, applies it (Drive files, renaming, publishing). No login is needed: this page's secret link is the authorization, do not share it." });
  b.push({ t: "h3", text: "Flujo en pasos" });
  b.push({ t: "ol", items: WORKFLOW_ES.map((s) => abs(s, c)) });
  b.push({ t: "h3", text: "Workflow steps" });
  b.push({ t: "ol", items: WORKFLOW_EN.map((s) => abs(s, c)) });
  b.push({ t: "p", text: `Base de la API / API base: ${c.api}` });
  b.push({ t: "h2", id: "reglas", text: "2. Reglas de corrección / Correction rules" });
  b.push({ t: "pre", text: RULES_ES() });
  b.push({ t: "pre", text: RULES_EN });
  b.push({ t: "h3", text: "Metadatos (meta) — solo en la parte 1 / Metadata (part 1 only)" });
  b.push({ t: "pre", text: `${META_RULES()}\nEn \`meta\` incluye SOLO las claves de \`template_variables_required\` además de summary, tags y note. tags: al menos 3.` });
  b.push({ t: "h3", id: "nombres", text: "Reglas de nombres (plantilla) / Naming rules" });
  b.push({ t: "pre", text: NAMING_ES() });
  b.push({ t: "h2", id: "esquema", text: "3. Resultado: esquema JSON / Result: JSON Schema" });
  b.push({ t: "p", text: `Devuelve SOLO un objeto JSON con format "${RESULT_FORMAT}" y el job_id del job. \`meta\` solo si needs_meta=true, con las claves de meta_required (summary, tags, note + variables del nombre). El esquema muestra todas las variables posibles; pide solo las de template_variables_required. Return ONLY a JSON object. Partes: ${MAX_SEGMENTS_PER_PART} segmentos como máximo por job.` });
  b.push({ t: "pre", text: JSON.stringify(RESULT_SCHEMA(), null, 1) });
  b.push({ t: "h3", text: "Ejemplo mínimo / Tiny worked example" });
  b.push({ t: "p", text: "Job recibido (recortado) / Job received (trimmed):" });
  b.push({ t: "pre", text: JSON.stringify(EXAMPLE.job, null, 1) });
  b.push({ t: "p", text: "Resultado a enviar / Result to submit:" });
  b.push({ t: "pre", text: JSON.stringify(EXAMPLE.result, null, 1) });
  b.push({ t: "h2", id: "api", text: "4. Referencia de la API / API reference" });
  b.push({ t: "p", text: `Todas las rutas cuelgan de ${c.api} (el token del enlace es la autenticación). CORS abierto; cuerpo máx. ${MAX_BODY / 1024 / 1024} MB; límite de peticiones por token. ${ERROR_CODES[0]}` });
  b.push({ t: "table", head: ["Método", "Ruta", "Qué hace", "curl"], rows: apiRows(c.api).map((r) => [r.method, r.path, r.what, r.curl]) });
  b.push({ t: "p", text: `Otras vistas de esta página: ${c.zonePage}?format=json (JSON) · ${c.zonePage}/llms.txt (texto plano) · formulario por job: ${c.zonePage}/job/<job_id> (HTML sin JavaScript).` });
  b.push({ t: "h2", id: "jobs", text: "5. Jobs (resumen) / Jobs" });
  if (!c.jobs.length) b.push({ t: "p", text: "No hay jobs en cola ahora mismo / No jobs in the queue right now." });
  else b.push({ t: "table", head: ["job_id", "parte", "serie", "título", "segmentos", "estado", "hasta"], rows: c.jobs.map((j) => [j.job_id, `${j.part}/${j.parts}`, j.series, j.title_hint, String(j.segments_count), j.status + (j.last_errors ? ` (${j.last_errors} errores)` : ""), j.claimed_until ?? ""]), links: c.jobs.map((j) => [c.jobPage(j.job_id), null, null, null, null, null, null]) });
  return b;
}

// ---------------------------------------------------------------- renderers

export const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const CSS = `body{font:16px/1.55 system-ui,sans-serif;max-width:60rem;margin:0 auto;padding:1rem 16px 4rem;color:#1a1a1a;background:#fff}
pre{background:#f4f4f4;padding:.75rem;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px;border:1px solid #ddd;border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}
code{background:#f4f4f4;padding:0 3px}textarea{width:100%;min-height:14rem;font:13px monospace}button{font-size:16px;padding:.5rem 1rem}nav a{margin-right:.75rem}
.ok{border:2px solid #1a7f37;padding:.5rem 1rem}.bad{border:2px solid #b3261e;padding:.5rem 1rem}
@media(prefers-color-scheme:dark){body{background:#151515;color:#e8e8e8}pre,code{background:#222;border-color:#444}td,th{border-color:#555}a{color:#8ab4ff}}`;
export const htmlPage = (title: string, body: string, lang = "es") => `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head>
<body>
${body}
</body></html>`;
const cell = (v: string, href?: string | null) => (href ? `<a href="${esc(href)}">${esc(v)}</a>` : /^curl /.test(v) ? `<code>${esc(v)}</code>` : esc(v));
export function blocksToHtml(bl: Block[]): string {
  return bl.map((x) => {
    switch (x.t) {
      case "h2": return `<h2${x.id ? ` id="${x.id}"` : ""}>${esc(x.text)}</h2>`;
      case "h3": return `<h3${x.id ? ` id="${x.id}"` : ""}>${esc(x.text)}</h3>`;
      case "p": return `<p>${esc(x.text)}</p>`;
      case "ol": return `<ol>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
      case "ul": return `<ul>${x.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
      case "pre": return `<pre>${esc(x.text)}</pre>`;
      case "table": return `<table><thead><tr>${x.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${x.rows.map((r, ri) => `<tr>${r.map((c, ci) => `<td>${cell(c, x.links?.[ri]?.[ci])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
  }).join("\n");
}
export function blocksToText(bl: Block[]): string {
  return bl.map((x) => {
    switch (x.t) {
      case "h2": return `\n## ${x.text}\n`;
      case "h3": return `\n### ${x.text}\n`;
      case "p": return x.text;
      case "ol": return x.items.map((i, k) => `${k + 1}. ${i}`).join("\n");
      case "ul": return x.items.map((i) => `- ${i}`).join("\n");
      case "pre": return "```\n" + x.text + "\n```";
      case "table": return [x.head.join(" | "), ...x.rows.map((r, ri) => r.map((c, ci) => (x.links?.[ri]?.[ci] ? `${c} <${x.links[ri][ci]}>` : c)).join(" | "))].join("\n");
    }
  }).join("\n\n");
}
