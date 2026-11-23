"use client";
import { useCallback, useEffect, useState } from "react";
import ZonePanel from "@/components/admin/ZonePanel";

type Item = {
  id: string; name: string; order: string; state: string; status: string; attempts: number; error?: string; newName?: string; needsReview?: boolean; dafNote?: string;
  nextAttemptAt?: number; cost: { falMinutes: number; promptTokens: number; completionTokens: number }; log: { at: string; msg: string }[]; createdAt: string; updatedAt: string;
};
type Status = {
  drive: { connected: boolean; email: string | null; oauthConfigured: boolean; folderId: string };
  config: { pollMinutes: number; model: string; effort: string; storageDir: string; enabled: boolean; env: Record<string, boolean> };
  scheduler: { started: boolean; running: string | null; checking: boolean; nextPollAt: number; lastPoll: { at: string; ok: boolean; files: number; newFiles: number; error?: string } | null; waitingStable: number };
  totals: { falMinutes: number; promptTokens: number; completionTokens: number; usd: number };
  items: Item[];
};
const box: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 10, padding: 16, marginBottom: 16 };
const btn: React.CSSProperties = { background: "var(--ink)", color: "var(--on-ink)", border: 0, borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 14 };
const when = (s?: string | number) => (s ? new Date(s).toLocaleString("es") : "—");

