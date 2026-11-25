import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setupProxy } from "../proxy";
import { dataDir } from "./store";
import { stripHtml, stripNikud, normRef } from "./text";
import type { Node } from "./types";

const BASE = (process.env.SEFARIA_BASE || "https://www.sefaria.org").replace(/\/$/, "");
export const TTL_MS = 7 * 86400_000;
const mem = new Map<string, { at: number; data: unknown }>();
export const stats = { hits: 0, misses: 0, calls: 0 };

let active = 0; const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  while (active >= 6) await new Promise<void>((r) => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cacheFile(key: string) { return path.join(dataDir(), "sefaria", crypto.createHash("sha1").update(key).digest("hex") + ".json"); }

/** JSON GET/POST with 7-day memory+disk cache and retries on 429/5xx/network errors. Returns null on 404/400. */
export async function sefJson<T = any>(url: string, init?: { method?: string; body?: string }, ttl = TTL_MS): Promise<T | null> {
  const key = (init?.method || "GET") + " " + url + " " + (init?.body || "");
  const now = Date.now();
  const m = mem.get(key);
  if (m && now - m.at < ttl) { stats.hits++; return m.data as T; }
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(key), "utf8"));
    if (now - c.at < ttl) { mem.set(key, c); stats.hits++; return c.data as T; }
  } catch {}
  stats.misses++;
  setupProxy();
  let lastErr = "";
  for (let a = 0; a < 4; a++) {
    try {
      stats.calls++;
      const res = await slot(() => fetch(BASE + url, {
        method: init?.method || "GET", body: init?.body, headers: init?.body ? { "content-type": "application/json" } : undefined,
        signal: AbortSignal.timeout(15000),
      }));
      if (res.status === 404 || res.status === 400) return null;
      if (res.status === 429 || res.status >= 500) { lastErr = "HTTP " + res.status; await sleep(500 * 2 ** a); continue; }
      if (!res.ok) return null;
      const data = await res.json();
      const rec = { at: Date.now(), data };
      mem.set(key, rec);
      try { fs.mkdirSync(path.dirname(cacheFile(key)), { recursive: true }); fs.writeFileSync(cacheFile(key), JSON.stringify(rec)); } catch {}
      return data as T;
    } catch (e: any) { lastErr = String(e?.message || e); await sleep(500 * 2 ** a); }
  }
  throw new Error("Sefaria unavailable: " + lastErr);
}

export const refPath = (ref: string) => encodeURIComponent(ref.replace(/ /g, "_")).replace(/%3A/gi, ":").replace(/%2C/gi, ",");

export type Unit = {
  ref: string; heRef?: string; work: Node["work"]; he: string; en: string | null; tr: string | null; trLang?: string;
};

function workOf(j: any, ref: string): Node["work"] {
  const cats: string[] = j.categories || [];
  const title: string = j.indexTitle || j.book || ref;
  if (/^rashi on /i.test(ref)) return "Rashi";
  if (/^tosafot on /i.test(ref)) return "Tosafot";
  if (/^likk?utei moharan/i.test(title)) return "Likutei Moharan";
  if (/^zohar/i.test(title) || cats.includes("Zohar")) return "Zohar";
  if (cats.includes("Bavli")) return "Bavli";
  if (cats.includes("Yerushalmi")) return "Yerushalmi";
  if (cats.includes("Mishnah")) return "Mishnah";
  if (cats[0] === "Tanakh") return "Tanakh";
  if (cats[0] === "Midrash") return "Midrash";
  return "Other";
}

const flat = (t: any): string[] | null => {
  if (typeof t === "string") return [t];
  if (Array.isArray(t) && t.every((x) => typeof x === "string")) return t;
  if (Array.isArray(t) && t.length === 1 && Array.isArray(t[0]) && t[0].every((x: any) => typeof x === "string")) return t[0];
  return null;
};

/**
 * Fetch Hebrew + English (+ translation in `trLang` when Sefaria has one) for a ref.
 * Section refs (an amud, a chapter) yield one Unit per segment ("Berakhot 28a:1", ...); a segment or range yields one Unit.
 */
