"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePlayer } from "./player/PlayerProvider";
import { cleanTitle, fmtTime } from "./format";
import { IconPlay, IconSearch, Ornament } from "./icons";
import SeriesFilter, { useSeries } from "./SeriesFilter";

type Hit = { classId: string; title: string; segmentIdx: number; startMs: number; snippet: string };
const SUGGEST = ["Bilam", "Shemá", "Tefilá", "Moshé", "Rambam"];

function Snippet({ html }: { html: string }) {
  // Render only text nodes; <mark> spans are rebuilt as elements (no HTML injection).
  const parts = html.split(/(<mark>[\s\S]*?<\/mark>)/);
  const clean = (x: string) => x.replace(/<[^>]*>/g, "");
  return (
    <>
      {parts.map((s, i) => {
        const m = /^<mark>([\s\S]*)<\/mark>$/.exec(s);
        return m ? <mark key={i}>{clean(m[1])}</mark> : <Fragment key={i}>{clean(s)}</Fragment>;
      })}
    </>
  );
}

export default function SearchView() {
  const sp = useSearchParams();
  const router = useRouter();
  const p = usePlayer();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);
  const sc = useSeries(sp.get("c")?.split(",").filter(Boolean));
  const scopeKey = sc.scope?.join(",") ?? "";

  useEffect(() => {
    const term = q.trim();
    const n = ++seq.current;
    if (!term) { setHits(null); setLoading(false); setFailed(false); return; }
    setLoading(true);
    const h = setTimeout(async () => {
      window.history.replaceState(null, "", `/buscar?q=${encodeURIComponent(term)}${scopeKey ? `&c=${scopeKey}` : ""}`);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=40${scopeKey ? `&c=${scopeKey}` : ""}`);
        if (!r.ok) throw new Error();
        const j = await r.json();
        if (n === seq.current) { setHits(j.hits ?? []); setFailed(false); }
      } catch { if (n === seq.current) { setHits(null); setFailed(true); } }
      if (n === seq.current) setLoading(false);
    }, 300);
    return () => clearTimeout(h);
  }, [q, scopeKey]);

  const open = (h: Hit) => {
    p.playAt(h.classId, h.startMs);
    router.push(`/shiur/${h.classId}?t=${Math.ceil(h.startMs / 100) / 10}`);
  };
  const term = q.trim();

  return (
    <>
      <header className="search-head">
        <span className="eyebrow">Buscar en las clases</span>
        <h1 className="page-title" style={{ marginTop: 14 }}>¿Qué quieres encontrar?</h1>
      </header>
      <div className="search-box">
        <IconSearch />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Un tema, un nombre, una frase…" aria-label="Buscar" autoFocus enterKeyHint="search" />
      </div>

      <SeriesFilter ctl={sc} className="series-filter-bar" />
      <div className="search-meta" role="status" aria-live="polite">
        {loading ? "Buscando…" : hits && hits.length > 0 ? `${hits.length} ${hits.length === 1 ? "resultado" : "resultados"} para “${term}”` : ""}
      </div>

      {!term && (
        <div className="state" style={{ paddingTop: 24 }}>
          <Ornament />
          <p style={{ marginTop: 20 }}>Busca en la transcripción completa de todas las clases y saltá al momento exacto.</p>
          <div className="suggest">{SUGGEST.map((s) => <button key={s} className="chip" onClick={() => setQ(s)}>{s}</button>)}</div>
        </div>
      )}
      {loading && !hits && term && (
        <ul className="results" aria-hidden="true">{[0, 1, 2].map((i) => <li key={i}><div className="card" style={{ display: "grid", gap: 10 }}><div className="skeleton" style={{ height: 24, width: "55%", marginLeft: "auto" }} /><div className="skeleton" style={{ height: 16 }} /><div className="skeleton" style={{ height: 16, width: "75%" }} /></div></li>)}</ul>
      )}
      {failed && !loading && (
        <div className="state" role="alert"><h2>No pudimos buscar</h2><p>Hubo un problema de conexión. Prueba de nuevo.</p><button className="btn" onClick={() => setQ(q + " ")}>Reintentar</button></div>
      )}
      {!loading && hits && hits.length === 0 && term && (
        <div className="state"><div className="glyph he" aria-hidden="true">?</div><h2>Sin resultados</h2><p>No encontramos “{term}”. Prueba con otra palabra o una raíz más corta.</p></div>
      )}
      <ul className="results">
        {(hits ?? []).map((h) => (
          <li key={`${h.classId}-${h.segmentIdx}`}>
            <button className="card hoverable result" onClick={() => open(h)}>
              <span className="result-head">
                <span className="result-title" dir="rtl" lang="he">{cleanTitle(h.title)}</span>
                <span className="ts-pill"><IconPlay />{fmtTime(h.startMs)}</span>
              </span>
              <span className="snippet" dir="ltr" lang="es"><Snippet html={h.snippet} /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
