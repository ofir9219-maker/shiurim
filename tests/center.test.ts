import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "center-t-"));
const C = await import("../lib/center/collections");
const F = await import("../lib/center/fal-models");
const { rawToSegments, gapClipToSegments } = await import("../lib/ingest/segments");
const { statusOf } = await import("../lib/center/status");
const { estimateRow, summarize } = await import("../lib/center/estimate");
const { buildTranscriptJson } = await import("../lib/center/outputs");
const { polishedToMd } = await import("../lib/ingest/md");

test("Berajot is migrated as collection #1 with the legacy behaviour", () => {
  const all = C.listCollections();
  assert.equal(all.length, 1);
  const b = all[0];
  assert.equal(b.folderId, C.BERAJOT_FOLDER_ID); assert.equal(b.slug, "berajot"); assert.equal(b.published, true); assert.equal(b.name, "ברכות שר לשמחה");
  const r = C.resolveSettings([b.folderId]);
  assert.equal(r.settings.model, "fal-ai/elevenlabs/speech-to-text/scribe-v2"); assert.equal(r.settings.language, "spa");
  assert.equal(r.settings.postprocess, "openai"); assert.equal(r.settings.autoSync, true); assert.equal(r.settings.namingMode, "template");
  assert.equal(r.settings.template, C.BERAJOT_TEMPLATE); assert.equal(r.published, true);
});

test("settings are inherited from the nearest configured ancestor, key by key", () => {
  C.upsertCollection({ folderId: "ROOT", name: "Todo", settings: { transcription: { model: "fal-ai/wizper", language: "heb" }, postprocess: "none", autoSync: true } });
  C.upsertCollection({ folderId: "LM", name: "Likutey Moharán", settings: { transcription: { language: "spa" }, postprocess: "openai", naming: { mode: "template", template: "{n}. ליקוטי מוהר״ן {torá} - {temas}" } }, published: true });
  const a = C.resolveSettings(["ROOT", "X", "LM", "sub"]);
  assert.equal(a.settings.model, "fal-ai/wizper"); assert.equal(a.from.model, "ROOT");        // inherited
  assert.equal(a.settings.language, "spa"); assert.equal(a.from.language, "LM");              // overridden
  assert.equal(a.settings.postprocess, "openai"); assert.equal(a.from.postprocess, "LM");
  assert.equal(a.settings.autoSync, true); assert.equal(a.from.autoSync, "ROOT");
  assert.equal(a.from.openaiModel, "default"); assert.equal(a.collection?.folderId, "LM"); assert.equal(a.published, true);
  const b = C.resolveSettings(["ROOT", "Y"]);                                               // Y is not configured: ROOT applies, not published
  assert.equal(b.collection?.folderId, "ROOT"); assert.equal(b.published, false);
  const d = C.resolveSettings(["NOPE"]);
  assert.equal(d.collection, null); assert.equal(d.settings.model, F.DEFAULT_FAL_MODEL); assert.equal(d.from.model, "default");
});

test("sanitizeSettings drops invalid values; slugs are unique", () => {
  const s = C.sanitizeSettings({ transcription: { model: "evil/model", language: "xx" }, postprocess: "rm -rf", autoSync: "yes", openai: { effort: "turbo", model: "gpt-5.2" }, naming: { mode: "template", template: "  " } });
  assert.deepEqual(s, { openai: { model: "gpt-5.2" }, naming: { mode: "template" } });
  const a = C.upsertCollection({ folderId: "A1", name: "Parashá" }), b = C.upsertCollection({ folderId: "A2", name: "Parashá" });
  assert.notEqual(a.slug, b.slug); assert.equal(a.published, false);
  assert.equal(C.collectionBySlug(a.slug)?.folderId, "A1");
  C.removeCollection("A1"); C.removeCollection("A2");
});

const geresh = "׳׳";
// Small fixtures of each model's real output shape
const scribeV2 = { language_code: "spa", words: [
  { text: "Hola", start: 0, end: 0.5, type: "word" }, { text: " ", start: 0.5, end: 0.6, type: "spacing" }, { text: "mundo.", start: 0.6, end: 1.1, type: "word" },
  { text: "(risa)", start: 1.1, end: 1.5, type: "audio_event" }, { text: " ", start: 1.5, end: 1.5, type: "spacing" }, { text: "Otra", start: 5, end: 5.4, type: "word" }, { text: " ", start: 5.4, end: 5.5, type: "spacing" }, { text: "frase", start: 5.5, end: 6, type: "word" }] };
const wizper = { text: "Hola mundo Otra frase", languages: ["es"], chunks: [{ text: " Hola mundo.", timestamp: [0, 1.2] }, { text: "", timestamp: [1.2, 3] }, { text: " Otra frase", timestamp: [5, 6.5] }] };
const whisper = { text: "x", inferred_languages: ["es"], chunks: [{ text: "Primera", timestamp: [0, 2.5], speaker: null }, { text: "Segunda sin fin", timestamp: [3, null] }, { text: "Tercera", timestamp: [10, 12] }] };
const doc = (model: string, result: unknown) => ({ model, parts: [{ part: 0, offsetMs: 0, durationMs: 20000, result }, { part: 1, offsetMs: 100000, durationMs: 5000, result }] }) as never;

