"use client";
import Link from "next/link";
import { usePlayer } from "./PlayerProvider";
import { cleanTitle, fmtTime } from "../format";
import { IconBack15, IconFwd15, IconPause, IconPlay } from "../icons";

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

export default function PlayerBar() {
  const p = usePlayer();
  if (!p.current) return null;
  const dur = p.durationMs || 0;
  const max = Math.max(dur, 1);
  const pos = Math.min(p.positionMs, max);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const next = SPEEDS[(Math.max(0, SPEEDS.indexOf(p.speed)) + 1) % SPEEDS.length];
  return (
    <div className="player-bar" role="region" aria-label="Reproductor">
      <div className="player-row">
        <div className="player-info">
          <span className="player-sub">{p.playing ? "Reproduciendo" : "En pausa"}</span>
          <Link href={`/shiur/${p.current.classId}`} className="player-title" dir="rtl" lang="he" title={cleanTitle(p.current.title)}>
            {cleanTitle(p.current.title)}
          </Link>
        </div>
        <div className="player-ctrls">
          <button className="pbtn skip" onClick={() => p.skip(-15000)} aria-label="Retroceder 15 segundos"><IconBack15 /><small>15</small></button>
          <button className="pbtn play" onClick={p.toggle} aria-label={p.playing ? "Pausa" : "Reproducir"}>{p.playing ? <IconPause /> : <IconPlay />}</button>
          <button className="pbtn skip" onClick={() => p.skip(15000)} aria-label="Avanzar 15 segundos"><IconFwd15 /><small>15</small></button>
          <button className="pbtn speed" onClick={() => p.setSpeed(next)} aria-label={`Velocidad ${p.speed}×, cambiar a ${next}×`}>{p.speed}×</button>
        </div>
      </div>
      <div className="scrub-row">
        <span className="player-time">{fmtTime(p.positionMs)}</span>
        <div className="scrub" style={{ "--p": pct(pos), "--b": pct(Math.max(p.bufferedMs, pos)) } as React.CSSProperties}>
          <input type="range" min={0} max={max} step={1000} value={pos} onChange={(e) => p.seek(Number(e.target.value))} aria-label="Posición" aria-valuetext={`${fmtTime(p.positionMs)} de ${fmtTime(dur)}`} />
        </div>
        <span className="player-time end">{fmtTime(dur)}</span>
      </div>
    </div>
  );
}
