// Per-file state machine + persistent ingest state ($STORAGE_DIR/ingest/state.json).
import path from "node:path";
import { INGEST_DIR, readJson, writeJson } from "../storage";
import type { Resolved } from "../center/collections";

export const STATES = ["detected", "uploaded", "transcribed", "polished", "renamed", "indexed"] as const;
export type StepState = (typeof STATES)[number];
export type Status = "queued" | "running" | "failed" | "done" | "waiting";
export const MAX_ATTEMPTS = 8;

export type Cost = { falMinutes: number; promptTokens: number; completionTokens: number; falUsd?: number; openaiUsd?: number };
export type Item = {
  id: string; name: string; ext: string; mimeType: string; sizeBytes: number; order: string;
  state: StepState; status: Status; attempts: number; nextAttemptAt?: number; error?: string;
  /** Collection (Drive folder id) this file belongs to, its Drive parent, and the settings resolved when it was queued. */
  collectionId?: string; parentId?: string; cfg?: JobCfg; origName?: string; manual?: boolean; fileDate?: string;
  newName?: string; title?: string; mdId?: string; jsonId?: string; durationMs?: number; needsReview?: boolean; dafNote?: string; r2Key?: string;
  cost: Cost; log: { at: string; msg: string }[]; createdAt: string; updatedAt: string; finishedAt?: string;
};
export type JobCfg = Resolved & { published: boolean; collectionName: string; slug: string };
export type Seen = { size: number; polls: number; firstSeen: string };
export type State = {
  items: Record<string, Item>; seen: Record<string, Seen>;
  lastPoll?: { at: string; ok: boolean; files: number; newFiles: number; error?: string };
  totals: Cost;
};
export const emptyCost = (): Cost => ({ falMinutes: 0, promptTokens: 0, completionTokens: 0 });
export const emptyState = (): State => ({ items: {}, seen: {}, totals: emptyCost() });

/** State that comes after `s`, or null at the end. */
export const nextState = (s: StepState): StepState | null => STATES[STATES.indexOf(s) + 1] ?? null;
/** Exponential backoff: 1, 2, 4 … min, capped at 60 min. */
export const backoffMs = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60_000;

export function newItem(f: { id: string; name: string; ext: string; mimeType: string; sizeBytes: number; order: string } & Partial<Pick<Item, "fileDate" | "collectionId" | "parentId" | "cfg" | "manual" | "durationMs">>, now = new Date()): Item {
  return { ...f, origName: f.name, state: "detected", status: "queued", attempts: 0, cost: emptyCost(), log: [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
}
export function addLog(it: Item, msg: string, now = new Date()) {
  it.log.push({ at: now.toISOString(), msg }); if (it.log.length > 300) it.log.splice(0, it.log.length - 300);
  it.updatedAt = now.toISOString();
}
/** A step finished: move to the next state (or done when indexed). */
export function completeStep(it: Item, now = new Date()) {
  const n = nextState(it.state);
  if (n) it.state = n;
  // `state` = last completed step; "indexed" is terminal.
  it.attempts = 0; it.error = undefined; it.nextAttemptAt = undefined;
  it.updatedAt = now.toISOString();
}
export function failItem(it: Item, err: string, now = Date.now()) {
  it.attempts += 1; it.error = err.slice(0, 600);
  if (it.attempts >= MAX_ATTEMPTS) { it.status = "failed"; it.nextAttemptAt = undefined; }
  else { it.status = "queued"; it.nextAttemptAt = now + backoffMs(it.attempts); }
  it.updatedAt = new Date(now).toISOString();
}
export function retryItem(it: Item) {
  it.status = "queued"; it.attempts = 0; it.error = undefined; it.nextAttemptAt = undefined; it.updatedAt = new Date().toISOString();
}
export const isRunnable = (it: Item, now = Date.now()) => it.status === "queued" && (it.nextAttemptAt ?? 0) <= now && !(it.state === "indexed");

/** Upload-in-progress guard: a file is stable once seen with the same size in 2 consecutive polls. */
export function observeFile(seen: Record<string, Seen>, id: string, size: number, now = new Date()): boolean {
  const s = seen[id];
  if (!s || s.size !== size) { seen[id] = { size, polls: 1, firstSeen: s?.firstSeen ?? now.toISOString() }; return false; }
  s.polls += 1;
  return s.polls >= 2;
}

const FILE = () => path.join(INGEST_DIR, "state.json");
export function loadState(file = FILE()): State {
  const s = readJson<State>(file, emptyState());
  return { ...emptyState(), ...s };
}
export function saveState(s: State, file = FILE()) { writeJson(file, s); }
