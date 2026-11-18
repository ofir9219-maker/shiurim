import { NextResponse } from "next/server";
import { undoRename } from "./undo";
import { readRenameLog } from "./rename-log";
import * as packages from "./packages";
import * as drive from "../ingest/drive";
import { scheduler } from "../ingest/scheduler";

const err = (e: unknown, status = 400) => NextResponse.json({ error: (e as Error).message ?? String(e) }, { status });
/** Extra admin operations: rename undo and AI packages. Returns null when the op is not handled. */
export async function templateApi(op: string[], url: URL | null, body: any): Promise<NextResponse | null> {
  const key = op.join("/");
  try {
    if (key === "undo-rename" && body) return NextResponse.json({ ok: true, ...(await undoRename(String(body.id))) });
    if (key === "renames" && url) return NextResponse.json({ renames: readRenameLog().filter((e) => e.audioId === url.searchParams.get("id")).slice(-30) });
    if (key === "packages" && url) {
      const items = scheduler().state.items;
      const list = packages.listPackages().filter((p) => p.status !== "superseded").map((p) => ({
        id: p.id, audioId: p.audioId, audioName: items[p.audioId]?.newName || items[p.audioId]?.name || p.baseName, part: p.part, total: p.total, fileName: p.fileName, correctedName: p.correctedName,
        status: packages.isExpired(p) && p.status !== "received" ? "expired" : p.status, createdAt: p.createdAt, expiresAt: p.expiresAt, receivedAt: p.receivedAt, via: p.via, appliedAt: p.appliedAt, errors: p.errors ?? [], segments: p.expect.indices.length,
      }));
      return NextResponse.json({ packages: list });
    }
    if (key === "package-json" && url) {
      const p = packages.listPackages().find((x) => x.id === url.searchParams.get("id")); if (!p?.driveFileId) return err("paquete no encontrado", 404);
      const text = await drive.readTextFile(p.driveFileId);
      return NextResponse.json({ text, upload: (JSON.parse(text) as { upload: unknown }).upload });
    }
    if (key === "package-regenerate" && body) return NextResponse.json({ ok: true, upload: await packages.regenerate(String(body.id)) });
    if (key === "packages/scan" && body) return NextResponse.json({ ok: true, ...(await packages.scanDrive()) });
  } catch (e) { return err(e); }
  return null;
}
