// Collections (series) = Drive folders with their own settings, plus the General (root) folder setting.
// Stored in $STORAGE_DIR/collections.json and $STORAGE_DIR/center.json. Settings are inherited from the nearest configured ancestor.
import path from "node:path";
import { STORAGE_DIR, readJson, writeJson } from "../storage";
import { DEFAULT_FAL_MODEL, DEFAULT_LANGUAGE, isFalModel, liveModel, LANGUAGES, type FalModelId } from "./fal-models";

export const BERAJOT_FOLDER_ID = "1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5";
export const BERAJOT_TEMPLATE = "{n}. {obra} {daf} ע׳׳{amud} - {temas}";
export type Postprocess = "none" | "openai" | "ai_package";
export type NamingMode = "keep" | "template";

/** Partial settings as stored on a collection (undefined = inherit). */
export type Settings = {
  transcription?: { model?: FalModelId; language?: string };
  autoSync?: boolean;
  postprocess?: Postprocess;
  openai?: { model?: string; effort?: string };
  naming?: { mode?: NamingMode; template?: string; obra?: string };
  /** Allow Hebrew script in transcript text (default: only Latin transliteration). */
  allowHebrew?: boolean;
  /** Zona IA: also write a plain `<name>.ai.json` data file next to the audio in Drive (default off). */
  aiCopyToDrive?: boolean;
  publish?: { title?: string; description?: string };
};
export type Collection = {
  folderId: string; name: string; slug: string; published: boolean; settings: Settings;
  parentFolderId?: string | null; createdAt: string;
};
/** Fully resolved settings + where each key came from (folderId, or "default"). */
export type Resolved = {
  model: FalModelId; language: string; autoSync: boolean; postprocess: Postprocess;
  openaiModel: string; openaiEffort: string; namingMode: NamingMode; template: string; obra: string; allowHebrew: boolean; aiCopyToDrive: boolean;
};
export type SettingKey = keyof Resolved;
export type Resolution = { settings: Resolved; from: Record<SettingKey, string>; collection: Collection | null; published: boolean };

export const systemDefaults = (): Resolved => ({
  model: DEFAULT_FAL_MODEL, language: DEFAULT_LANGUAGE, autoSync: false, postprocess: "none",
  openaiModel: process.env.POLISH_MODEL || "gpt-5.2", openaiEffort: process.env.POLISH_EFFORT || "medium",
  namingMode: "keep", template: "{n}. {temas}", obra: "", allowHebrew: false, aiCopyToDrive: false,
});
export const EFFORTS = ["minimal", "low", "medium", "high"] as const;
const POSTS: Postprocess[] = ["none", "openai", "ai_package"];

const COLL = () => path.join(STORAGE_DIR, "collections.json");
const CENTER = () => path.join(STORAGE_DIR, "center.json");
type CenterCfg = { rootFolderId?: string; rootName?: string };
export const getCenter = (): CenterCfg => readJson<CenterCfg>(CENTER(), {});
export const setCenterRoot = (rootFolderId: string, rootName: string) => writeJson(CENTER(), { ...getCenter(), rootFolderId, rootName });
export const clearCenterRoot = () => writeJson(CENTER(), { ...getCenter(), rootFolderId: undefined, rootName: undefined });

export const berajotCollection = (): Collection => ({
  folderId: process.env.DRIVE_FOLDER_ID || BERAJOT_FOLDER_ID, name: "ברכות שר לשמחה", slug: "berajot", published: true, createdAt: "2025-01-01T00:00:00.000Z",
  settings: {
    transcription: { model: DEFAULT_FAL_MODEL, language: "spa" }, autoSync: true, postprocess: "openai",
    naming: { mode: "template", template: BERAJOT_TEMPLATE },
    publish: { title: "ברכות שר לשמחה", description: "Un recorrido por el tratado de Berajot, daf por daf." },
  },
});

/** Loads collections; the first time, migrates the existing Berajot folder as collection #1. */
export function listCollections(): Collection[] {
  const f = readJson<{ collections?: Collection[] } | null>(COLL(), null);
  if (f?.collections) return f.collections;
  const list = [berajotCollection()];
  saveCollections(list);
  return list;
}
export const saveCollections = (c: Collection[]) => writeJson(COLL(), { version: 1, collections: c });
export const getCollection = (folderId: string) => listCollections().find((c) => c.folderId === folderId) ?? null;
export const collectionBySlug = (slug: string) => listCollections().find((c) => c.slug === slug) ?? null;
export const collectionById = (idOrFolder: string | undefined) => (idOrFolder ? listCollections().find((c) => c.folderId === idOrFolder || c.slug === idOrFolder) : undefined) ?? null;

export function slugify(name: string, taken: Set<string>): string {
  let s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) s = "serie";
  let out = s, n = 2;
  while (taken.has(out)) out = `${s}-${n++}`;
  return out;
}

