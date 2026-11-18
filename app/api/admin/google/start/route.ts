import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { isAdmin, isSecure, origin } from "@/lib/admin-auth";
import { authUrl, oauthConfigured } from "@/lib/ingest/drive";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!(await isAdmin())) return NextResponse.redirect(new URL("/admin", origin(req)));
  if (!oauthConfigured()) return NextResponse.json({ error: "Faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET" }, { status: 500 });
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(authUrl(`${origin(req)}/api/admin/google/callback`, state));
  res.cookies.set("g_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: isSecure(req), path: "/", maxAge: 600 });
  return res;
}
