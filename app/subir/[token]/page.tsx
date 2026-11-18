import type { Metadata } from "next";
import { findByToken, isExpired } from "@/lib/center/packages";
import UploadBox from "@/components/UploadBox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subir resultado", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = token.length >= 20 ? findByToken(token) : null;
  const bad = !p || p.status === "superseded" ? "Este enlace no es válido o fue reemplazado por uno nuevo." : isExpired(p) ? "Este enlace venció (30 días). Pide uno nuevo en el centro de Drive." : null;
  return (
    <div className="dc">
      <span className="eyebrow">Paquete para IA</span>
      <h1>Subir el resultado corregido</h1>
      {bad ? <div className="state"><h2>No se puede usar</h2><p>{bad}</p></div> : (<>
        <p className="muted">Paquete <code>{p!.id}</code>{p!.total > 1 ? ` · parte ${p!.part} de ${p!.total}` : ""} · {p!.expect.indices.length} segmentos · válido hasta {new Date(p!.expiresAt).toLocaleDateString("es")}.</p>
        <UploadBox token={token} initialStatus={p!.status} />
      </>)}
    </div>
  );
}
