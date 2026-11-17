"use client";
import Link from "next/link";
import { usePlayer } from "./PlayerProvider";
import { fmtTime } from "../format";

const SPEEDS = [1, 1.25, 1.5, 2];

export default function PlayerBar() {
  const p = usePlayer();
  if (!p.current) return null;
  const dur = p.durationMs || 0;
  return (
    <div className="player-bar" role="region" aria-label="Reproductor">
      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(dur, 1)}
        step={1000}
        value={Math.min(p.positionMs, Math.max(dur, 1))}
        onChange={(e) => p.seek(Number(e.target.value))}
        aria-label="Posición"
      />
      <div className="player-row">
        <Link href={`/shiur/${p.current.classId}`} className="player-title he" dir="rtl" lang="he">
          {p.current.title}
        </Link>
        <span className="player-time">{fmtTime(p.positionMs)} / {fmtTime(dur)}</span>
        <div className="player-ctrls">
          <button className="pbtn" onClick={() => p.skip(-15000)} aria-label="Retroceder 15 segundos">−15</button>
          <button className="pbtn play" onClick={p.toggle} aria-label={p.playing ? "Pausa" : "Reproducir"}>
            {p.playing ? "❚❚" : "▶"}
          </button>
          <button className="pbtn" onClick={() => p.skip(15000)} aria-label="Avanzar 15 segundos">+15</button>
          <button
            className="pbtn speed"
            onClick={() => p.setSpeed(SPEEDS[(SPEEDS.indexOf(p.speed) + 1) % SPEEDS.length])}
            aria-label="Velocidad"
          >
            {p.speed}×
          </button>
        </div>
      </div>
    </div>
  );
}
