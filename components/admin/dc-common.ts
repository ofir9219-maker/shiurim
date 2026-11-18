export type Crumb = { id: string; name: string };
export type Row = {
  kind: "folder" | "audio" | "file"; id: string; name: string; size?: number; durationMs?: number | null; status?: string; label?: string; error?: string;
  collection?: { name: string; slug: string; published: boolean } | null; inWeb?: boolean; hasMd?: boolean; hasJson?: boolean; published?: boolean;
};
export type ModelInfo = { id: string; label: string; note: string; splitSec: number };
export type CenterState = {
  root: { id: string; name: string } | null;
  drive: { connected: boolean; oauthConfigured: boolean; email: string | null };
  collections: { folderId: string; name: string; slug: string; published: boolean }[];
  costs: Record<string, { falUsd: number; openaiUsd: number; minutes: number; items: number }>;
  queue: { running: string | null; pending: number; items: { id: string; name: string; state: string; status: string; error?: string }[]; pollMinutes: number; nextPollAt: number };
  models: ModelInfo[]; languages: { code: string; label: string }[]; efforts: string[];
};
export async function api<T = unknown>(op: string, o: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api/admin/center/${op}`, { method: o.method ?? "GET", headers: o.body ? { "content-type": "application/json" } : undefined, body: o.body ? JSON.stringify(o.body) : undefined, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}
export const fmtSize = (b?: number) => (!b ? "—" : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
export const fmtDur = (ms: number) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };
