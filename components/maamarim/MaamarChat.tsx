"use client";
// AI chat over the maamarim library only (independent from the shiurim chat): several chats with per-chat memory,
// model / reasoning selector, long Markdown answers with [n] citations linked to the maamar section.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatSidebar } from "../chat/ChatSidebar";
import Markdown from "./Markdown";
import type { Effort } from "@/lib/chat-core";
import type { Conversation } from "@/lib/chat-store";
import { M_ACTIVE_KEY, mLoad, mNewChat, mSave, mSanitize, mSort, type MConversation, type MStoredMsg } from "@/lib/maamarim/chat-store";
import type { MChatEvent } from "@/lib/maamarim/types";

type ModelsInfo = { models: { id: string; label: string; reasoning: boolean }[]; default: string; efforts: Effort[]; defaultEffort: Effort; enabled: boolean };
const EFFORT_LABEL: Record<Effort, string> = { minimal: "Mínimo", low: "Bajo", medium: "Medio", high: "Alto" };
const PREF = "maamarim-chat-prefs-v1";
const MAX_SENT = 30;
const SUGGEST = [
  "¿Qué enseñan los maamarim sobre los sufrimientos de amor?",
  "Explícame la idea central del último maamar y sus fuentes",
  "מה ההבדל בין שכל לדמיון לפי המאמרים?",
  "Compara cómo se explica la teshuvá en distintos maamarim",
];
const ls = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export default function MaamarChat({ scope }: { scope?: { id: string; title: string } }) {
  const [chats, setChats] = useState<MConversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [info, setInfo] = useState<ModelsInfo | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [flash, setFlash] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatsRef = useRef<MConversation[]>([]); chatsRef.current = chats;
  const prefRef = useRef<{ model?: string; effort?: string }>({});

  useEffect(() => {
    const s = ls();
    try { prefRef.current = JSON.parse(s?.getItem(PREF) || "{}") || {}; } catch { /* ignore */ }
    const loaded = mLoad(s);
    let active = scope ? loaded.find((c) => c.maamarId === scope.id) : loaded.find((c) => c.id === s?.getItem(M_ACTIVE_KEY)) ?? loaded.find((c) => !c.maamarId);
    let list = loaded;
    if (!active) { active = mNewChat({ maamarId: scope?.id, maamarTitle: scope?.title, model: prefRef.current.model || "", effort: (prefRef.current.effort as Effort) || "medium" }); list = [active, ...loaded]; }
    setChats(list); setActiveId(active.id); setReady(true);
    fetch("/api/chat/models").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.models) setInfo(j); }).catch(() => {});
    return () => abortRef.current?.abort();
  }, [scope]);
  useEffect(() => { if (!ready) return; const t = setTimeout(() => mSave(ls(), chats), 300); return () => clearTimeout(t); }, [chats, ready]);
  useEffect(() => { const f = () => { if (ready) mSave(ls(), chatsRef.current); }; window.addEventListener("pagehide", f); return () => window.removeEventListener("pagehide", f); }, [ready]);
  useEffect(() => { if (ready && activeId) try { ls()?.setItem(M_ACTIVE_KEY, activeId); } catch { /* ignore */ } }, [activeId, ready]);

  const active = chats.find((c) => c.id === activeId);
  const msgs = active?.messages ?? [];
  const busy = busyId !== null, activeBusy = busyId === activeId;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs.length, msgs[msgs.length - 1]?.content.length]);

  const model = active && info?.models.some((m) => m.id === active.model) ? active.model : info?.default || "";
  const effort: Effort = active && info?.efforts.includes(active.effort) ? active.effort : info?.defaultEffort || "medium";
  const reasoning = !!info?.models.find((m) => m.id === model)?.reasoning;
  const update = useCallback((id: string, fn: (c: MConversation) => MConversation) => setChats((all) => all.map((c) => (c.id === id ? fn(c) : c))), []);
  const setPref = (p: { model?: string; effort?: Effort }) => {
    if (!active) return; update(active.id, (c) => ({ ...c, ...p })); prefRef.current = { ...prefRef.current, ...p };
    try { ls()?.setItem(PREF, JSON.stringify(prefRef.current)); } catch { /* ignore */ }
  };
  const say = (t: string) => { setNotice(t); setTimeout(() => setNotice(""), 4000); };

  const startNew = (keepScope = false) => {
    const c = mNewChat({ model, effort, ...(keepScope && active?.maamarId ? { maamarId: active.maamarId, maamarTitle: active.maamarTitle } : {}) });
    setChats((all) => [c, ...all.filter((x) => x.messages.length || x.id === c.id)]); setActiveId(c.id); setDrawer(false); setInput("");
  };
  const select = (id: string) => { setChats((all) => all.filter((c) => c.messages.length || c.id === id)); setActiveId(id); setDrawer(false); };
  const remove = (id: string) => {
    if (busyId === id) abortRef.current?.abort();
    const rest = chats.filter((c) => c.id !== id);
    if (id === activeId) { const next = mSort(rest.filter((c) => c.messages.length))[0] || mNewChat({ model, effort }); setChats(rest.some((c) => c.id === next.id) ? rest : [next, ...rest]); setActiveId(next.id); }
    else setChats(rest);
  };
  const doExport = () => {
    const blob = new Blob([JSON.stringify({ app: "maamarim-chat", v: 1, chats: chats.filter((c) => c.messages.length) }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `consultas-maamarim-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const doImport = async (f: File) => {
    try {
      const j = JSON.parse(await f.text()); const list = (Array.isArray(j) ? j : j.chats || []).map(mSanitize).filter(Boolean) as MConversation[];
      if (!list.length) return say("Archivo no válido.");
      setChats((all) => mSort([...all.filter((c) => !list.some((x) => x.id === c.id)), ...list])); say(`${list.length} consulta(s) importadas.`);
    } catch { say("Archivo no válido."); }
  };

  const send = useCallback(async (text: string) => {
    const q = text.trim(); if (!q || busyId || !active) return;
    const id = active.id;
    const all: MStoredMsg[] = [...active.messages, { role: "user", content: q }];
    const first = active.messages.length === 0;
    const words = q.replace(/[¿?¡!]/g, "").split(/\s+/).filter(Boolean);
    const title = first ? words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "") : active.title;
    update(id, (c) => ({ ...c, title, updatedAt: Date.now(), messages: [...all, { role: "assistant", content: "", model: model || undefined, effort: reasoning ? effort : undefined }] }));
    setInput(""); setBusyId(id); setStatus("Buscando en la biblioteca…");
    const ac = new AbortController(); abortRef.current = ac;
    const patch = (fn: (m: MStoredMsg) => MStoredMsg) => update(id, (c) => { const ms = c.messages.slice(); ms[ms.length - 1] = fn(ms[ms.length - 1]); return { ...c, messages: ms, updatedAt: Date.now() }; });
    const start = Math.max(active.memoryUpTo || 0, all.length - MAX_SENT);
    const sent = all.slice(start).filter((m) => m.content.trim());
    try {
      const res = await fetch("/api/maamarim/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ messages: sent.map((m) => ({ role: m.role, content: m.content })), memory: active.memory || undefined, maamarId: active.maamarId, model: model || undefined, effort: reasoning ? effort : undefined }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: MChatEvent; try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "status") setStatus(ev.text);
        else if (ev.type === "delta") { setStatus(""); patch((m) => ({ ...m, content: m.content + ev.text })); }
        else {
          patch((m) => ({ ...m, refs: ev.refs, cited: ev.cited, mode: ev.mode }));
          if (typeof ev.memory === "string" && ev.condensed) update(id, (c) => ({ ...c, memory: ev.memory, memoryUpTo: Math.max(c.memoryUpTo || 0, start + Math.min(ev.condensed!, sent.length)) }));
        }
      };
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || ""; lines.forEach(handle); }
      handle(buf);
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, content: m.content || "No pude conectar. Inténtalo de nuevo.", mode: "error" }));
    } finally { setBusyId(null); setStatus(""); }
  }, [active, busyId, model, effort, reasoning, update]);

  const shown = useMemo(() => {
    const l = mSort(chats.filter((c) => c.messages.length || c.id === activeId));
    const q = query.trim().toLowerCase();
    return q ? l.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q))) : l;
  }, [chats, activeId, query]);

  const cite = (mi: number, n: number) => { const k = `${mi}-${n}`; document.getElementById(`ref-${k}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); setFlash(k); setTimeout(() => setFlash(""), 1600); };

  return (
    <div className="chat-box chat-layout mm-chat relative mx-auto flex h-[calc(100dvh-8rem)] min-h-[24rem] w-full max-w-5xl gap-3">
      {drawer && <button type="button" className="chat-backdrop fixed inset-0 z-30 bg-black/30 lg:hidden" aria-label="Cerrar lista" onClick={() => setDrawer(false)} />}
      <ChatSidebar chats={shown as unknown as Conversation[]} activeId={activeId} query={query} open={drawer} notice={notice}
        onQuery={setQuery} onNew={() => startNew(false)} onSelect={select} onRename={(id, t) => update(id, (c) => ({ ...c, title: t }))} onDelete={remove}
        onExport={doExport} onImport={doImport} onClose={() => setDrawer(false)} />
      <section className="chat-main flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] shadow-sm" aria-label="Consulta">
        <header className="chat-header flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-3 py-2">
          <button type="button" className="chat-drawer-toggle rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm lg:hidden" onClick={() => setDrawer(true)}>☰ Consultas</button>
          <h1 className="chat-title min-w-0 flex-1 truncate font-serif text-base">{active && msgs.length ? active.title : "Preguntar a la biblioteca de maamarim"}</h1>
          {active?.memory && <span className="chat-memory-flag text-xs text-[var(--muted)]" title={active.memory}>● memoria</span>}
          {active?.maamarId && (
            <span className="mm-scope">Solo en: <Link href={`/maamarim/${active.maamarId}`} className="he" dir="rtl">{active.maamarTitle || "este maamar"}</Link>
              {!busy && <button type="button" className="btn-ghost btn-sm" onClick={() => { update(active.id, (c) => ({ ...c, maamarId: undefined, maamarTitle: undefined })); }}>Toda la biblioteca</button>}
            </span>
          )}
        </header>
        <div className="chat-messages flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite">
          {ready && msgs.length === 0 && (
            <div className="chat-empty space-y-3 pt-4 text-center">
              <p className="font-serif text-lg">{active?.maamarId ? "Pregunta sobre este maamar" : "Pregunta a la biblioteca"}</p>
              <p className="text-sm text-[var(--muted)]">Respondo solo con lo que está escrito en los maamarim, con respuestas completas y la fuente de cada idea. Puedes preguntar en español o en hebreo.</p>
              <div className="chat-suggestions flex flex-col gap-2 pt-2">
                {SUGGEST.map((s) => <button key={s} type="button" onClick={() => send(s)} disabled={busy} dir="auto" className="chat-suggestion rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-left text-sm">{s}</button>)}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "chat-row flex justify-end" : "chat-row flex justify-start"}>
              <div className={m.role === "user"
                ? "chat-bubble max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--ink)] px-3.5 py-2 text-[var(--bg)]"
                : "chat-bubble w-full max-w-[100%] rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg)] px-4 py-3"}>
                {m.role === "user" ? <p className="whitespace-pre-wrap break-words" dir="auto">{m.content}</p>
                  : m.content ? <Markdown text={m.content} onCite={(n) => cite(i, n)} maxCite={m.refs?.length ?? 0} />
                    : <span className="mm-status">{activeBusy && i === msgs.length - 1 ? status || "Pensando…" : ""}</span>}
                {m.role === "assistant" && m.refs && m.refs.length > 0 && (
                  <div className="mm-refs">
                    {m.refs.map((r, j) => ({ r, n: j + 1 })).filter(({ n }) => !m.cited?.length || m.cited.includes(n) || m.mode === "noai").map(({ r, n }) => (
                      <Link key={n} id={`ref-${i}-${n}`} href={`/maamarim/${r.maamarId}#${r.sectionId}`} className={`mm-ref${flash === `${i}-${n}` ? " flash" : ""}`}>
                        <span className="mm-ref-n">[{n}]</span>
                        <span><span className="mm-ref-t" dir="rtl" lang="he">{r.title}{r.sectionTitle ? ` — ${r.sectionTitle}` : ""}</span>{r.callNumber && <span className="mm-code"> · {r.callNumber}</span>}
                          <span className="mm-ref-q" dir="auto">{r.quote}</span></span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        {info?.enabled && (info.models.length > 1 || reasoning) && (
          <div className="chat-settings-wrap flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-3 py-1.5 text-xs">
            {info.models.length > 1 && (
              <label className="flex items-center gap-2"><span className="text-[var(--muted)]">Modelo</span>
                <select value={model} onChange={(e) => setPref({ model: e.target.value })} disabled={activeBusy} className="chat-model rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base sm:text-xs">
                  {info.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </label>
            )}
            {reasoning && (
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Nivel de razonamiento">
                <span className="text-[var(--muted)]">Razonamiento</span>
                <div className="inline-flex overflow-hidden rounded-md border border-[var(--line)]">
                  {info.efforts.map((e) => <button key={e} type="button" role="radio" aria-checked={effort === e} disabled={activeBusy} onClick={() => setPref({ effort: e })} className={`px-2.5 py-1 ${effort === e ? "bg-[var(--ink)] text-[var(--bg)]" : "bg-[var(--bg)]"}`}>{EFFORT_LABEL[e]}</button>)}
                </div>
              </div>
            )}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="chat-form flex gap-2 border-t border-[var(--line)] p-2 sm:p-3">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }}
            placeholder="Escribe tu pregunta… (Shift+Enter: nueva línea)" aria-label="Pregunta" maxLength={4000} rows={1} dir="auto"
            className="chat-input min-w-0 flex-1 resize-none rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base" />
          {activeBusy
            ? <button type="button" onClick={() => abortRef.current?.abort()} className="chat-send rounded-lg border border-[var(--line)] px-4 py-2 text-sm">Detener</button>
            : <button type="submit" disabled={busy || !input.trim()} className="chat-send rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-40">Enviar</button>}
        </form>
      </section>
    </div>
  );
}
