import { NextResponse } from "next/server";
import { UPLOAD_GUIDE } from "@/lib/maamarim/guide";
import { syncIndex } from "@/lib/maamarim/search";
import { getMaamar, upsertMaamar, listCards } from "@/lib/maamarim/store";
import { publicBase, uploadUrl, verifyMaamarToken } from "@/lib/maamarim/token";
import { clientIp, rateLimited } from "@/lib/zone/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const H = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "x-robots-tag": "noindex", "cache-control": "no-store" };
type P = { params: Promise<{ token: string }> };
const deny = (req: Request) => (rateLimited(`mbad:${clientIp(req)}`, 40, 3600_000) ? 429 : 404);

/** GET: the upload guide (text). */
export async function GET(req: Request, { params }: P) {
  const { token } = await params;
  if (!verifyMaamarToken(token)) return NextResponse.json({ error: "not found" }, { status: deny(req), headers: H });
  return new NextResponse(UPLOAD_GUIDE.replace(/<upload_url>/g, uploadUrl(token)) + `\nPOST JSON a ${uploadUrl(token)}: {"markup": "...", "categoria": ["…"], "etiquetas": ["…"], "ficha": {...}, "id"?: "..."}\n`, { headers: { ...H, "content-type": "text/plain; charset=utf-8" } });
}

/** POST JSON {markup, categoria?, categoria_id?, etiquetas?, ficha?, id?, fecha_iso?} */
export async function POST(req: Request, { params }: P) {
  const { token } = await params;
  if (!verifyMaamarToken(token)) return NextResponse.json({ error: "not found" }, { status: deny(req), headers: H });
  if (rateLimited(`mup:${token.slice(0, 10)}`, 30, 60_000)) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: H });
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400, headers: H }); }
  const id = typeof b.id === "string" && b.id ? b.id : undefined;
  if (id && !getMaamar(id)) return NextResponse.json({ ok: false, error: `no existe el maamar ${id}` }, { status: 404, headers: H });
  try {
    const r = await upsertMaamar({
      id, markup: typeof b.markup === "string" ? b.markup : "",
      category: (Array.isArray(b.categoria) ? b.categoria.map(String) : typeof b.categoria === "string" ? b.categoria : undefined) as string[] | string | undefined,
      categoryId: typeof b.categoria_id === "string" ? b.categoria_id : undefined,
      tags: Array.isArray(b.etiquetas) ? b.etiquetas.map(String) : undefined,
      ficha: (b.ficha && typeof b.ficha === "object" ? b.ficha : undefined) as never,
      dateIso: typeof b.fecha_iso === "string" ? b.fecha_iso : undefined,
    });
    await syncIndex().catch(() => null);
    const card = listCards().find((c) => c.id === r.maamar.id);
    return NextResponse.json({ ok: true, created: r.created, id: r.maamar.id, url: `${publicBase()}/maamarim/${r.maamar.id}`, callNumber: card?.callNumber, category: card?.categoryPath, warnings: r.warnings }, { headers: H });
  } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400, headers: H }); }
}
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: { ...H, "access-control-allow-methods": "GET, POST, OPTIONS" } }); }
