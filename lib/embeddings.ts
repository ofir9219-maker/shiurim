import { setupProxy } from "./proxy";

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
export const EMBEDDING_DIMS = Number(process.env.EMBEDDING_DIMS || 512);

export const hasEmbeddingKey = () => !!process.env.OPENAI_API_KEY;

export function vecToBlob(v: number[] | Float32Array): Buffer {
  const f = v instanceof Float32Array ? v : Float32Array.from(v);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}
export function blobToVec(b: Buffer): Float32Array {
  const copy = new Uint8Array(b).buffer; // aligned copy
  return new Float32Array(copy);
}
export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na * nb) || 1);
}

/** Embed texts via OpenAI-compatible API. Throws if no key. Retries on 429/5xx. */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  setupProxy();
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts, dimensions: EMBEDDING_DIMS }),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`embeddings HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`embeddings HTTP ${res.status}: ${await res.text()}`), { fatal: true });
      const j = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      return j.data.sort((a, b) => a.index - b.index).map((d) => Float32Array.from(d.embedding));
    } catch (e) {
      lastErr = e;
      if ((e as { fatal?: boolean }).fatal) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw lastErr;
}
