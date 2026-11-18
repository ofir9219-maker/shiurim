// Server-rendered pages of the AI zone (plain semantic HTML, no client JS): /ia/<token>, ?format=json, /llms.txt and /ia/<token>/job/<id>.
import { NextResponse } from "next/server";
import { NOINDEX, gate, originOf, readBody } from "./http";
import * as Z from "./jobs";
import { abs, EXAMPLE, NAMING_ES, RESULT_SCHEMA, RULES_EN, RULES_ES, META_RULES, WORKFLOW_EN, WORKFLOW_ES, apiRows, blocksToHtml, blocksToText, buildDoc, esc, htmlPage, type DocCtx } from "./docs";

const html = (body: string, status = 200) => new NextResponse(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...NOINDEX } });
const text = (body: string, status = 200) => new NextResponse(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "access-control-allow-origin": "*", ...NOINDEX } });
const denied = (g: NextResponse) => (g.status === 404 ? text("Enlace de la Zona IA no válido.\nInvalid AI zone link.\n", 404) : g);

function ctx(req: Request, token: string): DocCtx & { zoneUrl: string } {
  const o = originOf(req); Z.sweepLeases();
  const c = Z.counts();
  return { zonePage: `${o}/ia/${token}`, zoneUrl: `${o}/ia/${token}`, api: `${o}/api/ia/${token}`, counts: c, jobs: Z.listSummaries("all"), jobPage: (id) => `${o}/ia/${token}/job/${id}` };
}

export function zonePage(req: Request, token: string) {
  const g = gate(req, token); if (g) return denied(g);
  const c = ctx(req, token); const url = new URL(req.url); const fmt = url.searchParams.get("format");
  if (fmt === "json") return NextResponse.json(zoneJson(c), { headers: { "access-control-allow-origin": "*", ...NOINDEX } });
  if (fmt === "text" || fmt === "txt" || fmt === "md") return text(llmsText(c));
  const body = `<header><h1>Zona IA · AI work zone</h1>
<p>Página para agentes de IA: cola central de jobs de corrección de transcripciones. Sin login, sin JavaScript. / Page for AI agents: central queue of transcript-correction jobs. No login, no JavaScript.</p>
<nav aria-label="Secciones"><a href="#estado">Estado</a><a href="#que-es">Flujo</a><a href="#reglas">Reglas</a><a href="#nombres">Nombres</a><a href="#esquema">Esquema</a><a href="#api">API</a><a href="#jobs">Jobs</a><a href="${esc(c.zonePage)}/llms.txt">llms.txt</a><a href="${esc(c.zonePage)}?format=json">JSON</a></nav></header>
<main>${blocksToHtml(buildDoc(c))}</main>`;
  return html(htmlPage("Zona IA · AI work zone", body));
}
export function llmsText(c: DocCtx): string {
  return `# Zona IA — AI work zone (shiurim)\n\n> Cola central de jobs de corrección de transcripciones de shiurim para agentes de IA. Flujo: listar → claim → obtener → corregir → enviar resultado → revisar validación → repetir. / Central queue of transcript-correction jobs for AI agents: list → claim → fetch → correct → submit → check validation → repeat.\n\nAPI base: ${c.api}\nPágina HTML: ${c.zonePage}\n\n${blocksToText(buildDoc(c))}\n`;
}
export function llmsTxt(req: Request, token: string) {
  const g = gate(req, token); if (g) return denied(g);
  return text(llmsText(ctx(req, token)));
}
function zoneJson(c: DocCtx) {
  return {
    zone: { name: "Zona IA / AI work zone", page: c.zonePage, api_base: c.api, llms_txt: `${c.zonePage}/llms.txt`, generated_at: new Date().toISOString() },
    queue: { counts: c.counts, jobs: c.jobs.map((j) => ({ ...j, job_page: c.jobPage(j.job_id) })) },
    workflow: { es: WORKFLOW_ES.map((s) => abs(s, c)), en: WORKFLOW_EN.map((s) => abs(s, c)) },
    rules: { es: RULES_ES(), en: RULES_EN, metadata: META_RULES(), naming: NAMING_ES() },
    result_schema: RESULT_SCHEMA(), example: EXAMPLE,
    api: apiRows(c.api).map((r) => ({ method: r.method, url: `${c.api}${r.path}`, description: r.what, curl: r.curl })),
  };
}

// ---------------------------------------------------------------- per-job page (data + paste form, no JS)

