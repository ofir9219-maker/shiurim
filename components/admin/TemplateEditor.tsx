"use client";
import type { ReactNode } from "react";

/** Naming template field (Phase 2 adds presets and a live preview). */
export default function TemplateEditor(p: {
  template?: string; inherited: string; inheritedFrom: string; obra?: string; inheritedObra: string;
  onTemplate: (v: string) => void; onObra: (v: string) => void; hint: (k: any, own: unknown, show: string) => ReactNode;
}) {
  return (<>
    <label>Plantilla<input className="input he" dir="auto" value={p.template ?? ""} onChange={(e) => p.onTemplate(e.target.value)} placeholder={`Heredar (${p.inherited})`} />{p.hint("template", p.template, p.inherited)}</label>
    <label>Obra / serie ({"{obra}"})<input className="input he" dir="auto" value={p.obra ?? ""} onChange={(e) => p.onObra(e.target.value)} placeholder={p.inheritedObra || "p. ej. ברכות"} /></label>
  </>);
}
