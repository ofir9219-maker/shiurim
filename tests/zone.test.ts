// AI work zone: token auth, queue (list/claim/lease/release), validation errors, multi-part jobs, rendering (HTML / llms.txt / JSON), legacy packages.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zone-t-"));
process.env.ADMIN_PASSWORD = "pw-test"; delete process.env.AI_ZONE_TOKEN; delete process.env.PUBLIC_BASE_URL; process.env.AI_ZONE_RATE_PER_MIN = "1000";
const C = await import("../lib/center/collections");
const Z = await import("../lib/zone/jobs");
const T = await import("../lib/zone/token");
const H = await import("../lib/zone/http");
const R = await import("../lib/center/refs");
const A = await import("../lib/zone/api");
const P = await import("../lib/zone/pages");
const listRoute = await import("../app/api/ia/[token]/jobs/route");
const getRoute = await import("../app/api/ia/[token]/jobs/[jobId]/route");
const claimRoute = await import("../app/api/ia/[token]/jobs/[jobId]/claim/route");
const resultRoute = await import("../app/api/ia/[token]/jobs/[jobId]/result/route");
const releaseRoute = await import("../app/api/ia/[token]/jobs/[jobId]/release/route");
const pageRoute = await import("../app/ia/[token]/route");
const llmsRoute = await import("../app/ia/[token]/llms.txt/route");
const jobPageRoute = await import("../app/ia/[token]/job/[jobId]/route");

const geresh = "׳׳";
const mkSegs = (n: number) => Array.from({ length: n }, (_, i) => ({ startMs: i * 5000, endMs: i * 5000 + 4000, text: `segmento ${i} crudo` }));
const pcfg = (o: object = {}) => ({ ...C.systemDefaults(), published: false, collectionName: "Serie IA", slug: "ia", postprocess: "ai_package" as const, namingMode: "template" as const, template: C.BERAJOT_TEMPLATE, ...o });
const pit = { id: "AUDX", name: "27. clase.m4a", ext: ".m4a", order: "27", fileDate: "2025-03-01T10:00:00Z", collectionId: "SER", parentId: "PAR" } as any;
const goodResult = (data: any, over: (r: any) => void = () => {}) => {
  const r: any = { format: Z.RESULT_FORMAT, job_id: data.job_id, segments: data.segments.map((s: any) => ({ ...s, text: s.text.replace("crudo", "corregido") })) };
  if (data.needs_meta) r.meta = { summary: "Resumen en español.", tags: ["a", "b", "c"], note: "", obra: "ברכות", daf: [{ daf: "ג", amud: "א" }], temas: "בלעם, תשובה" };
  over(r); return r;
};
const sefaria = async () => "";
const BASE = "https://ofirsegal.app";
const req = (url: string, method = "GET", body?: string, headers: Record<string, string> = {}) => new Request(url, { method, body, headers });
const ctx = (token: string, jobId?: string) => ({ params: Promise.resolve({ token, jobId: jobId as string }) });
let token = "";

test("zone token: stored hashed (+ sealed copy for the admin), regenerate rotates, env override", () => {
  token = T.currentToken()!; assert.ok(token && token.length >= 43);
  const raw = fs.readFileSync(path.join(process.env.STORAGE_DIR!, "ai-zone", "token.json"), "utf8");
  assert.ok(!raw.includes(token), "plain token is never stored"); assert.ok(raw.includes(T.sha256(token)));
  assert.equal(T.verifyToken(token), true); assert.equal(T.verifyToken(token + "x"), false); assert.equal(T.verifyToken(""), false); assert.equal(T.verifyToken("corto"), false);
  assert.equal(T.zoneUrl(token), `https://ofirsegal.app/ia/${token}`);
  const t2 = T.regenerateToken(); assert.notEqual(t2, token); assert.equal(T.verifyToken(token), false); assert.equal(T.verifyToken(t2), true); assert.equal(T.currentToken(), t2); token = t2;
  process.env.ADMIN_PASSWORD = "otra"; assert.equal(T.currentToken(), null, "sealed copy unreadable after the password changes"); assert.equal(T.verifyToken(token), true); process.env.ADMIN_PASSWORD = "pw-test";
  process.env.AI_ZONE_TOKEN = "e".repeat(40); assert.equal(T.verifyToken("e".repeat(40)), true); assert.equal(T.verifyToken(token), false); assert.equal(T.currentToken(), "e".repeat(40)); assert.equal(T.tokenSource(), "env");
  delete process.env.AI_ZONE_TOKEN; assert.equal(T.verifyToken(token), true);
});

