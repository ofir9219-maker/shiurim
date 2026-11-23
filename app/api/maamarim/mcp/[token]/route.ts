import { NextResponse } from "next/server";
import { handleRpc } from "@/lib/maamarim/mcp";
import { verifyMaamarToken } from "@/lib/maamarim/token";
import { rateLimited, clientIp } from "@/lib/zone/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const H = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, GET, DELETE, OPTIONS", "access-control-allow-headers": "content-type, authorization, mcp-session-id, mcp-protocol-version", "x-robots-tag": "noindex", "cache-control": "no-store" };
type P = { params: Promise<{ token: string }> };

async function gate(req: Request, token: string) {
  if (!verifyMaamarToken(token)) {
    if (rateLimited(`mbad:${clientIp(req)}`, 40, 3600_000)) return NextResponse.json({ error: "too many attempts" }, { status: 429, headers: H });
    return NextResponse.json({ error: "not found" }, { status: 404, headers: H });
  }
  if (rateLimited(`mtok:${token.slice(0, 10)}`, 120, 60_000)) return NextResponse.json({ error: "rate limited" }, { status: 429, headers: H });
  return null;
}

export async function POST(req: Request, { params }: P) {
  const { token } = await params;
  const g = await gate(req, token); if (g) return g;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: H }); }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(m, token)))).filter(Boolean);
    return out.length ? NextResponse.json(out, { headers: H }) : new NextResponse(null, { status: 202, headers: H });
  }
  const r = await handleRpc(body as never, token);
  return r ? NextResponse.json(r, { headers: H }) : new NextResponse(null, { status: 202, headers: H });
}
export async function GET(req: Request, { params }: P) {
  const { token } = await params;
  const g = await gate(req, token); if (g) return g;
  return new NextResponse("Este endpoint es un servidor MCP (POST JSON-RPC). Agrégalo en claude.ai como conector personalizado.", { status: 405, headers: { ...H, allow: "POST" } });
}
export async function DELETE() { return new NextResponse(null, { status: 200, headers: H }); }
export async function OPTIONS() { return new NextResponse(null, { status: 204, headers: H }); }
