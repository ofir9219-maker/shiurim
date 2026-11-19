// R2 audio mirror.
// - r2KeyFor(id): canonical object key for a class audio: `shiurim/<driveId><ext>`.
// - existingKeys(): cached set of keys present in the bucket (refreshed every 10 min).
// - startBackgroundUpload(): copies every inventory audio that is missing from R2, streaming
//   Drive -> R2 (multipart), 2 at a time. Idempotent; runs once per server start unless R2_AUTO_UPLOAD=0.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getR2Client, r2Bucket, driveDownloadUrl } from "./audio";
import { storageInventory } from "./storage";

type Inv = { id: string; name: string; ext: string; mimeType: string; sizeBytes: number };
const PREFIX = "shiurim/";
const EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/wav": ".wav", "audio/x-wav": ".wav",
  "audio/ogg": ".ogg", "audio/aac": ".aac", "audio/flac": ".flac",
};
export const CT_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".ogg": "audio/ogg", ".aac": "audio/aac", ".flac": "audio/flac",
};

// Repo inventory only: the background uploader mirrors the original 82 from Drive. Classes added by the
// ingest pipeline are uploaded by the pipeline itself (storage inventory), so they are only used for key lookup.
function inventory(): Inv[] {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "inventory.json"), "utf8")); } catch { return []; }
}
export function extOf(c: Pick<Inv, "ext" | "mimeType">): string {
  const e = (c.ext || "").toLowerCase();
  return /^\.(mp3|m4a|wav|ogg|aac|flac)$/.test(e) ? e : EXT_BY_MIME[c.mimeType] ?? ".m4a";
}
/** Canonical R2 key for an audio (same rule for repo and ingested classes). */
export const r2ObjectKey = (c: Pick<Inv, "id" | "ext" | "mimeType">) => `${PREFIX}${c.id}${extOf(c)}`;
export function r2KeyFor(id: string): string | null {
  const c = inventory().find((x) => x.id === id) ?? (storageInventory().find((x) => x.id === id) as Inv | undefined);
  return c ? `${PREFIX}${c.id}${extOf(c)}` : null;
}

let cache: { at: number; keys: Set<string> } | null = null;
export async function existingKeys(force = false): Promise<Set<string>> {
  const client = getR2Client(); const bucket = r2Bucket();
  if (!client || !bucket) return new Set();
  if (!force && cache && Date.now() - cache.at < 10 * 60_000) return cache.keys;
  const keys = new Set<string>(); let token: string | undefined;
  try {
    do {
      const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: PREFIX, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key && (o.Size ?? 0) > 0) keys.add(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    cache = { at: Date.now(), keys };
  } catch (e) {
    console.log("r2: list failed:", (e as Error).message);
    return cache?.keys ?? new Set();
  }
  return keys;
}

let started = false;
export function startBackgroundUpload() {
  if (started || process.env.R2_AUTO_UPLOAD === "0") return;
  const client = getR2Client(); const bucket = r2Bucket();
  if (!client || !bucket) return;
  started = true;
  (async () => {
    const have = await existingKeys(true);
    const todo = inventory().filter((c) => !have.has(`${PREFIX}${c.id}${extOf(c)}`));
    console.log(`r2-upload: ${have.size} already in bucket, ${todo.length} to upload`);
    let i = 0, ok = 0, fail = 0;
    const worker = async () => {
      while (i < todo.length) {
        const c = todo[i++]; const key = `${PREFIX}${c.id}${extOf(c)}`;
        try {
          const res = await fetch(driveDownloadUrl(c.id));
          if (!res.ok || !res.body) throw new Error(`drive HTTP ${res.status}`);
          if ((res.headers.get("content-type") || "").includes("text/html")) throw new Error("drive returned HTML (quota/permission)");
          const up = new Upload({
            client, queueSize: 3, partSize: 16 * 1024 * 1024,
            params: { Bucket: bucket, Key: key, Body: Readable.fromWeb(res.body as never), ContentType: CT_BY_EXT[extOf(c)] ?? "application/octet-stream" },
          });
          await up.done(); ok++;
          console.log(`r2-upload: ok ${ok + fail}/${todo.length} ${key}`);
        } catch (e) {
          fail++; console.log(`r2-upload: FAIL ${key}: ${(e as Error).message}`);
        }
      }
    };
    await Promise.all([worker(), worker()]);
    await existingKeys(true);
    console.log(`r2-upload: done, ok=${ok} fail=${fail}`);
  })().catch((e) => console.log("r2-upload: aborted:", e?.message ?? e));
}
