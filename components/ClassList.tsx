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

export default function ClassList({ classes }: { classes: ClassSummary[] }) {
  const router = useRouter();
  const p = usePlayer();
  const [daf, setDaf] = useState<string>("");
  const [q, setQ] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);

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
  const shown = useMemo(() => (daf ? classes.filter((c) => c.daf.some((d) => d.daf === daf)) : classes), [classes, daf]);
  const groups = useMemo(() => {
    const m = new Map<string, ClassSummary[]>();
    for (const c of shown) { const k = daf || firstDaf(c); (m.get(k) ?? m.set(k, []).get(k)!).push(c); }
    return [...m.entries()];
  }, [shown, daf]);

  const hours = Math.round(classes.reduce((a, c) => a + c.durationMs, 0) / 3.6e6);
  const resume = saved ? classes.find((c) => c.id === saved.classId) : undefined;
  const live = resume && p.current?.classId === resume.id ? p.positionMs : saved?.positionMs ?? 0;
  const dur = resume ? (p.current?.classId === resume.id && p.durationMs ? p.durationMs : resume.durationMs) : 0;

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <span className="eyebrow">Masejet Berajot</span>
        <h1 id="hero-title" className="hero-title" dir="rtl" lang="he">ברכות שר לשמחה</h1>
        <p className="hero-sub">Shiurim de Guemará</p>
        <Ornament />
        <p className="lead">Un recorrido por el tratado de Berajot, daf por daf: escuchá cada clase con su transcripción sincronizada y buscá cualquier tema.</p>
        <ul className="stats" aria-label="La serie en números">
          <li><b>{classes.length || "—"}</b><span>clases</span></li>
          <li><b>~{hours || "—"}</b><span>horas</span></li>
          <li><b className="he" dir="rtl" lang="he" style={{ fontSize: "1.9rem", lineHeight: 1 }}>ברכות</b><span>Masejet</span></li>
        </ul>
        <form className="hero-search" role="search" onSubmit={(e) => { e.preventDefault(); const t = q.trim(); router.push(t ? `/buscar?q=${encodeURIComponent(t)}` : "/buscar"); }}>
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

      {dafim.length > 0 && (
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
          <p>{daf ? "No hay clases para este daf." : "Cuando se publiquen, vas a encontrarlas acá."}</p>
          {daf && <button className="btn-ghost" onClick={() => setDaf("")}>Ver todas</button>}
        </div>
      )}

      {groups.map(([d, list]) => (
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
