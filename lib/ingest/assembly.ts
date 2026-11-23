// AssemblyAI speech-to-text (pre-recorded API). Output normalized to the Scribe "words" shape (seconds + spacing tokens),
// so the rest of the pipeline (segments, gap recovery, polish) is unchanged.
import { fetchRetry, okJson, sleep, HttpError } from "./http";
import type { ScribeResult, Word } from "./segments";
import { LANGUAGES } from "../center/fal-models";

const base = () => (process.env.ASSEMBLYAI_BASE_URL || "https://api.assemblyai.com").replace(/\/$/, "");
type AaiWord = { text: string; start: number; end: number; confidence?: number };
type AaiTranscript = { id: string; status: "queued" | "processing" | "completed" | "error"; error?: string; words?: AaiWord[] | null; text?: string | null; language_code?: string };

/** AssemblyAI words (ms) -> Scribe-style words (s) with a spacing token after each word. */
export function aaiToScribe(t: Pick<AaiTranscript, "words" | "text" | "language_code">): ScribeResult {
  const words: Word[] = [];
  for (const w of t.words ?? []) {
    if (!w.text) continue;
    const s = w.start / 1000, e = Math.max(w.end, w.start) / 1000;
    words.push({ text: w.text, type: "word", start: s, end: e });
    words.push({ text: " ", type: "spacing", start: e, end: e });
  }
  return { words, text: t.text ?? "", language_code: t.language_code };
}

export async function assemblyTranscribe(audioUrl: string, label: string, opts: { model: string; language?: string }): Promise<ScribeResult> {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY no configurada (agrégala en Railway → Variables)");
  const L = LANGUAGES.find((l) => l.code === (opts.language ?? "spa")) ?? LANGUAGES[0];
  const speech = opts.model.replace(/^assemblyai\//, "");
  const headers = { authorization: key, "content-type": "application/json" };
  const body: Record<string, unknown> = { audio_url: audioUrl, speech_model: speech, punctuate: true, format_text: true, ...(L.two ? { language_code: L.two } : { language_detection: true }) };
  let r = await fetchRetry(`${base()}/v2/transcript`, { method: "POST", headers, body: JSON.stringify(body) });
  if (r.status === 400) {
    const txt = await r.text();
    if (!/speech_model/i.test(txt)) throw new HttpError(400, `assemblyai submit ${label}: ${txt.slice(0, 300)}`);
    delete body.speech_model; // model name not accepted by this account/region: use AssemblyAI's default model
    r = await fetchRetry(`${base()}/v2/transcript`, { method: "POST", headers, body: JSON.stringify(body) });
  }
  const sub = await okJson<AaiTranscript>(r, `assemblyai submit ${label}`);
  const started = Date.now();
  for (;;) {
    await sleep(Number(process.env.ASSEMBLYAI_POLL_MS || 5000));
    const t = await okJson<AaiTranscript>(await fetchRetry(`${base()}/v2/transcript/${sub.id}`, { headers }), `assemblyai status ${label}`);
    if (t.status === "completed") {
      const out = aaiToScribe(t);
      if (!out.words.length && (t.text ?? "").trim()) throw new Error(`assemblyai ${label}: respuesta sin palabras con tiempos`);
      return out;
    }
    if (t.status === "error") throw new Error(`assemblyai ${label}: ${t.error ?? "error"}`);
    if (Date.now() - started > 90 * 60_000) throw new Error(`assemblyai ${label}: timeout esperando ${sub.id}`);
  }
}
