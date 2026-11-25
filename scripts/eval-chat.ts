// Chat retrieval / answer eval. Usage:
//   OPENAI_API_KEY=... npx tsx scripts/eval-chat.ts [--e2e] [--model gpt-5-mini] [--effort low] [--only q01,q02] [--conc 4] [--out file.json]
// Without --e2e only retrieval is run (no answer generation). Questions: tests/eval/questions.json.
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../lib/db";
import { chat, retrieveContext } from "../lib/chat";
import { usageTotals, resetUsage } from "../lib/chat-llm";
import type { ChatOpts, Ref } from "../lib/chat-core";

type Expect = { ord: string; from?: number; to?: number };
type Q = { id: string; q: string; kind: string; covered?: boolean; expect: Expect[] };
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const val = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };

const qs: Q[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), "tests/eval/questions.json"), "utf8")).questions;
const only = val("only")?.split(",");
const list = qs.filter((q) => !only || only.includes(q.id));
const e2e = flag("e2e");
const opts: ChatOpts = { model: val("model"), effort: val("effort") as ChatOpts["effort"] };
const conc = Number(val("conc") || 4);
const K = Number(val("k") || 8);

const db = getDb()!;
const ordOf = new Map((db.prepare("SELECT id, ord_label o FROM classes").all() as { id: string; o: string }[]).map((r) => [r.id, r.o]));
const matches = (r: Ref, e: Expect) => {
  if (ordOf.get(r.classId) !== e.ord) return false;
  if (e.from == null) return true;
  const end = r.endMs ?? r.startMs;
  return end >= e.from - 30000 && r.startMs <= (e.to ?? Infinity) + 30000;
};
const hit = (refs: Ref[], q: Q) => refs.some((r) => q.expect.some((e) => matches(r, e)));
const NOT_FOUND_RE = /no encontr[eé]|no he encontrado|no se encuentra|no hay informaci[oó]n/i;

type Res = { id: string; kind: string; covered: boolean; refs: number; recallAtK: boolean; recallAll: boolean; firstRank: number; noEncontre: boolean; citedOk: boolean | null; ms: number; answer?: string; classes: string[] };

async function run(q: Q): Promise<Res> {
  const t0 = Date.now();
  const messages = [{ role: "user" as const, content: q.q }];
  let refs: Ref[] = [], answer = "", cited: number[] = [];
  if (e2e) {
    for await (const ev of chat(messages, undefined, opts, "")) {
      if (ev.type === "delta") answer += ev.text; else { refs = ev.refs; cited = ev.cited; }
    }
  } else refs = (await retrieveContext(messages, q.q, undefined, opts, "")).refs;
  const covered = q.covered !== false;
  // rank by retrieval score (the context itself is ordered by class/time)
  const byScore = refs.some((r) => r.score != null) ? [...refs].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : refs;
  const rank = byScore.findIndex((r) => q.expect.some((e) => matches(r, e)));
  return {
    id: q.id, kind: q.kind, covered, refs: refs.length, recallAtK: hit(byScore.slice(0, K), q), recallAll: hit(refs, q), firstRank: rank < 0 ? -1 : rank + 1,
    noEncontre: e2e ? NOT_FOUND_RE.test(answer) : false,
    citedOk: e2e && covered ? cited.some((n) => refs[n - 1] && q.expect.some((e) => matches(refs[n - 1], e))) : null,
    ms: Date.now() - t0, answer: e2e ? answer : undefined, classes: [...new Set(refs.map((r) => ordOf.get(r.classId) || "?"))],
  };
}

async function main() {
  resetUsage();
  const out: Res[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    while (next < list.length) {
      const q = list[next++];
      try { out.push(await run(q)); } catch (e) { console.error(q.id, "ERROR", e); }
    }
  }));
  out.sort((a, b) => a.id.localeCompare(b.id));
  for (const r of out) {
    console.log(`${r.id} ${r.covered ? (r.recallAtK ? "HIT@K " : r.recallAll ? "hit>K " : "MISS  ") : "n/c   "} rank=${String(r.firstRank).padStart(2)} refs=${String(r.refs).padStart(2)} ${(r.ms / 1000).toFixed(1)}s ${e2e ? (r.noEncontre ? "NO_ENCONTRE " : "") + (r.citedOk === false ? "BAD_CITE " : "") : ""}[${r.classes.slice(0, 8).join(",")}]`);
  }
  const cov = out.filter((r) => r.covered), unc = out.filter((r) => !r.covered);
  const pct = (n: number, d: number) => (d ? `${n}/${d} (${Math.round((100 * n) / d)}%)` : "-");
  console.log("\n== summary", e2e ? `e2e model=${opts.model || "default"} effort=${opts.effort || "-"}` : "retrieval-only", `K=${K}`);
  console.log("recall@K  ", pct(cov.filter((r) => r.recallAtK).length, cov.length));
  console.log("recall@all", pct(cov.filter((r) => r.recallAll).length, cov.length), "avg refs", (out.reduce((s, r) => s + r.refs, 0) / Math.max(out.length, 1)).toFixed(1));
  if (e2e) {
    console.log("wrong 'no encontre' (covered)", pct(cov.filter((r) => r.noEncontre).length, cov.length));
    console.log("correct abstain (uncovered)   ", pct(unc.filter((r) => r.noEncontre).length, unc.length));
    console.log("cited ref in right place      ", pct(cov.filter((r) => r.citedOk).length, cov.length));
    const u = usageTotals();
    console.log(`tokens in=${u.input} out=${u.output} llm_calls=${u.calls} embeddings_calls=${u.embeds}`);
  }
  console.log("avg latency", (out.reduce((s, r) => s + r.ms, 0) / Math.max(out.length, 1) / 1000).toFixed(1) + "s");
  const of = val("out");
  if (of) fs.writeFileSync(of, JSON.stringify(out, null, 1));
}
main();