test("everything under the zone requires the token (404 without leaking, CORS open, per-IP limit on bad tokens)", async () => {
  const bad = "x".repeat(43);
  for (const r of [listRoute.GET(req(`${BASE}/api/ia/${bad}/jobs`), ctx(bad)), getRoute.GET(req(`${BASE}/api/ia/${bad}/jobs/job_1`), ctx(bad, "job_1")), claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(bad, "job_1")),
    resultRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(bad, "job_1")), releaseRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(bad, "job_1")), pageRoute.GET(req(`${BASE}/ia/${bad}`), ctx(bad)), llmsRoute.GET(req(`${BASE}/ia/${bad}/llms.txt`), ctx(bad)), jobPageRoute.GET(req(`${BASE}/x`), ctx(bad, "job_1"))]) {
    const res = await r; assert.equal(res.status, 404); assert.ok(!(await res.text()).includes("job_1"));
  }
  assert.equal(listRoute.OPTIONS().headers.get("access-control-allow-origin"), "*"); assert.equal(listRoute.OPTIONS().status, 204);
  const ok = await listRoute.GET(req(`${BASE}/api/ia/${token}/jobs`), ctx(token)); assert.equal(ok.status, 200); assert.equal(ok.headers.get("access-control-allow-origin"), "*");
  H.resetRateLimits();
  let last = 0; for (let k = 0; k < 45; k++) last = (await listRoute.GET(req(`${BASE}/x`, "GET", undefined, { "x-forwarded-for": "9.9.9.9" }), ctx(bad))).status; assert.equal(last, 429);
});

test("per-token rate limit", async () => {
  H.resetRateLimits(); process.env.AI_ZONE_RATE_PER_MIN = "5";
  const st: number[] = []; for (let k = 0; k < 7; k++) st.push((await listRoute.GET(req(`${BASE}/x`), ctx(token))).status);
  process.env.AI_ZONE_RATE_PER_MIN = "1000"; H.resetRateLimits();
  assert.deepEqual(st, [200, 200, 200, 200, 200, 429, 429]);
});

test("build: jobs hold only data (no prompt), split into parts with neighbours; Drive copy is off by default", async () => {
  const [one] = await Z.buildJobs(pit, pcfg(), mkSegs(5), { sefaria });
  const d = one.data as any;
  assert.equal(d.format, "shiurim-ai-job/v1"); assert.match(d.job_id, /^job_[0-9a-f]{16}$/); assert.equal(d.part, 1); assert.equal(d.parts, 1); assert.equal(d.series, "Serie IA"); assert.equal(d.series_kind, "talmud");
  assert.equal(d.template, C.BERAJOT_TEMPLATE); assert.deepEqual(d.template_variables_required, ["obra", "daf", "temas"]); assert.equal(d.needs_meta, true); assert.equal(d.allow_hebrew, false);
  assert.ok(!("prompt" in d) && !("instructions_for_ai" in d) && !("output_schema" in d) && !("upload" in d)); assert.ok(!JSON.stringify(d).includes("CONSERVADORA"));
  assert.deepEqual(Object.keys(d.segments[0]), ["i", "startMs", "endMs", "text"]); assert.deepEqual(d.expected_result, { format: Z.RESULT_FORMAT, job_id: d.job_id, segments_count: 5, first_i: 0, last_i: 4 });
  const parts = await Z.buildJobs(pit, pcfg(), mkSegs(23), { maxPerPart: 10, sefaria });
  assert.equal(parts.length, 3); assert.deepEqual(parts.map((x) => x.data.segments.length), [10, 10, 3]); assert.deepEqual(parts.map((x) => [x.data.part, x.data.parts]), [[1, 3], [2, 3], [3, 3]]);
  assert.equal(parts[1].data.segments[0].i, 10); assert.equal(new Set(parts.map((x) => x.job.id)).size, 3);
  assert.equal(parts[0].data.needs_meta, true); assert.equal(parts[1].data.needs_meta, false); assert.deepEqual(parts[1].data.template_variables_required, []);
  assert.deepEqual(parts[1].data.context.neighbors.before.map((s) => s.i), [7, 8, 9]); assert.deepEqual(parts[1].data.context.neighbors.after.map((s) => s.i), [20, 21, 22]);
  const [k] = await Z.buildJobs(pit, pcfg({ namingMode: "keep", allowHebrew: true }), mkSegs(2), { sefaria });
  assert.deepEqual(k.data.template_variables_required, []); assert.equal(k.data.allow_hebrew, true); assert.equal(k.data.template, null); assert.deepEqual(k.data.meta_required, ["summary", "tags", "note"]);
  assert.equal(C.systemDefaults().aiCopyToDrive, false);
  assert.deepEqual(C.resolveSettings(["Q"], [{ folderId: "Q", name: "q", slug: "q", published: false, createdAt: "", settings: C.sanitizeSettings({ aiCopyToDrive: true }) }]).settings.aiCopyToDrive, true);
});

