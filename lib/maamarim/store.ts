// Maamarim store on the persistent volume: $STORAGE_DIR/maamarim/{items/<id>.json, categories.json}.
// Library order: category tree (codes like 2.1) -> call number <code>.<seq>.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { STORAGE_DIR, readJson, writeJson } from "../storage";
import { parseMarkup, resolvePending, htmlToText, wordCount } from "./markup";
import { resolveQuote } from "./sefaria";
import type { Category, CategoryNode, Ficha, Maamar, MaamarCard, Section } from "./types";

export const MAAMARIM_DIR = () => path.join(STORAGE_DIR, "maamarim");
const ITEMS = () => path.join(MAAMARIM_DIR(), "items");
const CATS = () => path.join(MAAMARIM_DIR(), "categories.json");
const ID_RE = /^[a-z0-9]{6,24}$/;
export const validId = (id: unknown): id is string => typeof id === "string" && ID_RE.test(id);

// ---------- categories ----------
export function listCategories(): Category[] { return readJson<Category[]>(CATS(), []); }
function saveCategories(c: Category[]) { writeJson(CATS(), c); bump(); }
const newCatId = () => "c" + crypto.randomBytes(4).toString("hex");
const cleanName = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 80) : "");

/** Find or create a category path (by names, case/space-insensitive). Returns the leaf id. */
export function ensureCategoryPath(names: string[]): string {
  const cats = listCategories();
  let parent: string | null = null, changed = false;
  for (const raw of names.map(cleanName).filter(Boolean).slice(0, 4)) {
    const key = raw.toLowerCase();
    let c = cats.find((x) => x.parentId === parent && x.name.toLowerCase() === key);
    if (!c) {
      const order = Math.max(0, ...cats.filter((x) => x.parentId === parent).map((x) => x.order)) + 1;
      c = { id: newCatId(), name: raw, parentId: parent, order };
      cats.push(c); changed = true;
    }
    parent = c.id;
  }
  if (changed) saveCategories(cats);
  if (!parent) return ensureCategoryPath(["כללי"]);
  return parent;
}

export function updateCategory(id: string, patch: { name?: string; parentId?: string | null; order?: number; description?: string }): Category {
  const cats = listCategories();
  const c = cats.find((x) => x.id === id);
  if (!c) throw new Error("categoría no encontrada");
  if (patch.name !== undefined) { const n = cleanName(patch.name); if (!n) throw new Error("nombre vacío"); c.name = n; }
  if (patch.parentId !== undefined) {
    if (patch.parentId !== null && !cats.some((x) => x.id === patch.parentId)) throw new Error("categoría padre no encontrada");
    // no cycles
    for (let p = patch.parentId; p; p = cats.find((x) => x.id === p)?.parentId ?? null) if (p === id) throw new Error("no se puede mover dentro de sí misma");
    c.parentId = patch.parentId;
  }
  if (patch.order !== undefined && Number.isFinite(patch.order)) c.order = Number(patch.order);
  if (patch.description !== undefined) c.description = String(patch.description).slice(0, 400) || undefined;
  saveCategories(cats);
  return c;
}
export function createCategory(name: string, parentId: string | null): Category {
  const cats = listCategories();
  if (parentId && !cats.some((x) => x.id === parentId)) throw new Error("categoría padre no encontrada");
  const n = cleanName(name); if (!n) throw new Error("nombre vacío");
  const c: Category = { id: newCatId(), name: n, parentId, order: Math.max(0, ...cats.filter((x) => x.parentId === parentId).map((x) => x.order)) + 1 };
  cats.push(c); saveCategories(cats); return c;
}
export function deleteCategory(id: string) {
  const cats = listCategories();
  if (cats.some((x) => x.parentId === id)) throw new Error("la categoría tiene subcategorías");
  if (listMaamarim().some((m) => m.categoryId === id)) throw new Error("la categoría tiene maamarim; muévelos antes");
  saveCategories(cats.filter((x) => x.id !== id));
}

export function categoryTree(): CategoryNode[] {
  const cats = listCategories();
  const counts = new Map<string, number>();
  for (const m of listMaamarim()) counts.set(m.categoryId, (counts.get(m.categoryId) ?? 0) + 1);
  const sort = (a: Category, b: Category) => a.order - b.order || a.name.localeCompare(b.name, "he");
  const build = (parent: string | null, prefix: string, ppath: string[]): CategoryNode[] =>
    cats.filter((c) => c.parentId === parent).sort(sort).map((c, i) => {
      const code = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      const p = [...ppath, c.name];
      const children = build(c.id, code, p);
      const count = counts.get(c.id) ?? 0;
      return { ...c, code, path: p, count, total: count + children.reduce((a, x) => a + x.total, 0), children };
    });
  return build(null, "", []);
}
export function flatTree(nodes = categoryTree()): CategoryNode[] { return nodes.flatMap((n) => [n, ...flatTree(n.children)]); }

