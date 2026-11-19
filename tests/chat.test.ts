import test from "node:test";
import assert from "node:assert/strict";
import {
  detectIntent, detectClass, heuristicQuery, hitsToRefs, citedMarkers, noAiText, sanitizeMessages, fmtTime, evenIndexes, buildContext, type ClassInfo,
} from "../lib/chat-core";

const classes: ClassInfo[] = [
  { id: "a", ord: 23, ordLabel: "23", title: "La historia de Bilam y Balak", dafLabel: "ז ע״א", tags: ["Bilam"] },
  { id: "b", ord: 1.2, ordLabel: "1.2", title: "Las guardias de la noche", dafLabel: "ג ע״א", tags: [] },
  { id: "c", ord: 2.1, ordLabel: "2.1", title: "Los sufrimientos y el yugo del Cielo", dafLabel: "ד ע״ב", tags: [] },
];

test("summary intent by order number", () => {
  const i = detectIntent("resume el shiur 23", classes);
  assert.equal(i.kind, "summary");
  assert.equal(i.kind === "summary" && i.cls?.id, "a");
  const j = detectIntent("resumen de la clase 1.2", classes);
  assert.equal(j.kind === "summary" && j.cls?.id, "b");
});
test("summary intent by title", () => {
  const i = detectIntent("de qué trata la clase de Bilam", classes);
  assert.equal(i.kind === "summary" && i.cls?.id, "a");
});
test("summary falls back to current class; qa otherwise", () => {
  const i = detectIntent("resume este shiur", classes, "c");
  assert.equal(i.kind === "summary" && i.cls?.id, "c");
  assert.equal(detectIntent("qué es el yugo del cielo?", classes).kind, "qa");
  assert.equal(detectClass("hola", classes), null);
});
test("heuristic query uses history when thin", () => {
  const q = heuristicQuery([
    { role: "user", content: "¿Qué dice Rashi sobre Meematai?" }, { role: "assistant", content: "..." }, { role: "user", content: "¿y Tosafot?" },
  ]);
  assert.match(q, /tosafot/); assert.match(q, /rashi/);
});
test("refs dedupe + mapping + citations", () => {
  const refs = hitsToRefs([
    { classId: "a", title: "T", startMs: 1000, text: "<mark>x</mark> uno" },
    { classId: "a", title: "T", startMs: 5000, text: "dup cercano" },
    { classId: "b", title: "U", startMs: 65000, text: "dos" },
  ]);
  assert.equal(refs.length, 2);
  assert.equal(refs[0].quote, "x uno");
  assert.match(buildContext([], refs), /\[2\] «U», 01:05/);
  assert.deepEqual(citedMarkers("Dice A [1][2] y B [2, 3] y [9]", 3), [1, 2, 3]);
});
test("fallback text and helpers", () => {
  const t = noAiText([{ classId: "a", title: "T", startMs: 61000, quote: "q" }]);
  assert.match(t, /sin IA/); assert.match(t, /\[1\] T · 01:01: q/);
  assert.match(noAiText([]), /No encontré esto en los shiurim/);
  assert.equal(fmtTime(3661000), "1:01:01");
  assert.deepEqual(evenIndexes(100, 4), [12, 37, 62, 87]);
  assert.equal(sanitizeMessages([{ role: "x", content: "a" }, { role: "user", content: " hi " }, 3]).length, 1);
});
