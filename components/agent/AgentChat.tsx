"use client";
// Site-wide AI chat: principal agent plans + writes, subagents read sources in parallel, quotes verified by code.
// Several chats (each with its own history and verified "dossier"), collapsible AI settings per role, live progress.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatSidebar } from "../chat/ChatSidebar";
import Markdown from "../maamarim/Markdown";
import type { Conversation } from "@/lib/chat-store";
import { AGENT_EFFORTS, AGENT_MODELS, DEFAULT_SETTINGS, modelLabel, type AgentSettings } from "@/lib/agent/models";
import type { AgentEvent, Citation, Dossier, PendingSource } from "@/lib/agent/agent";

export type AgentScope = { type: "all" } | { type: "series"; slug: string } | { type: "maamarim" } | { type: "shiur"; id: string; title?: string } | { type: "maamar"; id: string; title?: string };
type Step = { id: string; text: string; model?: string; state: "run" | "ok" | "err"; detail?: string };
type AMsg = {
  role: "user" | "assistant"; content: string;
  citations?: Citation[]; cited?: number[]; pending?: PendingSource[]; sources?: string[]; steps?: Step[]; error?: string; mode?: string; settings?: AgentSettings;
};
type AChat = { id: string; title: string; createdAt: number; updatedAt: number; messages: AMsg[]; dossier: Dossier; scope: AgentScope };

const STORE = "agent-chats-v1", ACTIVE = "agent-chat-active-v1", PREFS = "agent-settings-v1";
const EMPTY: Dossier = { readings: [], citations: [] };
const ls = (): Storage | null => { try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; } };
const newChat = (scope: AgentScope): AChat => ({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: "Nueva conversación", createdAt: Date.now(), updatedAt: Date.now(), messages: [], dossier: EMPTY, scope });
const scopeKey = (s: AgentScope) => s.type === "shiur" || s.type === "maamar" ? `${s.type}:${s.id}` : s.type === "series" ? `series:${s.slug}` : s.type;
function loadChats(): AChat[] { try { const a = JSON.parse(ls()?.getItem(STORE) || "[]"); return Array.isArray(a) ? a.filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages)) : []; } catch { return []; } }
function saveChats(l: AChat[]) {
  let keep = l.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  for (let i = 0; i < 6; i++) { try { ls()?.setItem(STORE, JSON.stringify(keep)); return; } catch { keep = keep.slice(0, Math.max(1, Math.floor(keep.length * 0.7))).map((c) => ({ ...c, dossier: { readings: c.dossier.readings.slice(-8), citations: c.dossier.citations.slice(-40) } })); } }
}
function loadPrefs(): AgentSettings {
  try {
    const p = JSON.parse(ls()?.getItem(PREFS) || "null");
    const ok = (r: any, d: AgentSettings["principal"]) => ({ model: AGENT_MODELS.some((m) => m.id === r?.model) ? r.model : d.model, effort: AGENT_EFFORTS.some((e) => e.id === r?.effort) ? r.effort : d.effort });
    return p ? { principal: ok(p.principal, DEFAULT_SETTINGS.principal), sub: ok(p.sub, DEFAULT_SETTINGS.sub) } : DEFAULT_SETTINGS;
  } catch { return DEFAULT_SETTINGS; }
}

const SUGGEST = [
  "¿Qué enseña la Guemará sobre los sufrimientos de amor?",
  "¿Cuál es el tiempo para leer el Shemá de la noche?",
  "¿Qué explica Rabí Najmán sobre la imaginación y la fe?",
  "מה ההבדל בין שכל לדמיון?",
];

