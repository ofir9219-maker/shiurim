// Admin API of the Drive transcription center (single catch-all, all operations admin-protected).
import { NextResponse } from "next/server";
import { adminEnabled, isAdmin } from "@/lib/admin-auth";
import * as drive from "@/lib/ingest/drive";
import { scheduler, pollMinutes } from "@/lib/ingest/scheduler";
import { reindex, cfgOf } from "@/lib/ingest/pipeline";
import { allInventory } from "@/lib/storage";
import { berajotCollection, clearCenterRoot, getCenter, listCollections, removeCollection, resolveSettings, setCenterRoot, upsertCollection, EFFORTS } from "@/lib/center/collections";
import { FAL_MODELS, LANGUAGES } from "@/lib/center/fal-models";
import { ancestorPath, childrenCached, folderInfo, invalidateChildren, jobCfg, NO_COLLECTION, walkAudio, type Candidate } from "@/lib/center/jobs";
import { statusOf, STATUS_LABEL } from "@/lib/center/status";
import { cachedDurations, probeDuration } from "@/lib/center/duration";
import { estimateRow, minutesFromSize, summarize } from "@/lib/center/estimate";
import { getChatModels } from "@/lib/chat-models";
import { readRenameLog, undoableSet } from "@/lib/center/rename-log";
import { mirrorCollectionAudio } from "@/lib/center/mirror";
import { templateApi } from "@/lib/center/template-api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
type Ctx = { params: Promise<{ op?: string[] }> };
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function gate(): Promise<NextResponse | null> {
  if (!adminEnabled()) return NextResponse.json({ error: "ADMIN_PASSWORD no configurada", disabled: true }, { status: 503 });
  if (!(await isAdmin())) return bad("unauthorized", 401);
  return null;
}
const crumbs = async (folderId: string) => {
  if (folderId === "root") return [{ id: "root", name: "Mi unidad" }];
  const root = getCenter().rootFolderId;
  const ids = await ancestorPath(folderId);
  const from = root && ids.includes(root) ? ids.indexOf(root) : 0;
  const out: { id: string; name: string }[] = [];
  for (const id of ids.slice(from)) out.push({ id, name: id === root ? getCenter().rootName || (await folderInfo(id)).name : (await folderInfo(id)).name });
  return { list: out, full: ids } as never;
};

async function listOp(url: URL) {
  const folderId = url.searchParams.get("folderId") || getCenter().rootFolderId;
  if (!folderId) return bad("Elige primero la carpeta general", 409);
  const offset = Number(url.searchParams.get("offset") || 0), limit = Math.min(500, Number(url.searchParams.get("limit") || 200));
  const foldersOnly = url.searchParams.get("foldersOnly") === "1";
  const kids = await childrenCached(folderId);
  const c = (await crumbs(folderId)) as unknown as { list: { id: string; name: string }[]; full: string[] } | { id: string; name: string }[];
  const breadcrumbs = Array.isArray(c) ? c : c.list, fullPath = Array.isArray(c) ? [folderId] : c.full;
  const colls = new Map(listCollections().map((x) => [x.folderId, x]));
  const sched = scheduler();
  const inv = new Set(allInventory().map((i) => i.id));
  const dur = cachedDurations(); const undoable = undoableSet();
  const key = (n: string) => n.replace(/\.[A-Za-z0-9]{2,5}$/, "").normalize("NFC").toLowerCase();
  const jsons = new Set(kids.filter((k) => /\.json$/i.test(k.name) && !/\.ai(\.|$)/i.test(k.name)).map((k) => key(k.name)));
  const mds = new Set(kids.filter((k) => /\.md$/i.test(k.name)).map((k) => key(k.name)));
  const q = (url.searchParams.get("q") || "").toLowerCase();
  const rows = kids.filter((k) => (!foldersOnly || drive.isFolder(k)) && (!q || k.name.toLowerCase().includes(q))).map((k) => {
    if (drive.isFolder(k)) {
      const col = colls.get(k.id);
      return { kind: "folder" as const, id: k.id, name: k.name, collection: col ? { name: col.name, slug: col.slug, published: col.published } : null };
    }
    if (!drive.isAudio(k)) return { kind: "file" as const, id: k.id, name: k.name, size: Number(k.size || 0) };
    const item = sched.state.items[k.id];
    const st = statusOf({ item, inInventory: inv.has(k.id), hasJson: jsons.has(key(k.name)), hasMd: mds.has(key(k.name)) });
    const durationMs = k.videoMediaMetadata?.durationMillis ? Number(k.videoMediaMetadata.durationMillis) : item?.durationMs ?? dur[k.id] ?? null;
    return { kind: "audio" as const, id: k.id, name: k.name, size: Number(k.size || 0), durationMs, status: st, label: STATUS_LABEL[st],
      error: item?.error, published: item ? cfgOf(item).published : undefined, inWeb: inv.has(k.id) || item?.state === "indexed", attempts: item?.attempts ?? 0, hasMd: mds.has(key(k.name)), hasJson: jsons.has(key(k.name)), undoable: undoable.has(k.id) };
  });
  const page = rows.slice(offset, offset + limit);
  const res = resolveSettings(fullPath);
  return NextResponse.json({ folderId, breadcrumbs, path: fullPath, total: rows.length, offset, next: offset + limit < rows.length ? offset + limit : null, items: page,
    inherited: res.collection ? { name: res.collection.name, folderId: res.collection.folderId } : null });
}

