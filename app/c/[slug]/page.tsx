import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { listClasses, rowToClass } from "../../../lib/db";
import { audioUrlFor } from "../../../lib/audio";
import { seriesBySlug } from "../../../lib/series";
import ClassList from "../../../components/ClassList";
import type { ClassSummary } from "../../../components/format";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const s = seriesBySlug((await params).slug);
  if (!s) return {};
  return s.slug === "berajot" ? { title: { absolute: "ברכות שר לשמחה — Shiurim de Berajot" } } : { title: s.title, description: s.description || undefined };
}

/** One published series: its classes (the original Berajot home lives at /c/berajot). */
export default async function SeriesPage({ params }: P) {
  const { slug } = await params;
  const series = seriesBySlug(slug);
  if (!series) notFound();
  const rows = listClasses({ collection: slug });
  const classes = (await Promise.all(rows.map(async (r) => rowToClass(r, await audioUrlFor(r.id, r.r2_key))))) as ClassSummary[];
  return <ClassList classes={classes} series={{ slug, title: series.title, description: series.description }} />;
}
