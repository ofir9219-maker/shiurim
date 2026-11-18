"use client";
import { useRef, useState } from "react";
import { relativeDate, type Conversation } from "../../lib/chat-store";

type Props = {
  chats: Conversation[]; activeId: string; query: string; open: boolean; notice: string;
  onQuery: (q: string) => void; onNew: () => void; onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void; onDelete: (id: string) => void;
  onExport: () => void; onImport: (file: File) => void; onClose: () => void;
};

export function ChatSidebar(p: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const commit = () => { if (editing) { const t = draft.trim(); if (t) p.onRename(editing, t.slice(0, 120)); } setEditing(null); };

  return (
    <aside className={`chat-sidebar fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col gap-2 border-r border-[var(--line)] bg-[var(--card)] p-3 shadow-xl transition-transform lg:static lg:z-auto lg:w-72 lg:max-w-none lg:translate-x-0 lg:rounded-xl lg:border lg:shadow-sm ${p.open ? "is-open translate-x-0" : "-translate-x-full"}`} aria-label="Conversaciones" data-open={p.open}>
      <div className="chat-sidebar-head flex items-center gap-2">
        <button type="button" className="chat-new btn flex-1 rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-medium text-[var(--bg)]" onClick={p.onNew}>+ Nuevo chat</button>
        <button type="button" className="chat-sidebar-close rounded-lg border border-[var(--line)] px-3 py-2 text-sm lg:hidden" onClick={p.onClose} aria-label="Cerrar lista de chats">✕</button>
      </div>
      <input type="search" className="chat-search w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-base text-[var(--text)] lg:text-sm" value={p.query} onChange={(e) => p.onQuery(e.target.value)} placeholder="Buscar chats…" aria-label="Buscar chats" />
      <ul className="chat-list -mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1">
        {p.chats.length === 0 && <li className="chat-list-empty px-2 py-3 text-sm text-[var(--muted)]">{p.query ? "Sin resultados." : "Aún no hay chats."}</li>}
        {p.chats.map((c) => (
          <li key={c.id} className={`chat-item flex items-stretch rounded-lg border ${c.id === p.activeId ? "is-active border-[var(--gold)] bg-[var(--bg)]" : "border-transparent hover:bg-[var(--bg)]"}`} data-chat-id={c.id}>
            {editing === c.id ? (
              <input className="chat-rename m-1 w-full rounded-md border border-[var(--gold)] bg-[var(--card)] px-2 py-1.5 text-base text-[var(--text)] lg:text-sm" autoFocus value={draft} maxLength={120} aria-label="Nuevo nombre del chat"
                onChange={(e) => setDraft(e.target.value)} onBlur={commit}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(null); }} />
            ) : confirming === c.id ? (
              <div className="chat-confirm flex flex-wrap items-center gap-2 px-2 py-2 text-sm" role="alertdialog" aria-label="Confirmar borrado">
                <span>¿Borrar este chat?</span>
                <button type="button" className="chat-confirm-yes rounded-md bg-[var(--ink)] px-2.5 py-1 text-[var(--bg)]" onClick={() => { setConfirming(null); p.onDelete(c.id); }}>Borrar</button>
                <button type="button" className="chat-confirm-no rounded-md border border-[var(--line)] px-2.5 py-1" onClick={() => setConfirming(null)}>Cancelar</button>
              </div>
            ) : (
              <>
                <button type="button" className="chat-item-main flex min-w-0 flex-1 flex-col gap-0.5 px-2.5 py-2 text-left" onClick={() => p.onSelect(c.id)} aria-current={c.id === p.activeId}>
                  <span className="chat-item-title truncate text-sm font-medium text-[var(--text)]">{c.title}</span>
                  <span className="chat-item-meta flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    {c.classId && <span className="chat-badge rounded bg-[var(--gold-soft)] px-1.5 text-[11px] text-[var(--ink)]" title={`Chat de la clase ${c.classId}`}>Clase</span>}
                    <time dateTime={new Date(c.updatedAt).toISOString()}>{relativeDate(c.updatedAt)}</time>
                  </span>
                </button>
                <span className="chat-item-actions flex items-center pr-1">
                  <button type="button" className="chat-rename-btn grid h-9 w-9 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--card)]" aria-label={`Renombrar ${c.title}`} onClick={() => { setDraft(c.title); setEditing(c.id); }}>✎</button>
                  <button type="button" className="chat-delete-btn grid h-9 w-9 place-items-center rounded-md text-[var(--muted)] hover:bg-[var(--card)]" aria-label={`Borrar ${c.title}`} onClick={() => setConfirming(c.id)}>🗑</button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <details className="chat-menu border-t border-[var(--line)] pt-2 text-sm">
        <summary className="cursor-pointer text-[var(--muted)]">Más</summary>
        <div className="chat-menu-items mt-2 flex flex-col items-start gap-1 [&>button]:rounded-md [&>button]:px-2 [&>button]:py-1.5 [&>button]:text-left [&>button]:hover:bg-[var(--bg)]">
          <button type="button" onClick={p.onExport}>Exportar chats (JSON)</button>
          <button type="button" onClick={() => fileRef.current?.click()}>Importar chats…</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden aria-label="Importar chats"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onImport(f); e.target.value = ""; }} />
        </div>
      </details>
      {p.notice && <p className="chat-notice text-xs text-[var(--muted)]" role="status">{p.notice}</p>}
    </aside>
  );
}
