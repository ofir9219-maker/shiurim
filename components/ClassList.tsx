"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useState } from "react";
import { cleanTitle, fmtTime, firstDaf, type ClassSummary } from "./format";
import { usePlayer } from "./player/PlayerProvider";
import { IconClock, IconPlay, IconSearch, Ornament } from "./icons";

const Card = memo(function Card({ c }: { c: ClassSummary }) {
  return (
    <Link href={`/shiur/${c.id}`} className={c.hasTranscript ? "card class-card" : "card class-card muted-card"}>
      <span className="top">
        <span className="badge" aria-label={`Clase ${c.ordLabel}`}>{c.ordLabel}</span>
        <span className="dur grow"><IconClock />{fmtTime(c.durationMs)}</span>
        {c.dafLabel && <span className="daf-pill" dir="rtl" lang="he">{c.dafLabel}</span>}
      </span>
      <span className="card-title" dir="rtl" lang="he">{cleanTitle(c.title)}</span>
      {c.hasTranscript ? (
        c.summary && <span className="summary clamp2">{c.summary}</span>
      ) : (
        <span className="pending">Transcripción en proceso</span>
      )}
      {c.hasTranscript && c.tags.length > 0 && (
        <ul className="tags" aria-label="Temas">
          {c.tags.slice(0, 3).map((t) => <li key={t}>{t}</li>)}
        </ul>
      )}
    </Link>
  );
});

type Saved = { classId: string; positionMs: number };

type CatNode = { id: string; name: string; sort: string; count: number; total: number; children: CatNode[] };
function buildTree(classes: ClassSummary[]): { roots: CatNode[]; byId: Map<string, CatNode> } {
  const byId = new Map<string, CatNode>(); const parent = new Map<string, string>(); const roots: CatNode[] = [];
  for (const c of classes) {
    const chain = c.folders ?? [];
    chain.forEach((f, i) => {
      let n = byId.get(f.id);
      if (!n) { n = { id: f.id, name: f.name, sort: "", count: 0, total: 0, children: [] }; byId.set(f.id, n); if (i === 0) roots.push(n); else { parent.set(f.id, chain[i - 1].id); byId.get(chain[i - 1].id)!.children.push(n); } }
      n.total++;
      if (i === chain.length - 1) { n.count++; if (!n.sort || (c.folderSort ?? "") < n.sort) n.sort = c.folderSort ?? ""; }
    });
  }
  // a folder sorts by its first class's key (folders that only hold subfolders take the smallest key below them)
  const key = (n: CatNode): string => [n.sort, ...n.children.map(key)].filter(Boolean).sort()[0] ?? "";
  const sortRec = (l: CatNode[]) => { l.sort((a, b) => key(a).localeCompare(key(b))); l.forEach((n) => sortRec(n.children)); };
  sortRec(roots);
  return { roots, byId };
}
function CatTree({ nodes, cur, onPick }: { nodes: CatNode[]; cur: string; onPick: (id: string) => void }) {
  return (
    <ul className="cat-tree">
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" className={`cat-item${cur === n.id ? " on" : ""}`} onClick={() => onPick(n.id)} aria-pressed={cur === n.id}>
            <span className="cat-name" dir="auto">{n.name}</span><span className="cat-count">{n.total}</span>
          </button>
          {n.children.length > 0 && <CatTree nodes={n.children} cur={cur} onPick={onPick} />}
        </li>
      ))}
    </ul>
  );
}

