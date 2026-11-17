import { setupProxy } from "./proxy";
import type { ChatMsg } from "./chat-core";

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

function request(cfg: NonNullable<ReturnType<typeof llmConfig>>, system: string, messages: ChatMsg[], stream: boolean, maxTokens: number) {
  setupProxy();
  if (cfg.provider === "anthropic") {
    return fetch(`${cfg.base}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, system, messages, stream, temperature: 0.2 }),
    });
  }
  return fetch(`${cfg.base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, messages: [{ role: "system", content: system }, ...messages], stream, temperature: 0.2, max_tokens: maxTokens }),
  });
}

/** Stream text deltas. Throws on HTTP/network errors. */
export async function* streamLLM(system: string, messages: ChatMsg[], maxTokens = 600): AsyncGenerator<string> {
  const cfg = llmConfig();
  if (!cfg) throw new Error("no LLM key");
  const res = await request(cfg, system, messages, true, maxTokens);
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
    }
  }
}

/** One-shot completion (query rewrite). Returns null on any failure / no key. */
export async function completeLLM(system: string, messages: ChatMsg[], maxTokens = 60): Promise<string | null> {
  const cfg = llmConfig();
  if (!cfg) return null;
  try {
    const res = await request(cfg, system, messages, false, maxTokens);
    if (!res.ok) return null;
    const j: any = await res.json();
    const t = cfg.provider === "anthropic" ? j.content?.map((c: any) => c.text).join("") : j.choices?.[0]?.message?.content;
    return typeof t === "string" ? t.trim() : null;
  } catch { return null; }
}
