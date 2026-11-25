import { completeLLM, llmConfig } from "../../../../lib/chat-llm";
import { titleFromText } from "../../../../lib/chat-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST {question} -> {title}. LLM short title when a key exists, else the first ~6 words. */
export async function POST(req: Request) {
  let body: { question?: unknown } = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const q = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!q) return Response.json({ error: "question required" }, { status: 400 });
  let title = "";
  if (llmConfig()) {
    const out = await completeLLM(
      "Escribe un título muy corto (2 a 6 palabras, en español, sin comillas ni punto final) para una conversación que empieza con esta pregunta. Devuelve SOLO el título.",
      [{ role: "user", content: q }], 24, { effort: "minimal" }
    );
    title = (out || "").split("\n")[0].replace(/^["'«“\s]+|["'»”.\s]+$/g, "").slice(0, 60);
  }
  return Response.json({ title: title || titleFromText(q), ai: !!title });
}
