import { setupProxy } from "./proxy";
import { llmConfig } from "./chat-llm";
import { EFFORTS, isReasoningModel, type Effort } from "./chat-core";

export type ModelInfo = { id: string; label: string; reasoning: boolean };
export type ModelsPayload = { models: ModelInfo[]; default: string; efforts: readonly Effort[]; defaultEffort: Effort; enabled: boolean };

const TTL = 3600_000;
const CHAT_RE = /^(gpt-|o\d|chatgpt-)/;
const EXCLUDE_RE = /audio|realtime|tts|transcribe|search|image|embedding|instruct|moderation|whisper|dall-e|computer-use|codex/i;
export const DEFAULT_EFFORT: Effort = "medium";
let cache: { at: number; key: string; ids: string[] } | null = null;
export function resetModelsCache() { cache = null; }

function allowlist(): string[] | null {
  const l = (process.env.CHAT_MODELS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return l.length ? [...new Set(l)] : null;
}

async function fetchOpenAIIds(key: string, base: string): Promise<string[]> {
  if (cache && cache.key === key && Date.now() - cache.at < TTL) return cache.ids;
  setupProxy();
  const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`models HTTP ${res.status}`);
  const j: any = await res.json();
  const rows: { id: string; created: number }[] = (Array.isArray(j?.data) ? j.data : [])
    .filter((m: any) => typeof m?.id === "string" && CHAT_RE.test(m.id) && !EXCLUDE_RE.test(m.id))
    .map((m: any) => ({ id: m.id as string, created: Number(m.created) || 0 }));
  rows.sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
  const ids = rows.map((r) => r.id);
  if (!ids.length) throw new Error("no chat models");
  cache = { at: Date.now(), key, ids };
  return ids;
}

export async function getChatModels(): Promise<ModelsPayload> {
  const cfg = llmConfig();
  let ids: string[];
  if (cfg?.provider === "anthropic") ids = [cfg.model];
  else {
    const allow = allowlist();
    if (allow) ids = allow;
    else if (cfg) { try { ids = await fetchOpenAIIds(cfg.key, cfg.base); } catch { ids = ["gpt-4.1-mini"]; } }
    else ids = ["gpt-4.1-mini"];
  }
  const models = ids.map((id) => ({ id, label: id, reasoning: cfg?.provider !== "anthropic" && isReasoningModel(id) }));
  const wanted = cfg?.model;
  const def = wanted && ids.includes(wanted) ? wanted : ids[0];
  return { models, default: def, efforts: EFFORTS, defaultEffort: DEFAULT_EFFORT, enabled: !!cfg };
}

/** Validate user-supplied model/effort against the server list; unknown model -> default, bad effort -> undefined. */
export async function resolveChatOptions(model: unknown, effort: unknown): Promise<{ model: string; effort?: Effort }> {
  const p = await getChatModels();
  const m = typeof model === "string" ? p.models.find((x) => x.id === model) : undefined;
  const chosen = m || p.models.find((x) => x.id === p.default)!;
  const e = typeof effort === "string" && (EFFORTS as readonly string[]).includes(effort) ? (effort as Effort) : DEFAULT_EFFORT;
  return { model: chosen.id, effort: chosen.reasoning ? e : undefined };
}
