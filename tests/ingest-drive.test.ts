import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ingest-t-"));
process.env.GOOGLE_REFRESH_TOKEN = "rt"; process.env.GOOGLE_CLIENT_ID = "id"; process.env.GOOGLE_CLIENT_SECRET = "sec";
const calls: { url: string; method: string; body?: string }[] = [];
let listing: { id: string; name: string; mimeType: string; size?: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url); calls.push({ url: u, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
  const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "content-type": "application/json" } });
  if (u.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "at", expires_in: 3600 });
  if (u.includes("/upload/drive/v3/files")) return json({ id: "NEWMD" });
  if (u.includes("/drive/v3/files?") && u.includes("name%3D")) return json({ files: [] });
  if (u.includes("/drive/v3/files?")) return json({ files: listing });
  if (u.includes("/drive/v3/files/")) return json({ id: "x", name: "n" });
  return realFetch(url as never, init);
}) as typeof fetch;

test("drive: list, rename, create md (multipart, parents)", async () => {
  const d = await import("../lib/ingest/drive");
  listing = [{ id: "a", name: "1. x.m4a", mimeType: "audio/mp4" }, { id: "b", name: "n.md", mimeType: "text/markdown" }];
  const files = await d.listFolder("FOLDER");
  assert.equal(files.length, 2); assert.deepEqual(files.filter(d.isAudio).map((f) => f.id), ["a"]);
  assert.ok(d.isAudio({ name: "voice.WAV", mimeType: "application/octet-stream" }));
  assert.ok(decodeURIComponent(calls.find((c) => c.url.includes("/drive/v3/files?"))!.url.replace(/\+/g, " ")).includes("'FOLDER' in parents"));
  await d.renameFile("a", "2. y.m4a");
  const ren = calls.find((c) => c.method === "PATCH")!; assert.match(ren.url, /files\/a\?/); assert.equal(JSON.parse(ren.body!).name, "2. y.m4a");
  const id = await d.createTextFile("FOLDER", "t.md", "# hola");
  assert.equal(id, "NEWMD");
  const up = calls.find((c) => c.url.includes("uploadType=multipart"))!;
  assert.equal(up.method, "POST"); assert.match(up.body!, /"parents":\["FOLDER"\]/); assert.match(up.body!, /# hola/);
});

test("scheduler: detects new audio only after 2 stable polls, order from name", async () => {
  const { scheduler } = await import("../lib/ingest/scheduler");
  const s = scheduler();
  listing = [{ id: "NEW1", name: "88. algo.m4a", mimeType: "audio/mp4", size: "1000" }, { id: "NEW2", name: "sin numero.mp3", mimeType: "audio/mpeg", size: "50" },
    { id: "14P9ahb9tVfKliOgcfW-1yFlyErv35s1h", name: "1. Berajot Kolel - Rashi Tosafot, Plag haminja.m4a", mimeType: "audio/mp4", size: "41983531" }, { id: "doc", name: "x.md", mimeType: "text/markdown", size: "5" }];
  let r = await s.poll(); assert.equal(r.newFiles, 0); assert.deepEqual(Object.keys(s.state.items), []);
  listing[1].size = "60"; // NEW2 still uploading
  r = await s.poll(); assert.equal(r.newFiles, 1);
  assert.equal(s.state.items.NEW1.order, "88"); assert.equal(s.state.items.NEW1.ext, ".m4a"); assert.equal(s.state.items.NEW1.state, "detected");
  assert.ok(!s.state.items["14P9ahb9tVfKliOgcfW-1yFlyErv35s1h"]); // already in repo inventory
  r = await s.poll(); assert.equal(r.newFiles, 1);
  assert.equal(s.state.items.NEW2.order, "89"); // next after max existing (88 is in-flight; repo max is 82+)
  r = await s.poll(); assert.equal(r.newFiles, 0); // not re-queued
  assert.ok(fs.existsSync(path.join(process.env.STORAGE_DIR!, "ingest", "state.json")));
});
