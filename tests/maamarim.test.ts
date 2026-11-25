// Maamarim library: markup parsing, Sefaria quote trimming, store/categories/call numbers, FTS search (no embeddings), MCP + upload routes.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "maamar-t-"));
process.env.ADMIN_PASSWORD = "pw-test"; delete process.env.MAAMARIM_TOKEN; delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
const MK = await import("../lib/maamarim/markup");
const SF = await import("../lib/maamarim/sefaria");
const S = await import("../lib/maamarim/store");
const IX = await import("../lib/maamarim/search");
const T = await import("../lib/maamarim/token");
const mcpRoute = await import("../app/api/maamarim/mcp/[token]/route");
const upRoute = await import("../app/api/maamarim/upload/[token]/route");

const MARKUP = `TITLE: יִסּוּרִים שֶׁל אַהֲבָה
SUBTITLE: על הייסורים הממרקים את העוונות
SOURCE: מאמר על פי שיעור בסוגיית ברכות ה.
DATE: חשון תשפ"ז
DATE_ISO: 2026-11-02

# פתיחה — על מה המאמר
הגמרא בברכות דנה ביסורים של אהבה{{ברכות ה.}} ובשאלה <b>מדוע</b> הם באים על הצדיק. נלמד שהיסורים ממרקים את העוונות כמו מלח הממתק את הבשר.
> אמר רבא ואיתימא רב חסדא אם רואה אדם שיסורין באין עליו יפשפש במעשיו (ברכות ה.)
> פשפש ולא מצא יתלה בביטול תורה (שם)
# פרק א — מלח וייסורים
כשם שהמלח ממתק את הבשר כך היסורים ממרקים את כל עוונותיו של אדם. רבי שמעון בן לקיש לומד זאת מגזירה שוה של ברית.
> @Berakhot.5a|*|נאמר ברית במלח|| (ברכות ה.)
`;

test("markup: header, sections, notes, quotes merged with (שם), unresolved @REF", () => {
  const p = MK.parseMarkup(MARKUP);
  assert.equal(p.header.title, "יִסּוּרִים שֶׁל אַהֲבָה");
  assert.equal(p.header.dateIso, "2026-11-02");
  assert.equal(p.sections.length, 2);
  assert.equal(p.sections[0].id, "s1");
  assert.equal(p.notes.length, 1);
  assert.match((p.sections[0].blocks[0] as { html: string }).html, /<sup class="fn" data-n="1">1<\/sup>.*<b>מדוע<\/b>/);
  const quotes = p.sections[0].blocks.filter((b) => b.t === "quote");
  assert.equal(quotes.length, 1, "the (שם) quote joins the previous box");
  assert.match((quotes[0] as { text: string }).text, /יפשפש במעשיו פשפש ולא מצא/);
  assert.equal(p.pending.length, 1);
  assert.equal(MK.safeInline("<script>x</script><b>ok</b>"), "&lt;script&gt;x&lt;/script&gt;<b>ok</b>");
});

test("sefaria: clean + trim on the nikud-less skeleton", () => {
  assert.equal(SF.cleanSefaria("<b>בְּרֵאשִׁ֖ית</b> בָּרָ֣א {פ}"), "בְּרֵאשִׁית בָּרָא");
  const t = "אָמַר רָבָא אִם רוֹאֶה אָדָם שֶׁיִּסּוּרִין בָּאִין עָלָיו יְפַשְׁפֵּשׁ בְּמַעֲשָׂיו";
  assert.equal(SF.trimBySkeleton(t, "אם רואה", "באין עליו"), "אִם רוֹאֶה אָדָם שֶׁיִּסּוּרִין בָּאִין עָלָיו");
  assert.equal(SF.trimBySkeleton(t, "לא קיים"), null);
});

