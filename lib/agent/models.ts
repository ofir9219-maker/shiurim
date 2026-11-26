// Agent roles (principal / subagentes): allowed models and reasoning efforts. Client-safe (no server imports).
export const AGENT_MODELS = [
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", desc: "organizar la búsqueda y redactar una respuesta integrada" },
  { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", desc: "leer fuentes rápidamente y localizar citas" },
  { id: "gpt-6.2-astra", label: "GPT-6.2 Astra", desc: "analizar preguntas complejas y comparar fuentes" },
] as const;
export type AgentModel = (typeof AGENT_MODELS)[number]["id"];
export const AGENT_EFFORTS = [
  { id: "low", label: "Bajo" }, { id: "medium", label: "Medio" }, { id: "high", label: "Alto" },
] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number]["id"];
export type RoleCfg = { model: AgentModel; effort: AgentEffort };
export type AgentSettings = { principal: RoleCfg; sub: RoleCfg };
export const DEFAULT_SETTINGS: AgentSettings = { principal: { model: "gpt-6.2-sol", effort: "low" }, sub: { model: "gpt-6.1-terra", effort: "low" } };
export const ROLE_LABEL = { principal: "agente principal", sub: "subagentes" } as const;
export const modelLabel = (id: string) => AGENT_MODELS.find((m) => m.id === id)?.label ?? id;

const isModel = (m: unknown): m is AgentModel => typeof m === "string" && AGENT_MODELS.some((x) => x.id === m);
const isEffort = (e: unknown): e is AgentEffort => typeof e === "string" && AGENT_EFFORTS.some((x) => x.id === e);
/** Server-side validation: unknown values fall back to the defaults of that role (and are reported). */
export function validateSettings(raw: unknown): { settings: AgentSettings; problems: string[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const problems: string[] = [];
  const role = (k: "principal" | "sub"): RoleCfg => {
    const r = (o[k] && typeof o[k] === "object" ? o[k] : {}) as Record<string, unknown>;
    const d = DEFAULT_SETTINGS[k];
    if (r.model !== undefined && !isModel(r.model)) problems.push(`modelo no permitido para ${ROLE_LABEL[k]}: ${String(r.model)}`);
    if (r.effort !== undefined && !isEffort(r.effort)) problems.push(`nivel de pensamiento no permitido para ${ROLE_LABEL[k]}: ${String(r.effort)}`);
    return { model: isModel(r.model) ? r.model : d.model, effort: isEffort(r.effort) ? r.effort : d.effort };
  };
  return { settings: { principal: role("principal"), sub: role("sub") }, problems };
}
