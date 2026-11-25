// Mocked Drive + Fal + R2 for end-to-end tests (no network access to those services). OpenAI/Sefaria go to the real network.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

export type MFile = { id: string; name: string; mimeType: string; parents: string[]; size?: string; content?: Buffer };
export const world = {
  files: new Map<string, MFile>(),
  falCalls: [] as { model: string; body: Record<string, unknown> }[],
  falResults: {} as Record<string, unknown>,   // by model id
  r2: new Map<string, number>(),
  calls: [] as { url: string; method: string }[],
};
export const FOLDER = "application/vnd.google-apps.folder";
export function addFolder(id: string, name: string, parent: string | null) { world.files.set(id, { id, name, mimeType: FOLDER, parents: parent ? [parent] : [] }); }
export function addAudio(id: string, name: string, parent: string, content: Buffer) { world.files.set(id, { id, name, mimeType: "audio/mpeg", parents: [parent], size: String(content.length), content }); }
export const children = (parent: string) => [...world.files.values()].filter((f) => f.parents.includes(parent));
export const byName = (parent: string, name: string) => children(parent).find((f) => f.name === name);
export const text = (f?: MFile) => (f?.content ? f.content.toString("utf8") : undefined);

export function makeMp3(seconds: number): Buffer {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mp3-")), "t.mp3");
  const ff = (createRequire(import.meta.url)("ffmpeg-static") as string);
  const r = spawnSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ac", "1", "-b:a", "32k", out]);
  if (r.status !== 0) throw new Error("ffmpeg no disponible: " + r.stderr);
  return fs.readFileSync(out);
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
export function installFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = String(input instanceof Request ? input.url : input); const method = (init?.method ?? "GET").toUpperCase();
    const url = new URL(u);
    world.calls.push({ url: u, method });
    if (url.host === "oauth2.googleapis.com") return json({ access_token: "at", expires_in: 3600 });
    if (url.host === "queue.fal.run") {
      const model = url.pathname.slice(1); world.falCalls.push({ model, body: JSON.parse(String(init!.body)) });
      return json({ request_id: "r1", status_url: `https://fal.test/s/${model}`, response_url: `https://fal.test/r/${model}` });
    }
    if (url.host === "fal.test") {
      if (url.pathname.startsWith("/s/")) return json({ status: "COMPLETED" });
      const model = url.pathname.slice(3); if (!world.falResults[model]) return json({ error: "no fixture" }, 500);
      return json(world.falResults[model]);
    }
    if (url.host === "www.googleapis.com") return drive(url, method, init);
    return real(input as never, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

function parseMultipart(body: string): { meta: Record<string, unknown>; content: string } {
  const b = body.slice(2, body.indexOf("\r\n")); // --boundary
  const parts = body.split(`--${b}`).filter((p) => p.trim() && p.trim() !== "--");
  const split = (p: string) => p.slice(p.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
  return { meta: JSON.parse(split(parts[0])), content: parts[1] ? split(parts[1]) : "" };
}
function listing(f: MFile) { return { id: f.id, name: f.name, mimeType: f.mimeType, size: f.size, parents: f.parents }; }
async function drive(url: URL, method: string, init?: RequestInit): Promise<Response> {
  const p = url.pathname;
  if (p === "/drive/v3/files" && method === "GET") {
    const q = url.searchParams.get("q") ?? ""; const par = q.match(/'([^']+)' in parents/)?.[1]; const nm = q.match(/name='((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, "$1");
    let r = par ? children(par) : [...world.files.values()];
    if (nm) r = r.filter((f) => f.name === nm);
    const c = q.match(/name contains '([^']+)'/)?.[1]; if (c) r = r.filter((f) => f.name.includes(c));
    r.sort((a, b) => Number(b.mimeType === FOLDER) - Number(a.mimeType === FOLDER) || a.name.localeCompare(b.name));
    return json({ files: r.map(listing) });
  }
  if (p === "/upload/drive/v3/files" && method === "POST") {
    const { meta, content } = parseMultipart(String(init!.body));
    const f: MFile = { id: "U" + crypto.randomBytes(4).toString("hex"), name: String(meta.name), mimeType: String(meta.mimeType ?? "text/plain"), parents: (meta.parents as string[]) ?? [], content: Buffer.from(content) };
    world.files.set(f.id, f); return json({ id: f.id });
  }
  const m = p.match(/^\/(upload\/)?drive\/v3\/files\/([^/]+)$/);
  if (m) {
    const f = world.files.get(decodeURIComponent(m[2])); if (!f) return json({ error: "nf" }, 404);
    if (m[1] && method === "PATCH") { f.content = Buffer.from(parseMultipart(String(init!.body)).content); return json({ id: f.id }); }
    if (method === "PATCH") { const b = JSON.parse(String(init!.body)); if (b.name) f.name = b.name; return json({ id: f.id, name: f.name }); }
    if (url.searchParams.get("alt") === "media") return new Response(new Uint8Array(f.content ?? Buffer.alloc(0)), { status: 200 });
    return json(listing(f));
  }
  return json({ error: "unmocked " + p }, 500);
}
export function mockR2() {
  return {
    async put(key: string, file: string) { world.r2.set(key, fs.statSync(file).size); },
    async size(key: string) { return world.r2.get(key) ?? null; },
    async deletePrefix(prefix: string) { for (const k of [...world.r2.keys()]) if (k.startsWith(prefix)) world.r2.delete(k); },
  };
}
