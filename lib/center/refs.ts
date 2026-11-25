// Guess a Sefaria reference (Talmud) from a file name, for the context of AI packages (no LLM involved).
const TRACTATES: Record<string, string> = {
  "ברכות": "Berakhot", "שבת": "Shabbat", "עירובין": "Eruvin", "פסחים": "Pesachim", "יומא": "Yoma", "סוכה": "Sukkah", "ביצה": "Beitzah", "ראש השנה": "Rosh_Hashanah",
  "תענית": "Taanit", "מגילה": "Megillah", "מועד קטן": "Moed_Katan", "חגיגה": "Chagigah", "יבמות": "Yevamot", "כתובות": "Ketubot", "נדרים": "Nedarim", "נזיר": "Nazir",
  "סוטה": "Sotah", "גיטין": "Gittin", "קידושין": "Kiddushin", "בבא קמא": "Bava_Kamma", "בבא מציעא": "Bava_Metzia", "בבא בתרא": "Bava_Batra", "סנהדרין": "Sanhedrin",
  "מכות": "Makkot", "שבועות": "Shevuot", "עבודה זרה": "Avodah_Zarah", "הוריות": "Horayot", "זבחים": "Zevachim", "מנחות": "Menachot", "חולין": "Chullin", "בכורות": "Bekhorot",
  "ערכין": "Arakhin", "תמורה": "Temurah", "כריתות": "Keritot", "מעילה": "Meilah", "נדה": "Niddah",
  berajot: "Berakhot", berakhot: "Berakhot", shabat: "Shabbat", shabbat: "Shabbat", nedarim: "Nedarim", horayot: "Horayot", megila: "Megillah", megillah: "Megillah", sucá: "Sukkah", suca: "Sukkah",
};
const VAL: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
export const hebNum = (s: string) => [...s].reduce((a, c) => a + (VAL[c] ?? 0), 0);

/** "ברכות ג ע׳׳א", "Berajot 7b" -> "Berakhot.3a" / "Berakhot.7b"; null when nothing recognizable. */
export function guessSefariaRef(name: string, fixedObra?: string): string | null {
  const text = `${name}`.normalize("NFC");
  let tract: string | null = null, rest = text;
  for (const [k, v] of Object.entries(TRACTATES).sort((a, b) => b[0].length - a[0].length)) {
    const i = text.toLowerCase().indexOf(k.toLowerCase());
    if (i >= 0) { tract = v; rest = text.slice(i + k.length); break; }
  }
  if (!tract && fixedObra) { const v = TRACTATES[fixedObra.trim()]; if (v) { tract = v; rest = text; } }
  if (!tract) return null;
  let m = rest.match(/\s([א-ת]{1,3})\s*ע[׳'"״]{1,2}\s*([אב])/u);
  if (m) return `${tract}.${hebNum(m[1])}${m[2] === "א" ? "a" : "b"}`;
  m = rest.match(/\b(\d{1,3})\s*([ab])\b/i);
  if (m) return `${tract}.${m[1]}${m[2].toLowerCase()}`;
  return null;
}
