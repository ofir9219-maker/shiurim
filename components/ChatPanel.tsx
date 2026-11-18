"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePlayer } from "./player/PlayerProvider";
import { RefChips } from "./chat/RefChips";
import { ChatSidebar } from "./chat/ChatSidebar";
import type { ChatEvent, Effort, Ref } from "../lib/chat-core";
import {
  chatForClass, exportChats, filterChats, loadActiveId, loadChats, mergeChats, newChat, parseImport, saveActiveId, saveChats,
  sortChats, titleFromText, DEFAULT_TITLE, type Conversation, type StoredMsg,
} from "../lib/chat-store";

const PREF_KEY = "shiurim-chat-prefs-v1";
const MAX_SENT = 40;
type ModelsInfo = { models: { id: string; label: string; reasoning: boolean }[]; default: string; efforts: Effort[]; defaultEffort: Effort; enabled: boolean };
const EFFORT_LABEL: Record<Effort, string> = { minimal: "Mínimo", low: "Bajo", medium: "Medio", high: "Alto" };
const SUGGESTIONS = [
  "¿Cuál es el tiempo para leer el Shemá de la noche?",
  "Resume el shiur 1.1",
  "¿Qué enseña sobre la emuná y los sufrimientos?",
  "¿Qué dice Tosafot sobre este tema?",
];

const ls = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };

