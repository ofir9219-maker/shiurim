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

test("teardown", () => { restore(); setR2Mock(null); });
