// Google Drive access as the user (OAuth refresh token stored in $STORAGE_DIR), plain REST via fetch.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { STORAGE_DIR, readJson, writeJson } from "../storage";
import { fetchRetry, okJson, HttpError } from "./http";

export const SCOPE = "https://www.googleapis.com/auth/drive";
export const FOLDER_ID = () => process.env.DRIVE_FOLDER_ID || "1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5";
const TOKEN_FILE = () => path.join(STORAGE_DIR, "google-token.json");
const API = "https://www.googleapis.com/drive/v3";

export type DriveFile = { id: string; name: string; mimeType: string; size?: string; modifiedTime?: string; parents?: string[]; videoMediaMetadata?: { durationMillis?: string } };
type TokenFile = { refresh_token: string; email?: string; scope?: string; savedAt: string };

export const oauthConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const loadToken = (): TokenFile | null => readJson<TokenFile | null>(TOKEN_FILE(), null);
export function saveToken(t: TokenFile) {
  writeJson(TOKEN_FILE(), t, 0o600);
  try { fs.chmodSync(TOKEN_FILE(), 0o600); } catch { /* ignore */ }
  cached = null;
}
export const driveConnected = () => !!loadToken()?.refresh_token || !!process.env.GOOGLE_REFRESH_TOKEN;

export function authUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || "", redirect_uri: redirectUri, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}
export async function exchangeCode(code: string, redirectUri: string): Promise<{ refresh_token?: string; access_token: string; scope?: string }> {
  const r = await fetchRetry("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  return okJson(r, "google token exchange");
}

let cached: { token: string; exp: number } | null = null;
export async function accessToken(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const refresh = loadToken()?.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;
  if (!refresh) throw new Error("Google Drive no conectado (falta refresh token)");
  const r = await fetchRetry("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const j = await okJson<{ access_token: string; expires_in: number }>(r, "google token refresh");
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}
async function gfetch(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetchRetry(url, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${await accessToken()}` } });
  if (r.status === 401) cached = null;
  return r;
}
export async function userEmail(): Promise<string | undefined> {
  try { return (await okJson<{ user?: { emailAddress?: string } }>(await gfetch(`${API}/about?fields=user`), "about")).user?.emailAddress; } catch { return undefined; }
}

export const AUDIO_EXT = /\.(m4a|mp3|wav|ogg|aac|flac|opus|mp4|wma)$/i;
export const isAudio = (f: Pick<DriveFile, "name" | "mimeType">) => f.mimeType.startsWith("audio/") || (AUDIO_EXT.test(f.name) && !f.mimeType.includes("folder"));

export async function listFolder(folderId = FOLDER_ID()): Promise<DriveFile[]> {
  const out: DriveFile[] = []; let pageToken = "";
  do {
    const q = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false`, fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)",
      pageSize: "1000", supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}),
    });
    const j = await okJson<{ files: DriveFile[]; nextPageToken?: string }>(await gfetch(`${API}/files?${q}`), "drive list");
    out.push(...j.files); pageToken = j.nextPageToken || "";
  } while (pageToken);
  return out;
}
export async function getMeta(id: string): Promise<DriveFile> {
  return okJson(await gfetch(`${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents,videoMediaMetadata(durationMillis)&supportsAllDrives=true`), "drive get");
}
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const isFolder = (f: Pick<DriveFile, "mimeType">) => f.mimeType === FOLDER_MIME;
const FIELDS = "nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,videoMediaMetadata(durationMillis))";
/** All children of a folder (every page), folders first then by name. */
export async function listChildren(folderId: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []; let pageToken = "";
  do {
    const q = new URLSearchParams({ q: `'${folderId}' in parents and trashed=false`, fields: FIELDS, pageSize: "1000", orderBy: "folder,name_natural", supportsAllDrives: "true", includeItemsFromAllDrives: "true", ...(pageToken ? { pageToken } : {}) });
    const j = await okJson<{ files: DriveFile[]; nextPageToken?: string }>(await gfetch(`${API}/files?${q}`), "drive list");
    out.push(...j.files); pageToken = j.nextPageToken || "";
  } while (pageToken && out.length < 20000);
  return out;
}
/** Name search anywhere in the user's Drive (caller filters by ancestry). */
export async function searchByName(text: string, limit = 60): Promise<DriveFile[]> {
  const q = new URLSearchParams({ q: `name contains '${esc(text)}' and trashed=false`, fields: FIELDS, pageSize: String(limit), supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  return (await okJson<{ files: DriveFile[] }>(await gfetch(`${API}/files?${q}`), "drive search")).files;
}
/** Short-lived bearer for ffmpeg/ffprobe reading a Drive file by URL. */
export const mediaUrl = (id: string) => `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
export const bearer = accessToken;
export async function downloadToFile(id: string, dest: string): Promise<number> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await gfetch(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  if (!r.ok || !r.body) throw new HttpError(r.status, `drive download ${id}: HTTP ${r.status}`);
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(r.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  return fs.statSync(dest).size;
}
export async function renameFile(id: string, name: string): Promise<void> {
  await okJson(await gfetch(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
  }), "drive rename");
}
function multipart(meta: object, body: string, mime: string) {
  const b = `ingest${crypto.randomBytes(8).toString("hex")}`;
  return {
    boundary: b,
    body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${body}\r\n--${b}--`,
  };
}
function esc(s: string) { return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'"); }
/** Create `<name>` in the folder with text content; if a file with that exact name exists (retry) its content is replaced. */
export async function createTextFile(folderId: string, name: string, content: string, mime = "text/markdown"): Promise<string> {
  const q = new URLSearchParams({ q: `'${folderId}' in parents and name='${esc(name)}' and trashed=false`, fields: "files(id)", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  const ex = await okJson<{ files: { id: string }[] }>(await gfetch(`${API}/files?${q}`), "drive find");
  const m = multipart(ex.files.length ? { name } : { name, parents: [folderId], mimeType: mime }, content, mime);
  const url = ex.files.length
    ? `https://www.googleapis.com/upload/drive/v3/files/${ex.files[0].id}?uploadType=multipart&supportsAllDrives=true&fields=id`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id`;
  const j = await okJson<{ id: string }>(await gfetch(url, {
    method: ex.files.length ? "PATCH" : "POST", headers: { "content-type": `multipart/related; boundary=${m.boundary}` }, body: m.body,
  }), "drive create md");
  return j.id;
}

/** Replace the content of an existing text file. */
export async function updateTextFile(id: string, content: string, mime = "text/markdown"): Promise<void> {
  const m = multipart({}, content, mime);
  await okJson(await gfetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=multipart&supportsAllDrives=true&fields=id`, {
    method: "PATCH", headers: { "content-type": `multipart/related; boundary=${m.boundary}` }, body: m.body,
  }), "drive update");
}
export async function readTextFile(id: string): Promise<string> {
  const r = await gfetch(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  if (!r.ok) throw new HttpError(r.status, `drive read ${id}: HTTP ${r.status}`);
  return r.text();
}