async function searchOp(url: URL) {
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) return NextResponse.json({ items: [] });
  const root = getCenter().rootFolderId;
  const hits = (await drive.searchByName(q, 80)).filter((f) => drive.isFolder(f) || drive.isAudio(f));
  const out = [];
  for (const f of hits) {
    const parent = f.parents?.[0]; if (!parent) continue;
    const chain = await ancestorPath(parent);
    if (root && !chain.includes(root)) continue;
    const names = [] as string[]; for (const id of chain.slice(root ? chain.indexOf(root) : 0)) names.push((await folderInfo(id)).name);
    out.push({ kind: drive.isFolder(f) ? "folder" : "audio", id: f.id, name: f.name, parentId: parent, where: names.join(" / "), path: chain });
    if (out.length >= 40) break;
  }
  return NextResponse.json({ items: out });
}

/** Selected ids (folders recursively, audio files directly) -> candidates; `path` = folder ids from root to the folder being viewed. */
async function candidatesFor(ids: { id: string; kind: string }[], path: string[]): Promise<Candidate[]> {
  const out = new Map<string, Candidate>();
  for (const s of ids.slice(0, 500)) {
    if (s.kind === "folder") for (const c of await walkAudio(s.id, [...path, s.id], { maxFiles: 3000 })) out.set(c.file.id, c);
    else {
      const f = await drive.getMeta(s.id);
      if (drive.isAudio(f)) out.set(f.id, { file: f, parentId: path[path.length - 1], path, hasJson: false, hasMd: false });
    }
  }
  return [...out.values()];
}

async function estimateOp(body: { ids?: { id: string; kind: string }[]; path?: string[] }) {
  if (!body.ids?.length || !body.path?.length) return bad("selección vacía");
  const cands = await candidatesFor(body.ids, body.path);
  const dur = cachedDurations(); const sched = scheduler();
  const rows = cands.map((c) => {
    const ms = c.file.videoMediaMetadata?.durationMillis ? Number(c.file.videoMediaMetadata.durationMillis) : dur[c.file.id];
    const minutes = ms ? ms / 60000 : minutesFromSize(Number(c.file.size || 0));
    return estimateRow({ id: c.file.id, name: c.file.name, minutes, approx: !ms, redo: !!sched.state.items[c.file.id] || c.hasJson }, jobCfg(resolveSettings(c.path)));
  });
  return NextResponse.json(summarize(rows));
}

