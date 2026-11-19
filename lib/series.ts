// Public view of the published collections (series): home grid, /c/[slug], and the collection filter of search / chat / champiñones.
import { getDb } from "./db";
import { listCollections } from "./center/collections";

export type Series = { slug: string; name: string; title: string; description: string; count: number; hours: number };

const hasCol = () => !!(getDb()?.prepare("PRAGMA table_info(classes)").all() as { name: string }[] | undefined)?.some((c) => c.name === "collection_id");

/** Published collections that have at least one class in the DB (the DB only holds published ones), in creation order. */
export function publishedSeries(): Series[] {
  const db = getDb(); if (!db) return [];
  const rows = (hasCol()
    ? db.prepare("SELECT COALESCE(collection_id,'berajot') slug, count(*) n, coalesce(sum(duration_ms),0) ms FROM classes GROUP BY 1")
    : db.prepare("SELECT 'berajot' slug, count(*) n, coalesce(sum(duration_ms),0) ms FROM classes")).all() as { slug: string; n: number; ms: number }[];
  const by = new Map(rows.map((r) => [r.slug, r]));
  const out: Series[] = [];
  for (const c of listCollections()) {
    const r = by.get(c.slug);
    if (!c.published || !r?.n) continue;
    out.push({ slug: c.slug, name: c.name, title: c.settings.publish?.title || c.name, description: c.settings.publish?.description || "", count: r.n, hours: Math.round(r.ms / 3.6e6) });
  }
  return out;
}
export const seriesBySlug = (slug: string) => publishedSeries().find((s) => s.slug === slug) ?? null;

/** User-supplied filter (array, or comma-separated string) -> known published slugs; undefined = all series (no filter). */
export function scopeFrom(input: unknown): string[] | undefined {
  const raw = Array.isArray(input) ? input : typeof input === "string" ? input.split(",") : [];
  const want = new Set(raw.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 20));
  if (!want.size) return undefined;
  const all = publishedSeries().map((s) => s.slug);
  const ok = all.filter((s) => want.has(s));
  return ok.length && ok.length < all.length ? ok : undefined;
}
/** Class ids of the given series (undefined = no filter). */
export function classIdsOf(slugs?: string[]): Set<string> | undefined {
  if (!slugs?.length) return undefined;
  const db = getDb(); if (!db) return new Set();
  if (!hasCol()) return slugs.includes("berajot") ? undefined : new Set();
  return new Set((db.prepare(`SELECT id FROM classes WHERE COALESCE(collection_id,'berajot') IN (${slugs.map(() => "?").join(",")})`).all(...slugs) as { id: string }[]).map((r) => r.id));
}
