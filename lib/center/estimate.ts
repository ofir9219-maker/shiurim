// Cost / time estimate shown before queueing a selection.
import { modelInfo } from "./fal-models";
import { openaiPrice } from "../ingest/openai";
import type { JobCfg } from "../ingest/state";

export type EstimateRow = { id: string; name: string; minutes: number; approx: boolean; model: string; postprocess: string; collection: string; falUsd: number; openaiUsd: number; redo: boolean };
export type Estimate = { files: number; minutes: number; approxFiles: number; falUsd: number; openaiUsd: number; totalUsd: number; etaMinutes: number; byModel: Record<string, { minutes: number; usd: number }>; rows: EstimateRow[]; redo: number };

/** Approximate audio length from file size when no duration is known (≈ 64 kbps speech). */
export const minutesFromSize = (bytes: number) => bytes / 8000 / 60;

export function estimateRow(f: { id: string; name: string; minutes: number; approx: boolean; redo: boolean }, cfg: JobCfg): EstimateRow {
  const m = modelInfo(cfg.model);
  const falUsd = m.usdPerMin ? m.usdPerMin * f.minutes : (m.usdPerComputeSec ?? 0) * (m.computeSecPerAudioMin ?? 0) * f.minutes;
  let openaiUsd = 0;
  if (cfg.postprocess === "openai") {
    const pr = openaiPrice(cfg.openaiModel), reasoning = /^(gpt-5|o\d)/.test(cfg.openaiModel);
    const tok = f.minutes * 200; // ~150 words/min
    const inTok = tok * 2.2 + 6000, outTok = tok * 1.2 * (reasoning ? 1.7 : 1) + 2500;
    openaiUsd = (inTok * pr.inM + outTok * pr.outM) / 1e6;
  }
  return { id: f.id, name: f.name, minutes: f.minutes, approx: f.approx, model: cfg.model, postprocess: cfg.postprocess, collection: cfg.collectionName, falUsd, openaiUsd, redo: f.redo };
}
export function summarize(rows: EstimateRow[]): Estimate {
  const byModel: Estimate["byModel"] = {};
  for (const r of rows) { const b = (byModel[r.model] ??= { minutes: 0, usd: 0 }); b.minutes += r.minutes; b.usd += r.falUsd; }
  const minutes = rows.reduce((a, r) => a + r.minutes, 0), falUsd = rows.reduce((a, r) => a + r.falUsd, 0), openaiUsd = rows.reduce((a, r) => a + r.openaiUsd, 0);
  const polishMin = rows.filter((r) => r.postprocess === "openai").reduce((a, r) => a + r.minutes, 0);
  return {
    files: rows.length, minutes, approxFiles: rows.filter((r) => r.approx).length, falUsd, openaiUsd, totalUsd: falUsd + openaiUsd,
    etaMinutes: Math.ceil(minutes / 10 + polishMin / 25 + rows.length * 0.7), byModel, rows, redo: rows.filter((r) => r.redo).length,
  };
}
