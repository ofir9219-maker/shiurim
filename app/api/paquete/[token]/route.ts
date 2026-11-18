// Public, token-scoped upload endpoint for AI packages: POST the corrected JSON here (CORS open, body <= 5 MB).
import { NextResponse } from "next/server";
import { MAX_BODY, findByToken, isExpired, publicInfo, receiveResult } from "@/lib/center/packages";

export const dynamic = "force-dynamic";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, OPTIONS", "access-control-allow-headers": "content-type", "access-control-max-age": "86400" };
const json = (o: unknown, status = 200) => NextResponse.json(o, { status, headers: CORS });
type Ctx = { params: Promise<{ token: string }> };

const fails = new Map<string, number[]>();
const limited = (k: string) => { const now = Date.now(); const l = (fails.get(k) ?? []).filter((t) => now - t < 3600_000); fails.set(k, l); return l.length >= 40; };
const fail = (k: string) => fails.set(k, [...(fails.get(k) ?? []), Date.now()]);

function lookup(token: string, ip: string) {
  if (limited(ip)) return { err: json({ ok: false, error: "Demasiados intentos; espera un rato." }, 429) };
  const p = token.length >= 20 ? findByToken(token) : null;
  if (!p || p.status === "superseded") { fail(ip); return { err: json({ ok: false, error: "Enlace no válido o reemplazado por uno nuevo." }, 404) }; }
  if (isExpired(p)) return { err: json({ ok: false, error: "Este enlace venció (30 días). Pide uno nuevo en el centro de Drive." }, 410) };
  return { p };
}
export const OPTIONS = () => new NextResponse(null, { status: 204, headers: CORS });
export async function GET(req: Request, ctx: Ctx) {
  const r = lookup((await ctx.params).token, req.headers.get("x-forwarded-for") || "x");
  return r.err ?? json({ ok: true, ...publicInfo(r.p!), errors: r.p!.errors ?? [] });
}
export async function POST(req: Request, ctx: Ctx) {
  const r = lookup((await ctx.params).token, req.headers.get("x-forwarded-for") || "x");
  if (r.err) return r.err;
  const len = Number(req.headers.get("content-length") || 0);
  if (len > MAX_BODY) return json({ ok: false, error: "El archivo supera 5 MB." }, 413);
  const body = await req.text();
  if (Buffer.byteLength(body) > MAX_BODY) return json({ ok: false, error: "El archivo supera 5 MB." }, 413);
  const via = req.headers.get("x-upload-via") === "page" ? "page" : "api";
  const res = await receiveResult(r.p!, body, via);
  return json({ ok: res.ok, applied: res.applied, message: res.message, errors: res.errors, waiting_for_parts: res.waitingForParts ?? [] }, res.ok ? 200 : 422);
}
