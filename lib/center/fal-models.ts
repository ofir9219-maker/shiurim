// Speech-to-text models (Fal endpoints + AssemblyAI): limits, prices, request builders and output normalization to one segment format.
import type { RawDoc, ScribeResult, Seg } from "../ingest/segments";

export const FAL_MODEL_IDS = [
  "fal-ai/elevenlabs/speech-to-text/scribe-v2",
  "fal-ai/elevenlabs/speech-to-text",
  "fal-ai/wizper",
  "assemblyai/universal",
] as const;
/** Models Fal retired (HTTP 410) -> their replacement. Old settings/items that still name them keep working. */
export const RETIRED_MODELS: Record<string, FalModelId> = { "fal-ai/whisper": "fal-ai/wizper" };
export const liveModel = (m: string | undefined): FalModelId | undefined => (m && RETIRED_MODELS[m]) || (m as FalModelId | undefined);
export type FalModelId = (typeof FAL_MODEL_IDS)[number];
export const DEFAULT_FAL_MODEL: FalModelId = "fal-ai/elevenlabs/speech-to-text/scribe-v2";

export type FalModelInfo = {
  id: FalModelId; label: string; kind: "words" | "chunks";
  /** Parts are cut to this many seconds (schemas document no hard limit; Scribe is proven reliable up to ~19 min, Whisper family handled in 25 min parts). */
  splitSec: number;
  /** USD per audio minute when billed per minute. */
  usdPerMin?: number;
  /** USD per compute second (Whisper family) and rough compute seconds per audio minute (estimate only). */
  usdPerComputeSec?: number; computeSecPerAudioMin?: number;
  note: string;
};
const env = (k: string, d: number) => { const n = Number(process.env[k]); return Number.isFinite(n) && n > 0 ? n : d; };
export const FAL_MODELS = (): Record<FalModelId, FalModelInfo> => ({
  "fal-ai/elevenlabs/speech-to-text/scribe-v2": { id: "fal-ai/elevenlabs/speech-to-text/scribe-v2", label: "ElevenLabs Scribe v2 (recomendado)", kind: "words", splitSec: 1140, usdPerMin: env("FAL_USD_PER_MIN", 0.008), note: "Palabras con tiempos; partes de 19 min." },
  "fal-ai/elevenlabs/speech-to-text": { id: "fal-ai/elevenlabs/speech-to-text", label: "ElevenLabs Scribe v1", kind: "words", splitSec: 1140, usdPerMin: env("FAL_USD_PER_MIN_SCRIBE_V1", 0.03), note: "Palabras con tiempos; partes de 19 min." },
  "fal-ai/wizper": { id: "fal-ai/wizper", label: "Wizper (Whisper v3, rápido)", kind: "chunks", splitSec: 1500, usdPerComputeSec: env("FAL_USD_PER_COMPUTE_SEC_WIZPER", 0.00111), computeSecPerAudioMin: env("FAL_WIZPER_COMPUTE_SEC_PER_MIN", 4), note: "Segmentos ≤29 s; partes de 25 min. Precio por segundo de cómputo (estimado)." },
  "assemblyai/universal": { id: "assemblyai/universal", label: "AssemblyAI Universal", kind: "words", splitSec: 4 * 3600, usdPerMin: env("ASSEMBLYAI_USD_PER_MIN", 0.0045), note: "AssemblyAI (clave ASSEMBLYAI_API_KEY). Palabras con tiempos; archivo entero hasta 4 h. Precio estimado, ajustable con ASSEMBLYAI_USD_PER_MIN." },
});
export const isAssemblyModel = (m: string | undefined) => !!m && m.startsWith("assemblyai/");
export const isFalModel = (m: unknown): m is FalModelId => typeof m === "string" && (FAL_MODEL_IDS as readonly string[]).includes(m);
export const modelInfo = (m: string): FalModelInfo => { const l = liveModel(m); return FAL_MODELS()[isFalModel(l) ? l : DEFAULT_FAL_MODEL]; };
/** Model of a raw document (its `model` field is the Fal endpoint id; unknown -> Scribe v2). */
export const kindOfModel = (m: string | undefined): "words" | "chunks" => (m && /wizper|\/whisper/.test(m) ? "chunks" : "words");

export const LANGUAGES: { code: string; two: string | null; label: string }[] = [
  { code: "spa", two: "es", label: "Español" }, { code: "auto", two: null, label: "Automático" }, { code: "heb", two: "he", label: "Hebreo" },
  { code: "eng", two: "en", label: "Inglés" }, { code: "fra", two: "fr", label: "Francés" }, { code: "por", two: "pt", label: "Portugués" },
  { code: "ita", two: "it", label: "Italiano" }, { code: "deu", two: "de", label: "Alemán" }, { code: "rus", two: "ru", label: "Ruso" },
  { code: "yid", two: "yi", label: "Yidis" }, { code: "ara", two: "ar", label: "Árabe" },
];
export const DEFAULT_LANGUAGE = "spa";

/** Request body for the Fal queue endpoint of each model. */
export function falInput(model: FalModelId, audioUrl: string, language: string): Record<string, unknown> {
  const L = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0];
  if (model === "fal-ai/wizper") return { audio_url: audioUrl, task: "transcribe", language: L.two, chunk_level: "segment", max_segment_len: 29, merge_chunks: true, version: "3" };
  return { audio_url: audioUrl, ...(L.code === "auto" ? {} : { language_code: L.code }), tag_audio_events: false, diarize: false };
}

type Chunk = { text?: string; timestamp?: (number | null)[]; start?: number; end?: number };
/** Chunk-style result (Wizper / Whisper) -> segments. A null/short end is repaired from the next chunk start or the part length. */
export function chunksToSegments(result: { chunks?: Chunk[] | null; text?: string }, offsetMs = 0, partMs?: number): Seg[] {
  const chunks = (result.chunks ?? []).filter((c) => (c.text ?? "").trim());
  const out: Seg[] = [];
  chunks.forEach((c, i) => {
    const s = c.timestamp?.[0] ?? c.start ?? 0;
    let e = c.timestamp?.[1] ?? c.end;
    if (e == null || e <= s) { const nx = chunks[i + 1]?.timestamp?.[0] ?? chunks[i + 1]?.start; e = nx != null && nx > s ? nx : partMs != null ? Math.max(s + 1, partMs / 1000) : s + 2; }
    out.push({ startMs: offsetMs + Math.round(s * 1000), endMs: offsetMs + Math.round(e * 1000), text: (c.text ?? "").trim() });
  });
  return out;
}
export const hasUsableOutput = (model: string, r: unknown): boolean => {
  const x = r as ScribeResult & { chunks?: unknown };
  return kindOfModel(model) === "chunks" ? Array.isArray(x?.chunks) : Array.isArray(x?.words);
};
/** Segments of a whole raw document, whatever the model (Scribe words are stitched across parts as normalize.py does). */
export function rawDocSegments(raw: RawDoc, words: (parts: RawDoc["parts"]) => Seg[]): Seg[] {
  if (kindOfModel(raw.model) === "words") return words(raw.parts);
  return raw.parts.flatMap((p) => chunksToSegments(p.result as never, p.offsetMs, p.durationMs));
}
/** Segments of one clip (gap recovery) in any model. */
export function clipSegments(model: string, result: unknown, clipStartMs: number, words: (r: ScribeResult, off: number) => Seg[]): Seg[] {
  return kindOfModel(model) === "chunks" ? chunksToSegments(result as never, clipStartMs) : words(result as ScribeResult, clipStartMs);
}
export type { FalModelInfo as ModelInfo };
