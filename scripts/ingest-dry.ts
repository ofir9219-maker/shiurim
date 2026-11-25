// End-to-end dry run of the ingestion pipeline WITHOUT Drive / R2 / Fal writes.
//   npm run ingest:dry -- <localAudioFile> [--id <driveId>] [--raw data/raw/<id>.json] [--out <dir>]
// - audio file: split with ffmpeg (checks the splitter) — Fal is mocked with the stored raw Scribe result of the class;
// - words -> segments (compared with data/segments/<id>.json), gap detection;
// - polishing/meta with the REAL OpenAI API (needs OPENAI_API_KEY) + real Sefaria;
// - compares the result with data/polished/<id>.json. Default class: order 27 (34 segments).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setupProxy } from "../lib/proxy";
import { openaiJson, POLISH_MODEL, POLISH_EFFORT } from "../lib/ingest/openai";
import { sefariaText } from "../lib/ingest/sefaria";
import { polishClass, validateTexts, type Cache } from "../lib/ingest/polish";
import { findGaps, findHollow, rawToSegments, mergeFinal, type RawDoc, type Seg } from "../lib/ingest/segments";
import { splitAudio } from "../lib/ingest/ffmpeg";
import { validateName } from "../lib/ingest/naming";
import { polishedToMd } from "../lib/ingest/md";

setupProxy();
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--")));
const id = arg("--id") || "196mMNJsoOgfnU60utfsok4H9zH--XuUU";
const rawPath = arg("--raw") || `data/raw/${id}.json`;
const out = arg("--out") || fs.mkdtempSync(path.join(os.tmpdir(), "ingest-dry-"));
const inv = (JSON.parse(fs.readFileSync("data/inventory.json", "utf8")) as { id: string; name: string; order: string; ext: string }[]).find((x) => x.id === id);
if (!inv) throw new Error(`id ${id} not in data/inventory.json`);
const ref = JSON.parse(fs.readFileSync(`data/polished/${id}.json`, "utf8")) as { segments: Seg[]; title: string; newName: string; daf: { daf: string; amud: string }[]; tags: string[]; summary: string };
const refSegs = (JSON.parse(fs.readFileSync(`data/segments/${id}.json`, "utf8")) as { segments: Seg[] }).segments;

const main = async () => {
  console.log(`dry run: ${inv.name} (order ${inv.order}) -> ${out}`);
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8")) as RawDoc;
  // 1. audio split (real ffmpeg) if a file was given
  const audio = positional[0];
  if (audio && fs.existsSync(audio)) {
    const parts = await splitAudio(audio, path.join(out, "parts"));
    console.log(`split: ${parts.length} part(s) ${parts.map((p) => `${(p.durationMs / 1000).toFixed(1)}s`).join(", ")} offsets ${parts.map((p) => p.offsetMs).join(",")}`);
  } else console.log("split: skipped (no local audio file given)");
  // 2. mocked Fal -> stitched segments
  const segs = rawToSegments(raw);
  const same = segs.length === refSegs.length && segs.every((s, i) => s.text === refSegs[i].text && s.startMs === refSegs[i].startMs && s.endMs === refSegs[i].endMs);
  console.log(`segments from raw: ${segs.length} (reference ${refSegs.length}) identical=${same}`);
  const dur = (JSON.parse(fs.readFileSync("data/inventory.json", "utf8")) as { id: string; durationMs: number }[]).find((x) => x.id === id)!.durationMs;
  console.log(`gaps: ${JSON.stringify(findGaps(segs, dur))} hollow: ${findHollow(segs).length}`);
  // 3. real polishing
  let calls = 0, pt = 0, ct = 0; const cacheM: Record<string, unknown> = {};
  const cache: Cache = { get: <T,>(k: string) => cacheM[k] as T | undefined, set: (k, v) => void (cacheM[k] = v) };
  console.log(`polishing with ${POLISH_MODEL()} (${POLISH_EFFORT()}) ...`);
  const t0 = Date.now();
  const r = await polishClass({ segments: segs, gapSegments: [], inv }, {
    llm: async (o) => { calls++; return openaiJson(o); }, sefaria: sefariaText, cache,
    onUsage: (u) => { pt += u.promptTokens; ct += u.completionTokens; }, log: (m) => console.log("  ·", m),
  });
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${calls} LLM calls, ${pt} prompt / ${ct} completion tokens`);
  // 4. validation like merge-polished.py
  const errs = validateTexts(segs.map((_, i) => i), r.polished.map((s, i) => ({ i, text: s.text })));
  errs.push(...validateName({ order: inv.order, ext: inv.ext, newName: r.meta.newName, title: r.meta.title, daf: r.meta.daf }));
  if (r.polished.length !== segs.length || r.polished.some((s, i) => s.startMs !== segs[i].startMs || s.endMs !== segs[i].endMs)) errs.push("timestamps/count changed");
  console.log(errs.length ? `VALIDATION FAIL: ${errs.join("; ")}` : "validation OK (count, timestamps, no Hebrew script, non-empty, title format)");
  // 5. comparison with the existing polished class
  const toks = (t: string) => new Set(t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-zñ]+/g) ?? []);
  const jac = (a: string, b: string) => { const A = toks(a), B = toks(b); const u = new Set([...A, ...B]).size; let n = 0; A.forEach((x) => B.has(x) && n++); return u ? n / u : 1; };
  const sims = r.polished.map((s, i) => jac(s.text, ref.segments[i].text));
  const exact = r.polished.filter((s, i) => s.text === ref.segments[i].text).length;
  const changed = r.polished.filter((s, i) => s.text !== segs[i].text.trim()).length;
  console.log(`vs reference: exact ${exact}/${segs.length}, mean word-overlap ${(100 * sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(0)}%, changed vs raw ${changed}/${segs.length} (reference changed ${ref.segments.filter((s, i) => s.text !== segs[i].text.trim()).length})`);
  console.log(`newName:   ${r.meta.newName}\nreference: ${ref.newName}`);
  console.log(`daf: ${JSON.stringify(r.meta.daf)} (reference ${JSON.stringify(ref.daf)}) needsReview=${!!r.meta.needsReview}`);
  console.log(`tags: ${r.meta.tags.join(", ")}\nsummary: ${r.meta.summary}`);
  const worst = sims.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]).slice(0, 3);
  for (const [s, i] of worst) console.log(`  low overlap ${(s * 100).toFixed(0)}% #${i}\n    new: ${r.polished[i].text.slice(0, 160)}\n    ref: ${ref.segments[i].text.slice(0, 160)}`);
  fs.writeFileSync(path.join(out, `${id}.polished.json`), JSON.stringify({ id, segments: r.polished, ...r.meta }, null, 1));
  fs.writeFileSync(path.join(out, `${id}.md`), polishedToMd({ ...r.meta, segments: mergeFinal(r.polished, [], new Set()) }));
  console.log(`outputs written to ${out}`);
  if (errs.length) process.exit(1);
};
main().catch((e) => { console.error(e); process.exit(1); });
