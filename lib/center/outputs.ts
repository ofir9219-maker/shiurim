// Drive outputs next to each audio: <name>.md (polished-to-md.py format) and <name>.json (shiurim transcript JSON).
import type { Seg } from "../ingest/segments";

export const JSON_VERSION = 1;
export type OutputMeta = {
  title: string; collection?: string; postprocess?: string; polished: boolean; durationMs?: number; needsReview?: boolean;
  daf?: { daf: string; amud: string }[]; naming?: Record<string, unknown>; generatedAt: string; [k: string]: unknown;
};
export type TranscriptJson = { version: number; audioId: string; model: string; segments: Seg[]; summary?: string; tags?: string[]; meta: OutputMeta };

export function buildTranscriptJson(o: { audioId: string; model: string; segments: Seg[]; summary?: string; tags?: string[]; meta: Omit<OutputMeta, "generatedAt"> & { generatedAt?: string } }): TranscriptJson {
  const j: TranscriptJson = {
    version: JSON_VERSION, audioId: o.audioId, model: o.model,
    segments: o.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
    meta: { ...o.meta, generatedAt: o.meta.generatedAt ?? new Date().toISOString() } as OutputMeta,
  };
  if (o.summary) j.summary = o.summary;
  if (o.tags?.length) j.tags = o.tags;
  return j;
}
export const baseOf = (name: string) => name.replace(/\.[A-Za-z0-9]{2,4}$/, "");
/** Drive file names cannot contain "/"; strip it defensively. */
export const safeName = (n: string) => n.replace(/[\/\\]/g, "-").trim();