// ---------- maamarim ----------
let cacheAt = 0; let cache: Maamar[] | null = null; let version = 0;
const bump = () => { cache = null; version++; };
export const storeVersion = () => version;

export function listMaamarim(): Maamar[] {
  if (cache && Date.now() - cacheAt < 5000) return cache;
  let files: string[] = [];
  try { files = fs.readdirSync(ITEMS()).filter((f) => f.endsWith(".json")); } catch { /* none yet */ }
  cache = files.map((f) => readJson<Maamar | null>(path.join(ITEMS(), f), null)).filter((m): m is Maamar => !!m && validId(m.id));
  cacheAt = Date.now();
  return cache;
}
export function getMaamar(id: string): Maamar | null {
  if (!validId(id)) return null;
  return readJson<Maamar | null>(path.join(ITEMS(), `${id}.json`), null);
}
function saveMaamar(m: Maamar) { writeJson(path.join(ITEMS(), `${m.id}.json`), m); bump(); }
export function deleteMaamar(id: string): boolean {
  if (!validId(id)) return false;
  try { fs.rmSync(path.join(ITEMS(), `${id}.json`)); bump(); return true; } catch { return false; }
}

export function callNumber(m: Pick<Maamar, "categoryId" | "seq">, nodes = flatTree()): string {
  const code = nodes.find((n) => n.id === m.categoryId)?.code ?? "0";
  return `${code}.${String(m.seq).padStart(2, "0")}`;
}
export function plainSummary(m: Maamar): string {
  return m.ficha.summary_es || m.ficha.summary_he || htmlToText((m.sections[0]?.blocks.find((b) => b.t === "p") as { html: string } | undefined)?.html ?? "").slice(0, 280);
}
export function toCard(m: Maamar, nodes = flatTree()): MaamarCard {
  const node = nodes.find((n) => n.id === m.categoryId);
  return {
    id: m.id, title: m.title, subtitle: m.subtitle, source: m.source, date: m.date, dateIso: m.dateIso,
    categoryId: m.categoryId, categoryPath: node?.path ?? [], callNumber: callNumber(m, nodes), tags: m.tags,
    summary: plainSummary(m), sections: m.sections.length, words: wordCount(m.sections), hasPdf: !!m.pdf, updatedAt: m.updatedAt, createdAt: m.createdAt,
  };
}
/** Library order: catalog code, then seq. */
export function listCards(): MaamarCard[] {
  const nodes = flatTree();
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  return listMaamarim().slice().sort((a, b) => (order.get(a.categoryId) ?? 1e9) - (order.get(b.categoryId) ?? 1e9) || a.seq - b.seq).map((m) => toCard(m, nodes));
}

// ---------- upload ----------
export type UploadInput = {
  id?: string;
  markup?: string;
  title?: string; subtitle?: string; source?: string; date?: string; dateIso?: string;
  category?: string[] | string; categoryId?: string;
  tags?: string[] | string;
  ficha?: Partial<Ficha> & { sections?: { title?: string; summary?: string; keywords?: string[] }[] };
};

const strList = (v: unknown, max: number, len = 200): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n،;]/) : []).map((x) => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, len) : "")).filter(Boolean).slice(0, max);
const str = (v: unknown, len: number) => (typeof v === "string" ? v.trim().slice(0, len) : "") || undefined;

export function normalizeFicha(f: unknown): Ficha {
  const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
  const sources = (Array.isArray(o.sources) ? o.sources : []).map((s) => {
    if (typeof s === "string") return { label: s.trim().slice(0, 200) };
    const r = s as { ref?: unknown; label?: unknown };
    const label = str(r?.label, 200) || str(r?.ref, 200);
    return label ? { ref: str(r?.ref, 120), label } : null;
  }).filter((x): x is { ref: string | undefined; label: string } => !!x).slice(0, 60);
  return {
    summary_es: str(o.summary_es, 2000), summary_he: str(o.summary_he, 2000), thesis: str(o.thesis, 600),
    keywords: strList(o.keywords, 80, 80), sources, people: strList(o.people, 60, 80), concepts: strList(o.concepts, 60, 120),
    questions: strList(o.questions, 40, 300), rav: str(o.rav, 120), notes: str(o.notes, 2000),
  };
}

function applySectionEnrichment(sections: Section[], list: unknown) {
  if (!Array.isArray(list)) return;
  list.slice(0, 200).forEach((e, i) => {
    if (!e || typeof e !== "object") return;
    const r = e as { title?: unknown; summary?: unknown; keywords?: unknown };
    const byTitle = typeof r.title === "string" && r.title.trim() ? sections.find((s) => s.title.trim() === (r.title as string).trim()) : undefined;
    const s = byTitle ?? sections[i];
    if (!s) return;
    s.summary = str(r.summary, 800) ?? s.summary;
    const kw = strList(r.keywords, 30, 80); if (kw.length) s.keywords = kw;
  });
}

