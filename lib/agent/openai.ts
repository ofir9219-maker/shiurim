// OpenAI Responses API (server only): one call per role with its own model + reasoning.effort.
import { setupProxy } from "../proxy";
import { ROLE_LABEL, modelLabel, type RoleCfg } from "./models";

export type Role = "principal" | "sub";
export class AgentError extends Error {
  constructor(message: string, public role?: Role, public model?: string, public status?: number) { super(message); }
}
export type FnTool = { type: "function"; name: string; description: string; parameters: Record<string, unknown>; strict: boolean };
export type CallOpts = {
  role: Role; cfg: RoleCfg; instructions: string; input: unknown[] | string;
  schema?: { name: string; schema: Record<string, unknown> }; tools?: FnTool[]; previousId?: string; maxOutput?: number; signal?: AbortSignal;
};
export type ResponseOut = { id: string; text: string; calls: { call_id: string; name: string; arguments: string }[]; usage?: { input_tokens: number; output_tokens: number } };

/** Test hook: capture/replace the HTTP call. */
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetcher | null = null;
export const setAgentFetcher = (f: Fetcher | null) => { fetcher = f; };

const base = () => (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
export function requireKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new AgentError("Falta la clave de OpenAI: configura la variable OPENAI_API_KEY en Railway (servicio web → Variables).");
  return k;
}
export function bodyFor(o: CallOpts, stream: boolean): Record<string, unknown> {
  const b: Record<string, unknown> = {
    model: o.cfg.model, instructions: o.instructions, input: o.input, reasoning: { effort: o.cfg.effort },
    max_output_tokens: o.maxOutput ?? 6000, stream, store: true,
  };
  if (o.schema) b.text = { format: { type: "json_schema", name: o.schema.name, schema: o.schema.schema, strict: true } };
  if (o.tools?.length) { b.tools = o.tools; b.tool_choice = "auto"; b.parallel_tool_calls = false; }
  if (o.previousId) b.previous_response_id = o.previousId;
  return b;
}

async function post(o: CallOpts, stream: boolean): Promise<Response> {
  const key = requireKey();
  setupProxy();
  console.log(`agent: llamada ${o.role} model=${o.cfg.model} effort=${o.cfg.effort}${o.schema ? ` (${o.schema.name})` : stream ? " (respuesta)" : ""}`);
  const init: RequestInit = { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(bodyFor(o, stream)), signal: o.signal };
  let res: Response | null = null; let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      res = await (fetcher ?? fetch)(`${base()}/responses`, init);
      if (res.status !== 429 && res.status < 500) break;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) { last = e; if ((e as Error).name === "AbortError") throw e; }
    await new Promise((r) => setTimeout(r, 1500 * 2 ** i));
  }
  if (!res) throw new AgentError(`No se pudo conectar con OpenAI (${ROLE_LABEL[o.role]}, ${modelLabel(o.cfg.model)}): ${(last as Error)?.message ?? "error de red"}`, o.role, o.cfg.model);
  if (!res.ok) throw await errorFrom(res, o);
  return res;
}
async function errorFrom(res: Response, o: CallOpts): Promise<AgentError> {
  const txt = await res.text().catch(() => "");
  let msg = txt; try { msg = JSON.parse(txt)?.error?.message ?? txt; } catch { /* plain */ }
  const who = `${modelLabel(o.cfg.model)} (${ROLE_LABEL[o.role]})`;
  if (res.status === 401) return new AgentError("La clave de OpenAI (OPENAI_API_KEY) no es válida o fue revocada.", o.role, o.cfg.model, 401);
  if (res.status === 404 || res.status === 403 || /model_not_found|does not have access|not found/i.test(msg))
    return new AgentError(`La cuenta de OpenAI no tiene acceso al modelo ${who}. Elige otro modelo en Ajustes.`, o.role, o.cfg.model, res.status);
  if (res.status === 429) return new AgentError(`OpenAI está limitando las peticiones (${who}). Espera un momento e inténtalo de nuevo.`, o.role, o.cfg.model, 429);
  if (res.status === 400 && /reasoning|effort/i.test(msg)) return new AgentError(`El modelo ${who} no acepta ese nivel de pensamiento: ${msg.slice(0, 160)}`, o.role, o.cfg.model, 400);
  return new AgentError(`Error de OpenAI con ${who}: ${msg.slice(0, 240)}`, o.role, o.cfg.model, res.status);
}

const textOf = (j: any): string => (j.output ?? []).filter((x: any) => x.type === "message").flatMap((x: any) => x.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
const callsOf = (j: any) => (j.output ?? []).filter((x: any) => x.type === "function_call").map((x: any) => ({ call_id: x.call_id, name: x.name, arguments: x.arguments }));

export async function respond(o: CallOpts): Promise<ResponseOut> {
  const res = await post(o, false);
  const j: any = await res.json();
  if (j.status === "failed" || j.error) throw new AgentError(`El modelo ${modelLabel(o.cfg.model)} (${ROLE_LABEL[o.role]}) falló: ${j.error?.message ?? "sin detalle"}`, o.role, o.cfg.model);
  return { id: j.id, text: textOf(j), calls: callsOf(j), usage: j.usage };
}

/** Streaming text (writer). */
export async function* respondStream(o: CallOpts): AsyncGenerator<string> {
  const res = await post(o, true);
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data || data === "[DONE]") continue;
      let ev: any; try { ev = JSON.parse(data); } catch { continue; }
      if (ev.type === "response.output_text.delta" && ev.delta) yield ev.delta as string;
      else if (ev.type === "response.failed" || ev.type === "error") throw new AgentError(`El modelo ${modelLabel(o.cfg.model)} (${ROLE_LABEL[o.role]}) falló: ${ev.response?.error?.message ?? ev.message ?? "sin detalle"}`, o.role, o.cfg.model);
    }
  }
}

/** JSON output with a strict schema. */
export async function respondJson<T>(o: CallOpts): Promise<{ data: T; id: string }> {
  const r = await respond(o);
  try { return { data: JSON.parse(r.text) as T, id: r.id }; }
  catch { throw new AgentError(`El modelo ${modelLabel(o.cfg.model)} (${ROLE_LABEL[o.role]}) devolvió una respuesta no válida.`, o.role, o.cfg.model); }
}
