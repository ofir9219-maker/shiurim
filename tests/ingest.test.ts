import test from "node:test";
import assert from "node:assert/strict";
import { parseOrder, nextOrder, validateName, buildTitle, dafSpan, AMUD_MARK, splitExt } from "../lib/ingest/naming";
import { stitchWords, wordsToSegments, findGaps, findHollow, mergeFinal, gapClipToSegments, rawToSegments } from "../lib/ingest/segments";
import { newItem, completeStep, failItem, retryItem, observeFile, nextState, backoffMs, isRunnable, MAX_ATTEMPTS, STATES, type Item } from "../lib/ingest/state";
import { runItem, type Steps } from "../lib/ingest/runner";
import { validateTexts, makeBatches, makeMeta, memCache } from "../lib/ingest/polish";
import { polishedToMd } from "../lib/ingest/md";

test("order parsing", () => {
  assert.equal(parseOrder("27. ברכות ז ע''א - בלעם.mp3"), "27");
  assert.equal(parseOrder("4.2. algo.m4a"), "4.2");
  assert.equal(parseOrder("  10 - x.mp3"), "10");
  assert.equal(parseOrder("Shiur de hoy 12.m4a"), "12");
  assert.equal(parseOrder("Shiur sin numero.m4a"), null);
  assert.equal(nextOrder(["1", "27", "4.2", "9999", null]), "28");
  assert.equal(nextOrder([]), "1");
  assert.deepEqual(splitExt("a b.M4A"), { base: "a b", ext: ".m4a" });
});

const geresh2 = "׳׳";
test("title format", () => {
  assert.equal(AMUD_MARK, geresh2);
  const t = buildTitle("27", "ברכות", [{ daf: "ז", amud: "א" }], "בלעם, תשובה");
  assert.equal(t, `27. ברכות ז ע${geresh2}א - בלעם, תשובה`);
  assert.equal(dafSpan([{ daf: "ג", amud: "א" }, { daf: "ג", amud: "ב" }]), `ג ע${geresh2}א-ע${geresh2}ב`);
  assert.equal(dafSpan([{ daf: "ט", amud: "ב" }, { daf: "י", amud: "א" }]), `ט ע${geresh2}ב-י ע${geresh2}א`);
  assert.equal(buildTitle("41", "ליקוטי מוהר״ן", [{ daf: "יט", amud: "" }], "x y"), "41. ליקוטי מוהר״ן יט - x y");
  const ok = (nn: string, o = {}) => validateName({ order: "27", ext: ".mp3", newName: nn, title: nn.replace(/\.mp3$/, ""), ...o });
  assert.deepEqual(ok(`${t}.mp3`, { daf: [{ daf: "ז", amud: "א" }] }), []);
  assert.ok(ok(`26. ברכות ז ע${geresh2}א - x.mp3`).some((e) => /start with/.test(e)));
  assert.ok(ok(`${t}.m4a`).some((e) => /end with/.test(e)));
  assert.ok(ok(`27. ברכות ז ע''א - x.mp3`).some((e) => /amud/.test(e)));
  assert.ok(ok(`27. ברכות ז ע${geresh2}א x.mp3`).some((e) => /' - '/.test(e)));
  assert.ok(ok(`27. ברכות ז ע${geresh2}א - a/b.mp3`).some((e) => /contains/.test(e)));
  assert.ok(ok(`27. ברכות ז ע${geresh2}א - a:b.mp3`).some((e) => /contains/.test(e)));
  assert.ok(validateName({ order: "27", ext: ".mp3", newName: `${t}.mp3`, title: "otro" }).some((e) => /title must equal/.test(e)));
  assert.ok(ok(`${t}.mp3`, { daf: [{ daf: "7", amud: "א" }] }).some((e) => /Hebrew letters/.test(e)));
});

