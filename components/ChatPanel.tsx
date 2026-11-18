"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayer } from "./player/PlayerProvider";
import { RefChips } from "./chat/RefChips";
import type { ChatEvent, Effort, Ref } from "../lib/chat-core";

type Msg = { role: "user" | "assistant"; content: string; refs?: Ref[]; cited?: number[]; mode?: string };
const KEY = "shiurim-chat-v1";
const PREF_KEY = "shiurim-chat-prefs-v1";
type ModelsInfo = { models: { id: string; label: string; reasoning: boolean }[]; default: string; efforts: Effort[]; defaultEffort: Effort; enabled: boolean };
const EFFORT_LABEL: Record<Effort, string> = { minimal: "Mínimo", low: "Bajo", medium: "Medio", high: "Alto" };
const SUGGESTIONS = [
  "¿Cuál es el tiempo para leer el Shemá de la noche?",
  "Resume el shiur 1.1",
  "¿Qué enseña sobre la emuná y los sufrimientos?",
  "¿Qué dice Tosafot sobre este tema?",
];

export default function ChatPanel({ classId }: { classId?: string } = {}) {
  const player = usePlayer();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [info, setInfo] = useState<ModelsInfo | null>(null);
  const [model, setModel] = useState<string>("");
  const [effort, setEffort] = useState<Effort>("medium");
  const [showSettings, setShowSettings] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { const s = sessionStorage.getItem(KEY); if (s) setMsgs(JSON.parse(s)); } catch { /* ignore */ }
    setReady(true);
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    let off = false;
    let pref: { model?: string; effort?: string } = {};
    try { pref = JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {}; } catch { /* ignore */ }
    fetch("/api/chat/models").then((r) => (r.ok ? r.json() : null)).then((j: ModelsInfo | null) => {
      if (off || !j || !Array.isArray(j.models)) return;
      setInfo(j);
      setModel(j.models.some((m) => m.id === pref.model) ? pref.model! : j.default);
      setEffort(j.efforts.includes(pref.effort as Effort) ? (pref.effort as Effort) : j.defaultEffort);
    }).catch(() => {});
    return () => { off = true; };
  }, []);
  useEffect(() => {
    if (!model) return;
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ model, effort })); } catch { /* ignore */ }
  }, [model, effort]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ }
  }, [msgs, ready]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs]);

  const play = useCallback((r: Ref) => { Promise.resolve(player?.playAt(r.classId, r.startMs)).catch(() => {}); }, [player]);

  const cur = info?.models.find((m) => m.id === model);
  const reasoning = !!cur?.reasoning;
  const showRow = !!info?.enabled && (info.models.length > 1 || reasoning);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setInput(""); setBusy(true);
    const ac = new AbortController(); abortRef.current = ac;
    const patch = (fn: (m: Msg) => Msg) => setMsgs((cur) => { const c = cur.slice(); c[c.length - 1] = fn(c[c.length - 1]); return c; });
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), classId, model: model || undefined, effort: reasoning ? effort : undefined }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: ChatEvent; try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "delta") patch((m) => ({ ...m, content: m.content + ev.text }));
        else patch((m) => ({ ...m, refs: ev.refs, cited: ev.cited, mode: ev.mode }));
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        lines.forEach(handle);
      }
      handle(buf);
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, content: m.content || "No pude conectar con el chat. Inténtalo de nuevo.", mode: "error" }));
    } finally { setBusy(false); }
  }, [msgs, busy, classId, model, effort, reasoning]);

  return (
    <section className="chat-box mx-auto flex h-[calc(100dvh-8rem)] min-h-[24rem] w-full max-w-2xl flex-col rounded-xl border border-[#c9a45c]/50 bg-[#f6efdc] text-[#1c2a4a] shadow-sm">
      <div className="flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite">
        {ready && msgs.length === 0 && (
          <div className="space-y-3 pt-4 text-center">
            <p className="font-serif text-lg">Pregunta sobre los shiurim</p>
            <p className="text-sm text-[#1c2a4a]/70">Respondo solo con lo que se dijo en las clases y te llevo al momento exacto.</p>
            <div className="flex flex-col gap-2 pt-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)}
                  className="rounded-lg border border-[#c9a45c]/60 bg-[#fffaf0] px-3 py-2 text-left text-sm hover:bg-[#f3e6c4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8893a]">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={m.role === "user"
              ? "max-w-[85%] rounded-2xl rounded-br-sm bg-[#1c2a4a] px-3.5 py-2 text-sm text-[#f6efdc]"
              : "max-w-[95%] rounded-2xl rounded-bl-sm border border-[#c9a45c]/50 bg-[#fffaf0] px-3.5 py-2 text-sm"}>
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {m.content || (busy && i === msgs.length - 1 ? <span className="opacity-60">Buscando en los shiurim…</span> : "")}
              </p>
              {m.role === "assistant" && m.refs && <RefChips refs={m.refs} cited={m.mode === "noai" ? undefined : m.cited} onPlay={play} />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {showRow && info && (
        <div className="border-t border-[#c9a45c]/50 px-2 py-1.5 sm:px-3">
          <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} aria-controls="chat-settings"
            className="flex w-full items-center justify-between gap-2 text-xs text-[#8a6420] sm:hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8893a]">
            <span className="truncate">⚙ Ajustes · {model}{reasoning ? ` · ${EFFORT_LABEL[effort]}` : ""}</span>
            <span aria-hidden>{showSettings ? "▴" : "▾"}</span>
          </button>
          <div id="chat-settings" className={`${showSettings ? "flex" : "hidden"} mt-1.5 flex-col gap-2 sm:mt-0 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-3`}>
            {info.models.length > 1 && (
              <label className="flex items-center gap-2 text-xs text-[#1c2a4a]">
                <span className="text-[#8a6420]">Modelo</span>
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}
                  className="min-w-0 flex-1 rounded-md border border-[#c9a45c]/60 bg-[#fffaf0] px-2 py-1 text-base sm:text-xs focus:outline-none focus:ring-2 focus:ring-[#b8893a]">
                  {info.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            )}
            {reasoning && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#1c2a4a]" role="radiogroup" aria-label="Nivel de razonamiento">
                <span className="text-[#8a6420]">Nivel de razonamiento</span>
                <div className="inline-flex overflow-hidden rounded-md border border-[#c9a45c]/60">
                  {info.efforts.map((e) => (
                    <button key={e} type="button" role="radio" aria-checked={effort === e} disabled={busy} onClick={() => setEffort(e)}
                      className={`px-2.5 py-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#b8893a] ${effort === e ? "bg-[#1c2a4a] text-[#f3e6c4]" : "bg-[#fffaf0] hover:bg-[#f3e6c4]"}`}>
                      {EFFORT_LABEL[e]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-[#c9a45c]/50 p-2 sm:p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta…" aria-label="Pregunta" enterKeyHint="send"
          className="min-w-0 flex-1 rounded-lg border border-[#c9a45c]/60 bg-[#fffaf0] px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-[#b8893a]" />
        <button type="submit" disabled={busy || !input.trim()}
          className="rounded-lg bg-[#1c2a4a] px-4 py-2 text-sm font-medium text-[#f3e6c4] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b8893a]">
          {busy ? "…" : "Enviar"}
        </button>
        {msgs.length > 0 && !busy && (
          <button type="button" onClick={() => setMsgs([])} className="rounded-lg border border-[#c9a45c]/60 px-3 py-2 text-xs text-[#8a6420]" aria-label="Nueva conversación">Nueva</button>
        )}
      </form>
    </section>
  );
}