let id = "";
test("store: upsert creates category path, call number, enrichment; replace keeps id/seq", async () => {
  const resolve = async (spec: string) => ({ text: `נֶאֱמַר בְּרִית בְּמֶלַח [${spec.split("|")[0]}]`, ref: "Berakhot.5a" });
  const r = await S.upsertMaamar({
    markup: MARKUP, category: ["גמרא", "ברכות"], tags: "sufrimiento, Berajot",
    ficha: { summary_es: "Explica los sufrimientos de amor (yisurim shel ahavá) en Berajot 5a.", questions: ["¿Por qué sufre el justo?"], keywords: ["teshuvá", "יסורים"], sections: [{ title: "פרק א — מלח וייסורים", summary: "La sal y los sufrimientos" }] },
  }, { resolve });
  id = r.maamar.id;
  assert.ok(r.created);
  assert.equal(r.maamar.sections[1].summary, "La sal y los sufrimientos");
  const q = r.maamar.sections[1].blocks.find((b) => b.t === "quote") as { text: string; unresolved?: boolean };
  assert.match(q.text, /נֶאֱמַר בְּרִית/); assert.equal(q.unresolved, false);
  const tree = S.categoryTree();
  assert.equal(tree[0].name, "גמרא"); assert.equal(tree[0].children[0].name, "ברכות"); assert.equal(tree[0].children[0].code, "1.1");
  assert.equal(S.listCards()[0].callNumber, "1.1.01");
  // second maamar in the same category -> seq 2; a different category -> its own code
  const r2 = await S.upsertMaamar({ markup: MARKUP.replace("יִסּוּרִים שֶׁל אַהֲבָה", "מאמר שני").replace(/^> @.*$/m, ""), category: ["גמרא", "ברכות"] }, { resolve });
  assert.equal(S.toCard(r2.maamar).callNumber, "1.1.02");
  const r3 = await S.upsertMaamar({ markup: MARKUP.replace("יִסּוּרִים שֶׁל אַהֲבָה", "תורה כה").replace(/^> @.*$/m, ""), category: "ליקוטי מוהר״ן" }, { resolve });
  assert.equal(S.toCard(r3.maamar).callNumber, "2.01");
  // replace
  const again = await S.upsertMaamar({ id, markup: MARKUP.replace("מלח וייסורים", "מלח ויסורים"), ficha: { thesis: "tesis" } }, { resolve });
  assert.equal(again.created, false); assert.equal(again.maamar.seq, 1); assert.equal(again.maamar.ficha.summary_es?.startsWith("Explica"), true, "ficha merged");
  await assert.rejects(S.upsertMaamar({ markup: "TITLE: x\n# a\nקצר" }), /contenido suficiente/);
  assert.throws(() => S.deleteCategory(tree[0].id), /subcategorías/);
});

test("search: Hebrew without nikud / with prefix, Spanish via ficha", async () => {
  await IX.syncIndex(true);
  const a = await IX.searchMaamarim(["מלח"]);
  assert.ok(a.length && a[0].maamarId, "found");
  const b = await IX.searchMaamarim(["והיסורים ממרקים"]);
  assert.ok(b.some((p) => p.maamarId === id));
  const c = await IX.searchMaamarim(["¿Por qué sufre el justo?"]);
  assert.ok(c.some((p) => p.maamarId === id), "matched through the ficha questions");
  const scoped = await IX.searchMaamarim(["מלח"], { maamarId: id });
  assert.ok(scoped.every((p) => p.maamarId === id));
  assert.deepEqual(IX.normForIndex("וְהַיִּסּוּרִים").slice(0, 2), ["והיסורימ", "היסורימ"]);
});

test("mcp: auth, initialize, tools/list, tools/call (list, search, upload)", async () => {
  const tok = T.currentMaamarToken()!;
  const call = async (body: unknown, t = tok) => mcpRoute.POST(new Request("http://x/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ token: t }) });
  assert.equal((await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, "x".repeat(40))).status, 404);
  const init = await (await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })).json();
  assert.equal(init.result.protocolVersion, "2025-03-26"); assert.ok(init.result.instructions);
  assert.equal((await call({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const tools = await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
  assert.ok(tools.result.tools.some((t: { name: string }) => t.name === "subir_maamar"));
  const cats = await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "listar_categorias", arguments: {} } })).json();
  assert.match(cats.result.content[0].text, /1\.1\s+ברכות/);
  const s = await (await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "buscar_en_maamarim", arguments: { pregunta: "מלח" } } })).json();
  assert.match(s.result.content[0].text, /\/maamarim\/m/);
  const up = await (await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "subir_maamar", arguments: { markup: MARKUP.replace(/^> @.*$/m, "").replace("יִסּוּרִים שֶׁל אַהֲבָה", "מאמר מהחיבור"), categoria: ["מחשבה ומוסר"], ficha: { summary_es: "x" } } } })).json();
  assert.match(up.result.content[0].text, /Subido: «מאמר מהחיבור»/);
  const bad = await (await call({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "subir_maamar", arguments: { markup: "nada" } } })).json();
  assert.equal(bad.result.isError, true);
  // HTTP upload route
  const r = await upRoute.POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ markup: MARKUP.replace(/^> @.*$/m, "").replace("יִסּוּרִים שֶׁל אַהֲבָה", "רביעי"), categoria: ["גמרא", "ברכות"] }) }), { params: Promise.resolve({ token: tok }) });
  const j = await r.json(); assert.equal(j.ok, true); assert.equal(j.callNumber, "1.1.03");
});