const w = (text: string, start: number, end: number, type = "word") => ({ text, start, end, type });
test("segment stitching with part offsets", () => {
  const parts = [
    { offsetMs: 0, result: { words: [w("Hola", 0, 0.5), w(" ", 0.5, 0.6, "spacing"), w("mundo.", 0.6, 1)] } },
    { offsetMs: 1140000, result: { words: [w("Segunda", 1, 1.5), w(" ", 1.5, 1.6, "spacing"), w("parte", 1.6, 2)] } },
  ];
  const words = stitchWords(parts);
  assert.equal(words.find((x) => x.text === "Segunda")!.start, 1141);
  const segs = wordsToSegments(words);
  assert.equal(segs.length, 2); // gap > 1.2s splits at the part boundary
  assert.deepEqual(segs.map((s) => [s.startMs, s.endMs, s.text]), [[0, 1000, "Hola mundo."], [1141000, 1142000, "Segunda parte"]]);
  assert.equal(rawToSegments({ model: "m", parts: parts.map((p, i) => ({ part: i, offsetMs: p.offsetMs, durationMs: 0, result: p.result })) }).length, 2);
  // audio events dropped; long sentence splits at sentence end after 6s
  const long = [w("a", 0, 3), w(" ", 3, 3, "spacing"), w("b.", 3, 7), w(" ", 7, 7, "spacing"), w("c", 7.1, 8), w("[risa]", 8, 9, "audio_event")];
  assert.deepEqual(wordsToSegments(stitchWords([{ offsetMs: 0, result: { words: long } }])).map((s) => s.text), ["a b.", "c"]);
});

test("gap and hollow detection", () => {
  const segs = [{ startMs: 5000, endMs: 10000, text: "a" }, { startMs: 60000, endMs: 70000, text: "b" }, { startMs: 71000, endMs: 150000, text: "x".repeat(100) }];
  const g = findGaps(segs, 200000);
  assert.deepEqual(g, [{ startMs: 9000, endMs: 61000 }, { startMs: 149000, endMs: 200000 }]); // 0-5s and 150-200s: 5s no, 50s yes
  assert.deepEqual(findGaps([{ startMs: 50000, endMs: 60000, text: "a" }], 61000), [{ startMs: 0, endMs: 51000 }]);
  assert.deepEqual(findGaps(segs, 200000, 100000), []);
  const h = findHollow(segs);
  assert.equal(h.length, 1); assert.equal(h[0].startMs, 71000); assert.equal(h[0].hollow, true);
  assert.equal(findHollow([{ startMs: 0, endMs: 46000, text: "x".repeat(400) }]).length, 0);
});

test("gap clip segments skip overlaps and merge", () => {
  const base = [{ startMs: 0, endMs: 10000, text: "a" }, { startMs: 40000, endMs: 90000, text: "hollow" }];
  const res = { words: [w("nuevo", 0, 1), w(" ", 1, 1, "spacing"), w("texto", 1, 2)] };
  assert.equal(gapClipToSegments(res, 9000, base).length, 0); // overlaps base[0] (9000-11000)
  const ok = gapClipToSegments(res, 20000, base);
  assert.deepEqual(ok, [{ startMs: 20000, endMs: 22000, text: "nuevo texto" }]);
  assert.equal(gapClipToSegments(res, 41000, base).length, 0);
  assert.equal(gapClipToSegments(res, 41000, base, 40000).length, 1); // hollow segment ignored for its own clip
  const merged = mergeFinal(base, [{ startMs: 41000, endMs: 50000, text: "z" }], new Set([40000]));
  assert.deepEqual(merged.map((s) => s.text), ["a", "z"]);
  assert.deepEqual(mergeFinal(base, [{ startMs: 41000, endMs: 50000, text: "z" }], new Set()).map((s) => s.text), ["a", "hollow", "z"]);
});