function problemsTable(errs: Z.Problem[]) {
  return `<table><thead><tr><th>where</th><th>problem</th></tr></thead><tbody>${errs.map((e) => `<tr><td><code>${esc(e.where)}</code></td><td>${esc(e.problem)}</td></tr>`).join("")}</tbody></table>`;
}
async function jobBody(req: Request, token: string, j: Z.Job, o: { notice?: string; pasted?: string; lease?: Z.Lease } = {}) {
  const base = `${originOf(req)}/ia/${token}`;
  const st = Z.statusOf(j);
  let data = ""; try { data = JSON.stringify(await Z.getJobData(j), null, 1); } catch (e) { data = `No se pudieron leer los datos del job: ${(e as Error).message}`; }
  const lease = o.lease ?? (Z.leaseActive(j) ? j.lease : undefined);
  const last = j.errors?.length && st !== "done" ? `<h2>Errores del último envío</h2>${problemsTable(j.errors)}` : "";
  return `<header><h1>Job ${esc(j.id)} · parte ${j.part}/${j.total}</h1><nav><a href="${esc(base)}">← Zona IA (reglas, API, cola)</a></nav>
<p>Serie: ${esc(j.series)} · ${esc(j.titleHint)} · ${j.expect.indices.length} segmentos · estado: <b>${st}</b>${lease ? ` · lease hasta ${esc(lease.until)}` : ""}</p></header>
<main>${o.notice ?? ""}
<h2>1. Tomar el job (opcional, evita que otra IA lo tome)</h2>
<form method="post" action="${esc(base)}/job/${esc(j.id)}"><input type="hidden" name="action" value="claim"><button type="submit">Tomar (claim) · 60 min</button></form>
<h2>2. Datos del job (JSON)</h2><p>Reglas de corrección, nombres y esquema del resultado: ver <a href="${esc(base)}#reglas">la Zona IA</a>.</p><pre id="job-json">${esc(data)}</pre>
${last}
<h2>3. Pegar el resultado corregido</h2>
<form method="post" action="${esc(base)}/job/${esc(j.id)}"><input type="hidden" name="action" value="result">${lease ? `<input type="hidden" name="lease_id" value="${esc(lease.id)}">` : ""}
<label for="result">JSON del resultado (esquema shiurim-ai-result/v1, solo el JSON)</label><br><textarea id="result" name="result" rows="16" spellcheck="false" placeholder='{"format":"shiurim-ai-result/v1","job_id":"${esc(j.id)}","segments":[…]}'>${esc(o.pasted ?? "")}</textarea><br><button type="submit">Enviar y validar</button></form>
<h2>Soltar el job</h2><form method="post" action="${esc(base)}/job/${esc(j.id)}"><input type="hidden" name="action" value="release"><button type="submit">Soltar (release)</button></form></main>`;
}
export async function jobPage(req: Request, token: string, jobId: string) {
  const g = gate(req, token); if (g) return denied(g);
  const j = Z.getJob(jobId);
  if (!j || !Z.isListed(j) || j.status === "discarded") return html(htmlPage("Job no encontrado", `<h1>Job no encontrado / not found</h1><p><a href="${esc(originOf(req))}/ia/${esc(token)}">Zona IA</a></p>`), 404);
  return html(htmlPage(`Job ${j.id}`, await jobBody(req, token, j)));
}
export async function jobPost(req: Request, token: string, jobId: string) {
  const g = gate(req, token); if (g) return denied(g);
  const j = Z.getJob(jobId);
  if (!j || !Z.isListed(j) || j.status === "discarded") return html(htmlPage("Job no encontrado", "<h1>Job no encontrado / not found</h1>"), 404);
  const b = await readBody(req, Z.MAX_BODY + 4096);
  if ("error" in b) return html(htmlPage("Demasiado grande", `<div class="bad"><h1>El cuerpo supera 5 MB</h1></div>`), 413);
  const ct = req.headers.get("content-type") || "";
  const form = /urlencoded/.test(ct) ? Object.fromEntries(new URLSearchParams(b.text)) : /multipart/.test(ct) ? null : { action: "result", result: b.text } as Record<string, string>;
  const f: Record<string, string> = form ?? Object.fromEntries([...(await new Request(req.url, { method: "POST", headers: { "content-type": ct }, body: b.text }).formData()).entries()].map(([k, v]) => [k, String(v)]));
  const action = f.action || "result";
  const page = async (notice: string, status = 200, extra: { pasted?: string; lease?: Z.Lease } = {}) => html(htmlPage(`Job ${j.id}`, await jobBody(req, token, Z.getJob(j.id)!, { notice, ...extra })), status);
  if (action === "claim") {
    const r = Z.claim(j.id, { leaseId: f.lease_id, holder: "html-form" });
    return r.ok ? page(`<div class="ok"><h2>Job tomado</h2><p>lease_id: <code>${esc(r.lease.id)}</code> · hasta ${esc(r.lease.until)}. Los datos están más abajo.</p></div>`, 200, { lease: r.lease }) : page(`<div class="bad"><h2>No se pudo tomar</h2><p>${esc(r.error)}</p></div>`, r.code);
  }
  if (action === "release") { const r = Z.release(j.id, { leaseId: f.lease_id }); return page(r.ok ? `<div class="ok"><h2>Job soltado</h2></div>` : `<div class="bad"><h2>${esc(r.error ?? "error")}</h2></div>`, r.code); }
  if (!(f.result ?? "").trim()) return page(`<div class="bad"><h2>Falta el JSON</h2><p>Pega el resultado en el cuadro de texto.</p></div>`, 422);
  const cur = Z.getJob(j.id)!;
  if (f.lease_id && Z.leaseActive(cur) && cur.lease!.id !== f.lease_id) return page(`<div class="bad"><h2>El lease pertenece a otro agente</h2></div>`, 409, { pasted: f.result });
  const r = await Z.receiveResult(j, f.result, "page");
  if (r.ok) {
    const next = Z.listSummaries("pending")[0];
    return page(`<div class="ok" role="status"><h2>ok: true · ${r.applied ? "applied" : "recibido"}</h2><p>${esc(r.message)}</p><p>${next ? `Siguiente job pendiente: <a href="${esc(originOf(req))}/ia/${esc(token)}/job/${esc(next.job_id)}">${esc(next.job_id)}</a> (${esc(next.title_hint)}).` : "No quedan jobs pendientes. / No pending jobs left."}</p></div>`);
  }
  return page(`<div class="bad" role="alert"><h2>ok: false · rechazado (${r.errors.length} problema(s))</h2><p>${esc(r.message)}</p>${problemsTable(r.errors)}</div>`, 422, { pasted: f.result });
}
