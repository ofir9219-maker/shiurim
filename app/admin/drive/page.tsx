"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/admin/AdminGate";
import SettingsPanel from "@/components/admin/SettingsPanel";
import ZonePanel from "@/components/admin/ZonePanel";
import { api, fmtDur, fmtSize, type CenterState, type Crumb, type Row } from "@/components/admin/dc-common";

type Sel = Record<string, { id: string; kind: string; name: string }>;
type Est = { files: number; minutes: number; approxFiles: number; falUsd: number; openaiUsd: number; totalUsd: number; etaMinutes: number; redo: number; byModel: Record<string, { minutes: number; usd: number }>; rows: { id: string; name: string; minutes: number; model: string; postprocess: string; collection: string; falUsd: number; openaiUsd: number; approx: boolean; redo: boolean }[] };

const usd = (n: number) => `US$ ${n.toFixed(n < 1 ? 3 : 2)}`;

function TreeNode({ id, name, depth, cur, onOpen, rootTick }: { id: string; name: string; depth: number; cur: string; onOpen: (id: string) => void; rootTick: number }) {
  const [open, setOpen] = useState(depth === 0);
  const [kids, setKids] = useState<Row[] | null>(null);
  useEffect(() => { if (open && !kids) void api<{ items: Row[] }>(`list?folderId=${id}&foldersOnly=1&limit=500`).then((r) => setKids(r.items.filter((x) => x.kind === "folder")), () => setKids([])); }, [open, kids, id]);
  useEffect(() => { setKids(null); }, [rootTick]);
  return (
    <li>
      <div className="dc-tn" style={{ paddingInlineStart: depth ? 0 : 0 }}>
        <button type="button" aria-label={open ? "Contraer" : "Expandir"} onClick={() => setOpen(!open)}>{open ? "▾" : "▸"}</button>
        <button type="button" className={cur === id ? "cur" : ""} onClick={() => onOpen(id)} dir="auto">📁 {name}</button>
      </div>
      {open && kids && !!kids.length && <ul>{kids.map((k) => <TreeNode key={k.id} id={k.id} name={k.name} depth={depth + 1} cur={cur} onOpen={onOpen} rootTick={rootTick} />)}</ul>}
    </li>
  );
}

function RootPicker({ onDone, current }: { onDone: () => void; current: boolean }) {
  const [folder, setFolder] = useState("root");
  const [rows, setRows] = useState<Row[]>([]); const [crumbs, setCrumbs] = useState<Crumb[]>([]); const [err, setErr] = useState("");
  useEffect(() => { api<{ items: Row[]; breadcrumbs: Crumb[] }>(`list?folderId=${folder}&foldersOnly=1&limit=500`).then((r) => { setRows(r.items.filter((x) => x.kind === "folder")); setCrumbs(r.breadcrumbs); setErr(""); }, (e) => setErr(e.message)); }, [folder]);
  const choose = async () => { const c = crumbs[crumbs.length - 1]; if (!c || c.id === "root") return setErr("Entra a la carpeta que quieres usar como General."); await api("root", { method: "POST", body: { folderId: c.id, name: c.name } }); onDone(); };
  return (
    <section className="card" style={{ padding: "var(--sp-4)" }}>
      <h2>Elige la carpeta General</h2>
      <p className="muted">Navega por tu Drive y entra a la carpeta que contiene todas tus series (o a una sola serie). El centro mostrará todo lo que haya dentro.</p>
      <div className="dc-crumbs">{crumbs.map((c, i) => <span key={c.id}>{i > 0 && " / "}<button type="button" onClick={() => setFolder(c.id)}>{c.name}</button></span>)}</div>
      <ul className="dc-list">{rows.map((r) => <li key={r.id} className="dc-row" style={{ gridTemplateColumns: "1fr" }}><button type="button" className="btn-ghost btn btn-sm" style={{ justifyContent: "flex-start" }} onClick={() => setFolder(r.id)} dir="auto">📁 {r.name}</button></li>)}</ul>
      {err && <p className="dc-err">{err}</p>}
      <div className="dc-bar" style={{ marginTop: 12 }}>
        <button className="btn" onClick={choose} disabled={crumbs.length < 2}>Usar “{crumbs[crumbs.length - 1]?.name ?? "…"}” como carpeta General</button>
        {current && <button className="btn-ghost" onClick={onDone}>Cancelar</button>}
      </div>
    </section>
  );
}

