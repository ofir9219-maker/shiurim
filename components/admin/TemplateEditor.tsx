"use client";
import type { ReactNode } from "react";
import { PRESETS, SAMPLE, TEMPLATE_VARS, VAR_HELP, finalName, validateRendered, validateTemplate } from "@/lib/center/templates";

/** Naming template editor: presets, free text, variable chips and a live preview with a sample class. */
export default function TemplateEditor(p: {
  template?: string; inherited: string; inheritedFrom: string; obra?: string; inheritedObra: string;
  onTemplate: (v: string) => void; onObra: (v: string) => void; hint: (k: any, own: unknown, show: string) => ReactNode;
}) {
  const effective = p.template ?? p.inherited;
  const terrs = validateTemplate(effective);
  const vars = { ...SAMPLE, obra: (p.obra ?? p.inheritedObra) || SAMPLE.obra };
  const prev = terrs.length ? null : finalName(effective, vars);
  const rerrs = terrs.length ? [] : validateRendered(effective, vars);
  return (<>
    <div>
      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Plantillas predefinidas</span>
      <div className="dc-strip" style={{ marginTop: 6 }}>
        {PRESETS.map((x) => <button key={x.id} type="button" className="chip" aria-pressed={p.template === x.template} onClick={() => p.onTemplate(x.template)}>{x.label}</button>)}
        {p.template !== undefined && <button type="button" className="chip" onClick={() => p.onTemplate("")}>Heredar</button>}
      </div>
    </div>
    <label>Plantilla<input className="input he" dir="auto" value={p.template ?? ""} onChange={(e) => p.onTemplate(e.target.value)} placeholder={`Heredar (${p.inherited})`} spellCheck={false} />{p.hint("template", p.template, p.inherited)}</label>
    <div className="dc-strip" aria-label="Variables">
      {TEMPLATE_VARS.map((v) => <button key={v} type="button" className="chip chip-sm" style={{ cursor: "pointer" }} title={VAR_HELP[v]} onClick={() => p.onTemplate(`${p.template ?? p.inherited}{${v}}`)}>{`{${v}}`}</button>)}
    </div>
    <label>Obra fija para {"{obra}"} (opcional; vacío = la IA la determina)<input className="input he" dir="auto" value={p.obra ?? ""} onChange={(e) => p.onObra(e.target.value)} placeholder={p.inheritedObra || "p. ej. ברכות"} /></label>
    <div>
      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>Vista previa con una clase de ejemplo</span>
      {prev ? <div className="dc-prev" dir="rtl" lang="he">{prev.newName}</div> : null}
      {[...terrs, ...rerrs].map((e) => <p key={e} className="dc-err">{e}</p>)}
      <p className="muted" style={{ fontSize: "var(--fs-xs)" }}>Ejemplo: n=27, daf ז ע׳׳א, temas «בלעם, תשובה». La extensión se agrega sola. El nombre del audio, el .md y el .json cambian juntos (con «Deshacer renombrado» por archivo).</p>
    </div>
  </>);
}
