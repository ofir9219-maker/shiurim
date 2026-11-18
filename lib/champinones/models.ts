// Client-safe model catalogue + price table (USD per 1M tokens; reference prices, verify before budgeting).
export type ModelOpt = { id: string; label: string; reasoning: boolean; inPer1M: number; outPer1M: number; note: string };
export const MODELS: ModelOpt[] = [
  { id: "gpt-5.2", label: "GPT-5.2", reasoning: true, inPer1M: 1.75, outPer1M: 14, note: "mejor profundidad" },
  { id: "gpt-5.1", label: "GPT-5.1", reasoning: true, inPer1M: 1.25, outPer1M: 10, note: "" },
  { id: "gpt-5", label: "GPT-5", reasoning: true, inPer1M: 1.25, outPer1M: 10, note: "" },
  { id: "gpt-5-mini", label: "GPT-5 mini", reasoning: true, inPer1M: 0.25, outPer1M: 2, note: "rápido y barato" },
  { id: "gpt-4.1", label: "GPT-4.1", reasoning: false, inPer1M: 2, outPer1M: 8, note: "sin razonamiento" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", reasoning: false, inPer1M: 0.4, outPer1M: 1.6, note: "económico" },
];
export const EFFORTS = ["low", "medium", "high"] as const;
export const DEFAULT_MODEL = "gpt-5.2";
export const FALLBACK_MODEL = "gpt-5-mini";
export const DEFAULT_EFFORT = "medium";
export const FAST_MODEL = "gpt-4.1-mini"; // pass 0 + pass 1
export function modelInfo(id: string): ModelOpt {
  return MODELS.find((m) => m.id === id) || (id.includes("mini") ? { id, label: id, reasoning: /^(gpt-5|o\d)/.test(id), inPer1M: 0.4, outPer1M: 1.6, note: "" } : { id, label: id, reasoning: /^(gpt-5|o\d)/.test(id), inPer1M: 1.75, outPer1M: 14, note: "" });
}
export function costOf(model: string, inTok: number, outTok: number): number {
  const m = modelInfo(model);
  return (inTok * m.inPer1M + outTok * m.outPer1M) / 1e6;
}
