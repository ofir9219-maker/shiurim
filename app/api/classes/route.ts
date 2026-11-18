import { NextRequest, NextResponse } from "next/server";
import { listClasses, rowToClass } from "../../../lib/db";
import { audioUrlFor } from "../../../lib/audio";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const daf = req.nextUrl.searchParams.get("daf") || undefined;
  const collection = req.nextUrl.searchParams.get("collection") || undefined;
  const rows = listClasses({ daf, collection });
  const classes = await Promise.all(rows.map(async (r) => rowToClass(r, await audioUrlFor(r.id, r.r2_key))));
  return NextResponse.json({ classes });
}
