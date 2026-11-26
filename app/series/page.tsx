import Link from "next/link";
import { redirect } from "next/navigation";
import { publishedSeries } from "../../lib/series";
import { Ornament } from "../../components/icons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Series de clases" };

export default function SeriesIndex() {
  const series = publishedSeries();
  if (series.length === 1) redirect(`/c/${series[0].slug}`);
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