export async function fetchUnits(ref: string, trLang?: string): Promise<Unit[]> {
  const q = `/api/v3/texts/${refPath(ref)}?version=hebrew&version=english&return_format=text_only`;
  const j = await sefJson<any>(q);
  if (!j || !Array.isArray(j.versions)) return [];
  const heV = j.versions.find((v: any) => v.language === "he"), enV = j.versions.find((v: any) => v.language === "en");
  const he = flat(heV?.text);
  if (!he) return [];
  const en = flat(enV?.text);
  let tr: string[] | null = null;
  if (trLang && trLang !== "en" && trLang !== "he" && (j.available_versions || []).some((v: any) => v.language === trLang)) {
    const jt = await sefJson<any>(`/api/v3/texts/${refPath(ref)}?version=${trLang}&return_format=text_only`).catch(() => null);
    tr = flat(jt?.versions?.find((v: any) => v.language === trLang)?.text);
  }
  const work = workOf(j, ref);
  const canon: string = j.ref || ref;
  // section ref (amud/chapter) <=> multiple segments and the ref does not already end in a segment number or range
  const isSection = he.length > 1 && !/[:\d][-–]\d|:\d+$/.test(canon.replace(/^[^:]*$/, "")) && !/:\d/.test(canon);
  const clean = (s: string) => stripHtml(s);
  if (!isSection || he.length === 1) {
    const hj = he.map(clean).join(" "), ej = en ? en.map(clean).join(" ") : null, tj = tr ? tr.map(clean).join(" ") : null;
    return hj ? [{ ref: canon, heRef: j.heRef, work, he: hj, en: ej, tr: tj, trLang }] : [];
  }
  const sec = canon.replace(/:\s*$/, "");
  return he.map((h, i) => ({
    ref: `${sec}:${i + 1}`, work, he: clean(h), en: en && en[i] != null ? clean(en[i]) : null, tr: tr && tr[i] != null ? clean(tr[i]) : null, trLang,
  })).filter((u) => u.he);
}

export type LinkRow = { ref: string; category: string; type: string; collectiveTitle?: string };
export async function fetchLinks(ref: string): Promise<LinkRow[]> {
  const j = await sefJson<any[]>(`/api/links/${refPath(ref)}?with_text=0`);
  if (!Array.isArray(j)) return [];
  return j.map((l) => ({ ref: String(l.ref || ""), category: String(l.category || ""), type: String(l.type || ""), collectiveTitle: l.collectiveTitle?.en })).filter((l) => l.ref);
}
export async function fetchRelated(ref: string): Promise<{ links: LinkRow[]; topics: string[] }> {
  const j = await sefJson<any>(`/api/related/${refPath(ref)}`);
  const links = Array.isArray(j?.links) ? j.links.map((l: any) => ({ ref: String(l.ref || ""), category: String(l.category || ""), type: String(l.type || "") })).filter((l: LinkRow) => l.ref) : [];
  const topics = Array.isArray(j?.topics) ? j.topics.map((t: any) => t.topic || t.slug).filter(Boolean).slice(0, 6) : [];
  return { links, topics };
}

export type SearchHit = { ref: string; heText: string; score: number };
/** Sefaria text search (naive_lemmatizer on Hebrew/Aramaic). `filter` is a path like "Talmud/Bavli", "Talmud/Bavli/Seder Zeraim/Berakhot", "Tanakh". */
export async function searchTerm(term: string, filter: string, size = 8): Promise<{ total: number; hits: SearchHit[] }> {
  const body = JSON.stringify({ query: term, type: "text", field: "naive_lemmatizer", filters: [filter], filter_fields: ["path"], size });
  const j = await sefJson<any>("/api/search-wrapper", { method: "POST", body });
  const hits: any[] = j?.hits?.hits || [];
  const total = typeof j?.hits?.total === "object" ? j.hits.total.value : j?.hits?.total || 0;
  return {
    total,
    hits: hits.map((h) => {
      const ref = String(h._source?.ref || h._id || "").replace(/\s*\(.*\)\s*$/, "");
      const hl = (h.highlight?.naive_lemmatizer || h.highlight?.exact || []).join(" ");
      return { ref, heText: stripNikud(stripHtml(hl)), score: h._score || 0 };
    }).filter((h) => h.ref),
  };
}

export async function resolveRef(name: string): Promise<string | null> {
  const j = await sefJson<any>(`/api/name/${encodeURIComponent(name)}?limit=1`);
  return j?.is_ref && j.ref ? String(j.ref) : null;
}

export { normRef };
