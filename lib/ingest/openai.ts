import { fetchRetry } from "./http";

export type Usage = { promptTokens: number; completionTokens: number };
export type JsonCall = <T>(o: { system: string; user: string; schema: object; name: string }) => Promise<{ data: T; usage: Usage }>;

export const POLISH_MODEL = () => process.env.POLISH_MODEL || "gpt-5.2";
export const POLISH_EFFORT = () => process.env.POLISH_EFFORT || "medium";

/** Chat Completions with strict json_schema output. Returns the parsed object + token usage. */
export const openaiJson: JsonCall = async ({ system, user, schema, name }) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY no configurada");
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = POLISH_MODEL();
  const body: Record<string, unknown> = {
    model, messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
  };
  if (/^(gpt-5|o\d)/.test(model)) { body.reasoning_effort = POLISH_EFFORT(); body.max_completion_tokens = 64000; }
  else { body.temperature = 0.2; body.max_tokens = 16000; }
  const r = await fetchRetry(`${base}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) }, { tries: 4, baseMs: 3000 });
  if (!r.ok) throw new Error(`openai HTTP ${r.status}: ${(await r.text()).slice(0, 500)}`);
  const j = (await r.json()) as { choices: { message: { content: string | null; refusal?: string | null }; finish_reason: string }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
  const c = j.choices?.[0];
  if (!c?.message?.content) throw new Error(`openai sin contenido (${c?.finish_reason ?? "?"}) ${c?.message?.refusal ?? ""}`);
  return { data: JSON.parse(c.message.content), usage: { promptTokens: j.usage?.prompt_tokens ?? 0, completionTokens: j.usage?.completion_tokens ?? 0 } };
};
