import Link from "next/link";
import { redirect } from "next/navigation";
import { listClasses, rowToClass } from "../lib/db";
import { audioUrlFor } from "../lib/audio";
import { publishedSeries } from "../lib/series";
import ClassList from "../components/ClassList";
import { Ornament } from "../components/icons";
import type { ClassSummary } from "../components/format";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "ברכות שר לשמחה — Shiurim de Berajot" } };

/** One published series -> straight to it (the Berajot home is /c/berajot); several -> grid of series. */
export default async function Home() {
  const series = publishedSeries();
  if (series.length === 1) redirect(`/c/${series[0].slug}`);
  if (series.length === 0) {
    const rows = listClasses({ collection: "berajot" });
    const classes = (await Promise.all(rows.map(async (r) => rowToClass(r, await audioUrlFor(r.id, r.r2_key))))) as ClassSummary[];
    return <ClassList classes={classes} />;
  }
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <span className="eyebrow">Biblioteca</span>
        <h1 id="hero-title" className="hero-title">Shiurim</h1>
        <p className="hero-sub">Elige una serie</p>
        <Ornament />
      </section>
      <ul className="cards" aria-label="Series">
        {series.map((s) => (
          <li key={s.slug}>
            <Link href={`/c/${s.slug}`} className="card class-card">
              <span className="top"><span className="badge">{s.count} {s.count === 1 ? "clase" : "clases"}</span><span className="dur grow">~{s.hours || "<1"} h</span></span>
              <span className="card-title" dir="auto" style={{ textAlign: "start" }}>{s.title}</span>
              {s.description && <span className="summary clamp2">{s.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
