import test from "node:test";
import assert from "node:assert/strict";
import { normHe, hookInText, excerptInSource, bestWindow, detectLang, explicitLang, confidentLang, stripPrefix } from "../lib/champinones/text";
import { validateAnalysis, type ValidateCtx } from "../lib/champinones/validate";
import { highlightHook, renderBody, renderDocument, renderMap } from "../lib/champinones/render";
import { costOf } from "../lib/champinones/models";
import type { Analysis } from "../lib/champinones/types";

const T1 = "אֲמַרָה לֵיהּ: לֵית לָךָ חִיוָּרָתָא. הָהוּא יוֹמָא בַּר תַּמְנֵי סְרֵי שְׁנֵי הֲוָה, אִתְרְחִישׁ לֵיהּ נִיסָּא וְאִהַדַּרוּ לֵיהּ תַּמְנֵי סְרֵי דָּרֵי חִיוָּרָתָא";
const T3 = "אַחְזוּ לֵיהּ בְּחֶלְמֵיהּ חֲצָבֵי חִיוָּרֵי דִּמְלַיְין קִטְמָא. וְלָא הִיא, הָהִיא לְיִתּוֹבֵי דַּעְתֵּיהּ הוּא דְּאַחְזוּ לֵיהּ";
const T2 = "כׇּל תַּלְמִיד שֶׁאֵין תּוֹכוֹ כְּבָרוֹ, לֹא יִכָּנֵס לְבֵית הַמִּדְרָשׁ";

const ctx = (over: Partial<ValidateCtx> = {}): ValidateCtx => ({
  items: [{ ref: "Berakhot 28a:1", he: T1 }, { ref: "Berakhot 28a:3", he: T3 }, { ref: "Berakhot 28a:2", he: T2 }],
  passages: [{ classId: "C64", startMs: 1000, endMs: 60000, champ: true }],
  moment: (c, ms) => c === "C64" && ms >= 1000 && ms <= 60000,
  classInfo: (c) => ({ title: "64. ברכות", ordLabel: c.slice(1) }),
  expectedLang: "es", ...over,
});
const base = (): Analysis => ({
  schema_version: "champinones-v1", title: "t", question_language: "es", answer_language: "es", summary: "s",
  nodes: [
    { id: "n1", ref: "Berakhot 28a:1", work: "Bavli", label: "a", hebrew_excerpt: "ואהדרו ליה תמני סרי דרי חיורתא", transliteration: null, translation: "x", role: "anchor" },
    { id: "n2", ref: "Berakhot 28a:3", work: "Bavli", label: "b", hebrew_excerpt: "אחזו ליה בחלמיה חצבי חיורי דמליין קטמא", transliteration: null, translation: "y", role: "parallel" },
  ],
  links: [{ id: "l1", from: "n1", to: "n2", hook_type: "rare_form", hook_text: "חיור", hook_transliteration: null, hook_gloss: "blanco", surface_explanation: "s", depth_explanation: "d", depth_moves: ["word_meaning"], strength: 3, shiur_ref_indexes: [0] }],
  layers: [{ kind: "textual", title: "t", text: "x", node_ids: ["n1", "n2"] }], synthesis: "s", practical_lesson: null,
  shiur_refs: [{ classId: "C64", startMs: 5000, why: "w" }], open_questions: [], caveats: [],
});