export const newMaamarId = () => "m" + crypto.randomBytes(5).toString("hex");

/** Create or replace a maamar from markup (+ ficha). Resolves @REF quotes from Sefaria. */
export async function upsertMaamar(input: UploadInput, opts: { resolve?: typeof resolveQuote } = {}): Promise<{ maamar: Maamar; warnings: string[]; created: boolean }> {
  const markup = typeof input.markup === "string" ? input.markup.slice(0, 600_000) : "";
  if (!markup.trim()) throw new Error("falta el texto del maamar (markup)");
  const parsed = parseMarkup(markup);
  const warnings = await resolvePending(parsed, opts.resolve ?? resolveQuote);
  const title = str(input.title, 200) || parsed.header.title;
  if (!title) throw new Error("falta el título (TITLE: en el texto o campo title)");
  if (!parsed.sections.length || wordCount(parsed.sections) < 20) throw new Error("el maamar no tiene contenido suficiente (usa # para los capítulos y párrafos de texto)");

  const prev = input.id ? getMaamar(input.id) : null;
  if (input.id && !validId(input.id)) throw new Error("id no válido");
  let categoryId: string;
  if (input.categoryId && listCategories().some((c) => c.id === input.categoryId)) categoryId = input.categoryId;
  else {
    const path = Array.isArray(input.category) ? input.category.map(String) : typeof input.category === "string" ? input.category.split(/\s*[/>›»]\s*/) : parsed.header.category;
    categoryId = path?.length ? ensureCategoryPath(path) : prev?.categoryId ?? ensureCategoryPath(["כללי"]);
  }
  const ficha = normalizeFicha({ ...(prev?.ficha ?? {}), ...(input.ficha ?? {}) });
  if (!ficha.rav && parsed.header.rav) ficha.rav = parsed.header.rav;
  applySectionEnrichment(parsed.sections, input.ficha?.sections);
  const tags = strList(input.tags ?? parsed.header.tags ?? prev?.tags ?? [], 30, 60);
  const now = new Date().toISOString();
  const sameCat = prev && prev.categoryId === categoryId;
  const seq = sameCat ? prev!.seq : Math.max(0, ...listMaamarim().filter((m) => m.categoryId === categoryId).map((m) => m.seq)) + 1;
  const dateIso = str(input.dateIso, 10) || parsed.header.dateIso || prev?.dateIso || now.slice(0, 10);
  const m: Maamar = {
    id: prev?.id ?? (input.id && validId(input.id) ? input.id : newMaamarId()),
    title, subtitle: str(input.subtitle, 300) || parsed.header.subtitle, source: str(input.source, 300) || parsed.header.source,
    date: str(input.date, 80) || parsed.header.date, dateIso: /^\d{4}-\d{2}-\d{2}$/.test(dateIso) ? dateIso : undefined,
    categoryId, tags, ficha, sections: parsed.sections, notes: parsed.notes, pdf: prev?.pdf, markup, seq,
    createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
  if (!ficha.summary_es && !ficha.summary_he) warnings.push("La ficha no trae resumen (summary_es / summary_he): la búsqueda IA funciona, pero mejor con resumen.");
  if (!ficha.questions?.length) warnings.push("La ficha no trae preguntas (questions): agregarlas mejora mucho la búsqueda IA.");
  saveMaamar(m);
  return { maamar: m, warnings, created: !prev };
}

export function patchMaamar(id: string, patch: { categoryId?: string; tags?: string[] | string; title?: string; subtitle?: string; date?: string; dateIso?: string; ficha?: Partial<Ficha>; pdf?: Maamar["pdf"] | null }): Maamar {
  const m = getMaamar(id);
  if (!m) throw new Error("maamar no encontrado");
  if (patch.categoryId && patch.categoryId !== m.categoryId) {
    if (!listCategories().some((c) => c.id === patch.categoryId)) throw new Error("categoría no encontrada");
    m.categoryId = patch.categoryId;
    m.seq = Math.max(0, ...listMaamarim().filter((x) => x.categoryId === patch.categoryId && x.id !== id).map((x) => x.seq)) + 1;
  }
  if (patch.tags !== undefined) m.tags = strList(patch.tags, 30, 60);
  if (patch.title !== undefined) { const t = str(patch.title, 200); if (!t) throw new Error("título vacío"); m.title = t; }
  if (patch.subtitle !== undefined) m.subtitle = str(patch.subtitle, 300);
  if (patch.date !== undefined) m.date = str(patch.date, 80);
  if (patch.dateIso !== undefined) m.dateIso = /^\d{4}-\d{2}-\d{2}$/.test(patch.dateIso) ? patch.dateIso : undefined;
  if (patch.ficha) m.ficha = normalizeFicha({ ...m.ficha, ...patch.ficha });
  if (patch.pdf !== undefined) m.pdf = patch.pdf ?? undefined;
  m.updatedAt = new Date().toISOString();
  saveMaamar(m);
  return m;
}
