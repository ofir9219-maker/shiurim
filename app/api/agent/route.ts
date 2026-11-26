import { runAgent, cleanDossier, type Msg, type PendingSource } from "@/lib/agent/agent";
import { validateSettings } from "@/lib/agent/models";
import { parseScope } from "@/lib/agent/search";
import { requireKey } from "@/lib/agent/openai";
import { loadSource } from "@/lib/agent/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST {messages, dossier?, scope?, settings?, action?: "ask"|"expand", focus?, pending?} -> ndjson AgentEvent stream. */
export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* below */ }
  const messages: Msg[] = (Array.isArray(b.messages) ? b.messages : []).filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-30).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 6000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return Response.json({ error: "messages must end with a user message" }, { status: 400 });
  const { settings, problems } = validateSettings(b.settings);
  if (problems.length) return Response.json({ error: `Ajustes no válidos: ${problems.join("; ")}` }, { status: 400 });
  try { requireKey(); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 503 }); }
  const pending: PendingSource[] = (Array.isArray(b.pending) ? b.pending : []).slice(0, 20).filter((p: any) => p && (p.kind === "shiur" || p.kind === "maamar") && typeof p.id === "string" && typeof p.anchor === "string" && loadSource(p))
    .map((p: any) => ({ kind: p.kind, id: p.id, title: String(p.title ?? ""), sub: String(p.sub ?? ""), anchor: p.anchor, score: Number(p.score) || 0 }));
  const focus = (Array.isArray(b.focus) ? b.focus : []).filter((x): x is string => typeof x === "string").slice(0, 20);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(c) {
      for await (const ev of runAgent({ messages, dossier: cleanDossier(b.dossier), scope: parseScope(b.scope), settings, action: b.action === "expand" ? "expand" : "ask", focus, pending, signal: req.signal })) {
        try { c.enqueue(enc.encode(JSON.stringify(ev) + "\n")); } catch { break; }
      }
      try { c.close(); } catch { /* closed */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