test("sefaria ref guessed from the file name only for Talmud series", async () => {
  assert.equal(R.guessSefariaRef("27. ברכות ז ע׳׳א - בלעם.m4a"), "Berakhot.7a"); assert.equal(R.guessSefariaRef("charla.m4a"), null);
  let asked = ""; const [p] = await Z.buildJobs({ ...pit, name: "ברכות ג ע׳׳ב.m4a" }, pcfg(), mkSegs(1), { sefaria: async (r) => { asked = r; return "## texto"; } });
  assert.equal(asked, "Berakhot.3b"); assert.equal(p.data.context.sefaria_text, "## texto");
  asked = ""; await Z.buildJobs(pit, pcfg({ template: "{n}. {temas}" }), mkSegs(1), { sefaria: async (r) => { asked = r; return ""; } }); assert.equal(asked, "");
});

test("validation = merge-polished.py rules, with where/problem errors", async () => {
  const [b] = await Z.buildJobs(pit, pcfg(), mkSegs(6), { sefaria });
  const v = (mut: (r: any) => void) => Z.validateResult(b.job, goodResult(b.data, mut));
  const ok = v(() => {}); assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.segments![2].text, "segmento 2 corregido"); assert.equal(ok.meta!.title, `27. ברכות ג ע${geresh}א - בלעם, תשובה`); assert.equal(ok.meta!.newName, ok.meta!.title + ".m4a");
  const has = (r: ReturnType<typeof Z.validateResult>, re: RegExp) => assert.ok(r.errors.some((e) => re.test(e.where + " " + e.problem)), JSON.stringify(r.errors));
  has(v((r) => { r.job_id = "job_otro"; }), /job_id/);
  assert.equal(Z.validateResult(b.job, { ...goodResult(b.data), job_id: undefined, package_id: b.job.id }).ok, true, "legacy package_id still accepted");
  has(v((r) => { r.segments.pop(); }), /Cantidad incorrecta/); has(v((r) => { r.segments.pop(); }), /Faltan los segmentos i = 5/);
  has(v((r) => { r.segments.push({ ...r.segments[0], i: 99 }); }), /fuera de este job/); has(v((r) => { r.segments[1].i = 0; }), /duplicados/); has(v((r) => { r.segments.reverse(); }), /no están en orden/);
  has(v((r) => { r.segments[3].startMs += 1; }), /segments\[i=3\]\.startMs/); has(v((r) => { delete r.segments[4].endMs; }), /segments\[i=4\]\.endMs/);
  has(v((r) => { r.segments[2].text = "   "; }), /segments\[i=2\]\.text.*vacío/); has(v((r) => { r.segments[5].text = "hola שלום"; }), /segments\[i=5\]\.text.*hebreas/);
  has(v((r) => { delete r.meta; }), /Falta `meta`/); has(v((r) => { r.meta.tags = ["a"]; }), /meta\.tags.*3 tags/); has(v((r) => { r.meta.summary = ""; }), /meta\.summary/);
  has(v((r) => { r.meta.tags = ["a", "b", "ברכות"]; }), /meta\.tags.*hebreas/); has(v((r) => { r.meta.daf = [{ daf: "3", amud: "א" }]; }), /meta\.daf/); has(v((r) => { r.meta.daf = [{ daf: "ג", amud: "ג" }]; }), /meta\.daf.*amud/);
  has(v((r) => { r.meta.temas = "x".repeat(80); }), /meta\.temas/); has(v((r) => { r.meta.temas = "english"; }), /hebreo/);
  assert.equal(Z.validateResult(b.job, "no es objeto").ok, false); assert.equal(v((r) => { r.format = "otro"; }).ok, false);
  assert.equal(Z.validateResult({ ...b.job, expect: { ...b.job.expect, allowHebrew: true } }, goodResult(b.data, (r) => { r.segments[0].text = "cita שלום"; })).ok, true);
  assert.deepEqual(Z.parseLoose("```json\n{\"a\":1}\n```"), { a: 1 });
});

