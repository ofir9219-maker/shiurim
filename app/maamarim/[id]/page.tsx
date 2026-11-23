import Link from "next/link";
import { notFound } from "next/navigation";
import ReaderTools from "@/components/maamarim/ReaderTools";
import { callNumber, flatTree, getMaamar } from "@/lib/maamarim/store";
import type { Block } from "@/lib/maamarim/types";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: P) {
  const m = getMaamar((await params).id);
  return m ? { title: `${m.title} — Maamarim`, description: m.ficha.summary_es || m.ficha.summary_he || m.subtitle } : { title: "Maamar no encontrado" };
}

/** Our parser only emits <b>, <i>, <br> and <sup class="fn" data-n="N">; link the footnote markers. */
const linkNotes = (html: string) => html.replace(/<sup class="fn" data-n="(\d+)">\d+<\/sup>/g, (_m, n) => `<sup class="fn" id="fnref-${n}"><a href="#fn-${n}" aria-label="Nota ${n}">${n}</a></sup>`);
const sefariaUrl = (ref: string) => `https://www.sefaria.org/${encodeURIComponent(ref.replace(/ /g, "_"))}?lang=he`;

function BlockView({ b }: { b: Block }) {
  if (b.t === "h") return <h3>{b.text}</h3>;
  if (b.t === "quote") return (
    <blockquote className={`mm-quote${b.unresolved ? " pending" : ""}`}>
      {b.text}
      {(b.label || b.ref) && <span className="mm-mekor">{b.ref ? <a href={sefariaUrl(b.ref)} target="_blank" rel="noopener noreferrer">{b.label || b.ref}</a> : b.label}</span>}
    </blockquote>
  );
  return <p dangerouslySetInnerHTML={{ __html: linkNotes(b.html) }} />;
}

export default async function MaamarPage({ params }: P) {
  const m = getMaamar((await params).id);
  if (!m) notFound();
  const nodes = flatTree();
  const node = nodes.find((n) => n.id === m.categoryId);
  const f = m.ficha;
  return (
    <div>
      <Link href={node ? `/maamarim?cat=${node.id}` : "/maamarim"} className="mm-back">→ {node ? node.path.join(" › ") : "Biblioteca"}</Link>
      <div className="mm-reader">
        <article className="mm-page">
          <p className="mm-mobile-actions">
            <Link href={`/maamarim/preguntar?m=${m.id}`} className="btn btn-sm">Preguntar sobre este maamar</Link>
            <a href="#ficha" className="btn-ghost btn-sm">Ficha</a>
          </p>
          <div className="mm-doc" lang="he">
            <header className="mm-cover">
              <span className="mm-bsd">בס״ד</span>
              <h1>{m.title}</h1>
              {m.subtitle && <p className="mm-subtitle">{m.subtitle}</p>}
              <div className="orn" aria-hidden>✦</div>
              {m.source && <p className="mm-source">{m.source}</p>}
              {m.date && <p className="mm-date">{m.date}</p>}
            </header>
            {m.sections.length > 1 && (
              <nav className="mm-toc" aria-label="תוכן עניינים">
                <h2>תוכן עניינים</h2>
                <ol>{m.sections.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title || "—"}</a></li>)}</ol>
              </nav>
            )}
            {m.sections.map((s) => (
              <section key={s.id} id={s.id} className="mm-section">
                {s.title && <h2>{s.title}</h2>}
                {s.blocks.map((b, i) => <BlockView key={i} b={b} />)}
              </section>
            ))}
            {m.notes.length > 0 && (
              <footer className="mm-notes">
                <h2>הערות</h2>
                <ol>{m.notes.map((n) => <li key={n.n} id={`fn-${n.n}`}><span dangerouslySetInnerHTML={{ __html: n.html }} /> <a href={`#fnref-${n.n}`} aria-label="Volver al texto">↩</a></li>)}</ol>
              </footer>
            )}
          </div>
        </article>
        <aside className="mm-aside" aria-label="Ficha del maamar">
          <Link href={`/maamarim/preguntar?m=${m.id}`} className="btn">Preguntar sobre este maamar</Link>
          {m.pdf && <a href={`/api/maamarim/pdf/${m.id}`} className="btn-ghost" target="_blank" rel="noopener">Descargar PDF</a>}
          <ReaderTools />
          <div className="mm-ficha" id="ficha">
            <h2>Ficha catalográfica</h2>
            <dl>
              <dt>Signatura</dt><dd className="tnum">{callNumber(m, nodes)}</dd>
              {node && <><dt>Categoría</dt><dd className="he" dir="rtl"><Link href={`/maamarim?cat=${node.id}`}>{node.path.join(" › ")}</Link></dd></>}
              {f.rav && <><dt>Rav</dt><dd className="he" dir="rtl">{f.rav}</dd></>}
              {m.date && <><dt>Fecha</dt><dd dir="auto">{m.date}</dd></>}
              <dt>Capítulos</dt><dd>{m.sections.length}</dd>
            </dl>
            {f.summary_es && <p dir="auto">{f.summary_es}</p>}
            {f.sources && f.sources.length > 0 && (
              <>
                <p><strong>Fuentes</strong></p>
                <ul className="he" dir="rtl">{f.sources.slice(0, 20).map((s, i) => <li key={i}>{s.ref ? <a href={sefariaUrl(s.ref)} target="_blank" rel="noopener noreferrer">{s.label}</a> : s.label}</li>)}</ul>
              </>
            )}
            {m.tags.length > 0 && <p className="mm-tags">{m.tags.map((t) => <Link key={t} href={`/maamarim?tag=${encodeURIComponent(t)}`} className="mm-tag" dir="auto">{t}</Link>)}</p>}
          </div>
        </aside>
      </div>
    </div>
  );
}
