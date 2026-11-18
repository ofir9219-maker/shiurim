import { NextResponse } from "next/server";
import { undoRename } from "./undo";
import { readRenameLog } from "./rename-log";

/** Extra admin operations (templates/rename undo here; AI packages in phase 3). Returns null when the op is not handled. */
export async function templateApi(op: string[], url: URL | null, body: any): Promise<NextResponse | null> {
  const key = op.join("/");
  if (key === "undo-rename" && body) {
    try { return NextResponse.json({ ok: true, ...(await undoRename(String(body.id))) }); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
  }
  if (key === "renames" && url) return NextResponse.json({ renames: readRenameLog().filter((e) => e.audioId === url.searchParams.get("id")).slice(-30) });
  return null;
}
