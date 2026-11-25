export const PROMPT_VERSION = "champinones-v1";

export const WORKS = ["Bavli", "Yerushalmi", "Mishnah", "Tanakh", "Midrash", "Rashi", "Tosafot", "Likutei Moharan", "Zohar", "Other"] as const;
export const ROLES = ["anchor", "parallel", "proof_text", "context", "commentary"] as const;
export const HOOK_TYPES = ["same_word", "rare_form", "shared_root", "same_phrase", "same_verse", "name_person", "number", "image_object", "structure", "scene_role", "concept"] as const;
export const NONLITERAL_HOOKS = new Set(["structure", "scene_role", "concept"]);
export const MOVES = ["word_meaning", "function_transfer", "situation", "person", "completion", "unifying_yesod", "kabbalistic", "practical"] as const;
export const LAYER_KINDS = ["textual", "structural", "conceptual", "kabbalistic", "likutey_moharan", "practical"] as const;

export type Node = {
  id: string; ref: string; work: (typeof WORKS)[number]; label: string; hebrew_excerpt: string;
  transliteration: string | null; translation: string; role: (typeof ROLES)[number];
  /** added by validation */ flags?: string[];
};
export type Link = {
  id: string; from: string; to: string; hook_type: (typeof HOOK_TYPES)[number]; hook_text: string;
  hook_transliteration: string | null; hook_gloss: string; surface_explanation: string; depth_explanation: string;
  depth_moves: (typeof MOVES)[number][]; strength: 1 | 2 | 3; shiur_ref_indexes: number[]; flags?: string[];
};
export type Layer = { kind: (typeof LAYER_KINDS)[number]; title: string; text: string; node_ids: string[] };
export type ShiurRef = { classId: string; startMs: number; why: string; title?: string; ordLabel?: string; champ?: boolean };
export type Analysis = {
  schema_version: string; title: string; question_language: string; answer_language: string; summary: string;
  nodes: Node[]; links: Link[]; layers: Layer[]; synthesis: string; practical_lesson: string | null;
  shiur_refs: ShiurRef[]; open_questions: string[]; caveats: string[];
};

export type Usage = { model: string; inTokens: number; outTokens: number; costUsd: number; ms: number };
export type Meta = {
  model: string; effort: string; scope: string; classId?: string; promptVersion: string; createdAt: number;
  totalMs: number; costUsd: number; calls: Usage[]; stages: Record<string, number>;
  validation: { dropped: string[]; flagged: string[]; repaired: boolean; retried: boolean };
  sources: { sefariaRefs: number; shiurPassages: number };
};
export type StoredResult = { id: string; question: string; data: Analysis; meta: Meta };

export type Input = {
  question: string; language?: string; model?: string; effort?: string; scope?: "berakhot" | "shas"; classId?: string; collections?: string[]; refresh?: boolean;
};

export type StreamEvent =
  | { type: "status"; stage: string; label: string; detail?: string; t: number }
  | { type: "progress"; stage: string; chars: number; t: number }
  | { type: "result"; id: string; data: Analysis; meta: Meta; question: string; cached: boolean }
  | { type: "error"; message: string };

// ---------- strict JSON schema (OpenAI response_format) ----------
const S = { type: "string" } as const;
const SN = { type: ["string", "null"] } as const;
const arr = (items: object) => ({ type: "array", items });
const obj = (props: Record<string, object>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const en = (v: readonly string[]) => ({ type: "string", enum: [...v] });

export const ANALYSIS_SCHEMA = obj({
  schema_version: S, title: S, question_language: S, answer_language: S, summary: S,
  nodes: arr(obj({ id: S, ref: S, work: en(WORKS), label: S, hebrew_excerpt: S, transliteration: SN, translation: S, role: en(ROLES) })),
  links: arr(obj({
    id: S, from: S, to: S, hook_type: en(HOOK_TYPES), hook_text: S, hook_transliteration: SN, hook_gloss: S,
    surface_explanation: S, depth_explanation: S, depth_moves: arr(en(MOVES)), strength: { type: "integer", enum: [1, 2, 3] },
    shiur_ref_indexes: arr({ type: "integer" }),
  })),
  layers: arr(obj({ kind: en(LAYER_KINDS), title: S, text: S, node_ids: arr(S) })),
  synthesis: S, practical_lesson: SN,
  shiur_refs: arr(obj({ classId: S, startMs: { type: "integer" }, why: S })),
  open_questions: arr(S), caveats: arr(S),
});

export const HOOKS_SCHEMA = obj({
  candidates: arr(obj({ a: S, b: S, hook_type: en(HOOK_TYPES), hook_text: S, why: S })),
  need_refs: arr(S),
});

export const ANALYZE_SCHEMA = obj({
  question_language: S,
  requested_answer_language: SN,
  hebrew_terms: arr(S),
  refs: arr(S),
  shiur_query: S,
  shiur_queries: arr(S),
  shiur_keywords: arr(S),
  names_a_set: { type: "boolean" },
  set_size: { type: ["integer", "null"] },
});
