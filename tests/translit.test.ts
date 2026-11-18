import test from "node:test";
import assert from "node:assert/strict";
import { normText, dafToHebrew } from "../lib/translit";

const same = (...v: string[]) => assert.equal(new Set(v.map(normText)).size, 1, JSON.stringify(v.map(normText)));
test("transliteration variants normalize to the same form", () => {
  same("jesed", "hesed", "chesed", "Jésed", "Chessed");
  same("Shemá", "Shema", "Sh'ma", "Shmá");
  same("kavaná", "kavana", "cavana", "kavvanah");
  same("Rabí Akiva", "Rabbi Akiva", "Rav Akiva");
  same("tzadik", "zadik", "tsadik", "Tsaddik");
  same("Gueulá", "Geulá", "Geula");
  same("Jizkiyahu", "Hizkiyahu", "Chizkiyahu");
  same("Avraham", "Abraham");
  same("Beit Hamikdash", "Bet HaMikdash", "Beth Hamikdash");
  same("Sha'ar HaNun", "Shaar Hanun");
  assert.notEqual(normText("Jesed"), normText("Shemá"));
});
test("hebrew letters kept, daf numbers to gematria", () => {
  assert.equal(normText("ברכות 13"), "ברכות 13");
  assert.deepEqual([6, 13, 15, 16, 27].map(dafToHebrew), ["ו", "יג", "טו", "טז", "כז"]);
});
