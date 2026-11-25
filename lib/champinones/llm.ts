import { setupProxy } from "../proxy";
import { costOf, modelInfo, FALLBACK_MODEL, type ModelOpt } from "./models";
import type { Usage } from "./types";

export function openaiKey(): string | null { return process.env.OPENAI_API_KEY || null; }
const base = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

export type Msg = { role: "system" | "user" | "assistant"; content: string };
export type CallOpts = {
  model: string; effort?: string; messages: Msg[]; schema: object; schemaName: string; maxOut?: number;
  stream?: boolean; onProgress?: (chars: number) => void; timeoutMs?: number;
};
export type CallResult<T> = { json: T; raw: string; usage: Usage };

async function* sse(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, "");
      const d = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (d) yield d;
    }
  }
  const d = buf.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
  if (d) yield d;
}

function body(o: CallOpts, mi: ModelOpt, drop: { effort?: boolean; temp?: boolean }) {
  const b: Record<string, unknown> = {
    model: o.model, messages: o.messages,
    response_format: { type: "json_schema", json_schema: { name: o.schemaName, strict: true, schema: o.schema } },
    max_completion_tokens: o.maxOut ?? 12000,
  };
  if (mi.reasoning) { if (o.effort && !drop.effort) b.reasoning_effort = o.effort; }
  else if (!drop.temp) b.temperature = 0.3;
  if (o.stream) { b.stream = true; b.stream_options = { include_usage: true }; }
  return b;
}

async function post(o: CallOpts, mi: ModelOpt, drop: { effort?: boolean; temp?: boolean }): Promise<Response> {
  setupProxy();
  const key = openaiKey();
  if (!key) throw new Error("OPENAI_API_KEY missing");
  return fetch(`${base()}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body(o, mi, drop)), signal: AbortSignal.timeout(o.timeoutMs ?? 240_000),
  });
}

/** One structured-output call. Retries on 429/5xx, drops rejected params, falls back to FALLBACK_MODEL if the model is unavailable. */
export async function callJson<T>(o: CallOpts): Promise<CallResult<T>> {
  const t0 = Date.now();
  let model = o.model, drop: { effort?: boolean; temp?: boolean } = {}, last = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = { ...o, model }; const mi = modelInfo(model);
    let res: Response;
    try { res = await post(cur, mi, drop); } catch (e: any) { last = String(e?.message || e); await sleep(600 * 2 ** attempt); continue; }
    if (!res.ok) {
      const txt = await res.text().catch(() => ""); last = `HTTP ${res.status}: ${txt.slice(0, 300)}`;
      if (res.status === 429 || res.status >= 500) { await sleep(800 * 2 ** attempt); continue; }
      if (res.status === 400 || res.status === 404) {
        if (/reasoning_effort|effort/i.test(txt) && !drop.effort) { drop = { ...drop, effort: true }; continue; }
        if (/temperature/i.test(txt) && !drop.temp) { drop = { ...drop, temp: true }; continue; }
        if (/model/i.test(txt) && /(not found|does not exist|not have access|unsupported|invalid)/i.test(txt) && model !== FALLBACK_MODEL) { model = FALLBACK_MODEL; continue; }
      }
      throw new Error(`OpenAI ${last}`);
    }
    let raw = "", inT = 0, outT = 0, finish = "", refusal = "";
    if (o.stream) {
      for await (const d of sse(res)) {
        if (d === "[DONE]") break;
        let j: any; try { j = JSON.parse(d); } catch { continue; }
        const c = j.choices?.[0];
        if (c?.delta?.content) { raw += c.delta.content; o.onProgress?.(raw.length); }
        if (c?.delta?.refusal) refusal += c.delta.refusal;
        if (c?.finish_reason) finish = c.finish_reason;
        if (j.usage) { inT = j.usage.prompt_tokens || 0; outT = j.usage.completion_tokens || 0; }
      }
    } else {
      const j: any = await res.json();
      raw = j.choices?.[0]?.message?.content || ""; refusal = j.choices?.[0]?.message?.refusal || "";
      finish = j.choices?.[0]?.finish_reason || ""; inT = j.usage?.prompt_tokens || 0; outT = j.usage?.completion_tokens || 0;
    }
    if (refusal) throw new Error("model refused: " + refusal.slice(0, 200));
    let json: T;
    try { json = JSON.parse(raw); } catch {
      last = `unparseable JSON (finish=${finish}, ${raw.length} chars)`;
      if (finish === "length") throw new Error("OpenAI output truncated (max tokens); try a lower effort");
      continue;
    }
    return { json, raw, usage: { model, inTokens: inT, outTokens: outT, costUsd: costOf(model, inT, outT), ms: Date.now() - t0 } };
  }
  throw new Error(`OpenAI call failed: ${last}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
