"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import ChatPanel from "./ChatPanel";
import { usePlayer } from "./player/PlayerProvider";
import Link from "next/link";
import { cleanTitle, fmtTime, parseT, type ClassFull, type Segment } from "./format";
import { IconArrowDown, IconBack, IconClock, IconDown, IconPause, IconPlay, IconShare, IconSpark, Ornament } from "./icons";

const SIZES = [1.02, 1.12, 1.22, 1.36, 1.52, 1.72];
const SIZE_KEY = "shiurim:txsize";

export function ShiurSkeleton() {
  return (
    <div className="measure" aria-busy="true" aria-label="Cargando clase">
      <div className="shiur-head">
        <div className="skeleton" style={{ height: 24, width: 200, margin: "0 auto 22px" }} />
        <div className="skeleton" style={{ height: 44, width: "80%", margin: "0 auto 12px" }} />
        <div className="skeleton" style={{ height: 44, width: "55%", margin: "0 auto 28px" }} />
        <div className="skeleton" style={{ height: 18, margin: "0 0 10px" }} />
        <div className="skeleton" style={{ height: 18, margin: "0 0 10px" }} />
        <div className="skeleton" style={{ height: 18, width: "60%" }} />
      </div>
      <div className="transcript">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 22, margin: "18px 14px", width: `${90 - i * 7}%` }} />)}</div>
    </div>
  );
}

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
  const [sizeIdx, setSizeIdx] = useState(2);
  useEffect(() => { try { const n = Number(localStorage.getItem(SIZE_KEY)); if (Number.isInteger(n) && n >= 0 && n < SIZES.length) setSizeIdx(n); } catch {} }, []);
  const bump = (d: number) => setSizeIdx((i) => { const n = Math.min(SIZES.length - 1, Math.max(0, i + d)); try { localStorage.setItem(SIZE_KEY, String(n)); } catch {} return n; });
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
    const el = document.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top > 160 && r.bottom < window.innerHeight * 0.75) return; // already comfortably visible
    // Segments use content-visibility:auto (estimated heights), so a long smooth scroll lands in the
    // wrong place: jump instantly when far away and re-center once the rows near the target render.
    const far = Math.abs(r.top - window.innerHeight / 2) > window.innerHeight * 2;
    el.scrollIntoView({ block: "center", behavior: far ? "auto" : "smooth" });
    if (!far) return;
    let n = 0, raf = 0;
    const fix = () => {
      const t = el.getBoundingClientRect().top - (window.innerHeight - el.offsetHeight) / 2;
      if (Math.abs(t) > 40) el.scrollIntoView({ block: "center" });
      if (++n < 6) raf = requestAnimationFrame(fix);
    };
    raf = requestAnimationFrame(fix);
    return () => cancelAnimationFrame(raf);
  }, [idx, follow, cls]);

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

  if (err) return (
    <div className="state" role="alert">
      <div className="glyph" lang="he" dir="rtl" aria-hidden="true">אין</div>
      <h2>No se encontró la clase</h2>
      <p>Puede que el enlace sea incorrecto o que la clase ya no esté disponible.</p>
      <Link href="/" className="btn">Ver los shiurim</Link>
    </div>
  );
  if (!cls) return <ShiurSkeleton />;

  const share = async () => {
    const url = `${location.origin}/shiur/${id}?t=${mine ? Math.floor(p.positionMs / 1000) : 0}`;
    try { await navigator.clipboard.writeText(url); } catch { window.prompt("Copiá el enlace", url); }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };
  const playing = mine && p.playing;

  return (
    <article style={{ "--tx-size": `${SIZES[sizeIdx]}rem` } as React.CSSProperties}>
      <Link href={`/c/${cls.collection || "berajot"}`} className="back"><IconBack />Todas las clases</Link>
      {cls.folders && cls.folders.length > 0 && (
        <nav className="crumbs-folders" aria-label="Categoría">
          {cls.folders.map((f, i) => <span key={f.id}>{i > 0 && "› "}<Link href={`/c/${cls.collection || "berajot"}?cat=${f.id}`} dir="auto">{f.name}</Link></span>)}
        </nav>
      )}
      <header className="shiur-head">
        <div className="meta-row">
          <span className="badge solid" aria-label={`Clase ${cls.ordLabel}`}>{cls.ordLabel}</span>
          {cls.dafLabel && <span className="daf-pill" dir="rtl" lang="he">{cls.dafLabel}</span>}
          <span className="meta-item"><IconClock />{fmtTime(cls.durationMs)}</span>
        </div>
        <h1 className="page-title" dir="rtl" lang="he">{cleanTitle(cls.title)}</h1>
        <Ornament />
        {cls.summary && <p className="summary">{cls.summary}</p>}
        {cls.tags.length > 0 && <ul className="tags">{cls.tags.map((tg) => <li key={tg}>{tg}</li>)}</ul>}
      </header>

      <div className="measure">
        <section className="ask">
          <button className="btn-ghost ask-toggle" aria-expanded={askOpen} aria-controls="ask-panel" onClick={() => setAskOpen((v) => !v)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}><IconSpark style={{ color: "var(--gold)" }} />Preguntar sobre esta clase</span>
            <IconDown />
          </button>
          {askOpen && <div className="ask-panel" id="ask-panel"><ChatPanel classId={id} /></div>}
        </section>
      </div>

      <div className="toolbar" role="toolbar" aria-label="Herramientas de la transcripción">
        <div className="group">
          <button className="btn btn-sm" onClick={() => (mine ? p.toggle() : p.playAt(id, t ?? 0))}>
            {playing ? <IconPause /> : <IconPlay />}<span>{playing ? "Pausa" : mine ? "Reanudar" : "Reproducir"}</span>
          </button>
          <button className="btn-ghost btn-sm" onClick={share} aria-live="polite">
            <IconShare /><span>{copied ? "¡Enlace copiado!" : <>Compartir<span className="lbl"> este minuto</span></>}</span>
          </button>
          {!follow && idx >= 0 && (
            <button className="btn-ghost btn-sm" onClick={() => setFollow(true)}><IconArrowDown /><span>Volver al actual</span></button>
          )}
        </div>
        <div className="fontsize" role="group" aria-label="Tamaño del texto">
          <button onClick={() => bump(-1)} disabled={sizeIdx === 0} aria-label="Reducir texto">A</button>
          <button onClick={() => bump(1)} disabled={sizeIdx === SIZES.length - 1} aria-label="Aumentar texto">A</button>
        </div>
      </div>

      <div className="measure" style={{ maxWidth: 780 }}>
        {segs.length === 0 ? (
          <div className="state"><h2>Transcripción en proceso</h2><p>Podés escuchar el audio mientras tanto.</p></div>
        ) : (
          <section className="transcript" dir="ltr" lang="es" aria-label="Transcripción" data-testid="transcript">
            {rows}
          </section>
        )}
      </div>
    </article>
  );
}
