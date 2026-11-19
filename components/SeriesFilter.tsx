"use client";
import { useCallback, useEffect, useState } from "react";

export type SeriesInfo = { slug: string; title: string; count: number };
const KEY = "shiurim:series";

/** Collection filter shared by search, chat and champiñones. Empty selection = all published series. */
export function useSeries(initial?: string[]) {
  const [series, setSeries] = useState<SeriesInfo[]>([]);
  const [selected, setSel] = useState<string[]>(initial ?? []);
  useEffect(() => {
    let alive = true;
    if (!initial?.length) { try { const s = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(s)) setSel(s.filter((x) => typeof x === "string")); } catch {} }
    fetch("/api/series").then((r) => r.json()).then((j) => { if (alive) setSeries(j.series ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const setSelected = useCallback((v: string[]) => { setSel(v); try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} }, []);
  const known = selected.filter((s) => series.some((x) => x.slug === s));
  const scope = known.length && known.length < series.length ? known : undefined;
  return { series, selected: known, scope, setSelected };
}

export default function SeriesFilter({ ctl, className = "" }: { ctl: ReturnType<typeof useSeries>; className?: string }) {
  const { series, selected, setSelected } = ctl;
  if (series.length < 2) return null;
  const toggle = (slug: string) => setSelected(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug]);
  return (
    <div className={`chips series-filter ${className}`} role="group" aria-label="Filtrar por serie">
      <button type="button" className={!selected.length ? "chip on" : "chip"} aria-pressed={!selected.length} onClick={() => setSelected([])}>Todas</button>
      {series.map((s) => <button key={s.slug} type="button" className={selected.includes(s.slug) ? "chip on" : "chip"} aria-pressed={selected.includes(s.slug)} dir="auto" onClick={() => toggle(s.slug)}>{s.title}</button>)}
    </div>
  );
}