function Center() {
  const [st, setSt] = useState<CenterState | null>(null);
  const [picking, setPicking] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [data, setData] = useState<{ breadcrumbs: Crumb[]; path: string[]; items: Row[]; total: number; next: number | null; inherited: { name: string } | null } | null>(null);
  const [q, setQ] = useState(""); const [found, setFound] = useState<(Row & { where?: string; path?: string[]; parentId?: string })[] | null>(null);
  const [sel, setSel] = useState<Sel>({}); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [est, setEst] = useState<Est | null>(null); const [panel, setPanel] = useState<{ id: string; name: string } | null>(null);
  const [logId, setLogId] = useState<string | null>(null); const [tick, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadState = useCallback(() => api<CenterState>("state").then(setSt).catch((e) => setMsg(e.message)), []);
  const loadList = useCallback(async (id: string, offset = 0) => {
    const r = await api<NonNullable<typeof data>>(`list?folderId=${id}&offset=${offset}&limit=200`);
    setData((d) => (offset && d ? { ...r, items: [...d.items, ...r.items] } : r));
  }, []);
  useEffect(() => { void loadState(); const t = setInterval(() => void loadState(), 6000); return () => clearInterval(t); }, [loadState]);
  useEffect(() => { if (st?.root && !folder) setFolder(st.root.id); }, [st?.root, folder]);
  useEffect(() => { if (folder) { setData(null); setSel({}); setFound(null); setQ(""); loadList(folder).catch((e) => setMsg(e.message)); } }, [folder, loadList]);
  // refresh statuses while jobs are active
  useEffect(() => { const active = st?.queue.pending; if (!active || !folder) return; const t = setInterval(() => void api<NonNullable<typeof data>>(`list?folderId=${folder}&limit=${Math.max(200, data?.items.length ?? 0)}`).then(setData).catch(() => {}), 5000); return () => clearInterval(t); }, [st?.queue.pending, folder, data?.items.length]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setFound(null); return; }
    timer.current = setTimeout(() => void api<{ items: NonNullable<typeof found> }>(`search?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.items)).catch((e) => setMsg(e.message)), 450);
  }, [q]);

  const toggle = (r: Row) => setSel((s) => { const n = { ...s }; if (n[r.id]) delete n[r.id]; else n[r.id] = { id: r.id, kind: r.kind === "folder" ? "folder" : "audio", name: r.name }; return n; });
  const selectable = (data?.items ?? []).filter((r) => r.kind !== "file");
  const allOn = selectable.length > 0 && selectable.every((r) => sel[r.id]);
  const nsel = Object.keys(sel).length;

  const doEstimate = async () => {
    setBusy(true); setMsg("");
    try { setEst(await api<Est>("estimate", { method: "POST", body: { ids: Object.values(sel), path: data!.path } })); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const confirm = async () => {
    setBusy(true);
    try { const r = await api<{ queued: number; files: number }>("enqueue", { method: "POST", body: { ids: Object.values(sel), path: data!.path } }); setMsg(`${r.queued} archivo(s) en cola.`); setEst(null); setSel({}); await loadState(); if (folder) await loadList(folder); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const retry = async (r: Row) => {
    setBusy(true);
    try { if (r.status === "error") await api("retry", { method: "POST", body: { id: r.id } }); else await api("enqueue", { method: "POST", body: { ids: [{ id: r.id, kind: "audio" }], path: data!.path } }); setMsg("Reintentando…"); if (folder) await loadList(folder); await loadState(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const undo = async (r: Row) => {
    if (!window.confirm(`¿Deshacer el renombrado de «${r.name}»? Se restauran los nombres anteriores del audio, .md y .json en Drive.`)) return;
    setBusy(true);
    try { const j = await api<{ restored: { from: string; to: string }[] }>("undo-rename", { method: "POST", body: { id: r.id } }); setMsg(`Renombrado deshecho (${j.restored.length} archivo[s]).`); if (folder) await loadList(folder); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const probe = async (r: Row) => { try { const j = await api<{ durationMs: number }>(`duration?id=${r.id}`); setData((d) => d && { ...d, items: d.items.map((x) => (x.id === r.id ? { ...x, durationMs: j.durationMs } : x)) }); } catch (e) { setMsg((e as Error).message); } };
  const open = (id: string) => { setFolder(id); setFound(null); setQ(""); };

  if (!st) return <div className="dc"><p className="muted">Cargando…</p></div>;
  const shown = (data?.items ?? []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const row = (r: Row, extra?: string) => (
    <li key={r.id} className="dc-row">
      {r.kind !== "file" ? <input type="checkbox" checked={!!sel[r.id]} onChange={() => toggle(r)} aria-label={`Seleccionar ${r.name}`} /> : <span />}
      <span aria-hidden>{r.kind === "folder" ? "📁" : r.kind === "audio" ? "🎧" : "📄"}</span>
      <div className="dc-name" dir="auto">
        {r.kind === "folder" ? <button type="button" onClick={() => open(r.id)}>{r.name}</button> : <span style={r.kind === "file" ? { color: "var(--muted)" } : undefined}>{r.name}</span>}
        <small>
          {extra}
          {r.kind === "folder" && r.collection && <>Serie: <b>{r.collection.name}</b> · {r.collection.published ? "publicada en la web" : "no publicada"}</>}
          {r.kind === "audio" && <>{fmtSize(r.size)} · {r.durationMs ? fmtDur(r.durationMs) : <button type="button" className="chip chip-sm" style={{ cursor: "pointer" }} onClick={() => probe(r)}>calcular duración</button>}{r.hasMd && !r.hasJson ? " · con .md" : ""}{r.hasJson ? " · con .json" : ""}</>}
          {r.kind === "audio" && r.error && <span className="dc-err"> · {r.error.slice(0, 160)}</span>}
        </small>
      </div>
      <div className="dc-acts">
        {r.kind === "audio" && <span className="badge" data-s={r.status}>{r.label}</span>}
        {r.kind === "folder" && <button type="button" className="btn-ghost btn-sm btn" onClick={() => setPanel({ id: r.id, name: r.name })}>⚙ Ajustes</button>}
        {r.kind === "audio" && <>
          <button type="button" className="btn-ghost btn-sm btn" disabled={busy || r.status === "transcribing" || r.status === "polishing"} onClick={() => retry(r)}>{r.status === "error" ? "Reintentar" : r.status === "none" ? "Transcribir" : "Rehacer"}</button>
          {r.status !== "none" && <button type="button" className="btn-ghost btn-sm btn" onClick={() => setLogId(r.id)}>Ver log</button>}
          <a className="btn-ghost btn-sm btn" href={`https://drive.google.com/file/d/${r.id}/view`} target="_blank" rel="noreferrer">Abrir en Drive</a>
          {r.undoable && <button type="button" className="btn-ghost btn-sm btn" disabled={busy} onClick={() => undo(r)}>Deshacer renombrado</button>}
          {r.inWeb && <Link className="btn-ghost btn-sm btn" href={`/shiur/${r.id}`} target="_blank">Abrir en la web</Link>}
        </>}
      </div>
    </li>
  );

  return (
    <div className="dc">
      <span className="eyebrow">Admin</span>
      <h1>Centro de transcripción</h1>
      <div className="dc-strip">
        <span className="chip chip-sm">Drive: {st.drive.connected ? `conectado${st.drive.email ? ` (${st.drive.email})` : ""}` : "no conectado"}</span>
        <span className="chip chip-sm">Cola: {st.queue.running ? "trabajando" : "libre"} · {st.queue.pending} pendiente(s)</span>
        <span className="chip chip-sm">Series: {st.collections.length}</span>
        <Link className="chip" href="/admin">Estado / costos</Link><Link className="chip" href="/admin/maamarim">Maamarim</Link>
        {st.root && !picking && <button className="chip" onClick={() => setPicking(true)}>Carpeta general: {st.root.name || st.root.id} (cambiar)</button>}
      </div>
      {!st.drive.connected && <p className="card" style={{ padding: 12 }}>Google Drive no está conectado. <a href="/api/admin/google/start" className="btn btn-sm">Conectar Google Drive</a></p>}
      {msg && <p role="status" className="card" style={{ padding: 10 }} onClick={() => setMsg("")}>{msg}</p>}

      {(!st.root || picking) ? <RootPicker current={!!st.root} onDone={() => { setPicking(false); setFolder(null); setTick((t) => t + 1); void loadState(); }} /> : (
        <div className="dc-grid">
          <nav className="card dc-tree" aria-label="Carpetas">
            <ul><TreeNode id={st.root.id} name={st.root.name || "General"} depth={0} cur={folder ?? ""} onOpen={open} rootTick={tick} /></ul>
          </nav>
          <section>
            <div className="dc-crumbs" aria-label="Ruta">{data?.breadcrumbs.map((c, i) => <span key={c.id}>{i > 0 && " / "}<button type="button" onClick={() => open(c.id)} dir="auto">{c.name}</button></span>)}</div>
            <div className="dc-bar">
              <input className="input grow" type="search" placeholder="Buscar por nombre (en esta carpeta y en toda la General)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" />
              <button className="btn-ghost btn btn-sm" onClick={() => { void api("refresh", { method: "POST" }).then(() => { if (folder) void loadList(folder); }); setTick((t) => t + 1); }}>Actualizar</button>
              {folder && <button className="btn btn-sm" onClick={() => setPanel({ id: folder, name: data?.breadcrumbs.at(-1)?.name ?? "" })}>⚙ Ajustes de esta carpeta</button>}
            </div>
            {data?.inherited && <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>Esta carpeta pertenece a la serie «{data.inherited.name}».</p>}
            {!data ? <div className="skeleton" style={{ height: 120 }} /> : (
              <div className="card flat" style={{ padding: 0 }}>
                <div className="dc-row" style={{ minHeight: 44 }}>
                  <input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? {} : Object.fromEntries(selectable.map((r) => [r.id, { id: r.id, kind: r.kind === "folder" ? "folder" : "audio", name: r.name }])))} aria-label="Seleccionar todo" />
                  <span /><span className="muted">{data.total} elemento(s)</span><span />
                </div>
                <ul className="dc-list">
                  {shown.map((r) => row(r))}
                  {!shown.length && <li className="state"><h2>Carpeta vacía</h2></li>}
                </ul>
                {data.next !== null && <div style={{ padding: 12, textAlign: "center" }}><button className="btn-ghost btn" onClick={() => folder && loadList(folder, data.next!)}>Cargar más</button></div>}
              </div>)}
            {found && <div className="card" style={{ marginTop: 12, padding: 0 }}><h2 style={{ padding: "12px 16px 0" }}>Resultados en toda la carpeta General</h2><ul className="dc-list">{found.length ? found.map((r) => row(r as Row, `${(r as { where?: string }).where} · `)) : <li className="state"><p>Sin resultados</p></li>}</ul></div>}
          </section>
        </div>)}

      <ZonePanel />

      {nsel > 0 && (
        <div className="dc-sel" role="region" aria-label="Selección">
          <b>{nsel} seleccionado(s)</b>
          <button className="btn" disabled={busy} onClick={doEstimate}>{busy ? "Calculando…" : "Transcribir selección"}</button>
          <button className="btn-ghost btn" onClick={() => setSel({})}>Limpiar</button>
        </div>)}

      {est && (<>
        <div className="drawer-backdrop" onClick={() => setEst(null)} />
        <aside className="drawer side" role="dialog" aria-label="Estimado">
          <div className="dc-x"><h2>Estimado</h2><button className="btn-ghost btn-icon btn" onClick={() => setEst(null)} aria-label="Cerrar">✕</button></div>
          <p><b>{est.files}</b> audio(s) · <b>{(est.minutes / 60).toFixed(1)} h</b> ({Math.round(est.minutes)} min){est.approxFiles ? ` · ${est.approxFiles} sin duración conocida (estimada por tamaño)` : ""}</p>
          <table className="dc-table"><tbody>
            {Object.entries(est.byModel).map(([m, v]) => <tr key={m}><td>{m.startsWith("assemblyai/") ? "AssemblyAI" : "Fal"} · {m.replace(/^(fal-ai|assemblyai)\//, "")}</td><td>{Math.round(v.minutes)} min</td><td>{usd(v.usd)}</td></tr>)}
            {est.openaiUsd > 0 && <tr><td>OpenAI (pulido, aprox.)</td><td /><td>{usd(est.openaiUsd)}</td></tr>}
            <tr><th>Total estimado</th><td /><th>{usd(est.totalUsd)}</th></tr>
          </tbody></table>
          <p className="muted">Tiempo aproximado: {est.etaMinutes < 90 ? `${est.etaMinutes} min` : `${(est.etaMinutes / 60).toFixed(1)} h`} (cola de a un archivo).{est.redo ? ` ${est.redo} ya tenían resultado: se volverán a generar y sus .md/.json en Drive se sobrescribirán (los audios nunca se borran).` : ""}</p>
          <details><summary>Detalle por archivo</summary>
            <table className="dc-table"><tbody>{est.rows.slice(0, 200).map((r) => <tr key={r.id}><td dir="auto">{r.name}</td><td>{Math.round(r.minutes)} min{r.approx ? "~" : ""}</td><td>{r.postprocess}</td></tr>)}</tbody></table>
          </details>
          <div className="dc-bar" style={{ marginTop: 14 }}><button className="btn" disabled={busy} onClick={confirm}>Confirmar y encolar</button><button className="btn-ghost btn" onClick={() => setEst(null)}>Cancelar</button></div>
        </aside></>)}

      {panel && <SettingsPanel folderId={panel.id} folderName={panel.name} state={st} onClose={() => setPanel(null)} onSaved={() => { void loadState(); if (folder) void loadList(folder); setTick((t) => t + 1); }} />}
      {logId && <LogPanel id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}

function LogPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const [it, setIt] = useState<{ renames?: { kind: string; oldName: string; newName: string; at: string; undoneAt?: string }[]; name: string; state: string; status: string; error?: string; log: { at: string; msg: string }[]; cost: { falMinutes: number; promptTokens: number; completionTokens: number; falUsd?: number; openaiUsd?: number } } | null>(null);
  useEffect(() => { const f = () => void api<NonNullable<typeof it>>(`job?id=${id}`).then(setIt).catch(() => setIt(null)); f(); const t = setInterval(f, 3000); return () => clearInterval(t); }, [id]);
  return (<>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className="drawer side" role="dialog" aria-label="Log">
      <div className="dc-x"><h2>Log</h2><button className="btn-ghost btn-icon btn" onClick={onClose} aria-label="Cerrar">✕</button></div>
      {!it ? <p className="muted">Sin trabajo registrado para este archivo.</p> : <>
        <p dir="auto"><b>{it.name}</b><br />{it.state} · {it.status}{it.error ? ` · ${it.error}` : ""}</p>
        <p className="muted">Transcripción {it.cost.falMinutes.toFixed(1)} min{it.cost.falUsd ? ` (${usd(it.cost.falUsd)})` : ""} · OpenAI {it.cost.promptTokens.toLocaleString("es")}/{it.cost.completionTokens.toLocaleString("es")} tok{it.cost.openaiUsd ? ` (${usd(it.cost.openaiUsd)})` : ""}</p>
        {!!it.renames?.length && <><h2>Renombrados</h2><table className="dc-table"><tbody>{it.renames.map((x, i) => <tr key={i}><td>{x.kind}</td><td dir="auto">{x.oldName || "(creado)"} → {x.newName}</td><td>{x.undoneAt ? "deshecho" : ""}</td></tr>)}</tbody></table></>}
        <pre className="dc-log" dir="auto">{it.log.map((l) => `${new Date(l.at).toLocaleTimeString("es")}  ${l.msg}`).join("\n")}</pre></>}
    </aside></>);
}

export default function Page() { return <AdminGate title="Centro de transcripción"><Center /></AdminGate>; }
