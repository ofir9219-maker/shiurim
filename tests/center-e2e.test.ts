// Local end-to-end of the generalized pipeline with mocked Drive/Fal/R2 (OpenAI + Sefaria are real when OPENAI_API_KEY is set).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "center-e2e-"));
Object.assign(process.env, { GOOGLE_REFRESH_TOKEN: "rt", GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s", FAL_KEY: "k", FAL_POLL_MS: "1", R2_PUBLIC_BASE_URL: "https://r2.test", INGEST_ENABLED: "0",
  DB_PATH: path.join(process.env.STORAGE_DIR, "x.db") });
const W = await import("./helpers/mock-world");
const { setR2Mock } = await import("../lib/ingest/r2");
const { scheduler } = await import("../lib/ingest/scheduler");
const C = await import("../lib/center/collections");
const J = await import("../lib/center/jobs");
const restore = W.installFetch();
setR2Mock(W.mockR2());
const HAS_OPENAI = !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== "";

const words = (texts: string[], step = 5) => texts.flatMap((t, i) => t.split(" ").map((w, k, a) => ({ text: (k ? " " : "") + w, start: i * step + k * 0.3, end: i * step + k * 0.3 + 0.25, type: "word" })));
const SCRIBE = { language_code: "spa", words: words([
  "Hoy estudiamos la Guemará en Berajot, daf guimel amud alef.", "La mishná pregunta meematai korín et Shemá beARvit.", "Desde la hora en que los cohanim entran a comer su teruma.",
  "Rabí Eliézer dice hasta el final de la primera guardia.", "Y los sabios dicen hasta la medianoche.", "Rabán Gamliel dice hasta que sube el alba.", "La guemará pregunta por qué la mishná comienza con la noche.",
  "Y responde que es como dice el versículo: vayehí érev vayehí bóker.", "El rabino explica que el día judío comienza con la noche.", "Por eso la tefilá y el Shemá se recitan de noche primero."]) };
const waitDone = async (id: string, ms = 120_000) => {
  const t0 = Date.now(); const s = scheduler();
  while (Date.now() - t0 < ms) { const it = s.state.items[id]; if (it && (it.status === "done" || it.status === "failed")) return it; await new Promise((r) => setTimeout(r, 200)); }
  throw new Error("timeout; log: " + JSON.stringify(s.state.items[id]?.log.slice(-5)));
};
let mp3: Buffer;
test("setup", () => { mp3 = W.makeMp3(60); W.addFolder("ROOT", "General", null); W.addFolder("SER", "Serie prueba", "ROOT"); W.addFolder("SUB", "Sub", "SER"); });

