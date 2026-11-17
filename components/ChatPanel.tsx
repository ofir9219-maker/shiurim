"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePlayer } from "./player/PlayerProvider";
import { RefChips } from "./chat/RefChips";
import type { ChatEvent, Ref } from "../lib/chat-core";

type Msg = { role: "user" | "assistant"; content: string; refs?: Ref[]; cited?: number[]; mode?: string };
const KEY = "shiurim-chat-v1";
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
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try { const s = sessionStorage.getItem(KEY); if (s) setMsgs(JSON.parse(s)); } catch { /* ignore */ }
    setReady(true);
    return () => abortRef.current?.abort();
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-40))); } catch { /* ignore */ }
  }, [msgs, ready]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs]);

  const play = useCallback((r: Ref) => { Promise.resolve(player?.playAt(r.classId, r.startMs)).catch(() => {}); }, [player]);

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
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), classId }),
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
  }, [msgs, busy, classId]);

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
