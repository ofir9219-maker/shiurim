"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type Current = { classId: string; title: string; audioUrl: string };
type Ctx = {
  current: Current | null;
  positionMs: number;
  playing: boolean;
  durationMs: number;
  /** End of the buffered range containing the playhead (ms). */
  bufferedMs: number;
  speed: number;
  playAt(classId: string, ms: number): Promise<void>;
  /** Load a class positioned at ms without starting playback. */
  load(classId: string, ms: number): Promise<void>;
  toggle(): void;
  seek(ms: number): void;
  skip(deltaMs: number): void;
  setSpeed(s: number): void;
};

const PlayerCtx = createContext<Ctx | null>(null);
const LS_KEY = "shiurim:player";

export function usePlayer(): Ctx {
  const c = useContext(PlayerCtx);
  if (!c) throw new Error("usePlayer outside PlayerProvider");
  return c;
}

async function fetchMeta(classId: string): Promise<(Current & { durationMs: number }) | null> {
  try {
    const r = await fetch(`/api/classes/${encodeURIComponent(classId)}`);
    if (!r.ok) return null;
    const c = await r.json();
    return { classId: c.id, title: c.title, audioUrl: c.audioUrl, durationMs: c.durationMs ?? 0 };
  } catch {
    return null;
  }
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [positionMs, setPositionMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [bufferedMs, setBufferedMs] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const currentRef = useRef<Current | null>(null);
  const pending = useRef<{ ms: number; play: boolean } | null>(null);
  const lastSave = useRef(0);
  const speedRef = useRef(1);
  const positionMsRef = useRef(0);
  positionMsRef.current = positionMs;

  const save = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastSave.current < 2000) return;
    lastSave.current = now;
    const c = currentRef.current, a = audioRef.current;
    if (!c || !a) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify({ classId: c.classId, positionMs: Math.round(a.currentTime * 1000) })); } catch {}
  }, []);

  const applyPending = useCallback(() => {
    const a = audioRef.current, p = pending.current;
    if (!a || !p) return;
    pending.current = null;
    try { a.currentTime = p.ms / 1000; } catch {}
    setPositionMs(p.ms);
    if (p.play) a.play().catch(() => {});
  }, []);

  const loadClass = useCallback(async (classId: string, ms: number, play: boolean) => {
    const a = audioRef.current;
    if (!a) return;
    if (currentRef.current?.classId === classId) {
      if (a.readyState >= 1) {
        a.currentTime = ms / 1000; setPositionMs(ms);
        if (play) await a.play().catch(() => {});
      } else { pending.current = { ms, play }; setPositionMs(ms); }
      return;
    }
    const meta = await fetchMeta(classId);
    if (!meta) return;
    const cur = { classId: meta.classId, title: meta.title, audioUrl: meta.audioUrl };
    currentRef.current = cur;
    setCurrent(cur);
    setDurationMs(meta.durationMs);
    setBufferedMs(0);
    setPositionMs(ms);
    pending.current = { ms, play };
    a.src = cur.audioUrl;
    a.playbackRate = speedRef.current;
    a.load();
  }, []);

  const playAt = useCallback((id: string, ms: number) => loadClass(id, ms, true), [loadClass]);
  const load = useCallback((id: string, ms: number) => loadClass(id, ms, false), [loadClass]);

  const seek = useCallback((ms: number) => {
    const a = audioRef.current;
    if (!a || !currentRef.current) return;
    const max = a.duration && isFinite(a.duration) ? a.duration * 1000 : Infinity;
    const v = Math.min(Math.max(0, ms), max);
    if (a.readyState >= 1) a.currentTime = v / 1000;
    else pending.current = { ms: v, play: pending.current?.play ?? !a.paused };
    setPositionMs(v);
    save(true);
  }, [save]);

  const skip = useCallback((d: number) => {
    const a = audioRef.current;
    seek((a && a.readyState >= 1 ? a.currentTime * 1000 : positionMsRef.current) + d);
  }, [seek]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !currentRef.current) return;
    if (pending.current) { pending.current.play = !pending.current.play; if (!pending.current.play && a.readyState < 1) return; }
    if (a.paused) a.play().catch(() => {}); else a.pause();
  }, []);

  const setSpeed = useCallback((s: number) => {
    speedRef.current = s; setSpeedState(s);
    if (audioRef.current) audioRef.current.playbackRate = s;
    try { localStorage.setItem("shiurim:speed", String(s)); } catch {}
  }, []);

  // Restore saved state (paused).
  useEffect(() => {
    try {
      const sp = parseFloat(localStorage.getItem("shiurim:speed") || "");
      if (sp > 0) { speedRef.current = sp; setSpeedState(sp); }
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s.classId === "string") loadClass(s.classId, Number(s.positionMs) || 0, false);
      }
    } catch {}
  }, [loadClass]);

  useEffect(() => {
    if (!current || typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: "ברכות שר לשמחה", album: "Shiurim" });
    } catch {}
  }, [current]);
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h); } catch {} };
    set("play", () => { audioRef.current?.play().catch(() => {}); });
    set("pause", () => audioRef.current?.pause());
    set("seekbackward", () => skip(-15000));
    set("seekforward", () => skip(15000));
    set("seekto", (d) => { if (d.seekTime != null) seek(d.seekTime * 1000); });
    return () => { (["play", "pause", "seekbackward", "seekforward", "seekto"] as MediaSessionAction[]).forEach((a) => set(a, null)); };
  }, [seek, skip]);

  useEffect(() => {
    const onHide = () => save(true);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [save]);

  const value = useMemo<Ctx>(
    () => ({ current, positionMs, playing, durationMs, bufferedMs, speed, playAt, load, toggle, seek, skip, setSpeed }),
    [current, positionMs, playing, durationMs, bufferedMs, speed, playAt, load, toggle, seek, skip, setSpeed],
  );

  return (
    <PlayerCtx.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (d && isFinite(d)) setDurationMs(Math.round(d * 1000));
          applyPending();
        }}
        onCanPlay={applyPending}
        onTimeUpdate={(e) => { if (!pending.current) setPositionMs(Math.round(e.currentTarget.currentTime * 1000)); save(); }}
        onProgress={(e) => {
          const a = e.currentTarget, t = a.currentTime;
          for (let i = 0; i < a.buffered.length; i++) if (a.buffered.start(i) <= t + 0.5 && a.buffered.end(i) >= t) { setBufferedMs(Math.round(a.buffered.end(i) * 1000)); return; }
          setBufferedMs(Math.round(t * 1000));
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => { setPlaying(false); save(true); }}
        onEnded={() => setPlaying(false)}
      />
    </PlayerCtx.Provider>
  );
}
