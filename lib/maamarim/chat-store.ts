// Client-side storage of the maamarim AI chats (separate from the shiurim chats). Pure; storage injected.
import { EFFORTS, type Effort } from "../chat-core";
import type { MRef } from "./types";

export type MStoredMsg = { role: "user" | "assistant"; content: string; refs?: MRef[]; cited?: number[]; mode?: string; model?: string; effort?: Effort };
export type MConversation = {
  id: string; title: string; createdAt: number; updatedAt: number; messages: MStoredMsg[];
  memory?: string; memoryUpTo?: number; model: string; effort: Effort; maamarId?: string; maamarTitle?: string;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const M_STORE_KEY = "maamarim-chats-v1";
export const M_ACTIVE_KEY = "maamarim-chat-active-v1";
const MAX_CHATS = 60, MAX_MSGS = 200, MAX_CONTENT = 40000;
export const M_DEFAULT_TITLE = "Nueva consulta";

export const mNewChat = (init: Partial<MConversation> = {}, now = Date.now()): MConversation =>
  ({ id: now.toString(36) + Math.random().toString(36).slice(2, 8), title: M_DEFAULT_TITLE, createdAt: now, updatedAt: now, messages: [], model: "", effort: "medium", ...init });

const validRef = (r: any): r is MRef => !!r && typeof r.maamarId === "string" && typeof r.title === "string" && typeof r.sectionId === "string" && typeof r.quote === "string";

export function mSanitize(raw: unknown): MConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  if (typeof r.id !== "string" || !r.id || r.id.length > 64 || !Array.isArray(r.messages)) return null;
  const messages: MStoredMsg[] = [];
  for (const m of r.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    const o: MStoredMsg = { role: m.role, content: m.content.slice(0, MAX_CONTENT) };
    if (Array.isArray(m.refs)) { const refs = m.refs.filter(validRef).slice(0, 16).map((x: MRef) => ({ maamarId: x.maamarId, title: String(x.title).slice(0, 200), sectionId: x.sectionId, sectionTitle: String(x.sectionTitle ?? "").slice(0, 200), quote: x.quote.slice(0, 300), callNumber: typeof x.callNumber === "string" ? x.callNumber.slice(0, 20) : undefined })); if (refs.length) o.refs = refs; }
    if (Array.isArray(m.cited)) o.cited = m.cited.filter((n: unknown) => Number.isInteger(n)).slice(0, 16);
    if (typeof m.mode === "string") o.mode = m.mode.slice(0, 10);
    if (typeof m.model === "string") o.model = m.model.slice(0, 80);
    if ((EFFORTS as readonly string[]).includes(m.effort)) o.effort = m.effort;
    messages.push(o);
  }
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const c: MConversation = {
    id: r.id, title: (typeof r.title === "string" && r.title.trim() ? r.title : M_DEFAULT_TITLE).slice(0, 120),
    createdAt: num(r.createdAt, Date.now()), updatedAt: num(r.updatedAt, Date.now()), messages: messages.slice(-MAX_MSGS),
    model: typeof r.model === "string" ? r.model.slice(0, 80) : "", effort: (EFFORTS as readonly string[]).includes(r.effort) ? r.effort : "medium",
  };
  if (typeof r.memory === "string" && r.memory.trim()) { c.memory = r.memory.slice(0, 2000); c.memoryUpTo = Math.max(0, Math.min(num(r.memoryUpTo, 0), MAX_MSGS)); }
  if (typeof r.maamarId === "string" && /^[a-z0-9]{6,24}$/.test(r.maamarId)) { c.maamarId = r.maamarId; c.maamarTitle = typeof r.maamarTitle === "string" ? r.maamarTitle.slice(0, 200) : undefined; }
  return c;
}
export const mSort = (l: MConversation[]) => l.slice().sort((a, b) => b.updatedAt - a.updatedAt);
export function mLoad(s: StorageLike | null): MConversation[] {
  try { const a = JSON.parse(s?.getItem(M_STORE_KEY) || "[]"); return Array.isArray(a) ? mSort(a.map(mSanitize).filter((x): x is MConversation => !!x)) : []; } catch { return []; }
}
export function mSave(s: StorageLike | null, chats: MConversation[]): boolean {
  if (!s) return false;
  let keep = mSort(chats.filter((c) => c.messages.length)).slice(0, MAX_CHATS);
  for (let i = 0; i < 6; i++) {
    try { s.setItem(M_STORE_KEY, JSON.stringify(keep)); return true; } catch { keep = keep.slice(0, Math.max(1, Math.floor(keep.length * 0.7))); }
  }
  return false;
}
