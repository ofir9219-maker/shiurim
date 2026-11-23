import { NextResponse } from "next/server";
import { isAdmin, adminEnabled } from "@/lib/admin-auth";
import { scheduler, pollMinutes } from "@/lib/ingest/scheduler";
import { driveConnected, loadToken, oauthConfigured, FOLDER_ID } from "@/lib/ingest/drive";
import { STORAGE_DIR } from "@/lib/storage";
import { POLISH_EFFORT, POLISH_MODEL } from "@/lib/ingest/openai";

export const dynamic = "force-dynamic";
export async function GET() {
  if (!adminEnabled()) return NextResponse.json({ error: "ADMIN_PASSWORD no configurada", disabled: true }, { status: 503 });
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const s = scheduler();
  const env = (k: string) => !!process.env[k];
  const price = { fal: Number(process.env.FAL_USD_PER_MIN || 0.008), inM: Number(process.env.POLISH_USD_PER_M_IN || 1.75), outM: Number(process.env.POLISH_USD_PER_M_OUT || 14) };
  const t = s.state.totals;
  return NextResponse.json({
    drive: { connected: driveConnected(), email: loadToken()?.email ?? null, oauthConfigured: oauthConfigured(), folderId: FOLDER_ID() },
    config: { pollMinutes: pollMinutes(), model: POLISH_MODEL(), effort: POLISH_EFFORT(), storageDir: STORAGE_DIR, enabled: process.env.INGEST_ENABLED !== "0",
      env: { FAL_KEY: env("FAL_KEY"), ASSEMBLYAI_API_KEY: env("ASSEMBLYAI_API_KEY"), OPENAI_API_KEY: env("OPENAI_API_KEY"), R2: env("R2_ACCESS_KEY_ID") && env("R2_BUCKET") && env("R2_PUBLIC_BASE_URL") } },
    scheduler: { started: s.started, running: s.running, checking: s.checking, nextPollAt: s.nextPollAt, lastPoll: s.state.lastPoll ?? null, waitingStable: Object.keys(s.state.seen).length },
    totals: { ...t, usd: (t.falUsd ?? t.falMinutes * price.fal) + (t.openaiUsd ?? (t.promptTokens * price.inM + t.completionTokens * price.outM) / 1e6) },
    items: Object.values(s.state.items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
}
