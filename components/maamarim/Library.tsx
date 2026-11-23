"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CategoryNode, MaamarCard } from "@/lib/maamarim/types";

type Sort = "catalog" | "recent" | "title";
const strip = (s: string) => s.normalize("NFC").replace(/[֑-ׇ]/g, "").replace(/["״׳']/g, "").toLowerCase();
const flat = (n: CategoryNode[]): CategoryNode[] => n.flatMap((x) => [x, ...flat(x.children)]);
const readMin = (w: number) => Math.max(1, Math.round(w / 180));

function Tree({ nodes, cur, onPick, depth = 0 }: { nodes: CategoryNode[]; cur: string; onPick: (id: string) => void; depth?: number }) {
  return (
    <ul className={depth ? "mm-tree-sub" : "mm-tree"}>
      {nodes.map((n) => (
        <li key={n.id}>
          <button type="button" className={`mm-tree-item${cur === n.id ? " on" : ""}`} onClick={() => onPick(cur === n.id ? "" : n.id)} aria-pressed={cur === n.id}>
            <span className="mm-code tnum">{n.code}</span>
            <span className="mm-tree-name he" dir="rtl" lang="he">{n.name}</span>
            <span className="mm-tree-count tnum">{n.total}</span>
          </button>
          {n.children.length > 0 && <Tree nodes={n.children} cur={cur} onPick={onPick} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function Book({ c }: { c: MaamarCard }) {
  return (
    <li>
      <Link href={`/maamarim/${c.id}`} className="mm-book">
        <span className="mm-spine" aria-hidden />
        <span className="mm-book-top">
          <span className="mm-call tnum" title="Signatura">{c.callNumber}</span>
          {c.hasPdf && <span className="mm-pdf-badge">PDF</span>}
        </span>
        <span className="mm-book-title he" dir="rtl" lang="he">{c.title}</span>
        {c.subtitle && <span className="mm-book-sub he" dir="rtl" lang="he">{c.subtitle}</span>}
        {c.summary && <span className="mm-book-sum clamp3" dir="auto">{c.summary}</span>}
        <span className="mm-book-meta">
          {c.date && <span dir="auto">{c.date}</span>}
          <span>{c.sections} {c.sections === 1 ? "capítulo" : "capítulos"} · {readMin(c.words)} min de lectura</span>
        </span>
        {c.tags.length > 0 && <span className="mm-tags">{c.tags.slice(0, 4).map((t) => <span key={t} className="mm-tag" dir="auto">{t}</span>)}</span>}
      </Link>
    </li>
  );
}

export default function Library({ cards, tree }: { cards: MaamarCard[]; tree: CategoryNode[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sort, setSort] = useState<Sort>("catalog");
  const [tag, setTag] = useState("");
  const [catOpen, setCatOpen] = useState(false);
  const nodes = useMemo(() => flat(tree), [tree]);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("cat")) setCat(p.get("cat")!);
    if (p.get("tag")) setTag(p.get("tag")!);
  }, []);
  useEffect(() => {
    const p = new URLSearchParams(); if (cat) p.set("cat", cat); if (tag) p.set("tag", tag);
    history.replaceState(null, "", p.toString() ? `?${p}` : location.pathname);
  }, [cat, tag]);

  const inCat = useMemo(() => {
    if (!cat) return null;
    const root = nodes.find((n) => n.id === cat);
    return root ? new Set(flat([root]).map((n) => n.id)) : null;
  }, [cat, nodes]);

  const list = useMemo(() => {
    const words = strip(q).split(/\s+/).filter(Boolean);
    let l = cards.filter((c) => (!inCat || inCat.has(c.categoryId)) && (!tag || c.tags.includes(tag)));
    if (words.length) l = l.filter((c) => { const hay = strip([c.title, c.subtitle, c.summary, c.source, c.callNumber, ...c.tags, ...c.categoryPath].join(" ")); return words.every((w) => hay.includes(w)); });
    if (sort === "recent") l = l.slice().sort((a, b) => (b.dateIso || b.createdAt).localeCompare(a.dateIso || a.createdAt));
    if (sort === "title") l = l.slice().sort((a, b) => strip(a.title).localeCompare(strip(b.title), "he"));
    return l;
  }, [cards, q, inCat, tag, sort]);

  const allTags = useMemo(() => {
    const m = new Map<string, number>(); for (const c of cards) for (const t of c.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([t]) => t);
  }, [cards]);

  const shelves = useMemo(() => {
    if (sort !== "catalog") return null;
    const by = new Map<string, MaamarCard[]>();
    for (const c of list) { const a = by.get(c.categoryId) ?? []; a.push(c); by.set(c.categoryId, a); }
    return nodes.filter((n) => by.has(n.id)).map((n) => ({ node: n, items: by.get(n.id)! }));
  }, [list, nodes, sort]);

  const curNode = nodes.find((n) => n.id === cat);

  return (
    <div className="mm-lib">
      <section className="hero mm-hero" aria-labelledby="mm-title">
        <span className="eyebrow">Biblioteca digital</span>
        <h1 id="mm-title" className="hero-title" lang="he" dir="rtl">ספריית המאמרים</h1>
        <p className="hero-sub">Maamarim · {cards.length} {cards.length === 1 ? "maamar" : "maamarim"} · {nodes.length} {nodes.length === 1 ? "categoría" : "categorías"}</p>
        <div className="mm-hero-actions">
          <Link href="/maamarim/preguntar" className="btn mm-ask-btn">Preguntar a la biblioteca</Link>
        </div>
      </section>

      {cards.length === 0 ? (
        <div className="mm-empty">
          <p className="he" dir="rtl" lang="he">הספרייה עדיין ריקה.</p>
          <p className="muted">Los maamarim aparecerán aquí cuando se suban (desde el skill de maamarim o desde el panel de administración).</p>
        </div>
      ) : (
        <div className="mm-lib-grid">
          <aside className={`mm-catalog${catOpen ? " open" : ""}`} aria-label="Catálogo">
            <button type="button" className="mm-cat-toggle" onClick={() => setCatOpen((v) => !v)} aria-expanded={catOpen}>
              <span>Catálogo{curNode ? ` · ${curNode.code}` : ""}{tag ? ` · ${tag}` : ""}</span><span aria-hidden>{catOpen ? "▴" : "▾"}</span>
            </button>
            <div className="mm-cat-body">
            <h2 className="mm-side-title">Catálogo</h2>
            <button type="button" className={`mm-tree-item mm-all${!cat ? " on" : ""}`} onClick={() => { setCat(""); setCatOpen(false); }}>
              <span className="mm-code">∗</span><span className="mm-tree-name">Toda la biblioteca</span><span className="mm-tree-count tnum">{cards.length}</span>
            </button>
            <Tree nodes={tree} cur={cat} onPick={(id) => { setCat(id); setCatOpen(false); }} />
            {allTags.length > 0 && (
              <>
                <h2 className="mm-side-title">Etiquetas</h2>
                <div className="mm-tagcloud">
                  {allTags.map((t) => <button key={t} type="button" className={`mm-tag${tag === t ? " on" : ""}`} onClick={() => setTag(tag === t ? "" : t)} dir="auto">{t}</button>)}
                </div>
              </>
            )}
            </div>
          </aside>

          <div className="mm-shelves">
            <div className="mm-toolbar">
              <input className="input mm-filter" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por título, tema, etiqueta… (para preguntas usa «Preguntar»)" aria-label="Filtrar maamarim" dir="auto" />
              <label className="mm-sort">
                <span className="sr-only">Orden</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="input">
                  <option value="catalog">Orden de catálogo</option>
                  <option value="recent">Más recientes</option>
                  <option value="title">Título (א–ת)</option>
                </select>
              </label>
            </div>
            {(curNode || tag) && (
              <p className="mm-crumbs">
                {curNode && <><span className="mm-code tnum">{curNode.code}</span> <span className="he" dir="rtl" lang="he">{curNode.path.join(" › ")}</span></>}
                {tag && <span className="mm-tag on">{tag}</span>}
                <button type="button" className="btn-ghost btn-sm" onClick={() => { setCat(""); setTag(""); }}>Quitar filtros</button>
              </p>
            )}
            {list.length === 0 && <p className="muted mm-none">No hay maamarim con estos filtros.</p>}
            {shelves ? shelves.map(({ node, items }) => (
              <section key={node.id} className="mm-shelf" aria-labelledby={`sh-${node.id}`}>
                <header className="mm-shelf-head">
                  <span className="mm-code tnum">{node.code}</span>
                  <h2 id={`sh-${node.id}`} className="he" dir="rtl" lang="he">{node.path.join(" › ")}</h2>
                  <span className="mm-shelf-count tnum">{items.length}</span>
                </header>
                {node.description && <p className="mm-shelf-desc" dir="auto">{node.description}</p>}
                <ul className="mm-books">{items.map((c) => <Book key={c.id} c={c} />)}</ul>
              </section>
            )) : <ul className="mm-books">{list.map((c) => <Book key={c.id} c={c} />)}</ul>}
          </div>
        </div>
      )}
    </div>
  );
}
