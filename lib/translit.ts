// Transliteration-insensitive normalization for Spanish transcripts with Hebrew/Aramaic terms spelled inconsistently
// (jesed/hesed/chesed, Shemá/Shema/Sh'ma, kavaná/kavana, Rabí/Rabbi/Rav, tz/ts/z, k/q/c, doubled letters...).
// Pure; used at build time (shadow FTS text) and at query time (same function on both sides).
// The output is a lossy "phonetic skeleton", only meant for matching, never for display.

const HEB = /[֐-׿]/;

export function normWord(w: string): string {
  if (HEB.test(w)) return w.replace(/[֑-ׇ]/g, ""); // Hebrew letters: drop niqqud only
  let s = w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); // accents (ñ -> n too)
  s = s.replace(/[^a-z0-9]/g, "");
  if (!s) return "";
  s = s.replace(/ph/g, "f").replace(/w/g, "v").replace(/th/g, "t");
  s = s.replace(/sch/g, "x").replace(/sh/g, "x"); // sh -> x
  s = s.replace(/ch|kh|gh/g, "j"); // chet / jaf
  s = s.replace(/tz|ts|dz|z/g, "z"); // tzadik / zadik / tsadik
  s = s.replace(/qu(?=[ei])/g, "k").replace(/q/g, "k");
  s = s.replace(/c(?=[aouklrtn]|$)/g, "k"); // cavaná -> kavana ("ce"/"ci" stay: Spanish soft c)
  s = s.replace(/gu(?=[ei])/g, "g"); // gueulá / geulá
  s = s.replace(/h$/, ""); // final h after a vowel: Torah, Yehudah
  s = s.replace(/h/g, "j"); // initial / intervocalic h = chet (hesed, Yehudá)
  s = s.replace(/v/g, "b"); // b/v (Avraham / Abraham)
  s = s.replace(/^i(?=[aeou])/, "y").replace(/ll/g, "y");
  s = s.replace(/(.)\1+/g, "$1"); // doubled letters
  s = s.replace(/ey|ei/g, "e"); // beit / bet, rabeinu / rabenu
  s = s.replace(/^xe(?=[^aeiou][aeiou])/, "x"); // Shemá / Shma
  s = s.replace(/^(rabi|rabino|rabbi)$/, "rab").replace(/^r$/, "rab");
  return s;
}

/** Normalized token list (letters and digits; hyphen -> separator, apostrophes joined). */
export function normTokens(text: string): string[] {
  const t = text.normalize("NFC").replace(/['’`´ʼ׳]/g, "").replace(/-/g, " ");
  const out: string[] = [];
  for (const w of t.match(/[\p{L}\p{N}]+/gu) || []) {
    const n = /^\d+$/.test(w) ? w : normWord(w);
    if (n) out.push(n);
  }
  return out;
}

export function normText(text: string): string {
  return normTokens(text).join(" ");
}

const GEMATRIA: [number, string][] = [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]];
/** 6 -> "ו", 15 -> "טו", 16 -> "טז", 27 -> "כז" (folio numbers as stored in classes.daf). */
export function dafToHebrew(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 999) return "";
  if (n === 15) return "טו";
  if (n === 16) return "טז";
  let out = "";
  let r = n;
  for (const [v, l] of GEMATRIA) while (r >= v) { out += l; r -= v; }
  return out.replace(/יה$/, "טו").replace(/יו$/, "טז");
}
