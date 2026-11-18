import { NextResponse } from "next/server";
import { isAdmin, origin } from "@/lib/admin-auth";
import { exchangeCode, saveToken, loadToken, accessToken, userEmail } from "@/lib/ingest/drive";
import { scheduler } from "@/lib/ingest/scheduler";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const o = origin(req);
  const back = (q: string) => NextResponse.redirect(`${o}/admin?${q}`);
  if (!(await isAdmin())) return NextResponse.redirect(`${o}/admin`);
  const u = new URL(req.url);
  const state = u.searchParams.get("state"), code = u.searchParams.get("code"), err = u.searchParams.get("error");
  const cookie = req.headers.get("cookie")?.match(/(?:^|; )g_oauth_state=([^;]+)/)?.[1];
  if (err) return back(`google_error=${encodeURIComponent(err)}`);
  if (!code || !state || state !== cookie) return back("google_error=state");
  try {
    const t = await exchangeCode(code, `${o}/api/admin/google/callback`);
    const refresh = t.refresh_token || loadToken()?.refresh_token;
    if (!refresh) return back("google_error=sin_refresh_token");
    saveToken({ refresh_token: refresh, scope: t.scope, savedAt: new Date().toISOString() });
    await accessToken();
    const email = await userEmail();
    saveToken({ refresh_token: refresh, scope: t.scope, email, savedAt: new Date().toISOString() });
    const s = scheduler(); s.start(); void s.checkNow().catch(() => {});
    const res = back("google=ok");
    res.cookies.set("g_oauth_state", "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) { return back(`google_error=${encodeURIComponent((e as Error).message.slice(0, 120))}`); }
}