const mk = (): Item => newItem({ id: "x", name: "5. a.mp3", ext: ".mp3", mimeType: "audio/mpeg", sizeBytes: 1, order: "5" });
test("state transitions", () => {
  const it = mk();
  assert.deepEqual([...STATES], ["detected", "uploaded", "transcribed", "polished", "renamed", "indexed"]);
  for (const s of STATES.slice(1)) { completeStep(it); assert.equal(it.state, s); }
  assert.equal(nextState("indexed"), null);
  const f = mk(); failItem(f, "boom", 0);
  assert.equal(f.status, "queued"); assert.equal(f.nextAttemptAt, backoffMs(1)); assert.equal(f.state, "detected");
  assert.equal(isRunnable(f, 0), false); assert.equal(isRunnable(f, backoffMs(1)), true);
  assert.equal(backoffMs(2), 2 * 60000); assert.equal(backoffMs(20), 60 * 60000);
  for (let i = 1; i < MAX_ATTEMPTS; i++) failItem(f, "boom", 0);
  assert.equal(f.status, "failed"); assert.equal(isRunnable(f, 1e15), false);
  retryItem(f); assert.equal(f.status, "queued"); assert.equal(f.attempts, 0); assert.equal(isRunnable(f), true);
});
test("upload stability needs same size on 2 polls", () => {
  const seen = {};
  assert.equal(observeFile(seen, "a", 100), false);
  assert.equal(observeFile(seen, "a", 150), false); // still growing
  assert.equal(observeFile(seen, "a", 150), true);
});
test("runner resumes from the persisted state and retries a failed step", async () => {
  const calls: string[] = []; let boom = true; let saves = 0;
  const steps: Steps = {
    detected: async () => void calls.push("up"), uploaded: async () => void calls.push("tr"),
    transcribed: async () => { calls.push("po"); if (boom) { boom = false; throw new Error("fal down"); } },
    polished: async () => void calls.push("re"), renamed: async () => void calls.push("ix"),
  };
  const it = mk();
  await runItem(it, steps, () => void saves++);
  assert.equal(it.status, "queued"); assert.equal(it.state, "transcribed"); assert.equal(it.attempts, 1); assert.match(it.error!, /fal down/);
  await runItem(it, steps, () => {}); // "restart": picks up at transcribed, earlier steps not repeated
  assert.deepEqual(calls, ["up", "tr", "po", "po", "re", "ix"]);
  assert.equal(it.status, "done"); assert.equal(it.state, "indexed"); assert.equal(it.attempts, 0); assert.ok(saves > 5);
});

test("polish validation (merge-polished rules)", () => {
  assert.deepEqual(validateTexts([0, 1], [{ i: 0, text: "ok" }, { i: 1, text: "bien" }]), []);
  const e = validateTexts([0, 1, 2], [{ i: 0, text: "" }, { i: 1, text: "שלום" }, { i: 5, text: "x" }, { i: 5, text: "y" }]);
  assert.ok(e.some((x) => /faltan/.test(x)) && e.some((x) => /vacíos/.test(x)) && e.some((x) => /hebreas/.test(x)) && e.some((x) => /fuera/.test(x)) && e.some((x) => /duplicado/.test(x)));
  const b = makeBatches(Array.from({ length: 250 }, () => "x"), 100);
  assert.deepEqual(b.map((x) => x.length), [100, 100, 50]);
  assert.equal(makeBatches(["a".repeat(10), "b".repeat(10), "c".repeat(10)], 100, 15).length, 3);
});

test("meta builds the exact name and repairs once", async () => {
  let n = 0;
  const llm = (async () => {
    n++;
    const data = n === 1
      ? { summary: "Resumen.", tags: ["a", "b", "c"], daf: [{ daf: "7", amud: "א" }], work_he: "ברכות", topics_he: "בלעם", daf_note: "" }
      : { summary: "Resumen.", tags: ["a", "b", "c"], daf: [{ daf: "ז", amud: "א" }], work_he: "ברכות", topics_he: 'בלעם: "x", תשובה', daf_note: "" };
    return { data, usage: { promptTokens: 1, completionTokens: 1 } };
  }) as never;
  const m = await makeMeta([{ startMs: 0, endMs: 1, text: "hola" }], { name: "27. x.mp3", order: "27", ext: ".mp3" }, { llm, sefaria: async () => "", cache: memCache() });
  assert.equal(n, 2);
  assert.equal(m.newName, `27. ברכות ז ע${geresh2}א - בלעם x, תשובה.mp3`);
  assert.equal(m.title + ".mp3", m.newName);
});

test("markdown format", () => {
  const md = polishedToMd({ title: "T", daf: [{ daf: "ג", amud: "א" }], summary: "S", tags: ["a", "b"], segments: [{ startMs: 3723000, endMs: 3725000, text: "hola" }] });
  assert.equal(md, "# T\n\n- **Daf:** ג א\n- **Resumen:** S\n- **Tags:** a, b\n\n---\n\n**[01:02:03]** hola\n");
});
