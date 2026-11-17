// Detect new audio files in the Drive folder and append them to data/inventory.json.
// Usage: npm run sync [-- --write] [-- --upload-r2]   (default is dry-run: nothing is written)
// Auth: GOOGLE_API_KEY (public/link-shared folder) or GOOGLE_SERVICE_ACCOUNT_JSON (service-account key JSON, inline or file path).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setupProxy } from "../lib/proxy";
import { driveDownloadUrl, getR2Client } from "../lib/audio";
import { Upload } from "@aws-sdk/lib-storage";

setupProxy();
const FOLDER = process.env.DRIVE_FOLDER_ID || "1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5";
const write = process.argv.includes("--write");
const uploadR2 = process.argv.includes("--upload-r2");
const invPath = path.join(process.cwd(), "data", "inventory.json");

type DriveFile = { id: string; name: string; mimeType: string; size?: string; videoMediaMetadata?: { durationMillis?: string } };

async function getToken(): Promise<string | null> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const sa = JSON.parse(raw.trim().startsWith("{") ? raw : fs.readFileSync(raw, "utf8"));
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: "RS256", typ: "JWT" }) + "." + b64({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/drive.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  });
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + sig }),
  });
  if (!res.ok) throw new Error("token HTTP " + res.status);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function listFolder(): Promise<DriveFile[]> {
  const token = await getToken();
  const key = process.env.GOOGLE_API_KEY;
  if (!token && !key) throw new Error("Set GOOGLE_API_KEY or GOOGLE_SERVICE_ACCOUNT_JSON to list the Drive folder.");
  const out: DriveFile[] = [];
  let pageToken = "";
  do {
    const u = new URL("https://www.googleapis.com/drive/v3/files");
    u.searchParams.set("q", `'${FOLDER}' in parents and trashed=false`);
    u.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,size,videoMediaMetadata(durationMillis))");
    u.searchParams.set("pageSize", "1000");
    u.searchParams.set("supportsAllDrives", "true");
    u.searchParams.set("includeItemsFromAllDrives", "true");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    if (!token) u.searchParams.set("key", key!);
    const res = await fetch(u, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error(`Drive list HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { files: DriveFile[]; nextPageToken?: string };
    out.push(...j.files);
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function main() {
  const inv: Record<string, unknown>[] = JSON.parse(fs.readFileSync(invPath, "utf8"));
  const known = new Set(inv.map((i) => i.id as string));
  const files = await listFolder();
  const audios = files.filter((f) => f.mimeType.startsWith("audio/") || /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.name));
  const fresh = audios.filter((f) => !known.has(f.id));
  console.log(`Drive audios: ${audios.length}; in inventory: ${inv.length}; new: ${fresh.length}`);
  for (const f of fresh) {
    const ext = (f.name.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase();
    const order = f.name.match(/^\s*(\d+(?:\.\d+)*)/)?.[1] ?? "";
    const entry = {
      id: f.id, name: f.name, order, ext, mimeType: f.mimeType, sizeBytes: Number(f.size || 0),
      durationMs: Number(f.videoMediaMetadata?.durationMillis || 0), mdId: null, mdName: null, transcript: "none", inShiurim: false,
    };
    console.log(`  NEW ${f.id}  ${f.name}  -> needs transcription`);
    inv.push(entry);
  }
  if (fresh.length && write) {
    fs.writeFileSync(invPath, JSON.stringify(inv, null, 2));
    console.log(`Appended ${fresh.length} to data/inventory.json. Run: npm run build:db`);
  } else if (fresh.length) console.log("Dry run: pass --write to append to data/inventory.json.");

  if (uploadR2) {
    const s3 = getR2Client(); const bucket = process.env.R2_BUCKET;
    if (!s3 || !bucket) { console.log("--upload-r2: R2 credentials missing (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET)."); return; }
    const mapPath = path.join(process.cwd(), "data", "r2-keys.json");
    const map: Record<string, string> = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, "utf8")) : {};
    for (const f of audios) {
      const ext = (f.name.match(/\.[a-z0-9]+$/i)?.[0] || ".m4a").toLowerCase();
      const key = `audio/${f.id}${ext}`;
      if (map[f.id]) continue;
      if (!write) { console.log(`  would upload ${f.id} -> ${key}`); continue; }
      const res = await fetch(driveDownloadUrl(f.id));
      if (!res.ok || !res.body) { console.log(`  skip ${f.id}: HTTP ${res.status}`); continue; }
      const { Readable } = await import("node:stream");
      await new Upload({ client: s3, params: { Bucket: bucket, Key: key, Body: Readable.fromWeb(res.body as never), ContentType: f.mimeType } }).done();
      map[f.id] = key;
      fs.writeFileSync(mapPath, JSON.stringify(map, null, 2));
      console.log(`  uploaded ${f.id} -> ${key}`);
    }
    if (!write) console.log("Dry run: pass --write with --upload-r2 to actually upload.");
  }
}
main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
