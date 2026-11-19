import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "series-t-"));
process.env.STORAGE_DIR = path.join(tmp, "vol"); process.env.DB_PATH = path.join(tmp, "x.db");
const C = await import("../lib/center/collections");
const D = await import("../lib/db");
const S = await import("../lib/series");
const Q = await import("../lib/search");

test("old DBs get the collection_id column (all rows = berajot); filters work", async () => {
  const db = new (await import("better-sqlite3")).default(process.env.DB_PATH!);
  db.exec("CREATE TABLE classes(id TEXT PRIMARY KEY, ord REAL, ord_label TEXT, title TEXT, file_name TEXT, daf TEXT, daf_label TEXT, duration_ms INTEGER, summary TEXT, tags TEXT, audio_url TEXT, r2_key TEXT, has_transcript INTEGER DEFAULT 0)");
  db.close();
  const w = D.openDb({ create: true });
  assert.ok((w.prepare("PRAGMA table_info(classes)").all() as { name: string }[]).some((c) => c.name === "collection_id"));
  const ins = w.prepare("INSERT INTO classes(id,ord,ord_label,title,file_name,daf,daf_label,duration_ms,summary,tags,has_transcript,collection_id) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)");
  ins.run("b1", 1, "1", "ברכות א", "f", "[]", "", 3600000, "", "[]", "berajot");
  ins.run("l1", 1, "1", "ליקוטי א", "f", "[]", "", 7200000, "", "[]", "lm");
  ins.run("l2", 2, "2", "ליקוטי ב", "f", "[]", "", 3600000, "", "[]", "lm");
  ins.run("x1", 1, "1", "oculta", "f", "[]", "", 1000, "", "[]", "secreta");
  const seg = w.prepare("INSERT INTO segments(class_id,idx,start_ms,end_ms,text) VALUES(?,?,?,?,?)");
  seg.run("b1", 0, 0, 1000, "hablamos de Bilam"); seg.run("l1", 0, 0, 1000, "tambien Bilam aqui"); seg.run("x1", 0, 0, 1000, "Bilam secreto");
  w.exec("INSERT INTO segments_fts(rowid,text) SELECT id,text FROM segments"); w.close();
  C.upsertCollection({ folderId: "LMF", name: "Likutey Moharán", slug: "lm", published: true, settings: { publish: { title: "ליקוטי מוהר״ן", description: "Torot" } } });
  C.upsertCollection({ folderId: "SEC", name: "Secreta", slug: "secreta", published: false });
  assert.deepEqual(S.publishedSeries().map((s) => [s.slug, s.count, s.hours]), [["berajot", 1, 1], ["lm", 2, 3]]); // unpublished never listed
  assert.equal(S.seriesBySlug("secreta"), null); assert.equal(S.seriesBySlug("lm")!.title, "ליקוטי מוהר״ן");
  assert.deepEqual(D.listClasses({ collection: "lm" }).map((r) => r.id), ["l1", "l2"]);
  assert.deepEqual(D.listClasses({ collection: ["lm", "berajot"] }).map((r) => r.id), ["b1", "l1", "l2", "x1"].filter((x) => x !== "x1"));
  assert.equal(D.listClasses().length, 4);
  assert.equal(D.rowToClass(D.listClasses({ collection: "lm" })[0], "u").collection, "lm");
  // scope parsing: unknown / unpublished slugs ignored; all series = no filter
  assert.deepEqual(S.scopeFrom("lm"), ["lm"]); assert.equal(S.scopeFrom("lm,berajot"), undefined); assert.equal(S.scopeFrom(["secreta"]), undefined); assert.equal(S.scopeFrom(undefined), undefined);
  assert.deepEqual([...S.classIdsOf(["lm"])!].sort(), ["l1", "l2"]); assert.equal(S.classIdsOf(undefined), undefined);
  // search / hybrid filter
  assert.equal(Q.textSearch("Bilam").length, 3);
  assert.deepEqual(Q.textSearch("Bilam", { collections: ["lm"] }).map((h) => h.classId), ["l1"]);
  assert.deepEqual((await Q.hybridSearch("Bilam", 10, ["berajot"])).map((h) => h.classId), ["b1"]);
  assert.deepEqual(Q.textSearch("Bilam", { collections: ["nada"] }).map((h) => h.classId), []);
});

test("build-db: published collections from the volume are indexed with collection_id; unpublished ones are not; Berajot untouched", async () => {
  const vol = path.join(tmp, "vol2"); const dp = path.join(vol, "data"); fs.mkdirSync(path.join(dp, "polished"), { recursive: true });
  const dbp = path.join(tmp, "b.db");
  const inv = [
    { id: "N1", name: "1. uno.mp3", order: "1", ext: ".mp3", mimeType: "audio/mpeg", sizeBytes: 1, durationMs: 60000, mdId: null, mdName: null, transcript: "x", inShiurim: false, collectionId: "PUB" },
    { id: "N2", name: "2. dos.mp3", order: "2", ext: ".mp3", mimeType: "audio/mpeg", sizeBytes: 1, durationMs: 60000, mdId: null, mdName: null, transcript: "x", inShiurim: false, collectionId: "PRIV" },
    { id: "N3", name: "3. tres.mp3", order: "3", ext: ".mp3", mimeType: "audio/mpeg", sizeBytes: 1, durationMs: 60000, mdId: null, mdName: null, transcript: "x", inShiurim: false, collectionId: "_none" },
  ];
  fs.writeFileSync(path.join(dp, "inventory.json"), JSON.stringify(inv));
  for (const id of ["N1", "N2", "N3"]) fs.writeFileSync(path.join(dp, "polished", `${id}.json`), JSON.stringify({ id, raw: true, title: `t ${id}`, newName: id, summary: "", tags: [], daf: [], segments: [{ startMs: 0, endMs: 1000, text: `texto ${id}` }] }));
  fs.writeFileSync(path.join(vol, "collections.json"), JSON.stringify({ version: 1, collections: [
    { ...C.berajotCollection() }, { folderId: "PUB", name: "Pública", slug: "publica", published: true, settings: {}, createdAt: "x" }, { folderId: "PRIV", name: "Privada", slug: "privada", published: false, settings: {}, createdAt: "x" }] }));
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/build-db.ts"], { cwd: process.cwd(), env: { ...process.env, STORAGE_DIR: vol, DB_PATH: dbp, OPENAI_API_KEY: "" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(dbp, { readonly: true });
  const by = Object.fromEntries((db.prepare("SELECT collection_id c, count(*) n FROM classes GROUP BY 1").all() as { c: string; n: number }[]).map((x) => [x.c, x.n]));
  assert.equal(by.berajot, 82); assert.equal(by.publica, 1); assert.equal(by.privada, undefined);
  assert.equal((db.prepare("SELECT count(*) n FROM classes WHERE id IN ('N2','N3')").get() as any).n, 0);
  assert.equal((db.prepare("SELECT has_transcript h FROM classes WHERE id='N1'").get() as any).h, 1);
  assert.equal((db.prepare("SELECT count(*) n FROM segments WHERE class_id='N1'").get() as any).n, 1);
  db.close();
});
