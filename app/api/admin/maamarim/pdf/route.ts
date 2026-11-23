import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { savePdf } from "@/lib/maamarim/pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** multipart: id, file */
export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const fd = await req.formData();
    const f = fd.get("file"); const id = String(fd.get("id") || "");
    if (!(f instanceof Blob)) throw new Error("falta el archivo");
    const pdf = await savePdf(id, Buffer.from(await f.arrayBuffer()));
    return NextResponse.json({ ok: true, size: pdf.size });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