let jobs: { id: string; data: any }[] = [];
test("queue API: list / claim (lease 60 min, 409 for others, renewable) / get / release / expiry", async () => {
  const made = await Z.createJobs({ ...pit, log: [] } as any, pcfg(), mkSegs(23), { sefaria, maxPerPart: 10 });
  jobs = await Promise.all(made.map(async (j) => ({ id: j.id, data: await Z.getJobData(j) })));
  const get = async (r: Promise<Response> | Response) => { const x = await r; return { status: x.status, body: await x.json() }; };
  const l = await get(listRoute.GET(req(`${BASE}/api/ia/${token}/jobs?status=pending`), ctx(token)));
  assert.equal(l.status, 200); assert.equal(l.body.length, 3); assert.deepEqual(Object.keys(l.body[0]).sort(), ["job_id", "part", "parts", "segments_count", "series", "status", "title_hint"].sort()); assert.equal(l.body[0].segments_count, 10);
  assert.equal((await get(listRoute.GET(req(`${BASE}/x?status=bogus`), ctx(token)))).status, 400);
  // claim
  const c1 = await get(claimRoute.POST(req(`${BASE}/x`, "POST", JSON.stringify({ holder: "agente-1" })), ctx(token, jobs[0].id)));
  assert.equal(c1.status, 200); assert.equal(c1.body.job_id, jobs[0].id); assert.equal(c1.body.segments.length, 10); assert.match(c1.body.lease_id, /^lease_/);
  const until = Date.parse(c1.body.claimed_until); assert.ok(Math.abs(until - Date.now() - 60 * 60_000) < 5000);
  const c2 = await get(claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(token, jobs[0].id))); assert.equal(c2.status, 409); assert.ok(c2.body.claimed_until);
  const pend = await get(listRoute.GET(req(`${BASE}/x?status=pending`), ctx(token))); assert.equal(pend.body.length, 2); assert.ok(!pend.body.some((x: any) => x.job_id === jobs[0].id));
  const cl = await get(listRoute.GET(req(`${BASE}/x?status=claimed`), ctx(token))); assert.equal(cl.body.length, 1); assert.equal(cl.body[0].claimed_until, c1.body.claimed_until);
  const ren = await get(claimRoute.POST(req(`${BASE}/x`, "POST", JSON.stringify({ lease_id: c1.body.lease_id })), ctx(token, jobs[0].id))); assert.equal(ren.status, 200); assert.equal(ren.body.renewed, true); assert.equal(ren.body.lease_id, c1.body.lease_id);
  const g = await get(getRoute.GET(req(`${BASE}/x`), ctx(token, jobs[0].id))); assert.equal(g.body.status, "claimed"); assert.equal(g.body.segments[0].i, 0);
  assert.equal((await get(getRoute.GET(req(`${BASE}/x`), ctx(token, "job_nope")))).status, 404);
  // release by a stranger is refused, by the owner returns it to pending
  assert.equal((await get(releaseRoute.POST(req(`${BASE}/x`, "POST", JSON.stringify({ lease_id: "lease_otro" })), ctx(token, jobs[0].id)))).status, 409);
  assert.equal((await get(releaseRoute.POST(req(`${BASE}/x`, "POST", JSON.stringify({ lease_id: c1.body.lease_id })), ctx(token, jobs[0].id)))).status, 200);
  assert.equal((await get(listRoute.GET(req(`${BASE}/x?status=pending`), ctx(token)))).body.length, 3);
  // expiry: the lease lapses by itself
  const n = await get(claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(token, "next"))); assert.equal(n.status, 200); assert.equal(n.body.job_id, jobs[0].id);
  const idx = path.join(process.env.STORAGE_DIR!, "ai-zone", "jobs.json"); const all = JSON.parse(fs.readFileSync(idx, "utf8"));
  all.find((j: any) => j.id === jobs[0].id).lease.until = new Date(Date.now() - 1000).toISOString(); fs.writeFileSync(idx, JSON.stringify(all));
  assert.equal(Z.statusOf(Z.getJob(jobs[0].id)!), "pending");
  assert.equal((await get(listRoute.GET(req(`${BASE}/x?status=pending`), ctx(token)))).body.length, 3);
  assert.equal((await get(claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(token, jobs[0].id)))).status, 200, "another agent can take it after expiry");
  assert.equal(Z.sweepLeases(Date.now() + 61 * 60_000), 1); assert.equal(Z.counts().claimed, 0);
});

