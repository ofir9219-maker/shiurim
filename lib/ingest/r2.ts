import fs from "node:fs";
import { DeleteObjectsCommand, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getR2Client, r2Bucket } from "../audio";
import { CT_BY_EXT } from "../r2-sync";
import path from "node:path";

export const r2Ready = () => !!(getR2Client() && r2Bucket());
export const publicUrl = (key: string) => {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!base) throw new Error("R2_PUBLIC_BASE_URL no configurada (Fal necesita una URL pública)");
  return `${base.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
};
export async function r2Size(key: string): Promise<number | null> {
  try { return (await getR2Client()!.send(new HeadObjectCommand({ Bucket: r2Bucket(), Key: key }))).ContentLength ?? null; } catch { return null; }
}
export async function r2Put(key: string, file: string, contentType?: string): Promise<void> {
  const client = getR2Client(); if (!client) throw new Error("R2 no configurado");
  await new Upload({
    client, queueSize: 3, partSize: 16 * 1024 * 1024,
    params: { Bucket: r2Bucket(), Key: key, Body: fs.createReadStream(file), ContentType: contentType ?? CT_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream" },
  }).done();
}
export async function r2DeletePrefix(prefix: string): Promise<void> {
  const client = getR2Client(); if (!client) return;
  const r = await client.send(new ListObjectsV2Command({ Bucket: r2Bucket(), Prefix: prefix }));
  const objs = (r.Contents ?? []).filter((o) => o.Key).map((o) => ({ Key: o.Key! }));
  if (objs.length) await client.send(new DeleteObjectsCommand({ Bucket: r2Bucket(), Delete: { Objects: objs } }));
}
