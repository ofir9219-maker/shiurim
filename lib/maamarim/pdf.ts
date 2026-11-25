// Maamar PDFs: R2 (maamarim/<id>.pdf, public URL) when configured, else the volume ($STORAGE_DIR/maamarim/pdf).
import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getR2Client, r2Bucket } from "../audio";
import { MAAMARIM_DIR, getMaamar, patchMaamar } from "./store";

const MAX = 40 * 1024 * 1024;
const localFile = (id: string) => path.join(MAAMARIM_DIR(), "pdf", `${id}.pdf`);
export const isPdf = (b: Buffer) => b.length > 8 && b.subarray(0, 5).toString("latin1") === "%PDF-";

export async function savePdf(id: string, buf: Buffer): Promise<{ key: string; size: number; url?: string }> {
  if (!getMaamar(id)) throw new Error("maamar no encontrado");
  if (!isPdf(buf)) throw new Error("el archivo no es un PDF");
  if (buf.length > MAX) throw new Error("PDF demasiado grande (máx. 40 MB)");
  const key = `maamarim/${id}.pdf`;
  const client = getR2Client(); const bucket = r2Bucket();
  let url: string | undefined;
  if (client && bucket && process.env.R2_PUBLIC_BASE_URL) {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: "application/pdf", CacheControl: "public, max-age=300" }));
    url = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}?v=${Date.now().toString(36)}`;
  } else {
    fs.mkdirSync(path.dirname(localFile(id)), { recursive: true });
    fs.writeFileSync(localFile(id), buf);
  }
  const pdf = { key, size: buf.length, url };
  patchMaamar(id, { pdf });
  return pdf;
}
export async function removePdf(id: string) {
  const m = getMaamar(id); if (!m?.pdf) return;
  try { const c = getR2Client(); if (c && r2Bucket() && m.pdf.url) await c.send(new DeleteObjectCommand({ Bucket: r2Bucket(), Key: m.pdf.key })); } catch { /* ignore */ }
  try { fs.rmSync(localFile(id), { force: true }); } catch { /* ignore */ }
  patchMaamar(id, { pdf: null });
}
export function readLocalPdf(id: string): Buffer | null { try { return fs.readFileSync(localFile(id)); } catch { return null; } }
