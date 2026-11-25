import { answerMaamarim } from "@/lib/maamarim/answer";
import { resolveChatOptions } from "@/lib/chat-models";
import { sanitizeMessages } from "@/lib/chat-core";
import { sanitizeMemory } from "@/lib/chat-memory";
import { validId } from "@/lib/maamarim/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST {messages, memory?, maamarId?, model?, effort?} -> ndjson MChatEvent stream */
export async function POST(req: Request) {
  let body: { messages?: unknown; memory?: unknown; maamarId?: unknown; model?: unknown; effort?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const messages = sanitizeMessages(body.messages, 40);
  if (!messages.length || messages[messages.length - 1].role !== "user") return Response.json({ error: "messages must end with a user message" }, { status: 400 });
  const memory = sanitizeMemory(body.memory);
  const maamarId = validId(body.maamarId) ? body.maamarId : undefined;
  const opts = { ...(await resolveChatOptions(body.model, body.effort).catch(() => ({}))), maamarId };
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      try { for await (const ev of answerMaamarim(messages, opts, memory)) c.enqueue(enc.encode(JSON.stringify(ev) + "\n")); }
      catch (e) {
        console.log("maamarim chat error:", (e as Error).message);
        c.enqueue(enc.encode(JSON.stringify({ type: "delta", text: "Error interno." }) + "\n"));
        c.enqueue(enc.encode(JSON.stringify({ type: "done", refs: [], cited: [], mode: "error" }) + "\n"));
      }
      c.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