export default function ChatPanel({ classId }: { classId?: string } = {}) {
  const player = usePlayer();
  const [chats, setChats] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [info, setInfo] = useState<ModelsInfo | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatsRef = useRef<Conversation[]>([]);
  chatsRef.current = chats;
  const prefRef = useRef<{ model?: string; effort?: string }>({});

  // ---- load
  useEffect(() => {
    const store = ls();
    try { prefRef.current = JSON.parse(store?.getItem(PREF_KEY) || "{}") || {}; } catch { /* ignore */ }
    const loaded = loadChats(store);
    let active: Conversation | undefined;
    let list = loaded;
    if (classId) active = chatForClass(loaded, classId);
    else { const id = loadActiveId(store); active = loaded.find((c) => c.id === id) || loaded[0]; }
    if (!active) { active = newChat({ classId, model: prefRef.current.model || "", effort: (prefRef.current.effort as Effort) || "medium" }); list = [active, ...loaded]; }
    setChats(list); setActiveId(active.id); setReady(true);
    return () => abortRef.current?.abort();
  }, [classId]);

  useEffect(() => {
    let off = false;
    fetch("/api/chat/models").then((r) => (r.ok ? r.json() : null)).then((j: ModelsInfo | null) => {
      if (!off && j && Array.isArray(j.models)) setInfo(j);
    }).catch(() => {});
    return () => { off = true; };
  }, []);

  // ---- persist (debounced; flushed when the page is hidden)
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { saveChats(ls(), chats); }, 300);
    return () => clearTimeout(t);
  }, [chats, ready]);
  useEffect(() => {
    const flush = () => { if (ready) saveChats(ls(), chatsRef.current); };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [ready]);
  useEffect(() => { if (ready && activeId && !classId) saveActiveId(ls(), activeId); }, [activeId, ready, classId]);

  const active = chats.find((c) => c.id === activeId);
  const msgs = active?.messages ?? [];
  const busy = busyId !== null;
  const activeBusy = busyId === activeId;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs]);

  const model = active && info?.models.some((m) => m.id === active.model) ? active.model : info?.default || "";
  const effort: Effort = active && info?.efforts.includes(active.effort) ? active.effort : info?.defaultEffort || "medium";
  const cur = info?.models.find((m) => m.id === model);
  const reasoning = !!cur?.reasoning;
  const showRow = !!info?.enabled && (info.models.length > 1 || reasoning);

  const update = useCallback((id: string, fn: (c: Conversation) => Conversation) => {
    setChats((all) => all.map((c) => (c.id === id ? fn(c) : c)));
  }, []);
  const play = useCallback((r: Ref) => { Promise.resolve(player?.playAt(r.classId, r.startMs)).catch(() => {}); }, [player]);
  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(""), 4000); };

  const setPref = (patch: { model?: string; effort?: Effort }) => {
    if (!active) return;
    update(active.id, (c) => ({ ...c, ...patch }));
    prefRef.current = { ...prefRef.current, ...patch };
    try { ls()?.setItem(PREF_KEY, JSON.stringify(prefRef.current)); } catch { /* ignore */ }
  };

  // ---- chat management
  const dropEmpty = (list: Conversation[], keep: string) => list.filter((c) => c.messages.length > 0 || c.id === keep);
  const startNew = () => {
    const empty = chats.find((c) => c.messages.length === 0 && !c.classId);
    if (empty) { setActiveId(empty.id); setDrawer(false); return; }
    const c = newChat({ model: model || "", effort });
    setChats((all) => [c, ...dropEmpty(all, c.id)]); setActiveId(c.id); setDrawer(false); setInput("");
  };
  const select = (id: string) => { setChats((all) => dropEmpty(all, id)); setActiveId(id); setDrawer(false); setInput(""); };
  const rename = (id: string, title: string) => update(id, (c) => ({ ...c, title }));
  const remove = (id: string) => {
    if (busyId === id) abortRef.current?.abort();
    const rest = chats.filter((c) => c.id !== id);
    if (id === activeId) {
      const next = sortChats(rest.filter((c) => c.messages.length))[0] || newChat({ model: model || "", effort });
      setChats(rest.some((c) => c.id === next.id) ? rest : [next, ...rest]); setActiveId(next.id);
    } else setChats(rest);
  };
  const resetClassChat = () => { if (active) update(active.id, (c) => ({ ...c, messages: [], memory: undefined, memoryUpTo: undefined, title: DEFAULT_TITLE, updatedAt: Date.now() })); };
  const doExport = () => {
    try {
      const blob = new Blob([exportChats(chats)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `chats-shiurim-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch { flash("No se pudo exportar."); }
  };
  const doImport = async (file: File) => {
    const parsed = parseImport(await file.text().catch(() => ""));
    if (!parsed || !parsed.length) { flash("Archivo no válido."); return; }
    setChats((all) => mergeChats(all, parsed)); flash(`${parsed.length} chat(s) importados.`);
  };

  // ---- send
  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busyId || !active) return;
    const id = active.id;
    const m0 = { model: model || undefined, effort: reasoning ? effort : undefined };
    const userMsg: StoredMsg = { role: "user", content: q };
    const all: StoredMsg[] = [...active.messages, userMsg];
    const first = active.messages.length === 0;
    const heur = first ? titleFromText(q) : active.title;
    update(id, (c) => ({ ...c, title: heur, updatedAt: Date.now(), messages: [...all, { role: "assistant", content: "", ...m0 }] }));
    setInput(""); setBusyId(id);
    const ac = new AbortController(); abortRef.current = ac;
    const patch = (fn: (m: StoredMsg) => StoredMsg) => update(id, (c) => { const ms = c.messages.slice(); ms[ms.length - 1] = fn(ms[ms.length - 1]); return { ...c, messages: ms, updatedAt: Date.now() }; });

    if (first) {
      fetch("/api/chat/title", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j?.ai && typeof j.title === "string" && j.title) update(id, (c) => (c.title === heur ? { ...c, title: j.title.slice(0, 120) } : c)); })
        .catch(() => {});
    }
    // Only the part not yet folded into memory is sent (last MAX_SENT at most).
    const start = Math.max(active.memoryUpTo || 0, all.length - MAX_SENT);
    const sent = all.slice(start).map((m, i) => ({ m, i: start + i })).filter((x) => x.m.content.trim());
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ac.signal,
        body: JSON.stringify({ messages: sent.map(({ m }) => ({ role: m.role, content: m.content })), memory: active.memory || undefined, classId: classId || active.classId, model: model || undefined, effort: reasoning ? effort : undefined }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: ChatEvent; try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "delta") patch((m) => ({ ...m, content: m.content + ev.text }));
        else {
          patch((m) => ({ ...m, refs: ev.refs, cited: ev.cited, mode: ev.mode }));
          if (typeof ev.memory === "string" && ev.condensed && ev.condensed > 0) {
            const upTo = (sent[Math.min(ev.condensed, sent.length) - 1]?.i ?? start - 1) + 1;
            update(id, (c) => ({ ...c, memory: ev.memory, memoryUpTo: Math.max(c.memoryUpTo || 0, upTo) }));
          }
        }
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
    } finally { setBusyId(null); }
  }, [active, busyId, classId, model, effort, reasoning, update]);

  const shown = useMemo(() => filterChats(sortChats(chats.filter((c) => c.messages.length > 0 || c.id === activeId)), query), [chats, query, activeId]);

  const settings = showRow && info && (
    <div className="chat-settings-wrap border-t border-[var(--line)] px-2 py-1.5 sm:px-3">
      <button type="button" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} aria-controls="chat-settings"
        className="chat-settings-toggle flex w-full items-center justify-between gap-2 text-xs text-[var(--muted)] sm:hidden">
        <span className="truncate">⚙ Ajustes · {model}{reasoning ? ` · ${EFFORT_LABEL[effort]}` : ""}</span>
        <span aria-hidden>{showSettings ? "▴" : "▾"}</span>
      </button>
      <div id="chat-settings" className={`chat-settings ${showSettings ? "flex" : "hidden"} mt-1.5 flex-col gap-2 sm:mt-0 sm:flex sm:flex-row sm:flex-wrap sm:items-center sm:gap-3`}>
        {info.models.length > 1 && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted)]">Modelo</span>
            <select value={model} onChange={(e) => setPref({ model: e.target.value })} disabled={activeBusy}
              className="chat-model min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2 py-1 text-base sm:text-xs">
              {info.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        )}
        {reasoning && (
          <div className="chat-effort flex flex-wrap items-center gap-2 text-xs" role="radiogroup" aria-label="Nivel de razonamiento">
            <span className="text-[var(--muted)]">Nivel de razonamiento</span>
            <div className="inline-flex overflow-hidden rounded-md border border-[var(--line)]">
              {info.efforts.map((e) => (
                <button key={e} type="button" role="radio" aria-checked={effort === e} disabled={activeBusy} onClick={() => setPref({ effort: e })}
                  className={`px-2.5 py-1 ${effort === e ? "bg-[var(--ink)] text-[var(--bg)]" : "bg-[var(--bg)]"}`}>
                  {EFFORT_LABEL[e]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const conversation = (
    <section className="chat-main flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-[var(--line)] bg-[var(--card)] text-[var(--text)] shadow-sm" aria-label="Conversación">
      <header className="chat-header flex items-center gap-2 border-b border-[var(--line)] px-3 py-2">
        {!classId && (
          <button type="button" className="chat-drawer-toggle rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm lg:hidden" onClick={() => setDrawer(true)} aria-label="Abrir lista de chats">☰ Chats</button>
        )}
        <h2 className="chat-title min-w-0 flex-1 truncate font-serif text-base">{active && active.messages.length ? active.title : "Preguntar a los shiurim"}</h2>
        {active?.memory && <span className="chat-memory-flag text-xs text-[var(--muted)]" title={active.memory}>● memoria</span>}
        {classId && msgs.length > 0 && !busy && (
          <button type="button" onClick={resetClassChat} className="chat-reset rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--muted)]">Reiniciar</button>
        )}
      </header>
      <div className="chat-messages flex-1 space-y-4 overflow-y-auto px-3 py-4 sm:px-5" aria-live="polite">
        {ready && msgs.length === 0 && (
          <div className="chat-empty space-y-3 pt-4 text-center">
            <p className="font-serif text-lg">Pregunta sobre los shiurim</p>
            <p className="text-sm text-[var(--muted)]">Respondo solo con lo que se dijo en las clases y te llevo al momento exacto.</p>
            <div className="chat-suggestions flex flex-col gap-2 pt-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} disabled={busy}
                  className="chat-suggestion rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-left text-sm">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "chat-row chat-row-user flex justify-end" : "chat-row chat-row-assistant flex justify-start"}>
            <div className={m.role === "user"
              ? "chat-bubble max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--ink)] px-3.5 py-2 text-sm text-[var(--bg)]"
              : "chat-bubble max-w-[95%] rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg)] px-3.5 py-2 text-sm"}>
              <p className="whitespace-pre-wrap break-words leading-relaxed">
                {m.content || (activeBusy && i === msgs.length - 1 ? <span className="opacity-60">Buscando en los shiurim…</span> : "")}
              </p>
              {m.role === "assistant" && m.refs && <RefChips refs={m.refs} cited={m.mode === "noai" ? undefined : m.cited} onPlay={play} />}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {settings}
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="chat-form flex gap-2 border-t border-[var(--line)] p-2 sm:p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Escribe tu pregunta…" aria-label="Pregunta" enterKeyHint="send" maxLength={2000}
          className="chat-input min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base" />
        <button type="submit" disabled={busy || !input.trim()}
          className="chat-send rounded-lg bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--bg)] disabled:opacity-40">
          {activeBusy ? "…" : "Enviar"}
        </button>
      </form>
    </section>
  );

  if (classId) return <div className="chat-box chat-embedded mx-auto flex h-[calc(100dvh-8rem)] min-h-[24rem] w-full max-w-2xl">{conversation}</div>;
  return (
    <div className="chat-box chat-layout relative mx-auto flex h-[calc(100dvh-8rem)] min-h-[24rem] w-full max-w-5xl gap-3">
      {drawer && <button type="button" className="chat-backdrop fixed inset-0 z-30 bg-black/30 lg:hidden" aria-label="Cerrar lista de chats" onClick={() => setDrawer(false)} />}
      <ChatSidebar chats={shown} activeId={activeId} query={query} open={drawer} notice={notice}
        onQuery={setQuery} onNew={startNew} onSelect={select} onRename={rename} onDelete={remove}
        onExport={doExport} onImport={doImport} onClose={() => setDrawer(false)} />
      {conversation}
    </div>
  );
}
