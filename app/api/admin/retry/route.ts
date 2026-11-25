import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { scheduler } from "@/lib/ingest/scheduler";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  scheduler().retry(id);
  return NextResponse.json({ ok: true });
}
