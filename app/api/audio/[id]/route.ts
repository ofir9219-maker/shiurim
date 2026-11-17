import { setupProxy } from "../../../../lib/proxy";
import { driveDownloadUrl } from "../../../../lib/audio";
import { getClass } from "../../../../lib/db";

export const dynamic = "force-dynamic";

const PASS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[\w-]{10,80}$/.test(id)) return new Response("bad id", { status: 400 });
  setupProxy();
  const headers: Record<string, string> = {};
  const range = req.headers.get("range");
  if (range) headers.range = range;
  let up: Response;
  try {
    up = await fetch(driveDownloadUrl(id), { headers, redirect: "follow", signal: req.signal });
  } catch {
    return new Response("upstream error", { status: 502 });
  }
  if (up.status >= 400 || !up.body) return new Response("upstream " + up.status, { status: up.status === 404 ? 404 : 502 });
  const h = new Headers();
  for (const k of PASS) { const v = up.headers.get(k); if (v) h.set(k, v); }
  // Drive often serves octet-stream; prefer the inventory's real type.
  const ct = h.get("content-type") || "";
  if (!ct.startsWith("audio/")) {
    const ext = (getClass(id)?.file_name || "").match(/\.(\w+)$/)?.[1]?.toLowerCase();
    h.set("content-type", ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/mp4");
  }
  if (!h.has("accept-ranges")) h.set("accept-ranges", "bytes");
  h.set("cache-control", "public, max-age=3600");
  return new Response(up.body, { status: up.status, headers: h });
}
