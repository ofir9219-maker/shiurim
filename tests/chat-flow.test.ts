import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = process.env.DB_PATH || "/tmp/fx.db";
delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY; delete process.env.LLM_PROVIDER;
const { chat } = await import("../lib/chat");
type Ev = { type: string; text?: string; refs?: any[]; cited?: number[]; mode?: string };
const run = async (q: string, classId?: string) => { const evs: Ev[] = []; for await (const e of chat([{ role: "user", content: q }], classId)) evs.push(e as Ev); return evs; };

test("no-key mode lists hits as refs", async () => {
  const evs = await run("¿Qué dice la Mishná sobre Meematai?");
  const done = evs.at(-1)!;
  assert.equal(done.mode, "noai"); assert.ok(done.refs!.length > 0);
  assert.match(evs[0].text!, /sin IA/);
});
test("no-key summary of a class", async () => {
  const done = (await run("resume el shiur 1.2")).at(-1)!;
  assert.ok(done.refs!.length > 0); assert.ok(done.refs!.every((r) => r.classId === "FIXTURE_ID_0002"));
});

test("streaming path with mocked OpenAI", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const orig = globalThis.fetch; const calls: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), body });
    if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: "meematai shemá" } }] }));
    const enc = new TextEncoder();
    const chunks = ['data: {"choices":[{"delta":{"content":"Es al ano"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"checer [1]."}}]}\n\ndata: [DONE]\n\n'];
    return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }));
  }) as any;
  try {
    const evs: Ev[] = [];
    for await (const e of chat([{ role: "user", content: "Meematai" }, { role: "assistant", content: "ok" }, { role: "user", content: "¿y el shemá?" }])) evs.push(e as Ev);
    assert.equal(evs.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Es al anochecer [1].");
    const done = evs.at(-1)!; assert.equal(done.mode, "ai"); assert.deepEqual(done.cited, [1]); assert.ok(done.refs!.length);
    const stream = calls.find((c) => c.body.stream);
    assert.match(stream.body.messages.at(-1).content, /EXTRACTOS/);
  } finally { globalThis.fetch = orig; delete process.env.OPENAI_API_KEY; }
});
test("anthropic streaming + LLM failure fallback", async () => {
  process.env.LLM_PROVIDER = "anthropic"; process.env.ANTHROPIC_API_KEY = "k";
  const orig = globalThis.fetch;
  globalThis.fetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body);
    if (!body.stream) return new Response("{}", { status: 500 });
    const enc = new TextEncoder();
    return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hola [2]"}}\n\n')); c.close(); } }));
  }) as any;
  try {
    const evs: Ev[] = []; for await (const e of chat([{ role: "user", content: "Meematai shemá" }])) evs.push(e as Ev);
    assert.equal(evs[0].text, "Hola [2]"); assert.equal(evs.at(-1)!.mode, "ai");
    globalThis.fetch = (async () => new Response("boom", { status: 500 })) as any;
    const evs2: Ev[] = []; for await (const e of chat([{ role: "user", content: "Meematai shemá" }])) evs2.push(e as Ev);
    assert.equal(evs2.at(-1)!.mode, "error"); assert.ok(evs2.at(-1)!.refs!.length);
  } finally { globalThis.fetch = orig; delete process.env.LLM_PROVIDER; delete process.env.ANTHROPIC_API_KEY; }
});

test("model/effort validation and retry without rejected param", async () => {
  const { resolveChatOptions, getChatModels, resetModelsCache } = await import("../lib/chat-models");
  process.env.OPENAI_API_KEY = "sk-test"; process.env.CHAT_MODELS = "gpt-4.1-mini,o4-mini"; delete process.env.CHAT_MODEL;
  try {
    assert.deepEqual((await getChatModels()).models.map((m) => [m.id, m.reasoning]), [["gpt-4.1-mini", false], ["o4-mini", true]]);
    assert.deepEqual(await resolveChatOptions("evil-model", "high"), { model: "gpt-4.1-mini", effort: undefined });
    assert.deepEqual(await resolveChatOptions("gpt-4.1-mini", "high"), { model: "gpt-4.1-mini", effort: undefined });
    assert.deepEqual(await resolveChatOptions("o4-mini", "high"), { model: "o4-mini", effort: "high" });
    assert.deepEqual(await resolveChatOptions("o4-mini", "bogus"), { model: "o4-mini", effort: "medium" });

    delete process.env.CHAT_MODELS; resetModelsCache();
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: [
      { id: "gpt-4o", created: 1 }, { id: "gpt-5-mini", created: 5 }, { id: "gpt-4o-audio-preview", created: 9 }, { id: "text-embedding-3-small", created: 9 }, { id: "o3", created: 3 }, { id: "gpt-4.1-mini-search", created: 9 }] }))) as any;
    try { assert.deepEqual((await getChatModels()).models.map((m) => m.id), ["gpt-5-mini", "o3", "gpt-4o"]); } finally { globalThis.fetch = orig; }
    resetModelsCache();

    const calls: any[] = [];
    globalThis.fetch = (async (_u: any, init: any) => {
      const body = JSON.parse(init.body); calls.push(body);
      if (body.reasoning_effort) return new Response('{"error":{"message":"Unsupported parameter: reasoning_effort"}}', { status: 400 });
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok [1]"}}]}\n\ndata: [DONE]\n\n')); c.close(); } }));
    }) as any;
    try {
      const evs: Ev[] = []; for await (const e of chat([{ role: "user", content: "Meematai shemá" }], undefined, { model: "o4-mini", effort: "low" })) evs.push(e as Ev);
      assert.equal(evs.at(-1)!.mode, "ai");
      assert.equal(calls[0].reasoning_effort, "low"); assert.equal(calls[0].temperature, undefined); assert.equal(calls[0].model, "o4-mini");
      assert.equal(calls[1].reasoning_effort, undefined); assert.equal(calls.length, 2);
      calls.length = 0;
      for await (const _ of chat([{ role: "user", content: "Meematai shemá" }], undefined, { model: "gpt-4.1-mini", effort: "high" })) { /* drain */ }
      assert.equal(calls[0].reasoning_effort, undefined); assert.equal(calls[0].temperature, 0.2);
    } finally { globalThis.fetch = orig; }
  } finally { delete process.env.OPENAI_API_KEY; delete process.env.CHAT_MODELS; resetModelsCache(); }
});

test("long conversation returns rolling memory in the done event (no key)", async () => {
  delete process.env.OPENAI_API_KEY;
  const msgs = Array.from({ length: 15 }, (_, i) => ({ role: (i % 2 ? "assistant" : "user") as "user" | "assistant", content: i % 2 ? "respuesta" : `pregunta ${i} sobre Meematai` }));
  msgs.push({ role: "user", content: "¿Y el Shemá?" });
  const evs: Ev[] = []; for await (const e of chat(msgs, undefined, {}, "")) evs.push(e as Ev);
  const done = evs.at(-1) as any;
  assert.equal(done.condensed, 10); assert.match(done.memory, /^Preguntas anteriores: pregunta 0/);
  const short: Ev[] = []; for await (const e of chat([{ role: "user", content: "Meematai" }], undefined, {}, "algo")) short.push(e as Ev);
  assert.equal((short.at(-1) as any).memory, undefined);
});
