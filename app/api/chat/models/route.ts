import { getChatModels } from "../../../../lib/chat-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET -> {models:[{id,label,reasoning}], default, efforts, defaultEffort, enabled} */
export async function GET() {
  return Response.json(await getChatModels(), { headers: { "cache-control": "no-store" } });
}
