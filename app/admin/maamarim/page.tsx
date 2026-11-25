"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/admin/AdminGate";
import type { CategoryNode, MaamarCard } from "@/lib/maamarim/types";

type State = { cards: MaamarCard[]; tree: CategoryNode[]; mcpUrl: string | null; uploadUrl: string | null; tokenFromEnv: boolean };
const box: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 12, padding: 16, marginBottom: 16 };
const flat = (n: CategoryNode[]): CategoryNode[] => n.flatMap((x) => [x, ...flat(x.children)]);
async function post<T = Record<string, unknown>>(body: object): Promise<T> {
  const r = await fetch("/api/admin/maamarim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j as T;
}

function Panel() {
  const [st, setSt] = useState<State | null>(null);
  const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [markup, setMarkup] = useState(""); const [ficha, setFicha] = useState(""); const [catPath, setCatPath] = useState(""); const [catId, setCatId] = useState("");
  const [tags, setTags] = useState(""); const [replaceId, setReplaceId] = useState(""); const [pdf, setPdf] = useState<File | null>(null);
  const [newCat, setNewCat] = useState(""); const [newParent, setNewParent] = useState("");
  const load = useCallback(async () => { const r = await fetch("/api/admin/maamarim", { cache: "no-store" }); if (r.ok) setSt(await r.json()); }, []);
  useEffect(() => { void load(); }, [load]);
  const run = async (fn: () => Promise<string | void>) => { setBusy(true); setMsg(""); try { const m = await fn(); if (m) setMsg(m); await load(); } catch (e) { setMsg("Error: " + (e as Error).message); } finally { setBusy(false); } };
  const nodes = flat(st?.tree ?? []);
  const copy = (t: string) => { void navigator.clipboard.writeText(t).then(() => setMsg("Copiado.")); };

  const upload = () => run(async () => {
    const r = await post<{ id: string; created: boolean; warnings: string[] }>({ action: "upload", id: replaceId || undefined, markup, ficha, categoryId: catId || undefined, category: !catId && catPath ? catPath.split("/").map((s) => s.trim()).filter(Boolean) : undefined, tags: tags || undefined });
    if (pdf) { const fd = new FormData(); fd.set("id", r.id); fd.set("file", pdf); const x = await fetch("/api/admin/maamarim/pdf", { method: "POST", body: fd }); if (!x.ok) throw new Error((await x.json()).error); }
    setMarkup(""); setFicha(""); setPdf(null); setReplaceId("");
    return `${r.created ? "Subido" : "Actualizado"} (${r.id}).${r.warnings.length ? " Avisos: " + r.warnings.join(" · ") : ""}`;
  });
  const attachPdf = (id: string, f: File) => run(async () => { const fd = new FormData(); fd.set("id", id); fd.set("file", f); const x = await fetch("/api/admin/maamarim/pdf", { method: "POST", body: fd }); if (!x.ok) throw new Error((await x.json()).error); return "PDF adjuntado."; });
  const loadForEdit = (id: string) => run(async () => {
    const r = await post<{ maamar: { id: string; markup?: string; ficha: unknown; tags: string[]; categoryId: string } }>({ action: "get", id });
    setReplaceId(r.maamar.id); setMarkup(r.maamar.markup ?? ""); setFicha(JSON.stringify(r.maamar.ficha, null, 1)); setTags(r.maamar.tags.join(", ")); setCatId(r.maamar.categoryId); setCatPath("");
    window.scrollTo({ top: 0, behavior: "smooth" }); return "Cargado para editar: cambia el texto o la ficha y pulsa «Guardar».";
  });

  if (!st) return <p className="muted">Cargando…</p>;
  return (
    <div>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="chip" href="/admin">Estado / costos</Link><Link className="chip" href="/admin/drive">Drive</Link><Link className="chip" href="/maamarim">Ver biblioteca →</Link></p>
      <h1 className="page-title">Maamarim</h1>
      {msg && <p role="status" style={{ ...box, borderColor: msg.startsWith("Error") ? "var(--danger)" : "var(--gold)" }}>{msg}</p>}

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Conector para Claude</h2>
        <p className="muted" style={{ fontSize: 14 }}>En claude.ai → Configuración → Conectores → «Agregar conector personalizado», pega este enlace (es secreto: quien lo tenga puede subir maamarim). Luego, al terminar un maamar con el skill, dile «súbelo a la biblioteca».</p>
        {st.mcpUrl ? (
          <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ wordBreak: "break-all", fontSize: 12, background: "var(--bg)", padding: "6px 8px", borderRadius: 6 }}>{st.mcpUrl}</code>
            <button className="btn btn-sm" onClick={() => copy(st.mcpUrl!)}>Copiar enlace MCP</button>
            <button className="btn-ghost btn-sm" onClick={() => copy(st.uploadUrl!)}>Copiar API de subida</button>
            {!st.tokenFromEnv && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => { if (confirm("¿Generar un enlace nuevo? El anterior dejará de funcionar.")) void run(async () => { await post({ action: "regenerateToken" }); return "Enlace nuevo generado: actualízalo en el conector de claude.ai."; }); }}>Generar enlace nuevo</button>}
          </p>
        ) : <p className="dc-err">No se puede mostrar el enlace (¿cambió ADMIN_PASSWORD?). Genera uno nuevo.</p>}
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>{replaceId ? `Editar maamar ${replaceId}` : "Subir maamar"}</h2>
        <p style={{ fontSize: 13 }} className="muted">¿Tienes el archivo <code>subida-maamar.json</code> que genera el skill? <label className="btn-ghost btn-sm" style={{ cursor: "pointer" }}>Cargar JSON de subida<input type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          try { const j = JSON.parse(await f.text()); setMarkup(String(j.markup ?? "")); setFicha(j.ficha ? JSON.stringify(j.ficha, null, 1) : ""); setCatId(""); setCatPath(Array.isArray(j.categoria) ? j.categoria.join(" / ") : String(j.categoria ?? "")); setTags(Array.isArray(j.etiquetas) ? j.etiquetas.join(", ") : ""); setReplaceId(typeof j.id === "string" ? j.id : ""); setMsg("JSON cargado: revisa y pulsa «Subir»."); }
          catch { setMsg("Error: el archivo no es un JSON válido."); }
        }} /></label></p>
        <label style={{ display: "block", marginBottom: 8 }}><span className="muted" style={{ fontSize: 13 }}>Texto del maamar (marcado del skill: TITLE:, # פרקים, &gt; citas, {"{{notas}}"})</span>
          <textarea className="input" value={markup} onChange={(e) => setMarkup(e.target.value)} rows={10} dir="rtl" style={{ fontFamily: "var(--font-he)" }} />
          <input type="file" accept=".txt,.md,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setMarkup(await f.text()); }} />
        </label>
        <label style={{ display: "block", marginBottom: 8 }}><span className="muted" style={{ fontSize: 13 }}>Ficha de enriquecimiento (JSON, opcional pero recomendada)</span>
          <textarea className="input" value={ficha} onChange={(e) => setFicha(e.target.value)} rows={5} style={{ fontFamily: "monospace", fontSize: 12 }} placeholder='{"summary_es": "...", "keywords": [...], "questions": [...], "sources": [{"ref":"Berakhot.5a","label":"ברכות ה."}]}' />
        </label>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: 8 }}>
          <label><span className="muted" style={{ fontSize: 13 }}>Categoría existente</span>
            <select className="input" value={catId} onChange={(e) => setCatId(e.target.value)}><option value="">— nueva / la del texto —</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.code} {n.path.join(" › ")}</option>)}</select></label>
          <label><span className="muted" style={{ fontSize: 13 }}>…o ruta nueva (גמרא / ברכות)</span><input className="input" value={catPath} onChange={(e) => setCatPath(e.target.value)} disabled={!!catId} dir="rtl" /></label>
          <label><span className="muted" style={{ fontSize: 13 }}>Etiquetas (coma)</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} dir="auto" /></label>
          <label><span className="muted" style={{ fontSize: 13 }}>PDF (opcional)</span><input type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} /></label>
        </div>
        <p style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={busy || !markup.trim()} onClick={() => void upload()}>{busy ? "…" : replaceId ? "Guardar" : "Subir"}</button>
          {replaceId && <button className="btn-ghost" onClick={() => { setReplaceId(""); setMarkup(""); setFicha(""); setTags(""); setCatId(""); }}>Cancelar edición</button>}
        </p>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Categorías</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {nodes.map((n) => (
            <li key={n.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0", paddingInlineStart: (n.path.length - 1) * 20, borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
              <span className="tnum" style={{ color: "var(--gold-strong)", minWidth: 48 }}>{n.code}</span>
              <span dir="rtl" style={{ fontFamily: "var(--font-he)", fontSize: 17, flex: 1 }}>{n.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{n.total}</span>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => { const v = prompt("Nuevo nombre", n.name); if (v) void run(async () => { await post({ action: "catUpdate", id: n.id, patch: { name: v } }); }); }}>Renombrar</button>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { await post({ action: "catUpdate", id: n.id, patch: { order: n.order - 1.5 } }); })} title="Subir en el orden">↑</button>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { await post({ action: "catUpdate", id: n.id, patch: { order: n.order + 1.5 } }); })} title="Bajar en el orden">↓</button>
              <select className="input" style={{ minHeight: 36, width: "auto" }} value={n.parentId ?? ""} onChange={(e) => void run(async () => { await post({ action: "catUpdate", id: n.id, patch: { parentId: e.target.value || null } }); })} aria-label="Mover a">
                <option value="">(raíz)</option>{nodes.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}
              </select>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => { const v = prompt("Descripción del estante (opcional)", n.description ?? ""); if (v !== null) void run(async () => { await post({ action: "catUpdate", id: n.id, patch: { description: v } }); }); }}>Descripción</button>
              {n.total === 0 && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { await post({ action: "catDelete", id: n.id }); })}>Borrar</button>}
            </li>
          ))}
        </ul>
        <p style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <input className="input" style={{ maxWidth: 260 }} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Nueva categoría" dir="rtl" />
          <select className="input" style={{ maxWidth: 260 }} value={newParent} onChange={(e) => setNewParent(e.target.value)}><option value="">(raíz)</option>{nodes.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select>
          <button className="btn btn-sm" disabled={busy || !newCat.trim()} onClick={() => void run(async () => { await post({ action: "catCreate", name: newCat, parentId: newParent || null }); setNewCat(""); })}>Crear</button>
        </p>
      </section>

      <section style={box}>
        <h2 style={{ marginTop: 0 }}>Maamarim ({st.cards.length})</h2>
        <p><button className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { const r = await post<{ indexed: number; embedded: number }>({ action: "reindex" }); return `Índice reconstruido: ${r.indexed} maamarim, ${r.embedded} fragmentos con embeddings.`; })}>Reconstruir índice de búsqueda</button></p>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {st.cards.map((c) => (
            <li key={c.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)", display: "grid", gap: 6 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span className="tnum" style={{ color: "var(--gold-strong)" }}>{c.callNumber}</span>
                <Link href={`/maamarim/${c.id}`} dir="rtl" style={{ fontFamily: "var(--font-he)", fontSize: 18 }}>{c.title}</Link>
                <span className="muted" style={{ fontSize: 12 }}>{c.categoryPath.join(" › ")} · {c.words} palabras · {c.hasPdf ? "con PDF" : "sin PDF"} · {c.id}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select className="input" style={{ minHeight: 36, width: "auto" }} value={c.categoryId} onChange={(e) => void run(async () => { await post({ action: "patch", id: c.id, patch: { categoryId: e.target.value } }); return "Movido."; })} aria-label="Categoría">
                  {nodes.map((n) => <option key={n.id} value={n.id}>{n.code} {n.path.join(" › ")}</option>)}
                </select>
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => { const v = prompt("Etiquetas (separadas por coma)", c.tags.join(", ")); if (v !== null) void run(async () => { await post({ action: "patch", id: c.id, patch: { tags: v } }); }); }}>Etiquetas</button>
                <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void loadForEdit(c.id)}>Editar texto/ficha</button>
                <label className="btn-ghost btn-sm" style={{ cursor: "pointer" }}>{c.hasPdf ? "Cambiar PDF" : "Adjuntar PDF"}<input type="file" accept="application/pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachPdf(c.id, f); }} /></label>
                {c.hasPdf && <button className="btn-ghost btn-sm" disabled={busy} onClick={() => void run(async () => { await post({ action: "removePdf", id: c.id }); })}>Quitar PDF</button>}
                <button className="btn-ghost btn-sm" disabled={busy} style={{ color: "var(--danger)" }} onClick={() => { if (confirm(`¿Borrar «${c.title}»? No se puede deshacer.`)) void run(async () => { await post({ action: "delete", id: c.id }); return "Borrado."; }); }}>Borrar</button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function AdminMaamarim() {
  return <div style={{ maxWidth: 980, margin: "0 auto", padding: "8px 0 120px", color: "var(--text)" }}><AdminGate title="Admin · maamarim"><Panel /></AdminGate></div>;
}
