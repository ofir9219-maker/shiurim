"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./dc-common";

type Pkg = { id: string; audioId: string; audioName: string; part: number; total: number; fileName: string; correctedName: string; status: string; expiresAt: string; receivedAt?: string; via?: string; appliedAt?: string; errors: { where: string; message: string }[]; segments: number };
const LABEL: Record<string, string> = { pending: "pendiente", received: "recibido", invalid: "rechazado", expired: "vencido" };

/** AI packages pending / received, with "Copiar prompt" (the whole package JSON, ready to paste in ChatGPT / Claude). */
export default function PackagesPanel() {
  const [list, setList] = useState<Pkg[]>([]); const [msg, setMsg] = useState(""); const [errOf, setErrOf] = useState<string | null>(null);
  const load = useCallback(() => api<{ packages: Pkg[] }>("packages").then((r) => setList(r.packages), () => {}), []);
  useEffect(() => { void load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  if (!list.length) return null;
  const copy = async (p: Pkg) => {
    try { const j = await api<{ text: string }>(`package-json?id=${p.id}`); await navigator.clipboard.writeText(j.text); setMsg(`Paquete «${p.fileName}» copiado (${Math.round(j.text.length / 1000)} KB): pégalo en ChatGPT o Claude.`); }
    catch (e) { setMsg(`No se pudo copiar: ${(e as Error).message}`); }
  };
  const page = async (p: Pkg) => { try { const j = await api<{ upload: { page: string } }>(`package-json?id=${p.id}`); window.open(j.upload.page, "_blank"); } catch (e) { setMsg((e as Error).message); } };
  const regen = async (p: Pkg) => { try { await api("package-regenerate", { method: "POST", body: { id: p.id } }); setMsg("Nuevo enlace generado (el anterior dejó de funcionar; el archivo en Drive se actualizó)."); await load(); } catch (e) { setMsg((e as Error).message); } };
  const scan = async () => { try { const r = await api<{ received: number }>("packages/scan", { method: "POST", body: {} }); setMsg(`Drive revisado: ${r.received} resultado(s) nuevo(s).`); await load(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <section className="card" style={{ padding: "var(--sp-4)", marginTop: "var(--sp-4)" }} aria-label="Paquetes para IA">
      <div className="dc-bar"><h2 className="grow" style={{ margin: 0 }}>Paquetes para IA ({list.filter((p) => p.status === "pending" || p.status === "invalid").length} pendientes)</h2><button className="btn-ghost btn btn-sm" onClick={scan}>Buscar corregidos en Drive</button></div>
      {msg && <p role="status" className="muted" onClick={() => setMsg("")}>{msg}</p>}
      <ul className="dc-list">{list.map((p) => (
        <li key={p.id} className="dc-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
          <div className="dc-name" dir="auto">{p.audioName}{p.total > 1 ? ` · parte ${p.part}/${p.total}` : ""}
            <small>{p.fileName} · {p.segments} segmentos · vence {new Date(p.expiresAt).toLocaleDateString("es")}{p.receivedAt ? ` · recibido ${new Date(p.receivedAt).toLocaleString("es")} (${p.via})` : ""}{p.appliedAt ? " · aplicado" : ""}</small>
            {p.errors.length > 0 && <button type="button" className="chip chip-sm" style={{ cursor: "pointer" }} onClick={() => setErrOf(errOf === p.id ? null : p.id)}>{p.errors.length} problema(s) del último envío</button>}
            {errOf === p.id && <table className="dc-table"><tbody>{p.errors.map((e, i) => <tr key={i}><td><b>{e.where}</b></td><td>{e.message}</td></tr>)}</tbody></table>}
          </div>
          <div className="dc-acts"><span className="badge" data-s={p.status === "invalid" ? "error" : p.status === "received" ? "polished" : "pending_package"}>{LABEL[p.status] ?? p.status}</span>
            <button className="btn btn-sm" onClick={() => copy(p)}>Copiar prompt</button>
            <button className="btn-ghost btn btn-sm" onClick={() => page(p)}>Página de subida</button>
            <button className="btn-ghost btn btn-sm" onClick={() => regen(p)}>Nuevo enlace</button></div>
        </li>))}</ul>
    </section>
  );
}
