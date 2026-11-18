"use client";
import { useEffect, useState } from "react";
import { api, type CenterState } from "./dc-common";
import TemplateEditor from "./TemplateEditor";

type Own = {
  transcription?: { model?: string; language?: string }; autoSync?: boolean; postprocess?: string; openai?: { model?: string; effort?: string };
  naming?: { mode?: string; template?: string; obra?: string }; allowHebrew?: boolean; aiCopyToDrive?: boolean; publish?: { title?: string; description?: string };
};
type Resolved = { model: string; language: string; autoSync: boolean; postprocess: string; openaiModel: string; openaiEffort: string; namingMode: string; template: string; obra: string; allowHebrew: boolean; aiCopyToDrive: boolean };
type Info = { path: string[]; own: { name: string; slug: string; published: boolean; settings: Own } | null; parentResolved: Resolved; parentFrom: Record<string, string>; names: Record<string, string>; name: string };

const POST_LABEL: Record<string, string> = { none: "Sin pulido (transcripción cruda)", openai: "Pulido con OpenAI", ai_package: "Zona IA (JSON)" };

export default function SettingsPanel({ folderId, folderName, state, onClose, onSaved }: { folderId: string; folderName: string; state: CenterState; onClose: () => void; onSaved: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [o, setO] = useState<Own>({}); const [name, setName] = useState(folderName); const [slug, setSlug] = useState(""); const [published, setPublished] = useState(false);
  const [oaModels, setOaModels] = useState<string[]>([]); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Info>(`resolve?folderId=${folderId}`).then((i) => { setInfo(i); setO(i.own?.settings ?? {}); setName(i.own?.name ?? i.name ?? folderName); setSlug(i.own?.slug ?? ""); setPublished(i.own?.published ?? false); }, (e) => setMsg(e.message));
    api<{ models: string[] }>("openai-models").then((r) => setOaModels(r.models), () => {});
  }, [folderId, folderName]);
  if (!info) return <><div className="drawer-backdrop" onClick={onClose} /><aside className="drawer side"><p className="muted">{msg || "Cargando…"}</p></aside></>;

  const P = info.parentResolved;
  const src = (k: string) => (info.parentFrom[k] === "default" ? "la configuración general" : `la carpeta «${info.names[info.parentFrom[k]] ?? "superior"}»`);
  const upd = (g: keyof Own | "", k: string, v: unknown) => setO((cur) => {
    const n: Record<string, any> = JSON.parse(JSON.stringify(cur));
    if (!g) { if (v === "" || v === undefined) delete n[k]; else n[k] = v; }
    else { n[g] = { ...(n[g] ?? {}) }; if (v === "" || v === undefined) delete n[g][k]; else n[g][k] = v; if (!Object.keys(n[g]).length) delete n[g]; }
    return n;
  });
  const bool = (v: boolean | undefined) => (v === undefined ? "" : v ? "1" : "0");
  const hint = (k: keyof Resolved, own: unknown, show: string) => (own === undefined || own === "" ? <span className="src">Automático: {show} — se toma de {src(k)}</span> : <span className="src">Elegido para esta carpeta</span>);

  const save = async () => {
    setBusy(true); setMsg("");
    try { await api("collection", { method: "PUT", body: { folderId, name, slug: slug || undefined, published, settings: o } }); setMsg("Guardado."); onSaved(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm("¿Quitar la configuración de esta carpeta? Usará la misma configuración que su carpeta superior (los archivos no se tocan).")) return;
    await fetch(`/api/admin/center/collection?folderId=${folderId}`, { method: "DELETE" }); onSaved(); onClose();
  };
  const models = state.models;
  const sel = (v: string | undefined, onChange: (v: string) => void, opts: [string, string][], inheritLabel: string) => (
    <select className="input" value={v ?? ""} onChange={(e) => onChange(e.target.value)}><option value="">{inheritLabel}</option>{opts.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>);

  return (<>
    <div className="drawer-backdrop" onClick={onClose} />
    <aside className="drawer side" role="dialog" aria-label="Ajustes de la carpeta" style={{ width: "min(520px, 94vw)" }}>
      <div className="dc-x"><h2 dir="auto">Ajustes · {folderName}</h2><button className="btn-ghost btn-icon btn" onClick={onClose} aria-label="Cerrar">✕</button></div>
      <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>{info.own ? "Esta carpeta es una serie." : "Esta carpeta aún no es una serie: al guardar lo será."} Cada opción puede quedar en «Automático»: entonces esta carpeta usa lo mismo que su carpeta superior (o la configuración general si no hay ninguna). Si eliges un valor, solo cambia para esta carpeta y sus subcarpetas.</p>
      <div className="dc-form">
        <fieldset><legend>Serie y publicación</legend>
          <label>Nombre de la serie<input className="input" value={name} onChange={(e) => setName(e.target.value)} dir="auto" /></label>
          <label>Dirección en la web (/c/…)<input className="input" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="se genera del nombre" /></label>
          <label style={{ display: "flex", gap: 10, alignItems: "center", color: "var(--text)" }}><input type="checkbox" style={{ width: 22, height: 22, accentColor: "var(--ink)" }} checked={published} onChange={(e) => setPublished(e.target.checked)} /> Publicar en la web</label>
          {published && <><label>Título de la sección<input className="input" value={o.publish?.title ?? ""} onChange={(e) => upd("publish", "title", e.target.value)} placeholder={name} dir="auto" /></label>
            <label>Descripción<textarea className="input" rows={3} value={o.publish?.description ?? ""} onChange={(e) => upd("publish", "description", e.target.value)} /></label></>}
        </fieldset>
        <fieldset><legend>Transcripción (Fal)</legend>
          <label>Modelo{sel(o.transcription?.model, (v) => upd("transcription", "model", v), models.map((m) => [m.id, m.label]), `Automático (${models.find((m) => m.id === P.model)?.label ?? P.model})`)}{hint("model", o.transcription?.model, models.find((m) => m.id === P.model)?.label ?? P.model)}</label>
          <label>Idioma{sel(o.transcription?.language, (v) => upd("transcription", "language", v), state.languages.map((l) => [l.code, l.label]), `Automático (${state.languages.find((l) => l.code === P.language)?.label ?? P.language})`)}{hint("language", o.transcription?.language, P.language)}</label>
          <label>Sincronización automática{sel(bool(o.autoSync), (v) => upd("", "autoSync", v === "" ? undefined : v === "1"), [["1", "Sí: transcribir audios nuevos"], ["0", "No"]], `Automático (${P.autoSync ? "sí" : "no"})`)}{hint("autoSync", o.autoSync, P.autoSync ? "sí" : "no")}</label>
        </fieldset>
        <fieldset><legend>Después de transcribir</legend>
          <label>Posproceso{sel(o.postprocess, (v) => upd("", "postprocess", v), Object.entries(POST_LABEL), `Automático (${POST_LABEL[P.postprocess]})`)}{hint("postprocess", o.postprocess, POST_LABEL[P.postprocess])}</label>
          <label>Modelo OpenAI<input className="input" list="oa-models" value={o.openai?.model ?? ""} onChange={(e) => upd("openai", "model", e.target.value)} placeholder={`Automático (${P.openaiModel})`} /><datalist id="oa-models">{oaModels.map((m) => <option key={m} value={m} />)}</datalist>{hint("openaiModel", o.openai?.model, P.openaiModel)}</label>
          <label>Esfuerzo (razonamiento){sel(o.openai?.effort, (v) => upd("openai", "effort", v), state.efforts.map((e) => [e, e]), `Automático (${P.openaiEffort})`)}{hint("openaiEffort", o.openai?.effort, P.openaiEffort)}</label>
          <label>Letras hebreas en la transcripción{sel(bool(o.allowHebrew), (v) => upd("", "allowHebrew", v === "" ? undefined : v === "1"), [["0", "No: transliteración latina"], ["1", "Sí: se permiten"]], `Automático (${P.allowHebrew ? "sí" : "no"})`)}{hint("allowHebrew", o.allowHebrew, P.allowHebrew ? "sí" : "no")}</label>
          {(o.postprocess ?? P.postprocess) === "ai_package" && <label>Zona IA: copiar también a Drive{sel(bool(o.aiCopyToDrive), (v) => upd("", "aiCopyToDrive", v === "" ? undefined : v === "1"), [["0", "No (solo la cola de la Zona IA)"], ["1", "Sí: escribir <nombre>.ai.json junto al audio"]], `Automático (${P.aiCopyToDrive ? "sí" : "no"})`)}{hint("aiCopyToDrive", o.aiCopyToDrive, P.aiCopyToDrive ? "sí" : "no")}</label>}
        </fieldset>
        <fieldset><legend>Nombres de los archivos</legend>
          <label>Modo{sel(o.naming?.mode, (v) => upd("naming", "mode", v), [["keep", "Mantener el nombre original"], ["template", "Renombrar con plantilla"]], `Automático (${P.namingMode === "keep" ? "mantener" : "plantilla"})`)}{hint("namingMode", o.naming?.mode, P.namingMode)}</label>
          <TemplateEditor template={o.naming?.template} inherited={P.template} inheritedFrom={src("template")} obra={o.naming?.obra} inheritedObra={P.obra}
            onTemplate={(v) => upd("naming", "template", v)} onObra={(v) => upd("naming", "obra", v)} hint={hint} />
        </fieldset>
        {msg && <p role="status" className={msg === "Guardado." ? "muted" : "dc-err"}>{msg}</p>}
        <div className="dc-bar"><button className="btn" disabled={busy} onClick={save}>Guardar</button>{info.own && <button className="btn-ghost btn" onClick={remove}>Quitar configuración</button>}</div>
      </div>
    </aside></>);
}
