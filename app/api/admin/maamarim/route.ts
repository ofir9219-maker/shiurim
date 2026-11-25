import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { syncIndex } from "@/lib/maamarim/search";
import { removePdf } from "@/lib/maamarim/pdf";
import {
  categoryTree, createCategory, deleteCategory, deleteMaamar, getMaamar, listCards, patchMaamar, updateCategory, upsertMaamar,
} from "@/lib/maamarim/store";
import { currentMaamarToken, mcpUrl, regenerateMaamarToken, uploadUrl } from "@/lib/maamarim/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const no = () => NextResponse.json({ error: "unauthorized" }, { status: 401 });

export async function GET() {
  if (!(await isAdmin())) return no();
  const t = currentMaamarToken();
  return NextResponse.json({ cards: listCards(), tree: categoryTree(), mcpUrl: t ? mcpUrl(t) : null, uploadUrl: t ? uploadUrl(t) : null, tokenFromEnv: !!process.env.MAAMARIM_TOKEN });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return no();
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  try {
    switch (b.action) {
      case "upload": {
        let ficha = b.ficha;
        if (typeof ficha === "string" && ficha.trim()) { try { ficha = JSON.parse(ficha); } catch { throw new Error("la ficha no es JSON válido"); } }
        const r = await upsertMaamar({ id: b.id || undefined, markup: b.markup, category: b.category || undefined, categoryId: b.categoryId || undefined, tags: b.tags, ficha: ficha || undefined });
        void syncIndex().catch(() => {});
        return NextResponse.json({ ok: true, id: r.maamar.id, created: r.created, warnings: r.warnings });
      }
      case "patch": { patchMaamar(String(b.id), b.patch ?? {}); void syncIndex().catch(() => {}); return NextResponse.json({ ok: true }); }
      case "delete": { await removePdf(String(b.id)).catch(() => {}); deleteMaamar(String(b.id)); void syncIndex().catch(() => {}); return NextResponse.json({ ok: true }); }
      case "removePdf": { await removePdf(String(b.id)); return NextResponse.json({ ok: true }); }
      case "get": { const m = getMaamar(String(b.id)); return m ? NextResponse.json({ ok: true, maamar: m }) : NextResponse.json({ error: "no encontrado" }, { status: 404 }); }
      case "catCreate": return NextResponse.json({ ok: true, category: createCategory(String(b.name ?? ""), b.parentId || null) });
      case "catUpdate": { const c = updateCategory(String(b.id), b.patch ?? {}); void syncIndex(true).catch(() => {}); return NextResponse.json({ ok: true, category: c }); }
      case "catDelete": deleteCategory(String(b.id)); return NextResponse.json({ ok: true });
      case "reindex": return NextResponse.json({ ok: true, ...(await syncIndex(true)) });
      case "regenerateToken": { if (process.env.MAAMARIM_TOKEN) throw new Error("el token está fijado por la variable MAAMARIM_TOKEN"); const t = regenerateMaamarToken(); return NextResponse.json({ ok: true, mcpUrl: mcpUrl(t), uploadUrl: uploadUrl(t) }); }
      default: return NextResponse.json({ error: "acción desconocida" }, { status: 400 });
    }
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
