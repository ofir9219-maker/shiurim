// LEGACY per-package upload endpoint (already-created packages keep working: their token maps to a job of the AI zone).
// New work goes through /api/ia/<zone-token>/…; this route only exists so old `.ai.json` files in Drive still return their result.
import { NextResponse } from "next/server";
import { CORS, clientIp, rateLimited } from "@/lib/zone/http";
import { MAX_BODY, findByLegacyToken, receiveResult, statusOf, type Job } from "@/lib/zone/jobs";

export const dynamic = "force-dynamic";
const json = (o: unknown, status = 200) => NextResponse.json(o, { status, headers: CORS });
type Ctx = { params: Promise<{ token: string }> };

function lookup(token: string, ip: string): { err: NextResponse } | { j: Job } {
  const j = token.length >= 20 ? findByLegacyToken(token) : null;
  if (!j || j.status === "superseded" || j.status === "discarded") { if (rateLimited(`oldbad:${ip}`, 40, 3600_000)) return { err: json({ ok: false, error: "Demasiados intentos; espera un rato." }, 429) }; return { err: json({ ok: false, error: "Enlace no válido, reemplazado o descartado. Usa el enlace de la Zona IA del centro de Drive." }, 404) }; }
  if (j.legacy && Date.parse(j.legacy.expiresAt) < Date.now() && j.status !== "received") return { err: json({ ok: false, error: "Este enlace venció (30 días). Usa el enlace de la Zona IA." }, 410) };
  return { j };
}
export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });
export async function GET(req: Request, ctx: Ctx) {
  const r = lookup((await ctx.params).token, clientIp(req));
  if ("err" in r) return r.err;
  return json({ ok: true, package_id: r.j.id, part: r.j.part, total: r.j.total, status: statusOf(r.j), segments: r.j.expect.indices.length, errors: (r.j.errors ?? []).map((e) => ({ where: e.where, message: e.problem })) });
}
export async function POST(req: Request, ctx: Ctx) {
  const r = lookup((await ctx.params).token, clientIp(req));
  if ("err" in r) return r.err;
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return json({ ok: false, error: "El archivo supera 5 MB." }, 413);
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY) return json({ ok: false, error: "El archivo supera 5 MB." }, 413);
  const res = await receiveResult(r.j, body, req.headers.get("x-upload-via") === "page" ? "page" : "api");
  return json({ ok: res.ok, applied: res.applied, message: res.message, errors: res.errors.map((e) => ({ where: e.where, message: e.problem })), waiting_for_parts: res.waitingForParts ?? [] }, res.ok ? 200 : 422);
}
