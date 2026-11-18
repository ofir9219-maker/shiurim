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

const aiResult = (pj: any, tag = "corregido") => ({ format: "shiurim-ai-result/v1", package_id: pj.package_id, segments: pj.segments.map((x: any) => ({ ...x, text: x.text.replace(/^./, (c: string) => c.toUpperCase()) + ` (${tag})` })),
  meta: { summary: "Una clase de prueba.", tags: ["prueba", "berajot", "shemá"], note: "", obra: "ברכות", daf: [{ daf: "ג", amud: "א" }], temas: "קריאת שמע, ערבית" } });
const waitStatus = async (id: string, st: string, ms = 60_000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (scheduler().state.items[id]?.status === st) return scheduler().state.items[id]; await new Promise((r) => setTimeout(r, 100)); } throw new Error(`timeout esperando ${st}: ` + JSON.stringify(scheduler().state.items[id]?.log.slice(-4))); };

test("AI package: Drive package -> invalid upload rejected -> valid upload applied (rename by template) -> re-upload replaces -> Drive pickup", async () => {
  const route = await import("../app/api/paquete/[token]/route");
  const K = await import("../lib/center/packages");
  W.addFolder("SER2", "Serie IA", "ROOT");
  W.world.falResults["fal-ai/elevenlabs/speech-to-text/scribe-v2"] = SCRIBE;
  C.upsertCollection({ folderId: "SER2", name: "Serie IA", published: false, settings: { transcription: { model: "fal-ai/elevenlabs/speech-to-text/scribe-v2" }, postprocess: "ai_package", naming: { mode: "template", template: C.BERAJOT_TEMPLATE } } });
  W.addAudio("AUD3", "9. otra.mp3", "SER2", mp3);
  scheduler().enqueue(await J.walkAudio("SER2", ["ROOT", "SER2"]));
  const it = await waitStatus("AUD3", "waiting");
  assert.equal(it.state, "transcribed");
  const pf = W.byName("SER2", "9. otra.ai.json")!; assert.ok(pf, "package written next to the audio");
  const pj = JSON.parse(W.text(pf)!); assert.equal(pj.format, "shiurim-ai-package/v1"); assert.ok(pj.segments.length >= 3);
  const token = pj.upload.url.split("/").pop();
  const call = (tok: string, body: string, method = "POST") => route[method as "POST"](new Request(`https://ofirsegal.app/api/paquete/${tok}`, { method, body, headers: { "content-type": "application/json" } }), { params: Promise.resolve({ token: tok }) });
  // CORS + unknown token
  const opt = route.OPTIONS(); assert.equal(opt.headers.get("access-control-allow-origin"), "*");
  assert.equal((await call("x".repeat(43), "{}")).status, 404);
  assert.equal((await call(token, "x".repeat(5 * 1024 * 1024 + 10))).status, 413);
  // invalid: wrong ids/timestamps -> 422, lists exactly what is wrong, nothing applied
  const bad = aiResult(pj); bad.segments[2].startMs += 7; bad.segments[4].text = "";
  const r1 = await call(token, JSON.stringify(bad)); assert.equal(r1.status, 422); assert.equal(r1.headers.get("access-control-allow-origin"), "*");
  const j1 = await r1.json(); assert.equal(j1.ok, false); assert.ok(j1.errors.some((e: any) => e.where === "segmento 2" && /startMs/.test(e.message)) && j1.errors.some((e: any) => e.where === "segmento 4"));
  assert.equal(scheduler().state.items.AUD3.status, "waiting"); assert.equal(W.world.files.get("AUD3")!.name, "9. otra.mp3");
  assert.equal((await call(token, "esto no es json")).status, 422);
  // valid -> applied, pipeline continues to rename/md/json
  const r2 = await call(token, "```json\n" + JSON.stringify(aiResult(pj)) + "\n```"); const j2 = await r2.json(); assert.equal(r2.status, 200, JSON.stringify(j2)); assert.equal(j2.applied, true);
  const done = await waitDone("AUD3", 60_000); assert.equal(done.status, "done", String(done.error));
  const au = W.world.files.get("AUD3")!; assert.match(au.name, /^9\. ברכות ג ע׳׳א - קריאת שמע, ערבית\.mp3$/);
  const base = au.name.replace(/\.mp3$/, ""); const js = JSON.parse(W.text(W.byName("SER2", base + ".json"))!);
  assert.equal(js.meta.polished, true); assert.match(js.segments[0].text, /\(corregido\)$/); assert.deepEqual(js.tags, ["prueba", "berajot", "shemá"]);
  assert.match(W.text(W.byName("SER2", base + ".md"))!, /\(corregido\)/); assert.ok(W.byName("SER2", "9. otra.ai.json"), "package file stays in Drive");
  // re-upload replaces the active result
  const r3 = await call(token, JSON.stringify(aiResult(pj, "v2"))); assert.equal((await r3.json()).applied, true);
  const t0 = Date.now(); while (Date.now() - t0 < 30000 && !/\(v2\)/.test(W.text(W.byName("SER2", base + ".md")) ?? "")) await new Promise((r) => setTimeout(r, 150));
  assert.match(W.text(W.byName("SER2", base + ".md"))!, /\(v2\)/); assert.doesNotMatch(W.text(W.byName("SER2", base + ".md"))!, /\(corregido\)/);
  // Drive pickup of <name>.ai.corregido.json (auto-sync)
  W.addAudio("AUD4", "10. dos.mp3", "SER2", mp3);
  scheduler().enqueue((await J.walkAudio("SER2", ["ROOT", "SER2"])).filter((c) => c.file.id === "AUD4"));
  await waitStatus("AUD4", "waiting");
  const pj4 = JSON.parse(W.text(W.byName("SER2", "10. dos.ai.json"))!);
  W.world.files.set("CORR", { id: "CORR", name: "10. dos.ai.corregido.json", mimeType: "application/json", parents: ["SER2"], content: Buffer.from(JSON.stringify(aiResult(pj4))) });
  const scan = await K.scanDrive(); assert.equal(scan.received >= 1, true);
  const d4 = await waitDone("AUD4", 60_000); assert.equal(d4.status, "done", String(d4.error)); assert.match(W.world.files.get("AUD4")!.name, /^10\. ברכות ג ע׳׳א/);
  // expired token
  const meta = K.listPackages().find((p) => p.id === pj.package_id)!; fs.writeFileSync(path.join(process.env.STORAGE_DIR!, "packages", "packages.json"), JSON.stringify(K.listPackages().map((p) => (p.id === meta.id ? { ...p, expiresAt: new Date(Date.now() - 1000).toISOString() } : p))));
  assert.equal((await call(token, "{}")).status, 410);
});

test("teardown", () => { restore(); setR2Mock(null); });
