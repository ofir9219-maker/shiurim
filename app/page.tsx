import Link from "next/link";
import AgentChat from "../components/agent/AgentChat";
import { publishedSeries } from "../lib/series";
import { listCards } from "../lib/maamarim/store";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "ברכות שר לשמחה — Shiurim y maamarim" } };

/** Home: the site-wide AI chat (plans, reads sources in parallel, verified citations), then the series and the library. */
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const series = publishedSeries();
  const maamarim = listCards().length;
  return (
    <>
      <section className="home-hero" aria-labelledby="hero-title">
        <span className="eyebrow">Shiurim · Maamarim</span>
        <h1 id="hero-title" className="hero-title" dir="rtl" lang="he">ברכות שר לשמחה</h1>
        <p className="lead">Pregunta lo que quieras: la respuesta se arma con las clases y los maamarim del sitio, con citas verificadas que te llevan al pasaje o al segundo exacto del audio.</p>
      </section>
      <AgentChat initialQuestion={typeof sp.q === "string" ? sp.q.slice(0, 500) : undefined} />
      <section className="home-series" aria-label="Series y biblioteca">
        <h2>Series de clases</h2>
        <ul className="cards">
          {series.map((s) => (
            <li key={s.slug}>
              <Link href={`/c/${s.slug}`} className="card class-card">
                <span className="top"><span className="badge">{s.count} {s.count === 1 ? "clase" : "clases"}</span><span className="dur grow">~{s.hours || "<1"} h</span></span>
                <span className="card-title" dir="auto" style={{ textAlign: "start" }}>{s.title}</span>
                {s.description && <span className="summary clamp2">{s.description}</span>}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/maamarim" className="card class-card">
              <span className="top"><span className="badge">{maamarim}</span><span className="dur grow">maamarim</span></span>
              <span className="card-title" dir="rtl" lang="he" style={{ textAlign: "start" }}>ספריית המאמרים</span>
              <span className="summary clamp2">Biblioteca digital de maamarim por categorías.</span>
            </Link>
          </li>
        </ul>
      </section>
    </>
  );
}
