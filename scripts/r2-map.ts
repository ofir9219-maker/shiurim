// Map each class audio to its object key in the existing R2 bucket → data/r2-keys.json ({ driveId: key }).
// Runs at build time (Railway has the R2 env vars). Matching, in order:
//   1) key contains the Drive file id
//   2) key basename (normalized) equals the original Drive name or the new polished name
// Unmatched classes keep streaming through the /api/audio Drive proxy. Never fails the build.
import fs from "node:fs";
import path from "node:path";
import { ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getR2Client, r2Bucket } from "../lib/audio";

const root = process.cwd();
const norm = (s: string) =>
  s.normalize("NFC").replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[״"”“]/g, "''").replace(/[׳’']/g, "'")
    .replace(/[_\s]+/g, " ").trim().toLowerCase();

async function main() {
  const client = getR2Client();
  const bucket = r2Bucket();
  if (!client || !bucket) { console.log("r2-map: no R2 credentials/bucket, skipping"); return; }
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const r = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key && /\.(m4a|mp3|wav|ogg|aac|opus|webm)$/i.test(o.Key)) keys.push(o.Key);
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);

  const inv: { id: string; name: string }[] = JSON.parse(fs.readFileSync(path.join(root, "data", "inventory.json"), "utf8"));
  const byBase = new Map<string, string>();
  for (const k of keys) byBase.set(norm(path.basename(k)), k);
  const map: Record<string, string> = {};
  for (const c of inv) {
    let k = keys.find((x) => x.includes(c.id));
    if (!k) {
      const pf = path.join(root, "data", "polished", `${c.id}.json`);
      const newName = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, "utf8")).newName : undefined;
      k = byBase.get(norm(c.name)) ?? (newName ? byBase.get(norm(newName)) : undefined);
    }
    if (k) map[c.id] = k;
  }
  fs.writeFileSync(path.join(root, "data", "r2-keys.json"), JSON.stringify(map, null, 1));
  console.log(`r2-map: ${keys.length} audio objects in bucket, matched ${Object.keys(map).length}/${inv.length} classes`);
  const miss = inv.filter((c) => !map[c.id]).map((c) => c.name);
  if (miss.length) console.log("r2-map: unmatched (served via Drive proxy):", miss.slice(0, 20).join(" | "));
}
main().catch((e) => console.log("r2-map: skipped due to error:", e?.message ?? e));