test("result API: 422 lists exactly what is wrong, 200 on success, 413 over 5 MB, multi-part waits for the rest", async () => {
  const post = async (job: { id: string; data: any }, body: string, q = "") => { const r = await resultRoute.POST(req(`${BASE}/api/ia/${token}/jobs/${job.id}/result${q}`, "POST", body, { "content-type": "application/json" }), ctx(token, job.id)); return { status: r.status, body: await r.json(), r }; };
  const [j1, j2, j3] = jobs;
  assert.equal((await post(j1, "x".repeat(5 * 1024 * 1024 + 10))).status, 413);
  const bad = goodResult(j1.data); bad.segments[2].startMs += 7; bad.segments[4].text = "";
  const r1 = await post(j1, JSON.stringify(bad)); assert.equal(r1.status, 422); assert.equal(r1.r.headers.get("access-control-allow-origin"), "*"); assert.equal(r1.body.ok, false);
  assert.ok(r1.body.errors.some((e: any) => e.where === "segments[i=2].startMs" && /≠/.test(e.problem)) && r1.body.errors.some((e: any) => e.where === "segments[i=4].text")); assert.match(r1.body.next, /misma URL/);
  assert.equal(Z.statusOf(Z.getJob(j1.id)!), "failed"); assert.equal(Z.getJob(j1.id)!.errors!.length, 2);
  assert.equal(Z.listSummaries("failed").length, 1); assert.equal(Z.listSummaries("pending").length, 3, "failed jobs stay retryable");
  assert.equal((await post(j1, "esto no es json")).status, 422);
  assert.equal((await post(j2, JSON.stringify(goodResult(j1.data)))).body.errors[0].where, "job_id");
  // lease of another agent
  const c = await (await claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(token, j1.id))).json();
  assert.equal((await post(j1, JSON.stringify(goodResult(j1.data)), "?lease_id=lease_otro")).status, 409);
  const ok = await post(j1, "```json\n" + JSON.stringify(goodResult(j1.data)) + "\n```", `?lease_id=${c.lease_id}`); assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.ok, true);
  assert.equal(ok.body.applied, false); assert.deepEqual(ok.body.waiting_for_parts, [2, 3]);
  assert.equal(Z.statusOf(Z.getJob(j1.id)!), "done"); assert.equal(Z.getJob(j1.id)!.lease, undefined); assert.equal(Z.getJob(j1.id)!.errors, undefined);
  assert.equal((await claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(token, j1.id))).status, 409, "done jobs cannot be claimed");
  assert.equal((await post(j2, JSON.stringify(goodResult(j2.data)))).body.ok, true); assert.deepEqual((await post(j3, JSON.stringify(goodResult(j3.data)))).body.waiting_for_parts, []);
  assert.deepEqual(Z.counts(), { pending: 0, claimed: 0, done: 3, failed: 0, discarded: 0 });
  // admin: reopen / discard
  assert.equal(Z.reopen(j1.id), true); assert.equal(Z.statusOf(Z.getJob(j1.id)!), "pending"); assert.equal(Z.discard(j2.id), true); assert.equal(Z.statusOf(Z.getJob(j2.id)!), "discarded");
  assert.equal((await claimRoute.POST(req(`${BASE}/x`, "POST", "{}"), ctx(token, j2.id))).status, 404); assert.equal(Z.listSummaries("all").length, 2);
  Z.reopen(j2.id);
});

