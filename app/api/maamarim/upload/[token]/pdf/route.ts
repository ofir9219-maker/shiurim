import { NextResponse } from "next/server";
import { savePdf } from "@/lib/maamarim/pdf";
import { verifyMaamarToken } from "@/lib/maamarim/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ token: string }> };

/** POST application/pdf (raw body) ?id=<maamar id> */
export async function POST(req: Request, { params }: P) {
  const { token } = await params;
  if (!verifyMaamarToken(token)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const id = new URL(req.url).searchParams.get("id") || "";
  try {
    const buf = Buffer.from(await req.arrayBuffer());
    const pdf = await savePdf(id, buf);
    return NextResponse.json({ ok: true, size: pdf.size });
  } catch (e) { return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 }); }
}
