import { loadResult } from "../../../../lib/champinones/store";
import { renderDocument } from "../../../../lib/champinones/render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/champinones/:id -> stored result JSON; ?format=html -> self-contained HTML (add &download=1 for an attachment). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = loadResult(id);
  if (!r) return Response.json({ error: "not found or expired" }, { status: 404 });
  const url = new URL(req.url);
  if (url.searchParams.get("format") === "html") {
    const html = renderDocument(r, { origin: url.origin, standalone: true });
    const slug = r.data.title.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 50).toLowerCase() || "champinones";
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...(url.searchParams.get("download") ? { "content-disposition": `attachment; filename="champinones-${slug}.html"` } : {}) } });
  }
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
