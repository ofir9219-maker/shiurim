// Build data/shiurim.db from data/inventory.json + data/polished/*.json (fixtures only if no polished files exist).
// Usage: npm run build:db [-- --embed] [-- --fixtures]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openDb } from "../lib/db";
import { embedTexts, hasEmbeddingKey, vecToBlob, EMBEDDING_MODEL, EMBEDDING_DIMS } from "../lib/embeddings";
import { setupProxy } from "../lib/proxy";
import { normText } from "../lib/translit";

const root = process.cwd();
const embed = process.argv.includes("--embed");
const useFixtures = process.argv.includes("--fixtures");
const r2Map: Record<string, string> = fs.existsSync(path.join(root, "data", "r2-keys.json"))
  ? JSON.parse(fs.readFileSync(path.join(root, "data", "r2-keys.json"), "utf8")) : {};

type Inv = { id: string; name: string; order: string; ext: string; durationMs: number };
type Seg = { startMs: number; endMs: number; text: string };
type Pol = { id: string; segments: Seg[]; summary?: string; tags?: string[]; daf?: { daf: string; amud: string }[]; title?: string; newName?: string };

const polDir = path.join(root, "data", "polished");
const hollowFile = path.join(root, "data", "gaps-hollow.json");
const hollow: { id: string; startMs: number }[] = fs.existsSync(hollowFile) ? JSON.parse(fs.readFileSync(hollowFile, "utf8")) : [];
const polFiles = fs.existsSync(polDir) ? fs.readdirSync(polDir).filter((f) => f.endsWith(".json")) : [];
const fixtureMode = useFixtures || polFiles.length === 0;
const invPath = fixtureMode && (useFixtures || !fs.existsSync(path.join(root, "data", "inventory.json")))
  ? path.join(root, "data", "fixtures", "inventory.json") : path.join(root, "data", "inventory.json");
const pDir = fixtureMode && useFixtures ? path.join(root, "data", "fixtures", "polished") : polDir;
if (fixtureMode && !useFixtures) console.log("No polished files; classes listed without transcripts.");

const inventory: Inv[] = JSON.parse(fs.readFileSync(invPath, "utf8"));
const amud = (a: string) => (a === "ב" ? "ע״ב" : "ע״א");
const dafLabel = (d: { daf: string; amud: string }[]) => d.map((x) => `${x.daf} ${amud(x.amud)}`).join(", ");
const stripExt = (n: string) => n.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/^\s*[\d.]+\s*[.\-–]\s*/, "").trim();

const classDoc = (c: { title: string; summary: string; tags: string }) => {
  let tags: string[] = [];
  try { tags = JSON.parse(c.tags || "[]"); } catch { /* ignore */ }
  return `${c.title}. ${tags.join(", ")}. ${c.summary || ""}`;
};
const db = openDb({ create: true });
const tx = db.transaction(() => {
  const keep = new Set(inventory.map((i) => i.id));
  for (const { id } of db.prepare("SELECT id FROM classes").all() as { id: string }[]) {
    if (!keep.has(id)) {
      db.prepare("DELETE FROM segments WHERE class_id=?").run(id);
      db.prepare("DELETE FROM chunks WHERE class_id=?").run(id);
      db.prepare("DELETE FROM classes WHERE id=?").run(id);
    }
  }
  const upC = db.prepare(`INSERT INTO classes(id,ord,ord_label,title,file_name,daf,daf_label,duration_ms,summary,tags,audio_url,r2_key,has_transcript)
    VALUES(@id,@ord,@ord_label,@title,@file_name,@daf,@daf_label,@duration_ms,@summary,@tags,@audio_url,@r2_key,@has)
    ON CONFLICT(id) DO UPDATE SET ord=@ord,ord_label=@ord_label,title=@title,file_name=@file_name,daf=@daf,daf_label=@daf_label,
      duration_ms=@duration_ms,summary=@summary,tags=@tags,audio_url=@audio_url,r2_key=@r2_key,has_transcript=@has`);
  db.exec("INSERT INTO segments_fts(segments_fts) VALUES('delete-all')");
  db.exec("DELETE FROM segments");
  const insS = db.prepare("INSERT INTO segments(class_id,idx,start_ms,end_ms,text) VALUES(?,?,?,?,?)");
  for (const inv of inventory) {
    const pf = path.join(pDir, `${inv.id}.json`);
    const pol: Pol | null = fs.existsSync(pf) ? JSON.parse(fs.readFileSync(pf, "utf8")) : null;
    // Merge gap-fill segments (re-transcribed stretches Scribe had dropped) by time.
    const gf = path.join(root, "data", "gapfill", `${inv.id}.json`);
    const gf2 = path.join(root, "data", "gapfill2", `${inv.id}.json`);
    const extra: Seg[] = pol
      ? [gf, gf2].flatMap((f) => (fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as Seg[]) : []))
      : [];
    // Drop a "hollow" polished segment (long, almost no text) when recovered segments cover its time range.
    const hollowStarts = new Set(hollow.filter((h) => h.id === inv.id).map((h) => h.startMs));
    const base = (pol?.segments ?? []).filter(
      (s) => !(hollowStarts.has(s.startMs) && extra.some((e) => e.startMs >= s.startMs && e.endMs <= s.endMs + 1000)),
    );
    const segs = [...base, ...extra].sort((a, b) => a.startMs - b.startMs);
    const daf = pol?.daf ?? [];
    const ord = parseFloat(inv.order);
    upC.run({
      id: inv.id, ord: Number.isFinite(ord) ? ord : 9999, ord_label: inv.order, title: pol?.title || stripExt(inv.name),
      file_name: pol?.newName || inv.name, daf: JSON.stringify(daf), daf_label: dafLabel(daf), duration_ms: inv.durationMs || 0,
      summary: pol?.summary || "", tags: JSON.stringify(pol?.tags ?? []), audio_url: null, r2_key: r2Map[inv.id] ?? null,
      has: segs.length ? 1 : 0,
    });
    segs.forEach((s, i) => insS.run(inv.id, i, Math.round(s.startMs), Math.round(s.endMs), s.text));
  }
  db.exec("INSERT INTO segments_fts(rowid,text) SELECT id,text FROM segments");
});
tx();