test("raw transcript with Wizper: .md and .json next to the audio, same base name, audio untouched, unpublished -> not indexed in DB", async () => {
  W.addAudio("AUD1", "Clase uno.mp3", "SUB", mp3);
  W.world.files.set("OLDMD", { id: "OLDMD", name: "Clase uno.md", mimeType: "text/markdown", parents: ["SUB"], content: Buffer.from("# transcripción de Plaud") });
  W.world.falResults["fal-ai/wizper"] = { text: "x", languages: ["es"], chunks: [{ text: " Hola, esto es una prueba.", timestamp: [0, 20] }, { text: " Segunda frase del shiur.", timestamp: [20, 40] }, { text: " Tercera.", timestamp: [40, 58] }] };
  C.setCenterRoot("ROOT", "General");
  C.upsertCollection({ folderId: "SER", name: "Serie prueba", published: false, settings: { transcription: { model: "fal-ai/wizper", language: "spa" }, postprocess: "none", naming: { mode: "keep" } } });
  const cands = await J.walkAudio("SER", ["ROOT", "SER"]);
  assert.equal(cands.length, 1); assert.deepEqual(cands[0].path, ["ROOT", "SER", "SUB"]); assert.equal(cands[0].hasMd, true);
  const r = scheduler().enqueue(cands); assert.equal(r.queued, 1);
  const it = await waitDone("AUD1");
  assert.equal(it.status, "done", JSON.stringify(it.log.slice(-4)) + it.error);
  assert.equal(it.cfg?.model, "fal-ai/wizper"); assert.equal(it.collectionId, "SER");
  assert.equal(W.world.falCalls.at(-1)!.model, "fal-ai/wizper"); assert.equal(W.world.falCalls.at(-1)!.body.language, "es");
  assert.equal(W.world.files.get("AUD1")!.name, "Clase uno.mp3"); // never renamed (keep)
  const md = W.byName("SUB", "Clase uno.md"), js = W.byName("SUB", "Clase uno.json");
  assert.ok(md && js); assert.equal(md!.id, "OLDMD"); // the Plaud md was updated, not duplicated
  assert.match(W.text(md)!, /^# Clase uno\n\n---\n\n\*\*\[00:00:00\]\*\* Hola, esto es una prueba\./);
  const j = JSON.parse(W.text(js)!); assert.equal(j.version, 1); assert.equal(j.audioId, "AUD1"); assert.equal(j.model, "fal-ai/wizper"); assert.equal(j.segments.length, 3); assert.equal(j.meta.polished, false);
  assert.equal(j.segments[1].startMs, 20000);
  assert.ok(it.cost.falUsd! > 0 && it.cost.falMinutes > 0.9);
  assert.equal(C.getCollection("SER")!.published, false);
  const inv = JSON.parse(fs.readFileSync(path.join(process.env.STORAGE_DIR!, "data", "inventory.json"), "utf8")); assert.equal(inv[0].collectionId, "SER");
  assert.ok(![...W.world.r2.keys()].some((k) => k.startsWith("tmp/AUD1/")), "tmp parts cleaned");
});

test("OpenAI polish + rename by template (audio, .md, .json together) + undo (real OpenAI)", { skip: !HAS_OPENAI }, async () => {
  W.addAudio("AUD2", "5. clase.mp3", "SER", mp3);
  W.world.falResults["fal-ai/elevenlabs/speech-to-text/scribe-v2"] = SCRIBE;
  C.upsertCollection({ folderId: "SER", name: "Serie prueba", published: false, settings: { transcription: { model: "fal-ai/elevenlabs/speech-to-text/scribe-v2" }, postprocess: "openai", openai: { model: process.env.E2E_OPENAI_MODEL || "gpt-5-mini", effort: "low" }, naming: { mode: "template", template: C.BERAJOT_TEMPLATE } } });
  const cands = (await J.walkAudio("SER", ["ROOT", "SER"], { skipCollections: true })).filter((c) => c.file.id === "AUD2");
  scheduler().enqueue(cands);
  const it = await waitDone("AUD2", 280_000);
  assert.equal(it.status, "done", it.error + JSON.stringify(it.log.slice(-5)));
  const audio = W.world.files.get("AUD2")!;
  assert.match(audio.name, /^5\. .* ע׳׳[אב] - .+\.mp3$/); assert.ok(!/[\/:"]/.test(audio.name));
  const base = audio.name.replace(/\.mp3$/, "");
  const js = JSON.parse(W.text(W.byName("SER", base + ".json"))!); assert.equal(js.meta.polished, true); assert.ok(js.summary && js.tags.length >= 3);
  assert.ok(js.segments.every((s: { text: string }) => !/[֐-׿]/.test(s.text)));
  assert.ok(W.byName("SER", base + ".md")); assert.equal(W.byName("SER", "5. clase.md"), undefined);
  assert.ok(it.cost.promptTokens > 0 && it.cost.openaiUsd! > 0);
  const { undoRename } = await import("../lib/center/undo");
  const r = await undoRename("AUD2");
  assert.equal(r.restored.length, 3);
  assert.equal(audio.name, "5. clase.mp3");
  assert.ok(W.byName("SER", "5. clase.md") && W.byName("SER", "5. clase.json")); assert.equal(W.byName("SER", base + ".md"), undefined);
  await assert.rejects(undoRename("AUD2"), /No hay/);
});

const aiResult = (data: any, tag = "corregido") => ({ format: "shiurim-ai-result/v1", job_id: data.job_id, segments: data.segments.map((x: any) => ({ ...x, text: x.text.replace(/^./, (c: string) => c.toUpperCase()) + ` (${tag})` })),
  ...(data.needs_meta ? { meta: { summary: "Una clase de prueba.", tags: ["prueba", "berajot", "shemá"], note: "", obra: "ברכות", daf: [{ daf: "ג", amud: "א" }], temas: "קריאת שמע, ערבית" } } : {}) });
const waitStatus = async (id: string, st: string, ms = 60_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (scheduler().state.items[id]?.status === st) return scheduler().state.items[id]; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`timeout esperando ${st}: ` + JSON.stringify(scheduler().state.items[id]?.log.slice(-4))); };

test("AI zone: transcribed file -> jobs in the queue (no Drive file by default) -> invalid result rejected -> valid applied (rename by template) -> re-submit replaces", async () => {
  const Z = await import("../lib/zone/jobs"); const T = await import("../lib/zone/token");
  const resultRoute = await import("../app/api/ia/[token]/jobs/[jobId]/result/route"); const claimRoute = await import("../app/api/ia/[token]/jobs/[jobId]/claim/route"); const listRoute = await import("../app/api/ia/[token]/jobs/route");
  const token = T.currentToken()!;
  W.addFolder("SER2", "Serie IA", "ROOT");
  W.world.falResults["fal-ai/elevenlabs/speech-to-text/scribe-v2"] = SCRIBE;
  C.upsertCollection({ folderId: "SER2", name: "Serie IA", published: false, settings: { transcription: { model: "fal-ai/elevenlabs/speech-to-text/scribe-v2" }, postprocess: "ai_package", naming: { mode: "template", template: C.BERAJOT_TEMPLATE } } });
  W.addAudio("AUD3", "9. otra.mp3", "SER2", mp3);
  scheduler().enqueue(await J.walkAudio("SER2", ["ROOT", "SER2"]));
  const it = await waitStatus("AUD3", "waiting");
  assert.equal(it.state, "transcribed");
  assert.equal(W.byName("SER2", "9. otra.ai.json"), undefined, "no Drive copy unless the series asks for it");
  const call = (id: string, body: string) => resultRoute.POST(new Request(`https://ofirsegal.app/api/ia/${token}/jobs/${id}/result`, { method: "POST", body, headers: { "content-type": "application/json" } }), { params: Promise.resolve({ token, jobId: id }) });
  const pend: any[] = await (await listRoute.GET(new Request(`https://ofirsegal.app/api/ia/${token}/jobs?status=pending`), { params: Promise.resolve({ token }) })).json();
  const mine = pend.filter((p) => Z.getJob(p.job_id)!.audioId === "AUD3"); assert.equal(mine.length, 1);
  const data: any = await (await claimRoute.POST(new Request("https://ofirsegal.app/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ token, jobId: mine[0].job_id }) })).json();
  assert.ok(data.segments.length >= 3 && !("prompt" in data));
  const bad = aiResult(data); bad.segments[2].startMs += 7; (bad.segments[4] as any).text = "";
  const r1 = await call(data.job_id, JSON.stringify(bad)); assert.equal(r1.status, 422); const j1 = await r1.json();
  assert.ok(j1.errors.some((e: any) => e.where === "segments[i=2].startMs") && j1.errors.some((e: any) => e.where === "segments[i=4].text"));
  assert.equal(scheduler().state.items.AUD3.status, "waiting"); assert.equal(W.world.files.get("AUD3")!.name, "9. otra.mp3");
  const r2 = await call(data.job_id, "```json\n" + JSON.stringify(aiResult(data)) + "\n```"); const j2 = await r2.json(); assert.equal(r2.status, 200, JSON.stringify(j2)); assert.equal(j2.applied, true);
  const done = await waitDone("AUD3", 60_000); assert.equal(done.status, "done", String(done.error));
  const au = W.world.files.get("AUD3")!; assert.match(au.name, /^9\. ברכות ג ע׳׳א - קריאת שמע, ערבית\.mp3$/);
  const base = au.name.replace(/\.mp3$/, ""); const js = JSON.parse(W.text(W.byName("SER2", base + ".json"))!);
  assert.equal(js.meta.polished, true); assert.match(js.segments[0].text, /\(corregido\)$/); assert.deepEqual(js.tags, ["prueba", "berajot", "shemá"]);
  assert.match(W.text(W.byName("SER2", base + ".md"))!, /\(corregido\)/);
  const r3 = await call(data.job_id, JSON.stringify(aiResult(data, "v2"))); assert.equal((await r3.json()).applied, true);
  const t0 = Date.now(); while (Date.now() - t0 < 30000 && !/\(v2\)/.test(W.text(W.byName("SER2", base + ".md")) ?? "")) await new Promise((r) => setTimeout(r, 150));
  assert.match(W.text(W.byName("SER2", base + ".md"))!, /\(v2\)/); assert.doesNotMatch(W.text(W.byName("SER2", base + ".md"))!, /\(corregido\)/);
});

test("AI zone: multi-part class applies only when every part is done; Drive copy + Drive pickup of <name>.ai.corregido.json when the series enables it", async () => {
  const Z = await import("../lib/zone/jobs");
  process.env.AI_ZONE_PART_SEGMENTS = "4";
  try {
    C.upsertCollection({ folderId: "SER2", name: "Serie IA", published: false, settings: { transcription: { model: "fal-ai/elevenlabs/speech-to-text/scribe-v2" }, postprocess: "ai_package", aiCopyToDrive: true, naming: { mode: "template", template: C.BERAJOT_TEMPLATE } } });
    W.addAudio("AUD4", "10. dos.mp3", "SER2", mp3);
    scheduler().enqueue((await J.walkAudio("SER2", ["ROOT", "SER2"])).filter((c) => c.file.id === "AUD4"));
    await waitStatus("AUD4", "waiting");
    const jobs = Z.jobsOfAudio("AUD4").sort((a, b) => a.part - b.part); assert.ok(jobs.length >= 2, `parts: ${jobs.length}`);
    assert.ok(W.byName("SER2", "10. dos.ai.parte1de" + jobs.length + ".json"), "plain data file written to Drive (copiar también a Drive)");
    const datas = await Promise.all(jobs.map((j) => Z.getJobData(j)));
    // part 2.. via the Drive pickup, then part 1 via receiveResult: only the last one triggers the apply
    const last = jobs.length - 1;
    for (let k = 1; k <= last; k++) W.world.files.set("CORR" + k, { id: "CORR" + k, name: `10. dos.ai.parte${k + 1}de${jobs.length}.corregido.json`, mimeType: "application/json", parents: ["SER2"], content: Buffer.from(JSON.stringify(aiResult(datas[k]))) });
    const scan = await Z.scanDrive(); assert.equal(scan.received, last);
    assert.equal(scheduler().state.items.AUD4.status, "waiting"); assert.equal(Z.counts().done >= last, true);
    const r = await Z.receiveResult(Z.getJob(jobs[0].id)!, JSON.stringify(aiResult(datas[0])), "api"); assert.equal(r.applied, true, JSON.stringify(r));
    const d4 = await waitDone("AUD4", 60_000); assert.equal(d4.status, "done", String(d4.error)); assert.match(W.world.files.get("AUD4")!.name, /^10\. ברכות ג ע׳׳א/);
    const js = JSON.parse(W.text(W.byName("SER2", W.world.files.get("AUD4")!.name.replace(/\.mp3$/, "") + ".json"))!); assert.equal(js.segments.length, datas.reduce((n, d) => n + d.segments.length, 0));
  } finally { delete process.env.AI_ZONE_PART_SEGMENTS; }
});

test("teardown", () => { restore(); setR2Mock(null); });
