// Client-side storage of conversations (localStorage). Pure helpers: storage is injected so they are testable.
import { EFFORTS, type Effort, type Ref } from "./chat-core";

export type StoredMsg = {
  role: "user" | "assistant"; content: string;
  refs?: Ref[]; cited?: number[]; mode?: string; model?: string; effort?: Effort;
};
export type Conversation = {
  id: string; title: string; createdAt: number; updatedAt: number;
  messages: StoredMsg[];
  memory?: string; memoryUpTo?: number; // messages[0..memoryUpTo) are folded into `memory`
  model: string; effort: Effort; classId?: string;
};
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const STORE_KEY = "shiurim-chats-v1";
export const ACTIVE_KEY = "shiurim-chat-active-v1";
export const MAX_CHATS = 50;
export const MAX_MSGS = 200;
export const DEFAULT_TITLE = "Nuevo chat";

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function newChat(init: Partial<Conversation> = {}, now = Date.now()): Conversation {
  return { id: newId(), title: DEFAULT_TITLE, createdAt: now, updatedAt: now, messages: [], model: "", effort: "medium", ...init };
}

/** First ~6 words of a question, used when no LLM title is available. */
export function titleFromText(text: string, words = 6): string {
  const w = text.replace(/[¿?¡!"“”«»]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!w.length) return DEFAULT_TITLE;
  const t = w.slice(0, words).join(" ");
  const out = w.length > words ? t + "…" : t;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function validRef(r: any): r is Ref {
  return !!r && typeof r.classId === "string" && typeof r.title === "string" && typeof r.startMs === "number" && typeof r.quote === "string";
}

/** Validate/normalize an untrusted object (localStorage or import) into a Conversation, or null. */
export function sanitizeConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  if (typeof r.id !== "string" || !r.id || r.id.length > 64 || !Array.isArray(r.messages)) return null;
  const messages: StoredMsg[] = [];
  for (const m of r.messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
    const o: StoredMsg = { role: m.role, content: m.content.slice(0, 8000) };
    if (Array.isArray(m.refs)) { const refs = m.refs.filter(validRef).slice(0, 12); if (refs.length) o.refs = refs; }
    if (Array.isArray(m.cited)) o.cited = m.cited.filter((n: unknown) => Number.isInteger(n)).slice(0, 12);
    if (typeof m.mode === "string") o.mode = m.mode.slice(0, 10);
    if (typeof m.model === "string") o.model = m.model.slice(0, 80);
    if ((EFFORTS as readonly string[]).includes(m.effort)) o.effort = m.effort;
    messages.push(o);
  }
  const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
  const dropped = Math.max(0, messages.length - MAX_MSGS);
  const memoryUpTo = Math.max(0, Math.min(num(r.memoryUpTo, 0) - dropped, MAX_MSGS));
  const c: Conversation = {
    id: r.id,
    title: (typeof r.title === "string" && r.title.trim() ? r.title : DEFAULT_TITLE).slice(0, 120),
    createdAt: num(r.createdAt, Date.now()), updatedAt: num(r.updatedAt, num(r.createdAt, Date.now())),
    messages: messages.slice(-MAX_MSGS),
    model: typeof r.model === "string" ? r.model.slice(0, 80) : "",
    effort: (EFFORTS as readonly string[]).includes(r.effort) ? r.effort : "medium",
  };
  if (typeof r.memory === "string" && r.memory.trim()) { c.memory = r.memory.slice(0, 2000); c.memoryUpTo = memoryUpTo; }
  if (typeof r.classId === "string" && r.classId) c.classId = r.classId.slice(0, 120);
  return c;
}

export function sortChats(chats: Conversation[]): Conversation[] {
  return chats.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadChats(storage: StorageLike | null | undefined): Conversation[] {
  try {
    const raw = storage?.getItem(STORE_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw);
    if (!j || j.v !== 1 || !Array.isArray(j.chats)) return [];
    return sortChats(j.chats.map(sanitizeConversation).filter((c: Conversation | null): c is Conversation => !!c)).slice(0, MAX_CHATS);
  } catch { return []; }
}

const stripRefs = (c: Conversation): Conversation => ({ ...c, messages: c.messages.map(({ refs, cited, ...m }) => m) });

/** Persist (empty chats are not stored). On quota errors: strip refs of older chats, then of all, then drop oldest chats. */
export function saveChats(storage: StorageLike | null | undefined, chats: Conversation[]): boolean {
  if (!storage) return false;
  let list = sortChats(chats.filter((c) => c.messages.length > 0)).slice(0, MAX_CHATS);
  const attempt = (l: Conversation[]) => { try { storage.setItem(STORE_KEY, JSON.stringify({ v: 1, chats: l })); return true; } catch { return false; } };
  if (attempt(list)) return true;
  list = list.map((c, i) => (i < 10 ? c : stripRefs(c)));
  if (attempt(list)) return true;
  list = list.map(stripRefs);
  while (list.length) {
    if (attempt(list)) return true;
    list = list.slice(0, -1);
  }
  try { storage.removeItem(STORE_KEY); } catch { /* ignore */ }
  return false;
}

export function loadActiveId(storage: StorageLike | null | undefined): string | null {
  try { return storage?.getItem(ACTIVE_KEY) || null; } catch { return null; }
}
export function saveActiveId(storage: StorageLike | null | undefined, id: string) {
  try { storage?.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
}

export function filterChats(chats: Conversation[], q: string): Conversation[] {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = n(q.trim());
  return t ? chats.filter((c) => n(c.title).includes(t)) : chats;
}

export function chatForClass(chats: Conversation[], classId: string): Conversation | undefined {
  return sortChats(chats).find((c) => c.classId === classId);
}

/** Merge imported chats into existing ones by id (newer updatedAt wins), cap at MAX_CHATS. */
export function mergeChats(existing: Conversation[], incoming: Conversation[]): Conversation[] {
  const map = new Map(existing.map((c) => [c.id, c]));
  for (const c of incoming) { const cur = map.get(c.id); if (!cur || c.updatedAt > cur.updatedAt) map.set(c.id, c); }
  return sortChats([...map.values()]).slice(0, MAX_CHATS);
}

export function exportChats(chats: Conversation[], now = Date.now()): string {
  return JSON.stringify({ app: "shiurim-chat", v: 1, exportedAt: now, chats: chats.filter((c) => c.messages.length) }, null, 1);
}

/** Parse an export file (or a bare array). Returns null if it is not valid JSON of chats. */
export function parseImport(text: string): Conversation[] | null {
  try {
    const j = JSON.parse(text);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.chats) ? j.chats : null;
    if (!arr) return null;
    return arr.map(sanitizeConversation).filter((c: Conversation | null): c is Conversation => !!c);
  } catch { return null; }
}

export function relativeDate(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 60_000) return "ahora";
  if (d < 3600_000) return `hace ${Math.floor(d / 60_000)} min`;
  if (d < 86400_000) return `hace ${Math.floor(d / 3600_000)} h`;
  const days = Math.floor(d / 86400_000);
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  return new Date(ts).toLocaleDateString("es", { day: "numeric", month: "short" });
}