test("pages: HTML (no JS, order), llms.txt, ?format=json, per-job page + form", async () => {
  const htmlRes = await pageRoute.GET(req(`${BASE}/ia/${token}`), ctx(token)); assert.equal(htmlRes.status, 200); assert.match(htmlRes.headers.get("content-type")!, /text\/html/); assert.match(htmlRes.headers.get("x-robots-tag")!, /noindex/);
  const html = await htmlRes.text();
  assert.ok(!/<script/i.test(html)); assert.match(html, /<html lang="es">/); assert.match(html, /<main>/); assert.match(html, /<table>/); assert.ok(html.includes(`${BASE}/api/ia/${token}/jobs`));
  const order = ["Estado de la cola", "1. Qué es esta zona", "Flujo en pasos", "Workflow steps", "2. Reglas de corrección", "Reglas de nombres", "3. Resultado: esquema JSON", "Ejemplo mínimo", "4. Referencia de la API", "5. Jobs (resumen)"].map((s) => html.indexOf(">" + s));
  assert.ok(order.every((x) => x > 0) && order.every((x, i) => i === 0 || x > order[i - 1]), `sections out of order: ${order}`);
  assert.ok(html.indexOf("Flujo en pasos") < html.indexOf("Workflow steps"), "Spanish first, then English");
  assert.ok(html.includes("CONSERVADORA") && html.includes("shiurim-ai-result/v1") && html.includes("curl -s -X POST") && html.includes("/jobs/&lt;job_id&gt;/claim") && html.includes(`${BASE}/ia/${token}/job/${jobs[0].id}`));
  const txt = await (await llmsRoute.GET(req(`${BASE}/ia/${token}/llms.txt`), ctx(token))).text();
  assert.match(txt, /^# Zona IA/); assert.ok(txt.includes("CONSERVADORA") && txt.includes(`curl -s "${BASE}/api/ia/${token}/jobs?status=pending"`) && !txt.includes("<table>") && txt.includes("1. Lista los jobs pendientes") && txt.includes(jobs[0].id));
  assert.ok(txt.indexOf("Estado de la cola") < txt.indexOf("Flujo en pasos"));
  const js: any = await (await pageRoute.GET(req(`${BASE}/ia/${token}?format=json`), ctx(token))).json();
  assert.equal(js.zone.api_base, `${BASE}/api/ia/${token}`); assert.equal(js.queue.counts.pending, 2); assert.equal(js.queue.jobs.length, 3); assert.ok(js.workflow.es.length >= 7 && js.workflow.en.length >= 7); assert.equal(js.result_schema.properties.format.const, "shiurim-ai-result/v1");
  assert.ok(js.rules.es.includes("CONSERVADORA") && js.api.length === 5 && js.example.result.job_id);
  // per-job page
  const jp = await (await jobPageRoute.GET(req(`${BASE}/x`), ctx(token, jobs[0].id))).text();
  assert.ok(jp.includes('<form method="post"') && jp.includes("<textarea") && jp.includes(jobs[0].id) && jp.includes("segmento 0 crudo") && !/<script/i.test(jp));
  assert.equal((await jobPageRoute.GET(req(`${BASE}/x`), ctx(token, "job_nope"))).status, 404);
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const post = (id: string, o: Record<string, string>) => jobPageRoute.POST(req(`${BASE}/x`, "POST", form(o), { "content-type": "application/x-www-form-urlencoded" }), ctx(token, id));
  const cl = await (await post(jobs[0].id, { action: "claim" })).text(); assert.match(cl, /Job tomado/); const lease = cl.match(/<code>(lease_[^<]+)<\/code>/)![1];
  const bad = goodResult(jobs[0].data); bad.segments[1].text = "";
  const rb = await post(jobs[0].id, { action: "result", result: JSON.stringify(bad), lease_id: lease }); assert.equal(rb.status, 422); const rbt = await rb.text(); assert.ok(rbt.includes("ok: false") && rbt.includes("segments[i=1].text") && rbt.includes("&quot;job_id&quot;"), "errors + the pasted JSON kept in the textarea");
  const rg = await post(jobs[0].id, { action: "result", result: JSON.stringify(goodResult(jobs[0].data)), lease_id: lease }); assert.equal(rg.status, 200); assert.match(await rg.text(), /ok: true/); assert.equal(Z.statusOf(Z.getJob(jobs[0].id)!), "done");
  assert.match(await (await post(jobs[1].id, { action: "result", result: "" })).text(), /Falta el JSON/);
  assert.equal((await post(jobs[1].id, { action: "release" })).status, 200);
  Z.reopen(jobs[0].id);
});

test("legacy packages: imported as jobs, old token routes keep working", async () => {
  const dir = path.join(process.env.STORAGE_DIR!, "packages"); fs.mkdirSync(dir, { recursive: true });
  const [b] = await Z.buildJobs({ ...pit, id: "AUDLEG" }, pcfg(), mkSegs(4), { sefaria });
  const old = "L".repeat(43), crypto = await import("node:crypto");
  const meta = { id: "pkg_legacy0000000001", audioId: "AUDLEG", part: 1, total: 1, baseName: "27. clase", fileName: "27. clase.ai.json", correctedName: "27. clase.ai.corregido.json", parentId: "PAR", driveFileId: "DRV1",
    tokenHash: crypto.createHash("sha256").update(old).digest("hex"), createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString(), status: "pending", expect: { ...b.job.expect } };
  const oldIdx = path.join(dir, "packages.json");
  // the zone index already exists in this process; simulate a fresh volume
  fs.rmSync(path.join(process.env.STORAGE_DIR!, "ai-zone", "jobs.json")); fs.rmSync(path.join(process.env.STORAGE_DIR!, "ai-zone", "migrated.json"));
  fs.writeFileSync(oldIdx, JSON.stringify([meta, { ...meta, id: "pkg_old_superseded", status: "superseded", tokenHash: "zz" }]));
  const list = Z.loadJobs(); assert.equal(list.length, 1); assert.equal(list[0].id, "pkg_legacy0000000001"); assert.equal(Z.statusOf(list[0]), "pending"); assert.equal(list[0].legacy!.tokenHash, meta.tokenHash);
  assert.equal(Z.listSummaries("pending").length, 1, "pending package is now in the zone queue"); assert.equal(Z.loadJobs().length, 1, "migration runs once");
  assert.equal(Z.findByLegacyToken(old)?.id, meta.id); assert.equal(Z.findByLegacyToken("nada"), null);
  const legacy = await import("../app/api/paquete/[token]/route");
  const call = (tok: string, body: string) => legacy.POST(req(`${BASE}/api/paquete/${tok}`, "POST", body, { "content-type": "application/json" }), { params: Promise.resolve({ token: tok }) });
  assert.equal((await call("x".repeat(43), "{}")).status, 404);
  const badR = await call(old, JSON.stringify({ format: Z.RESULT_FORMAT, package_id: meta.id, segments: [] })); assert.equal(badR.status, 422); const bj = await badR.json(); assert.ok(bj.errors[0].message && bj.errors[0].where);
  const g = await (await legacy.GET(req(`${BASE}/x`), { params: Promise.resolve({ token: old }) })).json(); assert.equal(g.package_id, meta.id); assert.equal(g.status, "failed");
  const okR = await call(old, JSON.stringify({ format: Z.RESULT_FORMAT, package_id: meta.id, segments: b.data.segments.map((s: any) => ({ ...s, text: "ok " + s.i })), meta: { summary: "r", tags: ["a", "b", "c"], note: "", obra: "ברכות", daf: [{ daf: "ג", amud: "א" }], temas: "בלעם" } }));
  assert.equal(okR.status, 200); assert.equal(Z.statusOf(Z.getJob(meta.id)!), "done");
  // a legacy job without local data reads it from its Drive file
  const mock = await import("./helpers/mock-world"); const restore = mock.installFetch();
  try {
    Object.assign(process.env, { GOOGLE_REFRESH_TOKEN: "rt", GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s" });
    mock.addFolder("PAR", "p", null);
    mock.world.files.set("DRV1", { id: "DRV1", name: "27. clase.ai.json", mimeType: "application/json", parents: ["PAR"], content: Buffer.from(JSON.stringify({ format: "shiurim-ai-package/v1", context: { series: "Vieja", kind: "talmud", daf_guess: null, neighbors: { before: [], after: [] } }, segments: b.data.segments })) });
    Z.reopen(meta.id); const d = await Z.getJobData(Z.getJob(meta.id)!); assert.equal(d.job_id, meta.id); assert.equal(d.series, "Vieja"); assert.equal(d.segments.length, 4); assert.ok(!("prompt" in d));
  } finally { restore(); }
});

test("rendering helpers escape HTML", () => { assert.equal(P.llmsText.length > 0, true); assert.equal(A.apiBase(req("https://x.test/y"), "T"), "https://x.test/api/ia/T"); });
