import { NextResponse } from "next/server";
import { COOKIE, adminEnabled, checkPassword, cookieOpts, isSecure, makeToken } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
let fails: number[] = [];
export async function POST(req: Request) {
  if (!adminEnabled()) return NextResponse.json({ error: "ADMIN_PASSWORD no configurada" }, { status: 503 });
  fails = fails.filter((t) => Date.now() - t < 10 * 60_000);
  if (fails.length >= 10) return NextResponse.json({ error: "Demasiados intentos, espera unos minutos" }, { status: 429 });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !checkPassword(password)) { fails.push(Date.now()); return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 401 }); }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, makeToken(), cookieOpts(isSecure(req)));
  return res;
}
