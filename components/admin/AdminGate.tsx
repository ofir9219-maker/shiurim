"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Admin auth wrapper: checks the center state endpoint, shows the login form on 401. Children render once authenticated. */
export default function AdminGate({ children, title = "Admin" }: { children: ReactNode; title?: string }) {
  const [auth, setAuth] = useState<"loading" | "login" | "ok" | "disabled">("loading");
  const [pw, setPw] = useState(""); const [msg, setMsg] = useState("");
  const check = useCallback(async () => {
    const r = await fetch("/api/admin/center/state", { cache: "no-store" }).catch(() => null);
    if (!r) return setAuth("login");
    setAuth(r.status === 503 ? "disabled" : r.status === 401 ? "login" : "ok");
  }, []);
  useEffect(() => { void check(); }, [check]);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (r.ok) { setPw(""); setMsg(""); void check(); } else setMsg((await r.json()).error || "Error");
  };
  if (auth === "loading") return <div className="dc"><p className="muted">Cargando…</p></div>;
  if (auth === "disabled") return <div className="dc"><div className="state"><h2>Admin desactivado</h2><p>Define la variable ADMIN_PASSWORD.</p></div></div>;
  if (auth === "login") return (
    <div className="dc"><form onSubmit={login} className="card dc-login">
      <span className="eyebrow">{title}</span>
      <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Contraseña" autoFocus aria-label="Contraseña" />
      <button className="btn">Entrar</button>{msg && <p role="alert" className="dc-err">{msg}</p>}
    </form></div>);
  return <>{children}</>;
}