test("normalization strips nikud, punctuation and prefixes", () => {
  assert.equal(normHe("אֲמַרָה לֵיהּ: לֵית!"), "אמרה ליה לית");
  assert.equal(stripPrefix("והחיורתא"), "חיורתא");
  assert.ok(hookInText("חיור", T1) && hookInText("חיור", T3));
  assert.ok(!hookInText("ארבע", T1));
  assert.ok(hookInText("תוכו כברו", T2));
  assert.ok(excerptInSource("ואהדרו ליה … דרי חיורתא", T1));
  assert.ok(!excerptInSource("ואהדרו ליה שלשים", T1));
  const w = bestWindow("אתרחיש ליה ניסא ואהדרו ליה תמני סרי", T1, 8);
  assert.ok(w.score > 0.8);
});
test("language detection and explicit requests", () => {
  assert.equal(detectLang("Champiñones about prayer as 'et ratzón'"), "en");
  assert.equal(detectLang("¿Qué conecta la barba con el sueño?"), "es");
  assert.equal(detectLang("מה הקשר בין חיורתא לחצבי חיורי"), "he");
  assert.equal(explicitLang("¿Qué conecta la barba con el sueño? Respond in English"), "en");
  assert.equal(explicitLang("jivartá y los cántaros, responde en hebreo"), "he");
  assert.equal(explicitLang("What is a chip? answer in Spanish please"), "es");
  assert.equal(explicitLang("jivartá y los cántaros blancos"), null);
  assert.equal(confidentLang("hmm"), null);
});
test("a fully valid analysis passes untouched", () => {
  const v = validateAnalysis(base(), ctx());
  assert.equal(v.dropped.length, 0); assert.equal(v.invalidRatio, 0);
  assert.equal(v.data.links[0].strength, 3); assert.deepEqual(v.data.links[0].shiur_ref_indexes, [0]);
  assert.equal(v.data.shiur_refs[0].ordLabel, "64");
});
test("invented refs are dropped with their links and orphan nodes", () => {
  const a = base(); a.nodes.push({ ...a.nodes[0], id: "n3", ref: "Berakhot 99z:1" });
  a.links.push({ ...a.links[0], id: "l2", from: "n1", to: "n3" });
  const v = validateAnalysis(a, ctx());
  assert.equal(v.data.nodes.length, 2); assert.equal(v.data.links.length, 1);
  assert.ok(v.dropped.some((d) => /Berakhot 99z/.test(d)));
});
test("non-verbatim excerpts are repaired or dropped", () => {
  const a = base(); a.nodes[0].hebrew_excerpt = "ואהדרו ליה תמני סרי דרי חיורתא ובלה בלה";
  let v = validateAnalysis(a, ctx());
  assert.equal(v.data.nodes.length, 2); assert.ok(v.data.nodes[0].flags?.includes("excerpt_repaired")); assert.ok(v.repaired);
  assert.ok(excerptInSource(v.data.nodes[0].hebrew_excerpt, T1));
  const b = base(); b.nodes[1].hebrew_excerpt = "שלום עליכם מלאכי השרת מלאכי עליון";
  v = validateAnalysis(b, ctx());
  assert.equal(v.data.nodes.length, 0); assert.equal(v.data.links.length, 0);
});
test("hooks must be in both texts; missing hook drops the link; outside-excerpt hook lowers strength", () => {
  let a = base(); a.links[0].hook_text = "ארבע";
  assert.equal(validateAnalysis(a, ctx()).data.links.length, 0);
  a = base(); a.nodes[1].hebrew_excerpt = "ולא היא ההיא ליתובי דעתיה"; // no חיורי in excerpt, but present in source
  const v = validateAnalysis(a, ctx());
  assert.equal(v.data.links.length, 1); assert.equal(v.data.links[0].strength, 2); assert.ok(v.data.links[0].flags?.includes("hook_outside_excerpt"));
  a = base(); a.links[0].hook_type = "concept"; a.links[0].hook_text = "תוכו כברו";
  const w = validateAnalysis(a, ctx());
  assert.equal(w.data.links.length, 1); assert.equal(w.data.links[0].strength, 1);
});
test("common-word hook cannot be strength 3", () => {
  const a = base(); a.links[0].hook_text = "ליה"; a.links[0].hook_type = "same_word";
  assert.ok(validateAnalysis(a, ctx()).data.links[0].strength <= 2);
});
test("shiur refs must be real and inside a provided passage", () => {
  const a = base(); a.shiur_refs = [{ classId: "C64", startMs: 5000, why: "ok" }, { classId: "C64", startMs: 99999999, why: "x" }, { classId: "NOPE", startMs: 5000, why: "y" }];
  a.links[0].shiur_ref_indexes = [0, 1, 2];
  const v = validateAnalysis(a, ctx());
  assert.equal(v.data.shiur_refs.length, 1); assert.deepEqual(v.data.links[0].shiur_ref_indexes, [0]);
});
test("language mismatch raises the invalid ratio (triggers retry)", () => {
  const a = base(); a.answer_language = "en";
  const v = validateAnalysis(a, ctx());
  assert.ok(v.invalidRatio > 0.25); assert.ok(v.problems.some((p) => /answer_language/.test(p)));
});
test("renderer: escapes, highlights the hook, standalone document is self-contained", () => {
  assert.match(highlightHook("אחזו ליה בחלמיה חצבי חיורי דמליין", "חיור"), /<mark class="hk">חיורי<\/mark>/);
  const a = base(); a.title = "<script>alert(1)</script>"; a.shiur_refs[0].title = "64. ברכות";
  const html = renderDocument({ data: validateAnalysis(a, ctx()).data, question: "q" }, { origin: "https://x.test" });
  assert.ok(!/<script>alert/.test(html)); assert.match(html, /<svg class="cmap"/); assert.match(html, /\/shiur\/C64\?t=5/);
  assert.match(html, /<style>/); assert.ok(!/<link rel="stylesheet" href="\/(?!\/)/.test(html));
  assert.match(renderBody({ data: a }), /data-play/);
  assert.match(renderMap(a, "es"), /cm-edge/);
});
test("cost table", () => { assert.ok(Math.abs(costOf("gpt-5.2", 10000, 5000) - (0.0175 + 0.07)) < 1e-9); });
