import test from "node:test";
import assert from "node:assert/strict";
import { capMemory, condensePrompt, memoryPrompt, mergeNoKeyMemory, needsCondense, sanitizeMemory, splitForCondense, MEM_CAP } from "../lib/chat-memory";
import { heuristicQuery } from "../lib/chat-core";

const mk = (n: number, len = 10) => Array.from({ length: n }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: "x".repeat(len) + i }));

test("needsCondense by count and by chars", () => {
  assert.equal(needsCondense(mk(12)), false);
  assert.equal(needsCondense(mk(13)), true);
  assert.equal(needsCondense(mk(4, 3500)), true);
  assert.equal(needsCondense(mk(4, 100)), false);
});
test("splitForCondense keeps the last 6", () => {
  const { older, recent } = splitForCondense(mk(15));
  assert.equal(older.length, 9); assert.equal(recent.length, 6);
  assert.deepEqual(splitForCondense(mk(3)).older, []);
});
test("capMemory truncates at word boundary", () => {
  const out = capMemory("palabra ".repeat(400));
  assert.ok(out.length <= MEM_CAP); assert.ok(out.endsWith("…"));
});
test("no-key memory concatenates user questions, newest survive truncation", () => {
  const m1 = mergeNoKeyMemory(undefined, [{ role: "user", content: "¿Qué es la emuná?" }, { role: "assistant", content: "respuesta" }]);
  assert.match(m1, /^Preguntas anteriores: ¿Qué es la emuná\?$/);
  const m2 = mergeNoKeyMemory(m1, [{ role: "user", content: "Segunda" }]);
  assert.match(m2, /emuná\?.*\| Segunda$/);
  const big = mergeNoKeyMemory("", Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, content: `pregunta numero ${i} `.repeat(8) })));
  assert.ok(big.length <= MEM_CAP); assert.match(big, /numero 39/);
  assert.equal(mergeNoKeyMemory("", []), "");
});
test("prompt builders and sanitizeMemory", () => {
  assert.equal(memoryPrompt(""), "");
  assert.match(memoryPrompt("Le interesa Berajot"), /Memoria de esta conversación: Le interesa Berajot/);
  const p = condensePrompt("viejo", mk(2));
  assert.match(p.messages[0].content, /MEMORIA ACTUAL:\nviejo/);
  assert.equal(sanitizeMemory(5), ""); assert.equal(sanitizeMemory("a".repeat(5000)).length, 2000);
});
test("heuristicQuery falls back to memory keywords", () => {
  const q = heuristicQuery([{ role: "user", content: "¿y eso?" }], "Conversación sobre Bilam y la profecía");
  assert.match(q, /bilam/);
});
