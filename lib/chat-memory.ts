// Pure helpers for the rolling per-chat memory (safe for client + server).
import type { ChatMsg } from "./chat-core";

export const MEM_MAX_MSGS = 12;
export const MEM_MAX_CHARS = 12000;
export const MEM_KEEP = 6; // recent messages kept verbatim after condensing
export const MEM_CAP = 1200;
export const MEM_INPUT_CAP = 2000; // max memory accepted from a client

export function totalChars(messages: ChatMsg[]): number {
  return messages.reduce((n, m) => n + m.content.length, 0);
}

/** True when the unsummarized part of the conversation is long enough to fold older turns into memory. */
export function needsCondense(messages: ChatMsg[]): boolean {
  return messages.length > MEM_MAX_MSGS || totalChars(messages) > MEM_MAX_CHARS;
}

export function splitForCondense(messages: ChatMsg[], keep = MEM_KEEP): { older: ChatMsg[]; recent: ChatMsg[] } {
  const cut = Math.max(0, messages.length - keep);
  return { older: messages.slice(0, cut), recent: messages.slice(cut) };
}

export function capMemory(s: string, max = MEM_CAP): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

/** No-key memory: concatenation of the user's earlier questions; the newest ones win when truncating. */
export function mergeNoKeyMemory(prev: string | undefined, older: ChatMsg[], max = MEM_CAP): string {
  const qs = older.filter((m) => m.role === "user").map((m) => m.content.replace(/\s+/g, " ").trim().slice(0, 160)).filter(Boolean);
  const base = (prev || "").replace(/^Preguntas anteriores: /, "").trim();
  const all = [base, ...qs].filter(Boolean).join(" | ");
  const prefix = "Preguntas anteriores: ";
  const room = max - prefix.length;
  const body = all.length > room ? "…" + all.slice(all.length - room + 1).replace(/^\S*\s/, "") : all;
  return all ? prefix + body : "";
}

export function condensePrompt(prev: string | undefined, older: ChatMsg[]): { system: string; messages: ChatMsg[] } {
  const turns = older.map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.content.slice(0, 700)}`).join("\n");
  return {
    system:
      `Mantienes la memoria de una conversación sobre shiurim (clases de Torá). Fusiona la MEMORIA ACTUAL con los TURNOS NUEVOS en una memoria actualizada, en español, ` +
      `de máximo ${MEM_CAP} caracteres: hechos mencionados, preferencias del usuario y temas tratados (incluye shiurim o dafim citados). Sin saludos ni relleno. Devuelve SOLO la memoria.`,
    messages: [{ role: "user", content: `MEMORIA ACTUAL:\n${prev?.trim() || "(vacía)"}\n\nTURNOS NUEVOS:\n${turns}` }],
  };
}

export function memoryPrompt(memory?: string): string {
  const m = memory?.trim();
  return m ? `\n\nMemoria de esta conversación: ${m}\n(Úsala solo para entender el contexto de la conversación; las respuestas se basan únicamente en los EXTRACTOS.)` : "";
}

export function sanitizeMemory(x: unknown): string {
  return typeof x === "string" ? x.slice(0, MEM_INPUT_CAP).trim() : "";
}
