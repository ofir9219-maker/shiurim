// Zone access token: ONE secret path segment (/ia/<token>) that authorizes everything under the AI work zone.
// Only the sha256 is needed to verify; an AES-GCM copy (key derived from ADMIN_PASSWORD) lets the admin copy the link again later.
// Env AI_ZONE_TOKEN overrides the stored token (e.g. a fixed value set on Railway).
import crypto from "node:crypto";
import path from "node:path";
import { STORAGE_DIR, readJson, writeJson } from "../storage";

export const ZONE_DIR = () => path.join(STORAGE_DIR, "ai-zone");
const FILE = () => path.join(ZONE_DIR(), "token.json");
type Stored = { hash: string; createdAt: string; enc?: { iv: string; tag: string; data: string } };

export const sha256 = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const newToken = () => crypto.randomBytes(32).toString("base64url");
const key = () => crypto.createHash("sha256").update(`shiurim-zone:${process.env.ADMIN_PASSWORD || ""}`).digest();
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export const envToken = () => (process.env.AI_ZONE_TOKEN || "").trim();
export const publicBase = () => (process.env.PUBLIC_BASE_URL || "https://ofirsegal.app").replace(/\/$/, "");

function seal(token: string): Stored["enc"] | undefined {
  if (!process.env.ADMIN_PASSWORD) return undefined;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(token, "utf8"), c.final()]);
  return { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
}
function unseal(e: NonNullable<Stored["enc"]>): string | null {
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(e.iv, "base64")); d.setAuthTag(Buffer.from(e.tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(e.data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}

/** Creates (or rotates) the stored zone token and returns the plain value (shown once, or copyable while ADMIN_PASSWORD is unchanged). */
export function regenerateToken(): string {
  const t = newToken();
  writeJson(FILE(), { hash: sha256(t), createdAt: new Date().toISOString(), enc: seal(t) } satisfies Stored, 0o600);
  return t;
}
/** Plain token for the admin's "copy link" button (creates one the first time). null when it cannot be recovered (password changed). */
export function currentToken(): string | null {
  if (envToken()) return envToken();
  const s = readJson<Stored | null>(FILE(), null);
  if (!s) return regenerateToken();
  const t = s.enc ? unseal(s.enc) : null;
  return t && eq(sha256(t), s.hash) ? t : null;
}
export function verifyToken(t: string | undefined | null): boolean {
  if (!t || t.length < 20 || t.length > 200) return false;
  if (envToken()) return eq(t, envToken());
  const s = readJson<Stored | null>(FILE(), null);
  return !!s && eq(sha256(t), s.hash);
}
export const tokenSource = (): "env" | "stored" => (envToken() ? "env" : "stored");
export const zoneUrl = (token: string, base = publicBase()) => `${base}/ia/${token}`;
export const tokenCreatedAt = () => readJson<Stored | null>(FILE(), null)?.createdAt ?? null;