export default function AgentChat({ scope: fixed, compact = false, initialQuestion }: { scope?: AgentScope; compact?: boolean; initialQuestion?: string }) {
  const router = useRouter();
  const baseScope: AgentScope = fixed ?? { type: "all" };
  const [chats, setChats] = useState<AChat[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState(initialQuestion ?? "");
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<{ slug: string; title: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const chatsRef = useRef<AChat[]>([]); chatsRef.current = chats;

  useEffect(() => {
    setSettings(loadPrefs());
    const all = loadChats();
    const k = scopeKey(baseScope);
    let act = initialQuestion ? undefined : fixed && (fixed.type === "shiur" || fixed.type === "maamar") ? all.find((c) => scopeKey(c.scope) === k) : all.find((c) => c.id === ls()?.getItem(ACTIVE));
    let list = all;
    if (!act) { act = newChat(baseScope); list = [act, ...all]; }
    setChats(list); setActiveId(act.id); setReady(true);
    if (!fixed) fetch("/api/series").then((r) => (r.ok ? r.json() : null)).then((j) => { if (Array.isArray(j?.series)) setSeries(j.series.map((s: any) => ({ slug: s.slug, title: s.title }))); }).catch(() => {});
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (ready) { const t = setTimeout(() => saveChats(chats), 300); return () => clearTimeout(t); } }, [chats, ready]);
  useEffect(() => { const f = () => ready && saveChats(chatsRef.current); window.addEventListener("pagehide", f); return () => window.removeEventListener("pagehide", f); }, [ready]);
  useEffect(() => { if (ready && activeId && !fixed) try { ls()?.setItem(ACTIVE, activeId); } catch { /* ignore */ } }, [activeId, ready, fixed]);
  const setPrefs = (s: AgentSettings) => { setSettings(s); try { ls()?.setItem(PREFS, JSON.stringify(s)); } catch { /* ignore */ } };

  const active = chats.find((c) => c.id === activeId);
  const msgs = active?.messages ?? [];
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs.length, msgs[msgs.length - 1]?.content.length, msgs[msgs.length - 1]?.steps?.length]);
  const update = useCallback((id: string, fn: (c: AChat) => AChat) => setChats((l) => l.map((c) => (c.id === id ? fn(c) : c))), []);

  const run = useCallback(async (chat: AChat, history: AMsg[], action: "ask" | "expand") => {
    const id = chat.id;
    const lastA = [...history].reverse().find((m) => m.role === "assistant");
    const used = { ...settings };
    const placeholder: AMsg = { role: "assistant", content: "", steps: [], settings: used };
    const msgsNow = action === "expand" ? history.slice(0, -1) : history;
    const prevAns = action === "expand" ? history[history.length - 1] : null;
    update(id, (c) => ({ ...c, updatedAt: Date.now(), messages: [...msgsNow, action === "expand" ? { ...prevAns!, steps: [], error: undefined } : placeholder] }));
    setBusy(true);
    const ac = new AbortController(); abortRef.current = ac;
    const patch = (fn: (m: AMsg) => AMsg) => update(id, (c) => { const ms = c.messages.slice(); ms[ms.length - 1] = fn(ms[ms.length - 1]); return { ...c, messages: ms, updatedAt: Date.now() }; });
    const step = (s: Step) => patch((m) => { const st = (m.steps ?? []).map((x) => (x.state === "run" && x.id !== s.id && !x.id.startsWith("read:") ? { ...x, state: "ok" as const } : x)); const i = st.findIndex((x) => x.id === s.id); if (i >= 0) st[i] = { ...st[i], ...s }; else st.push(s); return { ...m, steps: st }; });
    let expandText = "";
    try {
      const body = {
        messages: msgsNow.filter((m) => m.content.trim()).map((m) => ({ role: m.role, content: m.content })),
        dossier: chat.dossier, scope: chat.scope, settings: used, action,
        focus: action === "expand" ? prevAns?.sources : lastA?.sources, pending: action === "expand" ? prevAns?.pending : undefined,
      };
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Error ${res.status}`); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const handle = (line: string) => {
        if (!line.trim()) return;
        let ev: AgentEvent; try { ev = JSON.parse(line); } catch { return; }
        if (ev.type === "stage") step({ id: ev.stage, text: ev.text, model: ev.model, state: "run" });
        else if (ev.type === "queries") { if (ev.queries.length) step({ id: "plan", text: "Búsqueda preparada", state: "ok", detail: ev.queries.slice(1).join(" · ") }); else step({ id: "plan", text: "Uso las citas ya verificadas de esta conversación", state: "ok" }); }
        else if (ev.type === "sources") { for (const s of ev.sources) if (s.reused) step({ id: `read:${s.key}`, text: `Ya leída: ${s.title}`, state: "ok" }); }
        else if (ev.type === "reading") step({ id: `read:${ev.key}`, text: `${ev.status === "start" ? "Leyendo" : ev.status === "done" ? "Leída" : "No se pudo leer"}: ${ev.title}`, model: ev.model, state: ev.status === "start" ? "run" : ev.status === "done" ? "ok" : "err",
          detail: ev.status === "done" ? `${ev.verified} cita(s) verificada(s)${ev.rejected ? `, ${ev.rejected} descartada(s) por no coincidir con el texto` : ""}${ev.relevant === false ? " · poco relevante" : ""}` : ev.error });
        else if (ev.type === "delta") { if (action === "expand") { expandText += ev.text; patch((m) => ({ ...m, content: expandText })); } else patch((m) => ({ ...m, content: m.content + ev.text })); }
        else if (ev.type === "error") patch((m) => ({ ...m, error: ev.message, steps: (m.steps ?? []).map((x) => (x.state === "run" ? { ...x, state: "err" as const } : x)) }));
        else if (ev.type === "done") {
          patch((m) => ({ ...m, content: ev.answer, citations: ev.citations, cited: ev.cited, pending: ev.pending, sources: action === "expand" ? [...new Set([...(m.sources ?? []), ...ev.sources])] : ev.sources, mode: ev.mode, steps: (m.steps ?? []).map((x) => (x.state === "run" ? { ...x, state: "ok" as const } : x)) }));
          update(id, (c) => ({ ...c, dossier: ev.dossier }));
        }
      };
      for (;;) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || ""; lines.forEach(handle); }
      handle(buf);
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, error: (e as Error).message || "No se pudo conectar.", steps: (m.steps ?? []).map((x) => (x.state === "run" ? { ...x, state: "err" as const } : x)) }));
    } finally { setBusy(false); }
  }, [settings, update]);

  const send = (text: string) => {
    const q = text.trim(); if (!q || busy || !active) return;
    const words = q.replace(/[¿?¡!]/g, "").split(/\s+/).filter(Boolean);
    const history: AMsg[] = [...active.messages, { role: "user", content: q }];
    const title = active.messages.length ? active.title : words.slice(0, 8).join(" ") + (words.length > 8 ? "…" : "");
    const c = { ...active, title, messages: history };
    update(active.id, () => c); setInput("");
    void run(c, history, "ask");
  };
  // ?q= (from the old search box / series search): ask it once in a new chat, then clean the URL
  const autoSent = useRef(false);
  useEffect(() => {
    if (!ready || !initialQuestion || autoSent.current || !active) return;
    autoSent.current = true;
    try { const u = new URL(location.href); u.searchParams.delete("q"); history.replaceState(null, "", u); } catch { /* ignore */ }
    send(initialQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, active?.id]);
  const expand = () => { if (!active || busy) return; void run(active, active.messages, "expand"); };

  const startNew = () => { const c = newChat(active?.scope ?? baseScope); setChats((l) => [c, ...l.filter((x) => x.messages.length)]); setActiveId(c.id); setDrawer(false); setInput(""); };
  const select = (id: string) => { setChats((l) => l.filter((c) => c.messages.length || c.id === id)); setActiveId(id); setDrawer(false); };
  const remove = (id: string) => { if (busy && id === activeId) abortRef.current?.abort(); const rest = chats.filter((c) => c.id !== id); if (id === activeId) { const n = rest.find((c) => c.messages.length) ?? newChat(baseScope); setChats(rest.some((c) => c.id === n.id) ? rest : [n, ...rest]); setActiveId(n.id); } else setChats(rest); };
  const shown = useMemo(() => { const q = query.trim().toLowerCase(); const l = chats.filter((c) => c.messages.length || c.id === activeId).sort((a, b) => b.updatedAt - a.updatedAt); return q ? l.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q))) : l; }, [chats, activeId, query]);
  const setScope = (v: string) => { if (!active) return; const s: AgentScope = v === "all" ? { type: "all" } : v === "maamarim" ? { type: "maamarim" } : { type: "series", slug: v.slice(7) }; update(active.id, (c) => ({ ...c, scope: s })); };

  const cite = (m: AMsg, n: number) => { const c = m.citations?.find((x) => x.n === n); if (c) router.push(c.href); };
  const roleRow = (k: "principal" | "sub", label: string) => (
    <fieldset className="ag-role">
      <legend>{label}</legend>
      <label><span>Modelo</span>
        <select className="input" value={settings[k].model} disabled={busy} onChange={(e) => setPrefs({ ...settings, [k]: { ...settings[k], model: e.target.value } })}>
          {AGENT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.desc})</option>)}
        </select></label>
      <label><span>Pensamiento</span>
        <select className="input" value={settings[k].effort} disabled={busy} onChange={(e) => setPrefs({ ...settings, [k]: { ...settings[k], effort: e.target.value } })}>
          {AGENT_EFFORTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select></label>
    </fieldset>
  );
  const scopeVal = active ? (active.scope.type === "series" ? `series:${active.scope.slug}` : active.scope.type) : "all";

  const conversation = (
    <section className="ag-main" aria-label="Conversación">
      <header className="ag-head">
        {!compact && <button type="button" className="ag-drawer btn-ghost btn-sm" onClick={() => setDrawer(true)}>☰ Chats</button>}
        <h2 className="ag-title" dir="auto">{active && msgs.length ? active.title : fixed?.type === "shiur" ? "Preguntar sobre esta clase" : fixed?.type === "maamar" ? "Preguntar sobre este maamar" : "Pregunta al sitio"}</h2>
        {compact && msgs.length > 0 && !busy && <button type="button" className="btn-ghost btn-sm" onClick={startNew}>Nueva</button>}
        <button type="button" className="btn-ghost btn-sm" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings} aria-controls="ag-settings">⚙ Ajustes</button>
      </header>
      {showSettings && (
        <div id="ag-settings" className="ag-settings">
          {roleRow("principal", "Agente principal")}
          {roleRow("sub", "Subagentes")}
          <p className="muted ag-note">Se guardan en este navegador. Principal: organiza la búsqueda y redacta. Subagentes: leen cada fuente y localizan las citas.</p>
        </div>
      )}
      {!fixed && active && (
        <div className="ag-scope">
          <label><span className="muted">Buscar en</span>
            <select className="input" value={scopeVal} disabled={busy} onChange={(e) => setScope(e.target.value)}>
              <option value="all">Todo el sitio (clases y maamarim)</option>
              {series.map((s) => <option key={s.slug} value={`series:${s.slug}`}>Clases · {s.title}</option>)}
              <option value="maamarim">Maamarim</option>
            </select></label>
        </div>
      )}
      <div className="ag-msgs" aria-live="polite">
        {ready && msgs.length === 0 && (
          <div className="ag-empty">
            <p className="ag-empty-title">{fixed?.type === "shiur" ? "Pregunta sobre esta clase" : fixed?.type === "maamar" ? "Pregunta sobre este maamar" : "Pregunta lo que quieras sobre las clases y los maamarim"}</p>
            <p className="muted">Un agente prepara la búsqueda, varios lectores revisan las fuentes en paralelo y cada cita se verifica contra el texto real. Toca una cita para ir al pasaje{fixed?.type === "maamar" ? "" : " (o al segundo exacto del audio)"}.</p>
            {!fixed && <div className="ag-suggest">{SUGGEST.map((s) => <button key={s} type="button" className="chip" dir="auto" onClick={() => send(s)} disabled={busy}>{s}</button>)}</div>}
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} className="ag-row user"><div className="ag-bubble user" dir="auto">{m.content}</div></div>
        ) : (
          <div key={i} className="ag-row bot">
            <div className="ag-bubble bot">
              {m.steps && m.steps.length > 0 && (
                <details className="ag-steps" open={busy && i === msgs.length - 1}>
                  <summary>{busy && i === msgs.length - 1 ? "Trabajando…" : `Proceso (${m.steps.length} pasos${m.settings ? ` · ${modelLabel(m.settings.principal.model)} / ${modelLabel(m.settings.sub.model)}` : ""})`}</summary>
                  <ol>{m.steps.map((s) => (
                    <li key={s.id} className={`ag-step ${s.state}`}>
                      <span className="ag-dot" aria-hidden />
                      <span dir="auto">{s.text}{s.model && <em className="ag-model"> · {s.model}</em>}{s.detail && <small dir="auto">{s.detail}</small>}</span>
                    </li>))}</ol>
                </details>
              )}
              {m.content ? <Markdown text={m.content} onCite={(n) => cite(m, n)} maxCite={Math.max(0, ...(m.citations ?? []).map((c) => c.n))} /> : !m.error && <p className="ag-wait">…</p>}
              {m.error && <p className="ag-error" role="alert">{m.error}</p>}
              {m.citations && m.citations.length > 0 && (
                <ol className="ag-cites">
                  {m.citations.filter((c) => !m.cited?.length || m.cited.includes(c.n)).map((c) => (
                    <li key={c.n}>
                      <Link href={c.href} className="ag-cite">
                        <span className="ag-cite-n">[{c.n}]</span>
                        <span className="ag-cite-body">
                          <span className="ag-cite-src" dir="auto">{c.title} · <b>{c.kind === "shiur" ? `▶ ${c.label}` : c.label}</b></span>
                          <span className="ag-cite-q" dir="auto">«{c.quote}»</span>
                        </span>
                      </Link>
                    </li>))}
                </ol>
              )}
              {!busy && i === msgs.length - 1 && m.pending && m.pending.length > 0 && !m.error && (
                <button type="button" className="btn-ghost btn-sm ag-expand" onClick={expand}>Ampliar con más fuentes ({Math.min(5, m.pending.length)})</button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="ag-form" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <textarea className="input ag-input" value={input} rows={1} dir="auto" maxLength={3000} placeholder="Escribe tu pregunta… (Shift+Enter: nueva línea)" aria-label="Pregunta"
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); } }} />
        {busy ? <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>Detener</button>
          : <button type="submit" className="btn" disabled={!input.trim()}>Preguntar</button>}
      </form>
    </section>
  );

  if (compact) return <div className="ag ag-compact">{conversation}</div>;
  return (
    <div className="ag ag-layout">
      {drawer && <button type="button" className="chat-backdrop fixed inset-0 z-30 bg-black/30 lg:hidden" aria-label="Cerrar lista" onClick={() => setDrawer(false)} />}
      <ChatSidebar chats={shown as unknown as Conversation[]} activeId={activeId} query={query} open={drawer} notice=""
        onQuery={setQuery} onNew={startNew} onSelect={select} onRename={(id, t) => update(id, (c) => ({ ...c, title: t }))} onDelete={remove}
        onExport={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(chats.filter((c) => c.messages.length), null, 1)], { type: "application/json" })); a.download = "conversaciones.json"; a.click(); }}
        onImport={async (f) => { try { const l = JSON.parse(await f.text()); if (Array.isArray(l)) setChats((cur) => [...cur.filter((c) => !l.some((x: AChat) => x.id === c.id)), ...l.filter((x: AChat) => x && x.id && Array.isArray(x.messages))]); } catch { /* ignore */ } }}
        onClose={() => setDrawer(false)} />
      {conversation}
    </div>
  );
}
