import { NextResponse } from "next/server";
import { readLocalPdf } from "@/lib/maamarim/pdf";
import { getMaamar } from "@/lib/maamarim/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getMaamar(id);
  if (!m?.pdf) return NextResponse.json({ error: "sin PDF" }, { status: 404 });
  if (m.pdf.url) return NextResponse.redirect(m.pdf.url, 302);
  const buf = readLocalPdf(id);
  if (!buf) return NextResponse.json({ error: "sin PDF" }, { status: 404 });
  const name = encodeURIComponent(`${m.title}.pdf`);
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename*=UTF-8''${name}`, "cache-control": "public, max-age=300" } });
}