// Chunks: consecutive segments up to ~50s. Rebuilt per class only when its text changed (hash), keeping embeddings.
const classIds = (db.prepare("SELECT id FROM classes WHERE has_transcript=1").all() as { id: string }[]).map((r) => r.id);
let newChunks = 0;
for (const id of classIds) {
  const segs = db.prepare("SELECT start_ms s,end_ms e,text t FROM segments WHERE class_id=? ORDER BY idx").all(id) as { s: number; e: number; t: string }[];
  const chunks: { s: number; e: number; t: string }[] = [];
  let cur: { s: number; e: number; t: string } | null = null;
  for (const g of segs) {
    if (cur && g.e - cur.s > 55000) { chunks.push(cur); cur = null; }
    cur = cur ? { s: cur.s, e: g.e, t: cur.t + " " + g.t } : { ...g, t: g.t };
  }
  if (cur) chunks.push(cur);
  const old = new Map((db.prepare("SELECT hash,embedding FROM chunks WHERE class_id=?").all(id) as { hash: string; embedding: Buffer | null }[]).map((r) => [r.hash, r.embedding]));
  const hashOf = (c: { s: number; t: string }) => crypto.createHash("sha1").update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}:${c.s}:${c.t}`).digest("hex");
  db.transaction(() => {
    db.prepare("DELETE FROM chunks WHERE class_id=?").run(id);
    const ins = db.prepare("INSERT INTO chunks(class_id,start_ms,end_ms,text,hash,embedding) VALUES(?,?,?,?,?,?)");
    for (const c of chunks) { const h = hashOf(c); if (!old.has(h)) newChunks++; ins.run(id, c.s, c.e, c.t, h, old.get(h) ?? null); }
  })();
}
// Retrieval shadow indexes: chunk FTS (raw + transliteration-normalized) and class-level FTS (title + tags + summary).
db.transaction(() => {
  db.exec("DELETE FROM chunks_fts; DELETE FROM chunks_nfts; DELETE FROM classes_nfts");
  const insF = db.prepare("INSERT INTO chunks_fts(rowid,text) VALUES(?,?)");
  const insN = db.prepare("INSERT INTO chunks_nfts(rowid,text) VALUES(?,?)");
  for (const c of db.prepare("SELECT id,text FROM chunks").all() as { id: number; text: string }[]) { insF.run(c.id, c.text); insN.run(c.id, normText(c.text)); }
  const insC = db.prepare("INSERT INTO classes_nfts(class_id,text) VALUES(?,?)");
  for (const c of db.prepare("SELECT id,title,summary,tags FROM classes").all() as { id: string; title: string; summary: string; tags: string }[]) insC.run(c.id, normText(classDoc(c)));
})();
console.log(`classes: ${inventory.length}, with transcript: ${classIds.length}, segments: ${(db.prepare("SELECT count(*) n FROM segments").get() as { n: number }).n}, chunks: ${(db.prepare("SELECT count(*) n FROM chunks").get() as { n: number }).n}`);

if (embed) {
  if (!hasEmbeddingKey()) console.log("--embed: OPENAI_API_KEY not set, skipping embeddings (search stays full-text only).");
  else {
    setupProxy();
    // Class-level embeddings (title + tags + summary), re-embedded only when the text changes.
    const cls = db.prepare("SELECT id,title,summary,tags FROM classes").all() as { id: string; title: string; summary: string; tags: string }[];
    const oldV = new Map((db.prepare("SELECT class_id,hash FROM class_vecs").all() as { class_id: string; hash: string }[]).map((r) => [r.class_id, r.hash]));
    const needC = cls.map((c) => ({ id: c.id, text: classDoc(c), hash: crypto.createHash("sha1").update(`${EMBEDDING_MODEL}:${EMBEDDING_DIMS}:${classDoc(c)}`).digest("hex") })).filter((c) => oldV.get(c.id) !== c.hash);
    for (let i = 0; i < needC.length; i += 32) {
      const b = needC.slice(i, i + 32);
      const vecs = await embedTexts(b.map((x) => x.text.slice(0, 6000)));
      db.transaction(() => b.forEach((x, j) => db.prepare("INSERT OR REPLACE INTO class_vecs(class_id,hash,embedding) VALUES(?,?,?)").run(x.id, x.hash, vecToBlob(vecs[j]))))();
    }
    db.prepare("DELETE FROM class_vecs WHERE class_id NOT IN (SELECT id FROM classes)").run();
    console.log(`class embeddings updated: ${needC.length}`);
    const todo = db.prepare("SELECT id,text FROM chunks WHERE embedding IS NULL").all() as { id: number; text: string }[];
    console.log(`embedding ${todo.length} chunks...`);
    const upd = db.prepare("UPDATE chunks SET embedding=? WHERE id=?");
    for (let i = 0; i < todo.length; i += 64) {
      const batch = todo.slice(i, i + 64);
      const vecs = await embedTexts(batch.map((b) => b.text));
      db.transaction(() => batch.forEach((b, j) => upd.run(vecToBlob(vecs[j]), b.id)))();
      console.log(`  ${Math.min(i + 64, todo.length)}/${todo.length}`);
    }
  }
}
db.close();
