import test from "node:test";
import assert from "node:assert/strict";
import {
  STORE_KEY, MAX_CHATS, newChat, titleFromText, loadChats, saveChats, sanitizeConversation, filterChats, chatForClass,
  mergeChats, exportChats, parseImport, relativeDate, type Conversation,
} from "../lib/chat-store";

class Mem { m = new Map<string, string>(); limit = Infinity;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { if (v.length > this.limit) throw new Error("QuotaExceededError"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); } }
const chat = (i: number, extra: Partial<Conversation> = {}): Conversation =>
  newChat({ id: `c${i}`, title: `Chat ${i}`, updatedAt: 1000 + i, messages: [{ role: "user", content: `q${i}` }, { role: "assistant", content: "a", refs: [{ classId: "x", title: "t", startMs: 1, quote: "q".repeat(300) }] }], ...extra }, 1000 + i);

test("titleFromText", () => {
  assert.equal(titleFromText("¿Qué enseña el shiur sobre la emuná y los sufrimientos?"), "Qué enseña el shiur sobre la…");
  assert.equal(titleFromText("hola"), "Hola");
  assert.equal(titleFromText("  ¿? "), "Nuevo chat");
});
test("save/load roundtrip, newest first, empty chats skipped", () => {
  const s = new Mem();
  assert.ok(saveChats(s, [chat(1), chat(3), chat(2), newChat()]));
  const l = loadChats(s);
  assert.deepEqual(l.map((c) => c.id), ["c3", "c2", "c1"]);
});
test("load tolerates garbage and wrong version", () => {
  const s = new Mem();
  assert.deepEqual(loadChats(s), []);
  s.m.set(STORE_KEY, "{not json"); assert.deepEqual(loadChats(s), []);
  s.m.set(STORE_KEY, JSON.stringify({ v: 9, chats: [chat(1)] })); assert.deepEqual(loadChats(s), []);
  s.m.set(STORE_KEY, JSON.stringify({ v: 1, chats: [chat(1), { id: 5 }, null] })); assert.equal(loadChats(s).length, 1);
  assert.deepEqual(loadChats(null), []);
  assert.equal(saveChats(null, [chat(1)]), false);
});
test("cap at MAX_CHATS keeps the newest", () => {
  const s = new Mem();
  saveChats(s, Array.from({ length: 60 }, (_, i) => chat(i)));
  const l = loadChats(s);
  assert.equal(l.length, MAX_CHATS); assert.equal(l[0].id, "c59"); assert.ok(!l.some((c) => c.id === "c0"));
});
test("quota: strips refs of old chats, then drops oldest", () => {
  const s = new Mem();
  const list = Array.from({ length: 30 }, (_, i) => chat(i));
  const full = JSON.stringify({ v: 1, chats: list }).length;
  s.limit = Math.floor(full * 0.8);
  assert.ok(saveChats(s, list));
  const l = loadChats(s);
  assert.ok(l.length > 0); assert.equal(l[0].id, "c29");
  assert.ok(l[0].messages[1].refs); // newest keeps refs
  assert.equal(l.at(-1)!.messages[1].refs, undefined);
  s.limit = 100; assert.equal(saveChats(s, list), false); assert.equal(s.getItem(STORE_KEY), null);
});
test("sanitizeConversation validates", () => {
  assert.equal(sanitizeConversation({ id: "a", messages: "x" }), null);
  const c = sanitizeConversation({ id: "a", title: "", messages: [{ role: "bot", content: "x" }, { role: "user", content: "hi" }], effort: "ultra", memory: "m", memoryUpTo: 1, classId: "k" })!;
  assert.equal(c.messages.length, 1); assert.equal(c.title, "Nuevo chat"); assert.equal(c.effort, "medium"); assert.equal(c.memory, "m"); assert.equal(c.classId, "k");
});
test("filter, class lookup, merge, export/import, relative date", () => {
  const cs = [chat(1, { title: "Emuná y sufrimiento" }), chat(2, { classId: "K1" })];
  assert.deepEqual(filterChats(cs, "emuna").map((c) => c.id), ["c1"]);
  assert.equal(filterChats(cs, "").length, 2);
  assert.equal(chatForClass(cs, "K1")?.id, "c2"); assert.equal(chatForClass(cs, "zz"), undefined);
  const newer = { ...cs[0], title: "Nuevo título", updatedAt: 9999 };
  const merged = mergeChats(cs, [newer, chat(7)]);
  assert.equal(merged.length, 3); assert.equal(merged.find((c) => c.id === "c1")!.title, "Nuevo título");
  assert.equal(mergeChats(cs, [{ ...cs[0], title: "viejo", updatedAt: 1 }]).find((c) => c.id === "c1")!.title, "Emuná y sufrimiento");
  assert.equal(parseImport(exportChats(cs))!.length, 2);
  assert.equal(parseImport("nope"), null); assert.equal(parseImport(JSON.stringify({ a: 1 })), null);
  assert.equal(parseImport(JSON.stringify([chat(1)]))!.length, 1);
  assert.equal(relativeDate(1000, 1000 + 30_000), "ahora"); assert.equal(relativeDate(0, 5 * 60_000), "hace 5 min");
  assert.equal(relativeDate(0, 3 * 3600_000), "hace 3 h"); assert.equal(relativeDate(0, 86400_000 * 1.5), "ayer");
});
