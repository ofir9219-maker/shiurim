import { NextResponse } from "next/server";
import { undoRename } from "./undo";
import { readRenameLog } from "./rename-log";
import * as Z from "../zone/jobs";
import { currentToken, regenerateToken, tokenSource, zoneUrl } from "../zone/token";
import { scheduler } from "../ingest/scheduler";

/** Zone link, queue counts and every job with its status and latest validation errors (admin panels). */
export function zoneState() {
  const items = scheduler().state.items; const t = currentToken(); const now = Date.now();
  Z.sweepLeases(now);
  const jobs = Z.loadJobs().filter(Z.isListed).map((j) => ({
    id: j.id, audioId: j.audioId, audioName: items[j.audioId]?.newName || items[j.audioId]?.name || j.baseName, part: j.part, total: j.total, series: j.series, segments: j.expect.indices.length,
    status: Z.statusOf(j, now), claimedUntil: j.lease?.until, holder: j.lease?.holder, createdAt: j.createdAt, receivedAt: j.receivedAt, via: j.via, appliedAt: j.appliedAt, errors: j.errors ?? [], errorsAt: j.errorsAt, attempts: j.attempts,
  }));
  return { enabled: !!t, source: tokenSource(), url: t ? zoneUrl(t) : null, counts: Z.counts(now), jobs };
}
const err = (e: unknown, status = 400) => NextResponse.json({ error: (e as Error).message ?? String(e) }, { status });
/** Extra admin operations: rename undo and the AI work zone. Returns null when the op is not handled. */
export async function templateApi(op: string[], url: URL | null, body: any): Promise<NextResponse | null> {
  const key = op.join("/");
  try {
    if (key === "undo-rename" && body) return NextResponse.json({ ok: true, ...(await undoRename(String(body.id))) });
    if (key === "renames" && url) return NextResponse.json({ renames: readRenameLog().filter((e) => e.audioId === url.searchParams.get("id")).slice(-30) });
    if (key === "zone" && url) return NextResponse.json(zoneState());
    if (key === "zone/regenerate" && body) {
      if (tokenSource() === "env") return err("El enlace viene de AI_ZONE_TOKEN (variable de entorno): cámbialo en Railway.", 409);
      const t = regenerateToken(); return NextResponse.json({ ok: true, url: zoneUrl(t) });
    }
    if (key === "zone/job" && body) {
      const id = String(body.id || "");
      const ok = body.action === "reopen" ? Z.reopen(id) : body.action === "discard" ? Z.discard(id) : err("acción desconocida");
      return ok === true ? NextResponse.json({ ok: true }) : ok === false ? err("job no encontrado", 404) : ok;
    }
    if (key === "zone/scan" && body) return NextResponse.json({ ok: true, ...(await Z.scanDrive()) });
  } catch (e) { return err(e); }
  return null;
}
