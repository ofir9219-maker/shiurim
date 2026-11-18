import { NextRequest, NextResponse } from "next/server";
import { textSearch, hybridSearch } from "../../../lib/search";
import { scopeFrom } from "../../../lib/series";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") || "";
  const daf = sp.get("daf") || undefined;
  const limit = Number(sp.get("limit") || 30) || 30;
  const collections = scopeFrom(sp.get("c"));
  const out: Record<string, unknown> = { q, hits: textSearch(q, { daf, limit, collections }) };
  if (sp.get("mode") === "hybrid") out.semantic = await hybridSearch(q, Math.min(limit, 50), collections);
  return NextResponse.json(out);
}
