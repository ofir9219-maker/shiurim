import { runChampinones } from "../../../lib/champinones/pipeline";
import { MODELS, DEFAULT_MODEL, DEFAULT_EFFORT, EFFORTS } from "../../../lib/champinones/models";
import { openaiKey } from "../../../lib/champinones/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** GET -> options for the UI. */
export async function GET() {
  return Response.json({ models: MODELS, efforts: EFFORTS, defaultModel: DEFAULT_MODEL, defaultEffort: DEFAULT_EFFORT, enabled: !!openaiKey() });
}

/** POST {question, language?, model?, effort?, scope?, classId?, refresh?} -> application/x-ndjson:
 *  {"type":"status","stage","label","detail?","t"}* {"type":"progress","stage","chars","t"}* then
 *  {"type":"result","id","data","meta","question","cached"} | {"type":"error","message"} */
export async function POST(req: Request) {
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch {}
  const question = typeof b.question === "string" ? b.question.trim() : "";
  if (question.length < 3 || question.length > 600) return Response.json({ error: "question must be 3-600 characters" }, { status: 400 });
  const s = (k: string) => (typeof b[k] === "string" && (b[k] as string).length <= 120 ? (b[k] as string) : undefined);
  const input = { question, language: s("language"), model: s("model"), effort: s("effort"), scope: s("scope") as "berakhot" | "shas" | undefined, classId: s("classId"), collections: Array.isArray(b.collections) ? (b.collections as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 20) : undefined, refresh: b.refresh === true };
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try { for await (const ev of runChampinones(input)) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n")); }
      catch (e: any) { controller.enqueue(enc.encode(JSON.stringify({ type: "error", message: String(e?.message || e).slice(0, 300) }) + "\n")); }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
