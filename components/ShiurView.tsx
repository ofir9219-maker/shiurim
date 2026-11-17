"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ChatPanel from "./ChatPanel";
import { usePlayer } from "./player/PlayerProvider";
import { fmtTime, parseT, type ClassFull, type Segment } from "./format";

const Row = memo(function Row({ seg, active, onPick }: { seg: Segment; active: boolean; onPick: (ms: number) => void }) {
  return (
    <p className={active ? "seg active" : "seg"} data-idx={seg.idx} onClick={() => onPick(seg.startMs)}>
      <button className="ts" onClick={(e) => { e.stopPropagation(); onPick(seg.startMs); }} aria-label={`Ir a ${fmtTime(seg.startMs)}`}>
        {fmtTime(seg.startMs)}
      </button>
      <span>{seg.text}</span>
    </p>
  );
});

function activeIndex(segs: Segment[], ms: number): number {
  let lo = 0, hi = segs.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].startMs <= ms) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export default function ShiurView({ id }: { id: string }) {
  const p = usePlayer();
  const sp = useSearchParams();
  const t = parseT(sp.get("t"));
  const [cls, setCls] = useState<ClassFull | null>(null);
  const [err, setErr] = useState(false);
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const mine = p.current?.classId === id;
  const pRef = useRef(p); pRef.current = p;

  useEffect(() => {
    let dead = false;
    setCls(null); setErr(false);
    fetch(`/api/classes/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c) => { if (!dead) setCls(c); })
      .catch(() => { if (!dead) setErr(true); });
    return () => { dead = true; };
  }, [id]);

  // ?t= : position (paused) unless the player is already there (e.g. came from search).
  useEffect(() => {
    if (t == null) return;
    const q = pRef.current;
    if (q.current?.classId === id && Math.abs(q.positionMs - t) < 1500) return;
    q.load(id, t);
    setFollow(true);
  }, [id, t]);

  const segs = cls?.segments ?? [];
  const idx = mine && segs.length ? activeIndex(segs, p.positionMs) : -1;
  const onPick = useCallback((ms: number) => {
    const q = pRef.current;
    setFollow(true);
    if (q.current?.classId === id) { q.seek(ms); if (!q.playing) q.toggle(); } else q.playAt(id, ms);
  }, [id]);

  useEffect(() => {
    if (!follow || idx < 0) return;
    document.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx, follow]);

  useEffect(() => {
    const stop = () => setFollow(false);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchmove", stop, { passive: true });
    return () => { window.removeEventListener("wheel", stop); window.removeEventListener("touchmove", stop); };
  }, []);

  const rows = useMemo(
    () => segs.map((s) => <Row key={s.idx} seg={s} active={s.idx === idx} onPick={onPick} />),
    [segs, idx, onPick],
  );

  if (err) return <p className="muted">No se encontró la clase.</p>;
  if (!cls) return <p className="muted">Cargando…</p>;

  const share = async () => {
    const url = `${location.origin}/shiur/${id}?t=${mine ? Math.floor(p.positionMs / 1000) : 0}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copiá el enlace", url); }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  return (
    <article>
      <header className="shiur-head">
        <div className="meta"><span>Clase {cls.ordLabel}</span>{cls.dafLabel && <> · <span className="he" dir="rtl" lang="he">{cls.dafLabel}</span></>} · {fmtTime(cls.durationMs)}</div>
        <h1 className="page-title he" dir="rtl" lang="he">{cls.title}</h1>
        {cls.summary && <p className="summary big">{cls.summary}</p>}
        {cls.tags.length > 0 && <ul className="tags">{cls.tags.map((tg) => <li key={tg}>{tg}</li>)}</ul>}
        <div className="actions">
          <button className="btn primary" onClick={() => (mine ? p.toggle() : p.playAt(id, t ?? 0))}>
            {mine && p.playing ? "❚❚ Pausa" : "▶ Reproducir"}
          </button>
          <button className="btn" onClick={share}>{copied ? "¡Enlace copiado!" : "Compartir este minuto"}</button>
        </div>
      </header>

      <section className="ask">
        <button className="btn" aria-expanded={askOpen} onClick={() => setAskOpen((v) => !v)}>
          {askOpen ? "▾" : "▸"} Preguntar sobre esta clase
        </button>
        {askOpen && <div className="ask-panel"><ChatPanel classId={id} /></div>}
      </section>

      {segs.length === 0 ? (
        <p className="pending">Transcripción en proceso. Podés escuchar el audio mientras tanto.</p>
      ) : (
        <section className="transcript" dir="ltr" lang="es" aria-label="Transcripción" data-testid="transcript">
          {rows}
        </section>
      )}
      {!follow && idx >= 0 && (
        <button className="btn primary jump" onClick={() => setFollow(true)}>↓ Volver al actual</button>
      )}
    </article>
  );
}
