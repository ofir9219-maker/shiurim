import type { Metadata } from "next";
import { findByLegacyToken, statusOf } from "@/lib/zone/jobs";
import UploadBox from "@/components/UploadBox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Subir resultado", robots: { index: false, follow: false } };

/** LEGACY page of the per-file AI packages: still works for packages created before the AI zone (token -> job). */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const j = token.length >= 20 ? findByLegacyToken(token) : null;
  const bad = !j || j.status === "superseded" || j.status === "discarded" ? "Este enlace no es válido, fue reemplazado o el trabajo se descartó. Usa el enlace de la Zona IA del centro de Drive." : j.legacy && Date.parse(j.legacy.expiresAt) < Date.now() && j.status !== "received" ? "Este enlace venció (30 días). Usa el enlace de la Zona IA." : null;
  return (
    <div className="dc">
      <span className="eyebrow">Zona IA · enlace antiguo</span>
      <h1>Subir el resultado corregido</h1>
      {bad ? <div className="state"><h2>No se puede usar</h2><p>{bad}</p></div> : (<>
        <p className="muted">Este paquete ahora es un job de la Zona IA: <code>{j!.id}</code>{j!.total > 1 ? ` · parte ${j!.part} de ${j!.total}` : ""} · {j!.expect.indices.length} segmentos. Para trabajos nuevos usa el enlace de la Zona IA (<code>/ia/…</code>).</p>
        <UploadBox token={token} initialStatus={statusOf(j!) === "done" ? "received" : statusOf(j!)} />
      </>)}
    </div>
  );
}