export type SeriesHero = { slug: string; title: string; description: string };
export default function ClassList({ classes, series }: { classes: ClassSummary[]; series?: SeriesHero }) {
  const berajot = !series || series.slug === "berajot";
  const router = useRouter();
  const p = usePlayer();
  const [daf, setDaf] = useState<string>("");
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [cat, setCat] = useState<string>("");
  const [catOpen, setCatOpen] = useState(false);
  useEffect(() => { const c = new URLSearchParams(location.search).get("cat"); if (c) setCat(c); }, []);
  useEffect(() => { if (!series) return; const u = new URL(location.href); if (cat) u.searchParams.set("cat", cat); else u.searchParams.delete("cat"); history.replaceState(null, "", u); }, [cat, series]);

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("shiurim:player") || "null");
      if (s && typeof s.classId === "string") setSaved({ classId: s.classId, positionMs: Number(s.positionMs) || 0 });
    } catch {}
  }, []);

  const dafim = useMemo(() => {
    const s = new Set<string>();
    classes.forEach((c) => c.daf.forEach((d) => s.add(d.daf)));
    return [...s];
  }, [classes]);
  // Subfolders of the series (Drive) as categories: tree of the folders that hold classes, in catalog order.
  const tree = useMemo(() => buildTree(classes), [classes]);
  const hasFolders = tree.roots.length > 0;
  const shown = useMemo(() => classes.filter((c) => (!daf || c.daf.some((d) => d.daf === daf)) && (!cat || (c.folders ?? []).some((f) => f.id === cat))), [classes, daf, cat]);
  const groups = useMemo(() => {
    const m = new Map<string, ClassSummary[]>();
    for (const c of shown) { const k = daf || firstDaf(c); (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
    return [...m.entries()];
  }, [shown, daf]);
  /** Folder sections: one per leaf folder, with its ancestors as headings the first time they appear. */
  const folderGroups = useMemo(() => {
    if (!hasFolders) return [];
    const out: { key: string; chain: { id: string; name: string }[]; heads: { id: string; name: string; depth: number }[]; list: ClassSummary[] }[] = [];
    const seen = new Set<string>();
    for (const c of shown) {
      const chain = c.folders ?? []; const key = chain.length ? chain[chain.length - 1].id : "";
      let g = out[out.length - 1];
      if (!g || g.key !== key) {
        const heads = chain.map((f, i) => ({ ...f, depth: i })).filter((f) => !seen.has(f.id));
        heads.forEach((h) => seen.add(h.id));
        g = { key, chain, heads, list: [] }; out.push(g);
      }
      g.list.push(c);
    }
    return out;
  }, [shown, hasFolders]);

  const hours = Math.round(classes.reduce((a, c) => a + c.durationMs, 0) / 3.6e6);
  const resume = saved ? classes.find((c) => c.id === saved.classId) : undefined;
  const live = resume && p.current?.classId === resume.id ? p.positionMs : saved?.positionMs ?? 0;
  const dur = resume ? (p.current?.classId === resume.id && p.durationMs ? p.durationMs : resume.durationMs) : 0;

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        {berajot ? (<>
        <span className="eyebrow">Masejet Berajot</span>
        <h1 id="hero-title" className="hero-title" dir="rtl" lang="he">ברכות שר לשמחה</h1>
        <p className="hero-sub">Shiurim de Guemará</p>
        <Ornament />
        <p className="lead">Un recorrido por el tratado de Berajot, daf por daf: escucha cada clase con su transcripción sincronizada y busca cualquier tema.</p>
        <ul className="stats" aria-label="La serie en números">
          <li><b>{classes.length || "—"}</b><span>clases</span></li>
          <li><b>~{hours || "—"}</b><span>horas</span></li>
          <li><b className="he" dir="rtl" lang="he" style={{ fontSize: "1.9rem", lineHeight: 1 }}>ברכות</b><span>Masejet</span></li>
        </ul></>) : (<>
        <span className="eyebrow">Serie</span>
        <h1 id="hero-title" className="hero-title" dir="auto">{series!.title}</h1>
        <p className="hero-sub">Shiurim</p>
        <Ornament />
        <p className="lead">{series!.description || "Escucha cada clase con su transcripción sincronizada y busca cualquier tema."}</p>
        <ul className="stats" aria-label="La serie en números">
          <li><b>{classes.length || "—"}</b><span>clases</span></li>
          <li><b>~{hours || "—"}</b><span>horas</span></li>
        </ul></>)}
        <form className="hero-search" role="search" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); router.push(t ? `/buscar?q=${encodeURIComponent(t)}${series ? `&c=${series.slug}` : ""}` : "/buscar"); }}>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar un tema en las clases…" aria-label="Buscar en las clases" enterKeyHint="search" />
          <button type="submit" aria-label="Buscar"><IconSearch /></button>
        </form>
      </section>

      {resume && (
        <section className="card resume" aria-label="Continuar escuchando">
          <div className="resume-body">
            <span className="eyebrow">Continuar escuchando</span>
            <span className="resume-title" dir="rtl" lang="he">{cleanTitle(resume.title)}</span>
            <span className="progress" aria-hidden="true"><i style={{ width: `${dur ? Math.min(100, (live / dur) * 100) : 0}%` }} /></span>
            <span className="resume-meta">Clase {resume.ordLabel} · {fmtTime(live)} de {fmtTime(dur)}</span>
          </div>
          <button className="btn" onClick={() => { p.playAt(resume.id, live); router.push(`/shiur/${resume.id}?t=${Math.floor(live / 1000)}`); }}>
            <IconPlay /> Continuar
          </button>
        </section>
      )}

      {hasFolders && (
        <section className={`cat-panel${catOpen ? " open" : ""}`} aria-label="Categorías">
          <button type="button" className="cat-toggle" onClick={() => setCatOpen((v) => !v)} aria-expanded={catOpen}>
            <span>Categorías{cat && tree.byId.get(cat) ? ` · ${tree.byId.get(cat)!.name}` : ""}</span><span aria-hidden>{catOpen ? "▴" : "▾"}</span>
          </button>
          <div className="cat-body">
            <button type="button" className={`cat-item${!cat ? " on" : ""}`} onClick={() => { setCat(""); setCatOpen(false); }}><span className="cat-name">Todas las clases</span><span className="cat-count">{classes.length}</span></button>
            <CatTree nodes={tree.roots} cur={cat} onPick={(id) => { setCat(id === cat ? "" : id); setCatOpen(false); }} />
          </div>
        </section>
      )}

      {dafim.length > 0 && !hasFolders && (
        <div className="filter-bar">
          <div className="chips" role="group" aria-label="Filtrar por daf">
            <button className={!daf ? "chip on" : "chip"} aria-pressed={!daf} onClick={() => setDaf("")}>Todos</button>
            {dafim.map((d) => (
              <button key={d} className={daf === d ? "chip on he" : "chip he"} dir="rtl" lang="he" onClick={() => setDaf(d)} aria-pressed={daf === d} aria-label={`Daf ${d}`}>
                דף {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 && (
        <div className="state">
          <div className="glyph he" aria-hidden="true">ס</div>
          <h2>No hay clases todavía</h2>
          <p>{daf ? "No hay clases para este daf." : cat ? "No hay clases en esta categoría." : "Cuando se publiquen, vas a encontrarlas acá."}</p>
          {(daf || cat) && <button className="btn-ghost" onClick={() => { setDaf(""); setCat(""); }}>Ver todas</button>}
        </div>
      )}

      {hasFolders && folderGroups.map((g) => (
        <section key={g.key || "root"} className="daf-section folder-section" aria-label={g.chain.map((f) => f.name).join(" › ") || "Clases"}>
          {g.heads.map((h) => {
            const H = h.depth === 0 ? "h2" : "h3";
            return (
              <div key={h.id} className={`folder-head depth-${Math.min(h.depth, 3)}`}>
                <H dir="auto"><button type="button" className="folder-link" onClick={() => setCat(h.id)}>{h.name}</button></H>
                <span className="daf-rule" aria-hidden="true" />
                <span className="count">{tree.byId.get(h.id)?.total ?? 0} {(tree.byId.get(h.id)?.total ?? 0) === 1 ? "clase" : "clases"}</span>
              </div>
            );
          })}
          <ul className="cards">
            {g.list.map((c) => <li key={c.id}><Card c={c} /></li>)}
          </ul>
        </section>
      ))}

      {!hasFolders && groups.map(([d, list]) => (
        <section key={d || "x"} className="daf-section" aria-label={d ? `Daf ${d}` : "Clases"}>
          {d && (
            <div className="daf-head">
              <h2><small>Daf</small><span className="he" dir="rtl" lang="he">{d}</span></h2>
              <span className="daf-rule" aria-hidden="true" />
              <span className="count">{list.length} {list.length === 1 ? "clase" : "clases"}</span>
            </div>
          )}
          <ul className="cards">
            {list.map((c) => <li key={c.id}><Card c={c} /></li>)}
          </ul>
        </section>
      ))}
    </>
  );
}
