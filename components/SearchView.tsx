"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePlayer } from "./player/PlayerProvider";
import { fmtTime } from "./format";

type Hit = { classId: string; title: string; segmentIdx: number; startMs: number; snippet: string };

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
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    const n = ++seq.current;
    if (!term) { setHits(null); setLoading(false); return; }
    setLoading(true);
    const h = setTimeout(async () => {
      window.history.replaceState(null, "", `/buscar?q=${encodeURIComponent(term)}`);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}&limit=40`);
        const j = await r.json();
        if (n === seq.current) setHits(j.hits ?? []);
      } catch { if (n === seq.current) setHits([]); }
      if (n === seq.current) setLoading(false);
    }, 300);
    return () => clearTimeout(h);
  }, [q]);

  const open = (h: Hit) => {
    p.playAt(h.classId, h.startMs);
    router.push(`/shiur/${h.classId}?t=${Math.floor(h.startMs / 1000)}`);
  };

  return (
    <>
      <h1 className="page-title">Buscar</h1>
      <input
        className="search-input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar en las transcripciones…"
        aria-label="Buscar"
        autoFocus
      />
      {loading && <p className="muted">Buscando…</p>}
      {!loading && hits && hits.length === 0 && <p className="muted">Sin resultados.</p>}
      <ul className="results">
        {(hits ?? []).map((h) => (
          <li key={`${h.classId}-${h.segmentIdx}`}>
            <button className="result" onClick={() => open(h)}>
              <span className="result-head">
                <span className="he result-title" dir="rtl" lang="he">{h.title}</span>
                <span className="ts-pill">{fmtTime(h.startMs)}</span>
              </span>
              <span className="snippet" dir="ltr" lang="es"><Snippet html={h.snippet} /></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
