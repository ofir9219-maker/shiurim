import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const driveDownloadUrl = (id: string) =>
  `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`;

let _s3: S3Client | null = null;
function s3(): S3Client | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return (_s3 ??= new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  }));
}
export const getR2Client = s3;

/**
 * Best playable URL for an audio: R2 public base -> R2 presigned -> local proxy /api/audio/[id].
 * Only the R2 variants need r2Key (falls back to `${id}.<ext>` is NOT guessed; no key => proxy).
 */
export async function audioUrlFor(id: string, r2Key?: string | null): Promise<string> {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (r2Key && base) return `${base.replace(/\/$/, "")}/${r2Key.split("/").map(encodeURIComponent).join("/")}`;
  const client = s3();
  const bucket = process.env.R2_BUCKET;
  if (r2Key && client && bucket) {
    try {
      return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: r2Key }), { expiresIn: 6 * 3600 });
    } catch { /* fall through */ }
  }
  return `/api/audio/${encodeURIComponent(id)}`;
}
