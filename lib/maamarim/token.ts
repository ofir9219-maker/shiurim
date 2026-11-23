// Secret token for the maamarim upload API / MCP connector (one path segment, like the AI zone).
// Only the sha256 is needed to verify; an AES-GCM copy (key from ADMIN_PASSWORD) lets the admin copy the link again.
// Env MAAMARIM_TOKEN overrides the stored token.
import crypto from "node:crypto";
import path from "node:path";
import { readJson, writeJson } from "../storage";
import { MAAMARIM_DIR } from "./store";

const FILE = () => path.join(MAAMARIM_DIR(), "token.json");
type Stored = { hash: string; createdAt: string; enc?: { iv: string; tag: string; data: string } };
const sha256 = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
const key = () => crypto.createHash("sha256").update(`shiurim-maamarim:${process.env.ADMIN_PASSWORD || ""}`).digest();
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const envToken = () => (process.env.MAAMARIM_TOKEN || "").trim();
export const publicBase = () => (process.env.PUBLIC_BASE_URL || "https://ofirsegal.app").replace(/\/$/, "");

export function regenerateMaamarToken(): string {
  const t = crypto.randomBytes(32).toString("base64url");
  let enc: Stored["enc"];
  if (process.env.ADMIN_PASSWORD) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
    const data = Buffer.concat([c.update(t, "utf8"), c.final()]);
    enc = { iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64") };
  }
  writeJson(FILE(), { hash: sha256(t), createdAt: new Date().toISOString(), enc } satisfies Stored, 0o600);
  return t;
}
export function currentMaamarToken(): string | null {
  if (envToken()) return envToken();
  const s = readJson<Stored | null>(FILE(), null);
  if (!s) return regenerateMaamarToken();
  if (!s.enc) return null;
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(s.enc.iv, "base64")); d.setAuthTag(Buffer.from(s.enc.tag, "base64"));
    const t = Buffer.concat([d.update(Buffer.from(s.enc.data, "base64")), d.final()]).toString("utf8");
    return eq(sha256(t), s.hash) ? t : null;
  } catch { return null; }
}
export function verifyMaamarToken(t: string | undefined | null): boolean {
  if (!t || t.length < 20 || t.length > 200) return false;
  if (envToken()) return eq(t, envToken());
  const s = readJson<Stored | null>(FILE(), null);
  return !!s && eq(sha256(t), s.hash);
}
export const mcpUrl = (t: string) => `${publicBase()}/api/maamarim/mcp/${t}`;
export const uploadUrl = (t: string) => `${publicBase()}/api/maamarim/upload/${t}`;
