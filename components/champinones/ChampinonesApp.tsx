"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ResultView from "./ResultView";
import { PAGE_CSS } from "./page-css";
import { MODELS, DEFAULT_MODEL, DEFAULT_EFFORT, EFFORTS, modelInfo } from "../../lib/champinones/models";
import type { StreamEvent, StoredResult } from "../../lib/champinones/types";

const EXAMPLES = [
  "jivartá: Rabí Elazar ben Azaryá y los cántaros blancos",
  "¿Qué champiñones hay en las 5 memrot de Abba Binyamín?",
  "Champiñones about prayer as 'et ratzón'",
  "¿Qué conecta la barba de Rabí Elazar ben Azaryá con el sueño de Rabán Gamliel?",
];
const HIST_KEY = "shiurim:champ:history";
type Hist = { id: string; q: string; title: string; at: number };
type Row = { stage: string; label: string; detail?: string; t: number; done?: boolean };
type Res = Pick<StoredResult, "data" | "meta" | "question"> & { id: string; cached?: boolean };

function readHist(): Hist[] { try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; } }
function writeHist(h: Hist[]) { try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 25))); } catch {} }

export default function ChampinonesApp({ initialClassId }: { initialClassId?: string }) {
  const [q, setQ] = useState("");
  const [lang, setLang] = useState("auto");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [effort, setEffort] = useState(DEFAULT_EFFORT);
  const [scope, setScope] = useState("shas");
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const resRef = useRef<HTMLDivElement>(null);
  const t0 = useRef(0);

  useEffect(() => {
    setHist(readHist());
    const p = new URLSearchParams(window.location.search);
    const r = p.get("r"), qq = p.get("q");
    if (qq) setQ(qq);
    if (r && /^[a-f0-9]{16}$/.test(r)) void load(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!busy) return;
    const i = setInterval(() => setElapsed(Math.round((Date.now() - t0.current) / 1000)), 500);
    return () => clearInterval(i);
  }, [busy]);

  async function load(id: string) {
    setErr(""); setRes(null); setRows([]);
    try {
      const r = await fetch(`/api/champinones/${id}`);
      if (!r.ok) throw new Error(r.status === 404 ? "Ese análisis ya no está disponible (los enlaces duran 30 días)." : "No se pudo cargar el análisis.");
      const j: StoredResult = await r.json();
      setRes({ ...j, cached: true }); setQ((x) => x || j.question);
      history.replaceState(null, "", `/champinones?r=${id}`);
      const h = [{ id, q: j.question, title: j.data.title, at: Date.now() }, ...readHist().filter((x) => x.id !== id)];
      writeHist(h); setHist(h.slice(0, 25));
      setTimeout(() => resRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e: any) { setErr(e.message); }
  }

  const run = useCallback(async (refresh = false) => {
    const question = q.trim();
    if (question.length < 3 || busy) return;
    setBusy(true); setErr(""); setRes(null); setRows([]); setElapsed(0); t0.current = Date.now();
    const ctl = new AbortController(); abort.current = ctl;
    try {
      const r = await fetch("/api/champinones", {
        method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ question, language: lang, model, effort, scope, classId: initialClassId, refresh }),
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      const handle = (ev: StreamEvent) => {
        if (ev.type === "status") setRows((rs) => {
          const next = rs.map((x) => (x.stage !== ev.stage ? { ...x, done: true } : x));
          const i = next.findIndex((x) => x.stage === ev.stage);
          const row = { stage: ev.stage, label: ev.label, detail: ev.detail, t: ev.t };
          if (i >= 0) next[i] = { ...next[i], ...row, detail: ev.detail ?? next[i].detail }; else next.push(row);
          return next;
        });
        else if (ev.type === "progress") setRows((rs) => rs.map((x) => (x.stage === ev.stage ? { ...x, detail: ev.chars ? `${Math.round(ev.chars / 100) / 10}k caracteres generados…` : x.detail } : x)));
        else if (ev.type === "error") setErr(ev.message);
        else if (ev.type === "result") {
          setRes({ id: ev.id, data: ev.data, meta: ev.meta, question: ev.question, cached: ev.cached });
          history.replaceState(null, "", `/champinones?r=${ev.id}`);
          const h = [{ id: ev.id, q: ev.question, title: ev.data.title, at: Date.now() }, ...readHist().filter((x) => x.id !== ev.id)];
          writeHist(h); setHist(h.slice(0, 25));
          setTimeout(() => resRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) { try { handle(JSON.parse(line)); } catch {} } }
      }
    } catch (e: any) { if (e?.name !== "AbortError") setErr(e?.message || "Error de red."); }
    finally { setBusy(false); setRows((rs) => rs.map((x) => ({ ...x, done: true }))); }
  }, [q, lang, model, effort, scope, busy, initialClassId]);

  const link = res ? `${typeof location !== "undefined" ? location.origin : ""}/champinones?r=${res.id}` : "";
  async function copy() {
    try { await navigator.clipboard.writeText(link); } catch { const ta = document.createElement("textarea"); ta.value = link; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  }
  const reasoning = modelInfo(model).reasoning;
  const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${Math.max(1, m)} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

  return (
    <div className="cp">
      <style>{PAGE_CSS}</style>
      <section className="cp-hero">
        <div className="eyebrow">Champiñones</div>
        <h1>Conexiones visibles en la Guemará</h1>
        <p>Escribe un tema o una pregunta. Buscamos las palabras compartidas entre los pasajes —en Sefaria y en los shiurim— y sólo después explicamos por qué se conectan. Cada cita se verifica contra el texto.</p>
      </section>

      <form className="card cp-form" onSubmit={(e) => { e.preventDefault(); void run(); }}>
        <textarea className="input" value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} dir="auto" disabled={busy}
          placeholder="Ej.: jivartá y los cántaros blancos · prayer as ‘et ratzón’ · מה הקשר בין חיורתא לחצבי חיורי" aria-label="Tema o pregunta"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }} />
        <div className="cp-ex" aria-label="Ejemplos">{EXAMPLES.map((x) => <button key={x} type="button" className="chip" onClick={() => setQ(x)} disabled={busy}>{x}</button>)}</div>
        <div className="cp-opts">
          <label>Idioma de la respuesta<select className="input" value={lang} onChange={(e) => setLang(e.target.value)} disabled={busy}>
            <option value="auto">Automático (el de la pregunta)</option><option value="es">Español</option><option value="en">English</option><option value="he">עברית</option><option value="fr">Français</option></select></label>
          <label>Modelo<select className="input" value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}{m.note ? ` — ${m.note}` : ""}</option>)}</select></label>
          <label>Esfuerzo<select className="input" value={effort} onChange={(e) => setEffort(e.target.value)} disabled={busy || !reasoning}>{EFFORTS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <label>Alcance<select className="input" value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy}><option value="shas">Todo el Shas y Tanaj</option><option value="berakhot">Sólo Berajot (+ Tanaj)</option></select></label>
          <button className="btn cp-go" type="submit" disabled={busy || q.trim().length < 3}>{busy ? `Analizando… ${elapsed}s` : "Buscar champiñones"}</button>
        </div>
      </form>

      {(busy || rows.length > 0 && !res) && (
        <section className="card cp-prog" aria-live="polite" aria-label="Progreso">
          <ol>{rows.map((r, i) => (
            <li key={r.stage} className={r.done || (i < rows.length - 1) ? "ok" : "act"}><span className="dot" aria-hidden="true" /><span>{r.label}{r.detail ? <span className="d" dir="auto">{r.detail}</span> : null}</span><span className="tm">{Math.round(r.t / 1000)}s</span></li>
          ))}</ol>
        </section>
      )}
      {err && <div className="cp-err" role="alert">{err}</div>}

      {res && (
        <div ref={resRef}>
          <div className="cp-bar">
            <a className="btn btn-sm" href={`/api/champinones/${res.id}?format=html&download=1`} download>Descargar HTML</a>
            <button className="btn-ghost btn-sm" type="button" onClick={copy}>{copied ? "¡Enlace copiado!" : "Copiar enlace"}</button>
            <button className="btn-ghost btn-sm" type="button" onClick={() => { setQ(res.question || q); void run(true); }} disabled={busy}>Regenerar</button>
            <span className="meta tnum">{res.cached ? "desde caché · " : ""}{res.meta.model}{res.meta.effort ? ` · ${res.meta.effort}` : ""} · {Math.round(res.meta.totalMs / 1000)}s · US${res.meta.costUsd.toFixed(3)}</span>
          </div>
          <ResultView result={res} />
        </div>
      )}

      {hist.length > 0 && (
        <section className="cp-hist" aria-label="Análisis anteriores">
          <h2>Tus análisis anteriores</h2>
          <ul>{hist.map((h) => <li key={h.id}><button className="open" type="button" onClick={() => void load(h.id)} dir="auto">{h.title || h.q}</button><span className="when">hace {ago(h.at)}</span></li>)}</ul>
          <button className="clr" type="button" onClick={() => { writeHist([]); setHist([]); }}>Borrar historial</button>
        </section>
      )}
    </div>
  );
}
