"use client";
import { useRef, useState } from "react";

type Err = { where: string; message: string };
type Res = { ok: boolean; applied?: boolean; message?: string; error?: string; errors?: Err[]; waiting_for_parts?: number[] };

/** Drag & drop / paste box for the corrected JSON of an AI package. Shows the validation result in Spanish. */
export default function UploadBox({ token, initialStatus }: { token: string; initialStatus: string }) {
  const [text, setText] = useState(""); const [res, setRes] = useState<Res | null>(null); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const send = async (body: string) => {
    setBusy(true); setRes(null);
    try {
      const r = await fetch(`/api/paquete/${token}`, { method: "POST", headers: { "content-type": "application/json", "x-upload-via": "page" }, body });
      setRes((await r.json().catch(() => ({ ok: false, error: `Error ${r.status}` }))) as Res);
    } catch { setRes({ ok: false, error: "No se pudo conectar con el servidor." }); } finally { setBusy(false); }
  };
  const readFile = async (f: File) => { if (f.size > 5 * 1024 * 1024) return setRes({ ok: false, error: "El archivo supera 5 MB." }); const t = await f.text(); setText(t); void send(t); };
  return (
    <div className="dc-form">
      {initialStatus === "received" && <p className="muted">Ya hay un resultado válido para este paquete; si subes otro lo reemplazará.</p>}
      <div className="card" style={{ padding: "var(--sp-5)", textAlign: "center", borderStyle: "dashed", borderColor: drag ? "var(--gold)" : undefined, background: drag ? "var(--gold-soft)" : undefined }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) void readFile(f); }}>
        <p>Arrastra aquí el archivo <code>.json</code> corregido</p>
        <button type="button" className="btn-ghost btn" onClick={() => file.current?.click()}>Elegir archivo</button>
        <input ref={file} type="file" accept=".json,application/json,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); }} />
      </div>
      <label>…o pega el JSON
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder='{"format":"shiurim-ai-result/v1","package_id":"pkg_…","segments":[…]}' spellCheck={false} /></label>
      <div className="dc-bar"><button className="btn" disabled={busy || !text.trim()} onClick={() => send(text)}>{busy ? "Validando…" : "Enviar y validar"}</button></div>
      {res && (
        <div role="status" className="card" style={{ padding: "var(--sp-4)", borderColor: res.ok ? "var(--gold)" : "var(--danger)" }}>
          <h2 style={{ color: res.ok ? "var(--gold-strong)" : "var(--danger)" }}>{res.ok ? (res.applied ? "Aplicado" : "Recibido") : "No se aplicó"}</h2>
          <p>{res.message ?? res.error}</p>
          {!!res.waiting_for_parts?.length && <p className="muted">Faltan las partes: {res.waiting_for_parts.join(", ")}.</p>}
          {!!res.errors?.length && <table className="dc-table"><tbody>{res.errors.map((e, i) => <tr key={i}><td><b>{e.where}</b></td><td>{e.message}</td></tr>)}</tbody></table>}
        </div>)}
    </div>
  );
}
