import { setupProxy } from "./proxy";
import { isReasoningModel, type ChatMsg, type ChatOpts } from "./chat-core";

export type Provider = "openai" | "anthropic";
export function llmConfig(): { provider: Provider; key: string; model: string; base: string } | null {
  const provider: Provider = (process.env.LLM_PROVIDER || "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai";
  if (provider === "anthropic") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return null;
    return { provider, key, model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5", base: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "") };
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return { provider, key, model: process.env.CHAT_MODEL || "gpt-4.1-mini", base: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "") };
}

async function* sseData(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      const data = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (data) yield data;
    }
  }
  const tail = buf.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
  if (tail) yield tail;
}

function request(cfg: NonNullable<ReturnType<typeof llmConfig>>, system: string, messages: any[], stream: boolean, maxTokens: number, opts: ChatOpts = {}, extra: Record<string, unknown> = {}): Promise<Response> {
  setupProxy();
  if (cfg.provider === "anthropic") {
    return fetch(`${cfg.base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages, stream, temperature: 0.2 }),
    });
  }
  const model = opts.model || cfg.model;
  const reasoning = isReasoningModel(model);
  const post = (drop: { effort?: boolean; temp?: boolean }) => {
    const body: Record<string, unknown> = { model, messages: [{ role: "system", content: system }, ...messages], stream };
    if (stream) body.stream_options = { include_usage: true };
    Object.assign(body, extra);
    if (reasoning) {
      body.max_completion_tokens = maxTokens + 2000; // reasoning tokens count against the budget
      if (opts.effort && !drop.effort) body.reasoning_effort = opts.effort;
    } else {
      body.max_tokens = maxTokens;
      if (!drop.temp) body.temperature = 0.2;
    }
    return fetch(`${cfg.base}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` }, body: JSON.stringify(body),
    });
  };
  return post({}).then(async (res) => {
    if (res.status !== 400) return res;
    const txt = await res.text().catch(() => "");
    const effort = /reasoning_effort|effort/i.test(txt), temp = /temperature/i.test(txt);
    if (!effort && !temp) return new Response(txt, { status: 400 });
    return post({ effort, temp }); // retry once without the rejected param
  });
}

/** Stream text deltas. Throws on HTTP/network errors. */
export async function* streamLLM(system: string, messages: ChatMsg[], maxTokens = 600, opts: ChatOpts = {}): AsyncGenerator<string> {
  const cfg = llmConfig();
  if (!cfg) throw new Error("no LLM key");
  const res = await request(cfg, system, messages, true, maxTokens, opts);
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  for await (const data of sseData(res)) {
    if (data === "[DONE]") break;
    let j: any;
    try { j = JSON.parse(data); } catch { continue; }
    if (cfg.provider === "anthropic") {
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) yield j.delta.text as string;
      else if (j.type === "error") throw new Error(`LLM error: ${j.error?.message || "unknown"}`);
    } else {
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t as string;
      if (j.usage) addUsage(opts.model || cfg.model, j.usage.prompt_tokens, j.usage.completion_tokens);
    }
  }
}

/** One-shot completion (query rewrite). Returns null on any failure / no key. */
export async function completeLLM(system: string, messages: ChatMsg[], maxTokens = 60, opts: ChatOpts = {}, json = false): Promise<string | null> {
  const cfg = llmConfig();
  if (!cfg) return null;
  try {
    const res = await request(cfg, system, messages, false, maxTokens, opts, json && cfg.provider === "openai" ? { response_format: { type: "json_object" } } : {});
    if (!res.ok) return null;
    const j: any = await res.json();
    if (j.usage) addUsage(opts.model || cfg.model, j.usage.prompt_tokens ?? j.usage.input_tokens, j.usage.completion_tokens ?? j.usage.output_tokens);
    const t = cfg.provider === "anthropic" ? j.content?.map((c: any) => c.text).join("") : j.choices?.[0]?.message?.content;
    return typeof t === "string" ? t.trim() : null;
  } catch { return null; }
}

// ---- usage accounting (for the eval / cost estimates), per model ----
const usage = new Map<string, { input: number; output: number; calls: number }>();
let embedCalls = 0;
export const usageByModel = () => Object.fromEntries(usage);
export const usageTotals = () => { let input = 0, output = 0, calls = 0; for (const u of usage.values()) { input += u.input; output += u.output; calls += u.calls; } return { input, output, calls, embeds: embedCalls }; };
export const resetUsage = () => { usage.clear(); embedCalls = 0; };
export const countEmbed = () => { embedCalls++; };
export function addUsage(model: string, i = 0, o = 0) { const u = usage.get(model) || { input: 0, output: 0, calls: 0 }; u.input += i || 0; u.output += o || 0; u.calls++; usage.set(model, u); }

export type ToolDef = { name: string; description: string; parameters: Record<string, unknown> };

/**
 * Stream an answer that may call tools (OpenAI function calling): up to `maxCalls` tool-call rounds, then a final
 * round without tools. Yields text deltas. Providers without tool support just stream normally.
 */
export async function* streamWithTools(
  system: string, messages: ChatMsg[], tools: ToolDef[], run: (name: string, args: Record<string, unknown>) => Promise<string>,
  maxTokens = 1500, opts: ChatOpts = {}, maxCalls = 2,
): AsyncGenerator<string> {
  const cfg = llmConfig();
  if (!cfg) throw new Error("no LLM key");
  if (cfg.provider !== "openai" || !tools.length) { yield* streamLLM(system, messages, maxTokens, opts); return; }
  const msgs: any[] = [...messages];
  const toolSpec = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
  let calls = 0;
  for (let round = 0; round <= maxCalls; round++) {
    const allow = calls < maxCalls;
    const res = await request(cfg, system, msgs, true, maxTokens, opts, { tools: toolSpec, tool_choice: allow ? "auto" : "none" });
    if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    let text = "";
    const tc = new Map<number, { id: string; name: string; args: string }>();
    for await (const data of sseData(res)) {
      if (data === "[DONE]") break;
      let j: any;
      try { j = JSON.parse(data); } catch { continue; }
      const d = j.choices?.[0]?.delta;
      if (d?.content) { text += d.content; yield d.content as string; }
      for (const t of d?.tool_calls || []) {
        const cur = tc.get(t.index) || { id: "", name: "", args: "" };
        if (t.id) cur.id = t.id;
        if (t.function?.name) cur.name += t.function.name;
        if (t.function?.arguments) cur.args += t.function.arguments;
        tc.set(t.index, cur);
      }
      if (j.usage) addUsage(opts.model || cfg.model, j.usage.prompt_tokens, j.usage.completion_tokens);
    }
    if (!tc.size || !allow) return;
    const list = [...tc.entries()].sort((a, b) => a[0] - b[0]).map(([, v], i) => ({ ...v, id: v.id || `call_${round}_${i}` }));
    msgs.push({ role: "assistant", content: text || null, tool_calls: list.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })) });
    for (const c of list) {
      calls++;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.args || "{}"); } catch { /* ignore */ }
      let out = "";
      try { out = await run(c.name, args); } catch { out = "Error al buscar."; }
      msgs.push({ role: "tool", tool_call_id: c.id, content: out });
    }
  }
}