test("Fal output normalization: every model yields {startMs,endMs,text} segments with part offsets", () => {
  const s2 = rawToSegments(doc("fal-ai/elevenlabs/speech-to-text/scribe-v2", scribeV2));
  assert.deepEqual(s2.slice(0, 2).map((s) => [s.startMs, s.endMs, s.text]), [[0, 1500, "Hola mundo."], [5000, 6000, "Otra frase"]]);
  assert.equal(s2.length, 4); assert.equal(s2[2].startMs, 100000);
  const s1 = rawToSegments(doc("fal-ai/elevenlabs/speech-to-text", scribeV2)); assert.deepEqual(s1, s2);
  const w = rawToSegments(doc("fal-ai/wizper", wizper));
  assert.deepEqual(w.map((s) => [s.startMs, s.endMs, s.text]), [[0, 1200, "Hola mundo."], [5000, 6500, "Otra frase"], [100000, 101200, "Hola mundo."], [105000, 106500, "Otra frase"]]);
  const h = rawToSegments(doc("fal-ai/whisper", whisper));
  assert.deepEqual(h.slice(0, 3).map((s) => [s.startMs, s.endMs, s.text]), [[0, 2500, "Primera"], [3000, 10000, "Segunda sin fin"], [10000, 12000, "Tercera"]]); // null end -> next start
  assert.equal(F.chunksToSegments({ chunks: [{ text: "ultimo", timestamp: [4, null] }] }, 0, 9000)[0].endMs, 9000); // last chunk -> part length
  for (const s of [...s2, ...w, ...h]) { assert.ok(s.endMs > s.startMs); assert.ok(s.text.trim()); }
  assert.deepEqual(gapClipToSegments(wizper as never, 50000, [], undefined, "fal-ai/wizper").map((s) => s.startMs), [50000, 55000]);
});

test("Fal request bodies and limits per model", () => {
  const sc = F.falInput("fal-ai/elevenlabs/speech-to-text/scribe-v2", "u", "spa"); assert.equal(sc.language_code, "spa"); assert.equal(sc.diarize, false);
  assert.equal("language_code" in F.falInput("fal-ai/elevenlabs/speech-to-text", "u", "auto"), false);
  const wz = F.falInput("fal-ai/wizper", "u", "spa"); assert.equal(wz.language, "es"); assert.equal(wz.chunk_level, "segment"); assert.equal(wz.max_segment_len, 29);
  assert.equal(F.falInput("fal-ai/whisper", "u", "auto").language, null);
  assert.equal(F.modelInfo("fal-ai/elevenlabs/speech-to-text/scribe-v2").splitSec, 1140);
  assert.ok(F.modelInfo("fal-ai/wizper").splitSec >= 1200);
  assert.equal(F.modelInfo("nonsense").id, F.DEFAULT_FAL_MODEL);
  assert.equal(F.hasUsableOutput("fal-ai/wizper", wizper), true); assert.equal(F.hasUsableOutput("fal-ai/wizper", scribeV2), false);
});

test("status derivation", () => {
  const it = (o: object) => ({ state: "detected", status: "queued", ...o }) as never;
  assert.equal(statusOf({}), "none");
  assert.equal(statusOf({ hasMd: true }), "transcribed");
  assert.equal(statusOf({ inInventory: true }), "polished");
  assert.equal(statusOf({ item: it({}) }), "queued");
  assert.equal(statusOf({ item: it({ status: "running", state: "uploaded" }) }), "transcribing");
  assert.equal(statusOf({ item: it({ status: "running", state: "transcribed" }) }), "polishing");
  assert.equal(statusOf({ item: it({ status: "failed" }) }), "error");
  assert.equal(statusOf({ item: it({ status: "waiting", state: "transcribed" }) }), "pending_package");
  assert.equal(statusOf({ item: it({ status: "done", state: "indexed", cfg: { postprocess: "none" } }) }), "transcribed");
  assert.equal(statusOf({ item: it({ status: "done", state: "indexed", cfg: { postprocess: "openai" } }) }), "polished");
});

test("estimate: Fal per model + OpenAI only when polishing", () => {
  const base = { ...C.systemDefaults(), published: false, collectionName: "x", slug: "x" };
  const a = estimateRow({ id: "1", name: "a", minutes: 60, approx: false, redo: false }, base);
  assert.ok(Math.abs(a.falUsd - 0.48) < 1e-9); assert.equal(a.openaiUsd, 0);
  const b = estimateRow({ id: "2", name: "b", minutes: 60, approx: true, redo: true }, { ...base, postprocess: "openai", model: "fal-ai/wizper" });
  assert.ok(b.openaiUsd > 0.05 && b.openaiUsd < 3); assert.ok(b.falUsd > 0 && b.falUsd < 0.48);
  const s = summarize([a, b]); assert.equal(s.files, 2); assert.equal(s.minutes, 120); assert.equal(s.approxFiles, 1); assert.equal(s.redo, 1);
  assert.ok(Math.abs(s.totalUsd - (s.falUsd + s.openaiUsd)) < 1e-9); assert.ok(s.etaMinutes > 10);
});

test("Drive outputs: json shape and md format (raw has no empty header lines)", () => {
  const j = buildTranscriptJson({ audioId: "A", model: "m", segments: [{ startMs: 0, endMs: 5, text: "hola" }], meta: { title: "t", polished: false } });
  assert.equal(j.version, 1); assert.equal(j.audioId, "A"); assert.equal(j.segments.length, 1); assert.equal(j.summary, undefined); assert.ok(j.meta.generatedAt);
  const md = polishedToMd({ title: "T", segments: [{ startMs: 3723000, endMs: 3725000, text: "hola" }] });
  assert.equal(md, "# T\n\n---\n\n**[01:02:03]** hola\n");
  assert.ok(polishedToMd({ title: "T", daf: [{ daf: "ג", amud: "א" }], summary: "S", tags: ["a"], segments: [] }).includes("- **Daf:** ג א"));
  void geresh;
});
