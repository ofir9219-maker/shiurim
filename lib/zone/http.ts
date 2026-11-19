// Shared HTTP helpers of the AI zone routes: token auth (path segment), per-token rate limit, CORS, origin.
import { NextResponse } from "next/server";
import { verifyToken } from "./token";

export const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400" };
export const NOINDEX = { "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" };
export const json = (o: unknown, status = 200, extra: Record<string, string> = {}) => NextResponse.json(o, { status, headers: { ...CORS, ...NOINDEX, ...extra } });
export const optionsResponse = () => new NextResponse(null, { status: 204, headers: CORS });

/** Sliding-window limiter (in memory). */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max: number, windowMs: number, now = Date.now()): number {
  const l = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (l.length >= max) { hits.set(key, l); return Math.max(1, Math.ceil((windowMs - (now - l[0])) / 1000)); }
  l.push(now); hits.set(key, l); return 0;
}
export const resetRateLimits = () => hits.clear();
export const REQ_PER_MIN = () => Number(process.env.AI_ZONE_RATE_PER_MIN || 240);
const BAD_PER_HOUR = 40;

export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for") || "x").split(",")[0].trim();
export function originOf(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** null = ok; otherwise the response to return. Invalid tokens are a plain 404 (counted per IP); valid ones are limited per token. */
export function gate(req: Request, token: string): NextResponse | null {
  const ip = clientIp(req);
  if (!verifyToken(token)) {
    const wait = rateLimited(`bad:${ip}`, BAD_PER_HOUR, 3600_000);
    if (wait) return json({ ok: false, error: "Demasiados intentos con enlace inválido; espera un rato." }, 429, { "retry-after": String(wait) });
    return json({ ok: false, error: "Enlace de la Zona IA no válido." }, 404);
  }
  const wait = rateLimited(`tok:${token.slice(0, 12)}`, REQ_PER_MIN(), 60_000);
  if (wait) return json({ ok: false, error: "Demasiadas peticiones; espera unos segundos." }, 429, { "retry-after": String(wait) });
  return null;
}
export async function readBody(req: Request, max: number): Promise<{ text: string } | { error: NextResponse }> {
  const len = Number(req.headers.get("content-length") || 0);
  const tooBig = () => ({ error: json({ ok: false, error: "El cuerpo supera 5 MB." }, 413) });
  if (len > max) return tooBig();
  const text = await req.text();
  if (Buffer.byteLength(text) > max) return tooBig();
  return { text };
}