export default function AdminPage() {
  const [st, setSt] = useState<Status | null>(null);
  const [auth, setAuth] = useState<"loading" | "login" | "ok" | "disabled">("loading");
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/status", { cache: "no-store" });
    if (r.status === 503) return setAuth("disabled");
    if (r.status === 401) return setAuth("login");
    setSt(await r.json()); setAuth("ok");
  }, []);
  useEffect(() => {
    void load(); const t = setInterval(() => void load(), 5000);
    const q = new URLSearchParams(location.search);
    if (q.get("google") === "ok") setMsg("Google Drive conectado."); else if (q.get("google_error")) setMsg(`Error al conectar Google: ${q.get("google_error")}`);
    return () => clearInterval(t);
  }, [load]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) { setPw(""); setMsg(""); void load(); } else setMsg((await r.json()).error || "Error");
  };
  const post = async (url: string, body?: object) => {
    setBusy(true);
    try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); const j = await r.json(); setMsg(r.ok ? (j.files !== undefined ? `Revisión hecha: ${j.files} audios, ${j.newFiles} nuevos.` : "Hecho.") : j.error); await load(); }
    finally { setBusy(false); }
  };

  const wrap = (c: React.ReactNode) => <main id="main" style={{ maxWidth: 980, margin: "0 auto", padding: "24px 16px 120px", color: "var(--text)" }}>{c}</main>;
  if (auth === "loading") return wrap(<p>Cargando…</p>);
  if (auth === "disabled") return wrap(<p>Admin desactivado: define la variable ADMIN_PASSWORD.</p>);
  if (auth === "login") return wrap(
    <form onSubmit={login} style={{ ...box, maxWidth: 360, margin: "60px auto" }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Admin · ingesta</h1>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Contraseña" autoFocus aria-label="Contraseña"
        style={{ width: "100%", padding: 8, border: "1px solid var(--line-strong)", borderRadius: 8, marginBottom: 12, background: "var(--bg)", color: "var(--text)" }} />
      <button style={btn}>Entrar</button>{msg && <p role="alert" style={{ marginTop: 8 }}>{msg}</p>}
    </form>);
  if (!st) return wrap(<p>Cargando…</p>);

  const e = st.config.env;
  return wrap(<>
    <h1 style={{ fontSize: 24, marginBottom: 12 }}>Ingesta automática</h1>
    <p style={{ marginBottom: 12 }}><a href="/admin/drive" style={{ ...btn, textDecoration: "none", display: "inline-block" }}>Centro de transcripción de Drive →</a> <a href="/admin/maamarim" style={{ ...btn, textDecoration: "none", display: "inline-block", marginInlineStart: 8 }}>Maamarim →</a></p>
    {msg && <p role="status" style={{ ...box, padding: 10 }}>{msg}</p>}
    <section style={box}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Conexión</h2>
      <p>Google Drive: <b>{st.drive.connected ? `conectado${st.drive.email ? ` (${st.drive.email})` : ""}` : "no conectado"}</b>{" "}
        {st.drive.oauthConfigured ? <a href="/api/admin/google/start" style={{ ...btn, textDecoration: "none", display: "inline-block", marginLeft: 8 }}>{st.drive.connected ? "Reconectar" : "Conectar Google Drive"}</a> : <em>(faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)</em>}</p>
      <p>Claves: Fal {e.FAL_KEY ? "✔" : "✘"} · AssemblyAI {e.ASSEMBLYAI_API_KEY ? "✔" : "✘"} · OpenAI {e.OPENAI_API_KEY ? "✔" : "✘"} · R2 {e.R2 ? "✔" : "✘"} · modelo {st.config.model} ({st.config.effort}) · volumen <code>{st.config.storageDir}</code></p>
      <p>Carpeta: <code>{st.drive.folderId}</code> · revisión cada {st.config.pollMinutes} min · {st.config.enabled ? (st.scheduler.started ? "scheduler activo" : "scheduler no iniciado") : "desactivado (INGEST_ENABLED=0)"}</p>
      <p>Última revisión: {when(st.scheduler.lastPoll?.at)} {st.scheduler.lastPoll && (st.scheduler.lastPoll.ok ? `(${st.scheduler.lastPoll.files} audios, ${st.scheduler.lastPoll.newFiles} nuevos)` : `— error: ${st.scheduler.lastPoll.error}`)} · próxima: {when(st.scheduler.nextPollAt)}{st.scheduler.waitingStable ? ` · ${st.scheduler.waitingStable} archivo(s) esperando que termine la subida` : ""}</p>
      <p style={{ marginTop: 10 }}><button style={btn} disabled={busy || !st.drive.connected} onClick={() => post("/api/admin/check")}>{busy ? "Revisando…" : "Revisar ahora"}</button>
        <button style={{ ...btn, background: "transparent", color: "var(--ink)", border: "1px solid var(--line-strong)", marginLeft: 8 }} onClick={async () => { await fetch("/api/admin/logout", { method: "POST" }); setAuth("login"); }}>Salir</button></p>
    </section>
    <ZonePanel compact />
    <section style={box}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Costos acumulados</h2>
      <p>Transcripción: {st.totals.falMinutes.toFixed(1)} min · OpenAI: {st.totals.promptTokens.toLocaleString("es")} tokens in / {st.totals.completionTokens.toLocaleString("es")} out · estimado ≈ US$ {st.totals.usd.toFixed(2)} <small>(sin embeddings; precios por defecto, ajustables con FAL_USD_PER_MIN, POLISH_USD_PER_M_IN/OUT)</small></p>
    </section>
    <section style={box}>
      <h2 style={{ fontSize: 16, marginBottom: 8 }}>Clases ({st.items.length})</h2>
      {!st.items.length && <p>Aún no se ha detectado ningún audio nuevo.</p>}
      {st.items.map((it) => (
        <div key={it.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
            <b dir="auto">{it.newName || it.name}</b>
            <span style={{ fontSize: 13 }}>[{it.state}] {it.status === "running" ? "▶ en curso" : it.status === "done" ? "✔ publicada" : it.status === "failed" ? "✘ fallida" : it.nextAttemptAt ? `en cola (reintento ${when(it.nextAttemptAt)})` : "en cola"}{it.needsReview ? " · revisar (>20% inaudible)" : ""}</span>
            <button style={{ ...btn, padding: "3px 10px", fontSize: 12, background: "transparent", color: "var(--ink)", border: "1px solid var(--line-strong)" }} onClick={() => setOpen(open === it.id ? null : it.id)}>{open === it.id ? "Ocultar log" : "Log"}</button>
            {it.status !== "done" && it.status !== "running" && <button style={{ ...btn, padding: "3px 10px", fontSize: 12 }} disabled={busy} onClick={() => post("/api/admin/retry", { id: it.id })}>Reintentar</button>}
          </div>
          {it.error && <p style={{ color: "#a02020", fontSize: 13 }}>{it.error}</p>}
          {it.dafNote && <p style={{ fontSize: 13 }}>Nota de daf: {it.dafNote}</p>}
          <p style={{ fontSize: 12, color: "var(--muted)" }}>{it.id} · Transcripción {it.cost.falMinutes.toFixed(1)} min · OpenAI {it.cost.promptTokens.toLocaleString("es")}/{it.cost.completionTokens.toLocaleString("es")} tok · actualizada {when(it.updatedAt)}</p>
          {open === it.id && <pre style={{ fontSize: 12, whiteSpace: "pre-wrap", background: "var(--bg)", padding: 10, borderRadius: 8, maxHeight: 320, overflow: "auto" }} dir="auto">{it.log.map((l) => `${new Date(l.at).toLocaleTimeString("es")}  ${l.msg}`).join("\n")}</pre>}
        </div>))}
    </section>
  </>);
}
