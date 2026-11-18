// Minimal cookie session for /admin (env ADMIN_PASSWORD). Token = "<expiry>.<hmac>"; no server-side store.
import crypto from "node:crypto";
import { cookies } from "next/headers";

export const COOKIE = "admin_session";
const secret = () => crypto.createHash("sha256").update(`shiurim-admin:${process.env.ADMIN_PASSWORD || ""}`).digest();
const sign = (exp: string) => crypto.createHmac("sha256", secret()).update(exp).digest("hex");
export const adminEnabled = () => !!process.env.ADMIN_PASSWORD;

export function checkPassword(pw: string): boolean {
  const a = crypto.createHash("sha256").update(pw).digest(), b = crypto.createHash("sha256").update(process.env.ADMIN_PASSWORD || "").digest();
  return adminEnabled() && crypto.timingSafeEqual(a, b);
}
export function makeToken(days = 7): string { const exp = String(Date.now() + days * 86400_000); return `${exp}.${sign(exp)}`; }
export function validToken(t: string | undefined): boolean {
  if (!t || !adminEnabled()) return false;
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const want = sign(exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
export async function isAdmin(): Promise<boolean> { return validToken((await cookies()).get(COOKIE)?.value); }
export const cookieOpts = (secure: boolean) => ({ httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 7 * 86400 });
export const isSecure = (req: Request) => (req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(":", "")) === "https";
/** Public origin behind Railway's proxy. */
export function origin(req: Request): string {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return `${proto}://${host}`;
}
