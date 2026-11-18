import { chat } from "../../../lib/chat";
import { resolveChatOptions } from "../../../lib/chat-models";
import { sanitizeMessages } from "../../../lib/chat-core";
import { sanitizeMemory } from "../../../lib/chat-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {messages:[{role,content}], memory?, classId?, model?, effort?} -> application/x-ndjson:
 *  {"type":"delta","text":"..."}* then {"type":"done","refs":[{classId,title,startMs,quote}],"cited":[1,2],"mode":"ai|noai|error","memory"?,"condensed"?} */
export async function POST(req: Request) {
  let body: { messages?: unknown; memory?: unknown; classId?: unknown; model?: unknown; effort?: unknown } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  const messages = sanitizeMessages(body.messages, 40);
  const memory = sanitizeMemory(body.memory);
  if (!messages.length || messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "messages must end with a user message" }, { status: 400 });
  }
  const classId = typeof body.classId === "string" && body.classId && body.classId.length <= 120 ? body.classId : undefined;
  const opts = await resolveChatOptions(body.model, body.effort).catch(() => ({}));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of chat(messages, classId, opts, memory)) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      } catch {
        controller.enqueue(enc.encode(JSON.stringify({ type: "delta", text: "Error interno del chat." }) + "\n"));
        controller.enqueue(enc.encode(JSON.stringify({ type: "done", refs: [], cited: [], mode: "error" }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
