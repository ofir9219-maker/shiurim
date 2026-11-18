// Fal Scribe v2 via the queue REST API.
import { fetchRetry, okJson, sleep } from "./http";
import type { ScribeResult } from "./segments";

export const FAL_ENDPOINT = "fal-ai/elevenlabs/speech-to-text/scribe-v2";
export type Transcriber = (audioUrl: string, label: string) => Promise<ScribeResult>;

export const falTranscribe: Transcriber = async (audioUrl, label) => {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY no configurada");
  const headers = { authorization: `Key ${key}`, "content-type": "application/json" };
  const sub = await okJson<{ request_id: string; status_url: string; response_url: string }>(
    await fetchRetry(`https://queue.fal.run/${FAL_ENDPOINT}`, {
      method: "POST", headers, body: JSON.stringify({ audio_url: audioUrl, language_code: "spa", tag_audio_events: false, diarize: false }),
    }), `fal submit ${label}`);
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
  if (!Array.isArray(j.words)) throw new Error(`fal ${label}: response without words`);
  return j;
};