export async function GET(req: Request, ctx: Ctx) {
  const g = await gate(); if (g) return g;
  const op = (await ctx.params).op ?? ["state"]; const url = new URL(req.url);
  try {
    switch (op.join("/")) {
      case "state": {
        const s = scheduler(); const center = getCenter();
        const costs: Record<string, { falUsd: number; openaiUsd: number; minutes: number; items: number }> = {};
        for (const it of Object.values(s.state.items)) {
          const k = it.collectionId ?? berajotCollection().folderId; const c = (costs[k] ??= { falUsd: 0, openaiUsd: 0, minutes: 0, items: 0 });
          c.falUsd += it.cost.falUsd ?? it.cost.falMinutes * 0.008; c.openaiUsd += it.cost.openaiUsd ?? 0; c.minutes += it.cost.falMinutes; c.items++;
        }
        const items = Object.values(s.state.items).filter((i) => i.status !== "done").map((i) => ({ id: i.id, name: i.name, state: i.state, status: i.status, error: i.error }));
        return NextResponse.json({
          root: center.rootFolderId ? { id: center.rootFolderId, name: center.rootName ?? "" } : null,
          drive: { connected: drive.driveConnected(), oauthConfigured: drive.oauthConfigured(), email: drive.loadToken()?.email ?? null },
          collections: listCollections(), costs, queue: { running: s.running, pending: items.length, items: items.slice(0, 50), pollMinutes: pollMinutes(), nextPollAt: s.nextPollAt, lastPoll: s.state.lastPoll ?? null },
          models: Object.values(FAL_MODELS()), languages: LANGUAGES, efforts: EFFORTS,
        });
      }
      case "list": return await listOp(url);
      case "search": return await searchOp(url);
      case "resolve": {
        const id = url.searchParams.get("folderId"); if (!id) return bad("folderId");
        const path = await ancestorPath(id); const res = resolveSettings(path);
        const names: Record<string, string> = {};
        const own = listCollections().find((c) => c.folderId === id) ?? null;
        const parent = resolveSettings(path.slice(0, -1));
        for (const v of Object.values(parent.from)) if (v !== "default") names[v] = listCollections().find((c) => c.folderId === v)?.name ?? v;
        return NextResponse.json({ path, own, resolved: res.settings, from: res.from, names, parentResolved: parent.settings, parentFrom: parent.from, name: (await folderInfo(id)).name });
      }
      case "job": { const id = url.searchParams.get("id") || ""; const it = scheduler().state.items[id]; return it ? NextResponse.json({ ...it, renames: readRenameLog().filter((e) => e.audioId === id).slice(-12) }) : bad("sin trabajo para ese archivo", 404); }
      case "duration": { try { return NextResponse.json({ durationMs: await probeDuration(url.searchParams.get("id") || "") }); } catch (e) { return bad((e as Error).message, 502); } }
      case "openai-models": { const m = await getChatModels(); return NextResponse.json({ models: m.models.map((x) => x.id), enabled: m.enabled, efforts: m.efforts }); }
      default: {
        const t = await templateApi(op, url, null); if (t) return t;
        return bad("not found", 404);
      }
    }
  } catch (e) { return bad((e as Error).message, 502); }
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await gate(); if (g) return g;
  const op = (await ctx.params).op ?? []; const body = (await req.json().catch(() => ({}))) as any;
  const s = scheduler();
  try {
    switch (op.join("/")) {
      case "root": if (!body.folderId) return bad("folderId"); setCenterRoot(body.folderId, String(body.name || "")); return NextResponse.json({ ok: true });
      case "root/clear": clearCenterRoot(); return NextResponse.json({ ok: true });
      case "estimate": return await estimateOp(body);
      case "enqueue": {
        if (!body.ids?.length || !body.path?.length) return bad("selección vacía");
        const cands = await candidatesFor(body.ids, body.path);
        if (!cands.length) return bad("No hay audios en la selección");
        s.start();
        return NextResponse.json({ ok: true, ...s.enqueue(cands, body.force !== false), files: cands.length });
      }
      case "retry": if (!body.id) return bad("id"); s.retry(body.id); return NextResponse.json({ ok: true });
      case "cancel": return NextResponse.json({ ok: s.cancel(body.id) });
      case "refresh": invalidateChildren(); return NextResponse.json({ ok: true });
      default: { const t = await templateApi(op, null, body); if (t) return t; return bad("not found", 404); }
    }
  } catch (e) { return bad((e as Error).message, 502); }
}

export async function PUT(req: Request, ctx: Ctx) {
  const g = await gate(); if (g) return g;
  const op = (await ctx.params).op ?? []; const b = (await req.json().catch(() => ({}))) as any;
  if (op.join("/") !== "collection") return bad("not found", 404);
  if (!b.folderId) return bad("folderId");
  const prev = listCollections().find((c) => c.folderId === b.folderId);
  const path = await ancestorPath(b.folderId).catch(() => [b.folderId]);
  const parent = [...path].slice(0, -1).reverse().find((id) => listCollections().some((c) => c.folderId === id)) ?? null;
  const name = String(b.name || prev?.name || (await folderInfo(b.folderId)).name);
  const c = upsertCollection({ folderId: b.folderId, name, settings: b.settings, published: typeof b.published === "boolean" ? b.published : undefined, slug: b.slug, parentFolderId: parent });
  if ((prev && prev.published !== c.published) || (!prev && c.published)) void (async () => { if (c.published) await mirrorCollectionAudio(c.folderId, console.log).catch(() => {}); await reindex(() => {}); })().catch(() => {}); // publication changed: mirror audio to R2, rebuild the site DB
  return NextResponse.json({ ok: true, collection: c });
}
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await gate(); if (g) return g;
  const id = new URL(req.url).searchParams.get("folderId") || "";
  const was = listCollections().find((c) => c.folderId === id);
  const ok = removeCollection(id);
  if (ok && was?.published) void reindex(() => {}).catch(() => {});
  void NO_COLLECTION; void ctx;
  return NextResponse.json({ ok });
}
