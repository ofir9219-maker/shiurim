import { NextResponse } from "next/server";
import { getClass, getSegments, rowToClass } from "../../../../lib/db";
import { audioUrlFor } from "../../../../lib/audio";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getClass(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...rowToClass(row, await audioUrlFor(row.id, row.r2_key)), segments: getSegments(id) });
}
