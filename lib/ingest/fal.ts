// Fal speech-to-text via the queue REST API (any of the supported models).
import { fetchRetry, okJson, sleep } from "./http";
import type { ScribeResult } from "./segments";
import { DEFAULT_FAL_MODEL, DEFAULT_LANGUAGE, falInput, hasUsableOutput, isAssemblyModel, liveModel, type FalModelId } from "../center/fal-models";
import { assemblyTranscribe } from "./assembly";

export const FAL_ENDPOINT = DEFAULT_FAL_MODEL;
export type TranscribeOpts = { model?: FalModelId; language?: string };
export type Transcriber = (audioUrl: string, label: string, opts?: TranscribeOpts) => Promise<ScribeResult>;

export const falTranscribe: Transcriber = async (audioUrl, label, opts = {}) => {
  if (isAssemblyModel(opts.model)) return assemblyTranscribe(audioUrl, label, { model: opts.model!, language: opts.language });
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY no configurada");
  const model = liveModel(opts.model) ?? DEFAULT_FAL_MODEL; // retired endpoints (410) are mapped to their replacement
  const headers = { authorization: `Key ${key}`, "content-type": "application/json" };
  const sub = await okJson<{ request_id: string; status_url: string; response_url: string }>(
    await fetchRetry(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(falInput(model, audioUrl, opts.language ?? DEFAULT_LANGUAGE)) }), `fal submit ${label}`);
  const started = Date.now();
  for (;;) {
    await sleep(Number(process.env.FAL_POLL_MS || 5000));
    const st = await okJson<{ status: string; error?: string }>(await fetchRetry(sub.status_url, { headers }), `fal status ${label}`);
    if (st.status === "COMPLETED") break;
    if (st.error) throw new Error(`fal ${label}: ${st.error}`);
    if (Date.now() - started > 45 * 60_000) throw new Error(`fal ${label}: timeout waiting for ${sub.request_id}`);
  }
  const res = await fetchRetry(sub.response_url, { headers });
  const j = await okJson<ScribeResult>(res, `fal result ${label}`);
  if (!hasUsableOutput(model, j)) throw new Error(`fal ${label}: respuesta sin ${model.includes("wizper") || model.endsWith("/whisper") ? "chunks" : "words"}`);
  return j;
};
