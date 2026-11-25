"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "./dc-common";

type Err = { where: string; problem: string };
type Job = { id: string; audioId: string; audioName: string; part: number; total: number; segments: number; status: string; claimedUntil?: string; holder?: string; receivedAt?: string; via?: string; appliedAt?: string; errors: Err[]; errorsAt?: string; attempts: number };
type Zone = { enabled: boolean; source: "env" | "stored"; url: string | null; counts: { pending: number; claimed: number; done: number; failed: number; discarded: number }; jobs: Job[] };
const LABEL: Record<string, string> = { pending: "pendiente", claimed: "tomado", done: "hecho", failed: "rechazado", discarded: "descartado" };
const BADGE: Record<string, string> = { pending: "pending_package", claimed: "polishing", done: "polished", failed: "error", discarded: "none" };

/** Zona IA: link for the AI (copy / regenerate), queue counts and per-job status with Reabrir / Descartar and the latest validation errors. */
export default function ZonePanel({ compact = false }: { compact?: boolean }) {
  const [z, setZ] = useState<Zone | null>(null); const [msg, setMsg] = useState(""); const [errOf, setErrOf] = useState<string | null>(null); const [show, setShow] = useState(false);
  const load = useCallback(() => api<Zone>("zone").then(setZ, () => {}), []);
  useEffect(() => { void load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  if (!z) return null;
  const copy = async () => {
    if (!z.url) return setMsg("No se puede recuperar el enlace (cambió ADMIN_PASSWORD): pulsa «Regenerar enlace».");
    try { await navigator.clipboard.writeText(z.url); setMsg("Enlace copiado: pégalo en una IA con acceso a internet (ChatGPT agent, Codex, Claude Code…)."); }
    catch { setShow(true); setMsg("No se pudo copiar automáticamente: selecciona el enlace de abajo."); }
  };
  const regen = async () => {
    if (!confirm("Se crea un enlace nuevo y el anterior deja de funcionar (las IA que lo tengan perderán el acceso). ¿Continuar?")) return;
    try { await api("zone/regenerate", { method: "POST", body: {} }); setMsg("Enlace nuevo generado; el anterior ya no funciona."); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const act = async (j: Job, action: "reopen" | "discard") => {
    if (action === "discard" && !confirm("¿Descartar este job? Sale de la cola y la clase no se aplicará hasta reencolarla.")) return;
    try { await api("zone/job", { method: "POST", body: { id: j.id, action } }); await load(); } catch (e) { setMsg((e as Error).message); }
  };
  const scan = async () => { try { const r = await api<{ received: number }>("zone/scan", { method: "POST", body: {} }); setMsg(`Drive revisado: ${r.received} resultado(s) nuevo(s).`); await load(); } catch (e) { setMsg((e as Error).message); } };
  const c = z.counts; const open = c.pending + c.failed;
  return (
    <section className="card" style={{ padding: "var(--sp-4)", marginTop: "var(--sp-4)" }} aria-label="Zona IA">
      <div className="dc-bar"><h2 className="grow" style={{ margin: 0 }}>Zona IA ({open} por hacer)</h2>
        {compact && <a className="btn-ghost btn btn-sm" href="/admin/drive">Ver cola →</a>}</div>
      <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Pega este único enlace en una IA con acceso HTTP: ella lee las instrucciones, toma los JSON de la cola y devuelve los corregidos.</p>
      <div className="dc-bar">
        <button className="btn btn-sm" onClick={copy} disabled={!z.enabled}>Copiar enlace para la IA</button>
        {z.source === "stored" && <button className="btn-ghost btn btn-sm" onClick={regen}>Regenerar enlace</button>}
        <button className="btn-ghost btn btn-sm" onClick={() => setShow(!show)}>{show ? "Ocultar enlace" : "Mostrar enlace"}</button>
        {!compact && <button className="btn-ghost btn btn-sm" onClick={scan}>Buscar corregidos en Drive</button>}
      </div>
      {z.source === "env" && <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>El enlace viene de la variable <code>AI_ZONE_TOKEN</code> (se cambia en Railway).</p>}
      {show && <p><code style={{ wordBreak: "break-all" }}>{z.url ?? "(no recuperable: regenera el enlace)"}</code></p>}
      {msg && <p role="status" className="muted" onClick={() => setMsg("")}>{msg}</p>}
      <p>Cola: <b>{c.pending}</b> pendientes · <b>{c.claimed}</b> tomados · <b>{c.done}</b> hechos · <b>{c.failed}</b> rechazados{c.discarded ? ` · ${c.discarded} descartados` : ""}</p>
      {!compact && z.jobs.length > 0 && (
        <ul className="dc-list">{z.jobs.map((j) => (
          <li key={j.id} className="dc-row" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
            <div className="dc-name" dir="auto">{j.audioName}{j.total > 1 ? ` · parte ${j.part}/${j.total}` : ""}
              <small>{j.id} · {j.segments} segmentos{j.claimedUntil ? ` · tomado hasta ${new Date(j.claimedUntil).toLocaleTimeString("es")}${j.holder ? ` por ${j.holder}` : ""}` : ""}{j.receivedAt ? ` · recibido ${new Date(j.receivedAt).toLocaleString("es")} (${j.via})` : ""}{j.appliedAt ? " · aplicado" : ""}</small>
              {j.errors.length > 0 && j.status !== "done" && <button type="button" className="chip chip-sm" style={{ cursor: "pointer" }} onClick={() => setErrOf(errOf === j.id ? null : j.id)}>{j.errors.length} problema(s) del último envío{j.errorsAt ? ` (${new Date(j.errorsAt).toLocaleTimeString("es")})` : ""}</button>}
              {errOf === j.id && <table className="dc-table"><tbody>{j.errors.map((e, i) => <tr key={i}><td><b>{e.where}</b></td><td>{e.problem}</td></tr>)}</tbody></table>}
            </div>
            <div className="dc-acts"><span className="badge" data-s={BADGE[j.status] ?? "none"}>{LABEL[j.status] ?? j.status}</span>
              {(j.status === "done" || j.status === "failed" || j.status === "claimed" || j.status === "discarded") && <button className="btn-ghost btn btn-sm" onClick={() => act(j, "reopen")}>Reabrir</button>}
              {j.status !== "discarded" && <button className="btn-ghost btn btn-sm" onClick={() => act(j, "discard")}>Descartar</button>}</div>
          </li>))}</ul>)}
    </section>
  );
}
