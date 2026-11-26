// Site AI agent: quote verification, settings validation, per-role model/effort in the real request body, dossier hygiene.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "agent-t-"));
process.env.OPENAI_API_KEY = "test-key";
const V = await import("../lib/agent/verify");
const M = await import("../lib/agent/models");
const O = await import("../lib/agent/openai");
const A = await import("../lib/agent/agent");
const { getDb } = await import("../lib/db");

const units = [
  { key: "seg-0", text: "Dice la Guemará: אִם רוֹאֶה אָדָם שֶׁיִּסּוּרִין בָּאִין עָלָיו,", label: "00:00", startMs: 0 },
  { key: "seg-1", text: "yefashpesh bemaasav. Examina tus actos, ¿sí?", label: "00:05", startMs: 5000 },
  { key: "seg-2", text: "Y si no encontró nada, que lo atribuya al bitul Torá.", label: "00:09", startMs: 9000 },
  { key: "seg-3", text: "Eso son los yisurim shel ahavá, sufrimientos de amor.", label: "00:14", startMs: 14000 },
];

test("verify: exact, across units, nikud/punctuation-insensitive, relocated, fabricated rejected", () => {
  assert.deepEqual(V.verifyQuote(units, "que lo atribuya al bitul Torá", "seg-2", "seg-2"), { ok: true, from: 2, to: 2 });
  assert.deepEqual(V.verifyQuote(units, "Examina tus actos, ¿sí? Y si no encontró nada", "seg-1", "seg-2"), { ok: true, from: 1, to: 2 });
  assert.equal(V.verifyQuote(units, "אם רואה אדם שיסורין באין עליו", "seg-0", "seg-0").ok, true, "nikud ignored");
  const moved = V.verifyQuote(units, "los yisurim shel ahavá, sufrimientos de amor", "seg-1", "seg-1");
  assert.ok(moved.ok && moved.from === 3, "wrong location within ±3 is corrected");
  assert.equal(V.verifyQuote(units, "los sufrimientos limpian todos los pecados", "seg-3", "seg-3").ok, false, "invented quote rejected");
  assert.equal(V.verifyQuote(units, "amor", "seg-3", "seg-3").ok, false, "too short");
  assert.equal(V.verifyQuote(units, "que lo atribuya al bitul Torá", "seg-99", "seg-99").ok, false, "unknown location");
});

test("settings: defaults, allowed lists, invalid values rejected", () => {
  assert.deepEqual(M.DEFAULT_SETTINGS, { principal: { model: "gpt-6.2-sol", effort: "low" }, sub: { model: "gpt-6.1-terra", effort: "low" } });
  assert.deepEqual(M.AGENT_MODELS.map((m) => m.id), ["gpt-6.2-sol", "gpt-6.1-terra", "gpt-6.2-astra"]);
  assert.deepEqual(M.validateSettings({ principal: { model: "gpt-6.2-astra", effort: "high" } }).settings, { principal: { model: "gpt-6.2-astra", effort: "high" }, sub: M.DEFAULT_SETTINGS.sub });
  const bad = M.validateSettings({ principal: { model: "gpt-4o", effort: "extreme" } });
  assert.equal(bad.problems.length, 2); assert.equal(bad.settings.principal.model, "gpt-6.2-sol");
});

test("each role's model and reasoning.effort reach its own request (same model, different effort)", async () => {
  const bodies: any[] = [];
  O.setAgentFetcher(async (url, init) => { bodies.push({ url, ...JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ id: "r1", output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }] })); });
  try {
    await O.respond({ role: "principal", cfg: { model: "gpt-6.2-sol", effort: "high" }, instructions: "x", input: "x" });
    await O.respond({ role: "sub", cfg: { model: "gpt-6.2-sol", effort: "low" }, instructions: "x", input: "x" });
    assert.match(bodies[0].url, /\/responses$/);
    assert.deepEqual([bodies[0].model, bodies[0].reasoning], ["gpt-6.2-sol", { effort: "high" }]);
    assert.deepEqual([bodies[1].model, bodies[1].reasoning], ["gpt-6.2-sol", { effort: "low" }]);
  } finally { O.setAgentFetcher(null); }
});

test("model without access -> clear message naming model and role", async () => {
  O.setAgentFetcher(async () => new Response(JSON.stringify({ error: { message: "The model `gpt-6.2-astra` does not exist or you do not have access to it.", code: "model_not_found" } }), { status: 404 }));
  try {
    await assert.rejects(O.respond({ role: "sub", cfg: { model: "gpt-6.2-astra", effort: "low" }, instructions: "x", input: "x" }), /no tiene acceso al modelo GPT-6.2 Astra \(subagentes\)/);
  } finally { O.setAgentFetcher(null); }
});

test("dossier from the client is re-verified against the real class; citation numbers are kept", () => {
  const db = getDb();
  const row = db?.prepare("SELECT class_id, idx, text FROM segments WHERE length(text) > 80 LIMIT 1").get() as { class_id: string; idx: number; text: string } | undefined;
  if (!row) return; // no local DB
  const good = { kind: "shiur", id: row.class_id, key: `seg-${row.idx}`, quote: row.text.slice(0, 60), title: "", sub: "", label: "", href: "" };
  const fake = { ...good, quote: "esta frase no está en ninguna clase del sitio en absoluto" };
  const d = A.cleanDossier({ readings: [{ kind: "shiur", id: row.class_id, relevant: true, explanation: "x", quotes: [good, fake] }], citations: [{ n: 7, ...good }] });
  assert.equal(d.readings[0].quotes.length, 1, "tampered quote dropped");
  assert.equal(d.citations[0].n, 7, "number already shown is kept");
  assert.match(d.citations[0].href, new RegExp(`^/shiur/${row.class_id}\\?t=`));
});
