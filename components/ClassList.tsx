"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtTime, type ClassSummary } from "./format";

export default function ClassList({ classes }: { classes: ClassSummary[] }) {
  const [daf, setDaf] = useState<string>("");
  const dafim = useMemo(() => {
    const s = new Set<string>();
    classes.forEach((c) => c.daf.forEach((d) => s.add(d.daf)));
    return [...s];
  }, [classes]);
  const shown = daf ? classes.filter((c) => c.daf.some((d) => d.daf === daf)) : classes;
  return (
    <>
      {dafim.length > 0 && (
        <div className="chips" role="group" aria-label="Filtrar por daf">
          <button className={!daf ? "chip on" : "chip"} onClick={() => setDaf("")}>Todos</button>
          {dafim.map((d) => (
            <button key={d} className={daf === d ? "chip on he" : "chip he"} dir="rtl" lang="he" onClick={() => setDaf(d)} aria-pressed={daf === d}>
              דף {d}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 && <p className="muted">No hay clases todavía.</p>}
      <ul className="cards">
        {shown.map((c) => (
          <li key={c.id}>
            <Link href={`/shiur/${c.id}`} className={c.hasTranscript ? "card" : "card muted-card"}>
              <span className="ord">{c.ordLabel}</span>
              <span className="card-body">
                <span className="card-title he" dir="rtl" lang="he">{c.title}</span>
                <span className="meta">
                  {c.dafLabel && <span className="he" dir="rtl" lang="he">{c.dafLabel}</span>}
                  {c.dafLabel && " · "}{fmtTime(c.durationMs)}
                </span>
                {c.hasTranscript ? (
                  c.summary && <span className="summary">{c.summary}</span>
                ) : (
                  <span className="pending">transcripción en proceso</span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