/** Keeps only valid values of a settings object coming from the UI. */
export function sanitizeSettings(x: unknown): Settings {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, any>;
  const s: Settings = {};
  const str = (v: unknown, max = 400) => (typeof v === "string" ? v.slice(0, max) : undefined);
  if (o.transcription && typeof o.transcription === "object") {
    const t: NonNullable<Settings["transcription"]> = {};
    const lm = liveModel(o.transcription.model as string | undefined);
    if (isFalModel(lm)) t.model = lm;
    if (LANGUAGES.some((l) => l.code === o.transcription.language)) t.language = o.transcription.language;
    if (Object.keys(t).length) s.transcription = t;
  }
  if (typeof o.autoSync === "boolean") s.autoSync = o.autoSync;
  if (POSTS.includes(o.postprocess)) s.postprocess = o.postprocess;
  if (o.openai && typeof o.openai === "object") {
    const a: NonNullable<Settings["openai"]> = {};
    if (str(o.openai.model, 80)) a.model = str(o.openai.model, 80);
    if ((EFFORTS as readonly string[]).includes(o.openai.effort)) a.effort = o.openai.effort;
    if (Object.keys(a).length) s.openai = a;
  }
  if (typeof o.allowHebrew === "boolean") s.allowHebrew = o.allowHebrew;
  if (typeof o.aiCopyToDrive === "boolean") s.aiCopyToDrive = o.aiCopyToDrive;
  if (o.naming && typeof o.naming === "object") {
    const n: NonNullable<Settings["naming"]> = {};
    if (o.naming.mode === "keep" || o.naming.mode === "template") n.mode = o.naming.mode;
    if (str(o.naming.template) !== undefined && o.naming.template.trim()) n.template = str(o.naming.template);
    if (str(o.naming.obra, 80)) n.obra = str(o.naming.obra, 80);
    if (Object.keys(n).length) s.naming = n;
  }
  if (o.publish && typeof o.publish === "object") {
    const p: NonNullable<Settings["publish"]> = {};
    if (str(o.publish.title, 120)) p.title = str(o.publish.title, 120);
    if (str(o.publish.description, 600)) p.description = str(o.publish.description, 600);
    if (Object.keys(p).length) s.publish = p;
  }
  return s;
}

const flat = (s: Settings): Partial<Resolved> => {
  const r: Partial<Resolved> = {};
  if (s.transcription?.model) r.model = liveModel(s.transcription.model) ?? r.model;
  if (s.transcription?.language) r.language = s.transcription.language;
  if (s.autoSync !== undefined) r.autoSync = s.autoSync;
  if (s.postprocess) r.postprocess = s.postprocess;
  if (s.openai?.model) r.openaiModel = s.openai.model;
  if (s.openai?.effort) r.openaiEffort = s.openai.effort;
  if (s.naming?.mode) r.namingMode = s.naming.mode;
  if (s.naming?.template) r.template = s.naming.template;
  if (s.naming?.obra !== undefined) r.obra = s.naming.obra;
  if (s.allowHebrew !== undefined) r.allowHebrew = s.allowHebrew;
  if (s.aiCopyToDrive !== undefined) r.aiCopyToDrive = s.aiCopyToDrive;
  return r;
};

/** Resolve settings for a folder given its path (root -> ... -> folder). Nearest configured ancestor wins, key by key. */
export function resolveSettings(pathIds: string[], collections = listCollections()): Resolution {
  const settings = systemDefaults();
  const from = Object.fromEntries(Object.keys(settings).map((k) => [k, "default"])) as Record<SettingKey, string>;
  let nearest: Collection | null = null;
  for (const id of pathIds) {
    const c = collections.find((x) => x.folderId === id);
    if (!c) continue;
    nearest = c;
    for (const [k, v] of Object.entries(flat(c.settings))) { (settings as any)[k] = v; from[k as SettingKey] = c.folderId; }
  }
  return { settings, from, collection: nearest, published: !!nearest?.published };
}
/** Settings of exactly one collection when its ancestors are unknown (single-level resolution). */
export const resolveCollection = (c: Collection, ancestorPath: string[] = []) => resolveSettings([...ancestorPath, c.folderId]);

export function upsertCollection(input: { folderId: string; name: string; settings?: unknown; published?: boolean; slug?: string; parentFolderId?: string | null }): Collection {
  const all = listCollections();
  const i = all.findIndex((c) => c.folderId === input.folderId);
  const taken = new Set(all.filter((c) => c.folderId !== input.folderId).map((c) => c.slug));
  const prev = i >= 0 ? all[i] : null;
  const name = (input.name || prev?.name || "Serie").trim().slice(0, 120);
  let slug = prev?.slug ?? slugify(name, taken);
  if (input.slug) slug = slugify(input.slug, taken);
  const c: Collection = {
    folderId: input.folderId, name, slug, createdAt: prev?.createdAt ?? new Date().toISOString(),
    published: input.published ?? prev?.published ?? false,
    settings: input.settings !== undefined ? sanitizeSettings(input.settings) : prev?.settings ?? {},
    parentFolderId: input.parentFolderId !== undefined ? input.parentFolderId : prev?.parentFolderId ?? null,
  };
  if (i >= 0) all[i] = c; else all.push(c);
  saveCollections(all);
  return c;
}
export function removeCollection(folderId: string): boolean {
  const all = listCollections();
  const n = all.filter((c) => c.folderId !== folderId);
  if (n.length === all.length) return false;
  saveCollections(n); return true;
}
export const publishedCollections = () => listCollections().filter((c) => c.published);
