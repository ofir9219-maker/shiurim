import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { scheduler } from "@/lib/ingest/scheduler";

export const dynamic = "force-dynamic";
export async function POST() {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { const s = scheduler(); s.start(); return NextResponse.json({ ok: true, ...(await s.checkNow()) }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
