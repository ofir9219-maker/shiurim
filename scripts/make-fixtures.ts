// Generates realistic demo fixtures into data/fixtures (deterministic). Run: npx tsx scripts/make-fixtures.ts
import fs from "node:fs";
import path from "node:path";

const out = path.join(process.cwd(), "data", "fixtures");
fs.mkdirSync(path.join(out, "polished"), { recursive: true });

const classes = [
  {
    id: "FIXTURE_ID_0001", order: "1.1", name: "Berajot 2a - Zman Keriat Shema",
    title: "El tiempo de la lectura del Shemá de la noche", daf: [{ daf: "ב", amud: "א" }],
    summary: "Análisis de la primera mishná de Berajot: desde cuándo se recita el Shemá de la noche, la opinión de Rabí Eliezer y de los Jajamim, y el sentido de la expresión 'Meematai'.",
    tags: ["Shemá", "Zmanim", "Rabí Eliezer", "Meematai"],
    topics: ["Meematai korin et Shemá be-Arvit", "Rabí Eliezer y la hora de los kohanim", "Los Jajamim y la media noche", "Rabán Gamliel y la protección de la Torá"],
  },
  {
    id: "FIXTURE_ID_0002", order: "1.2", name: "Berajot 3a - Ashmorot",
    title: "Las guardias de la noche y la voz del Santo, bendito sea", daf: [{ daf: "ג", amud: "א" }],
    summary: "La guerra de las guardias (ashmorot) de la noche, el rugido del Santo, bendito sea, sobre la destrucción del Templo, y la importancia de responder 'Amén, yehé shemé rabá'.",
    tags: ["Ashmorot", "Jurbán", "Amén yehé shemé rabá", "Bat Kol"],
    topics: ["Las tres ashmorot de la noche", "El rugido del león y el Jurbán", "Amén yehé shemé rabá", "El Bat Kol que gime como paloma"],
  },
  {
    id: "FIXTURE_ID_0003", order: "2.1", name: "Berajot 4b-5a - Yisurim",
    title: "Los sufrimientos y la aceptación del yugo del Cielo", daf: [{ daf: "ד", amud: "ב" }, { daf: "ה", amud: "א" }],
    summary: "La sugía de 'Kol ha-meshamer Keriat Shema al mitató' y el tema de los yisurim shel ahavá: cómo se vive el sufrimiento con emuná y por qué la Torá se adquiere con yisurim.",
    tags: ["Yisurim", "Emuná", "Keriat Shemá al ha-mitá", "Yisurim shel ahavá"],
    topics: ["Keriat Shemá al ha-mitá", "Yisurim shel ahavá", "Rabí Yojanán y el hueso de su décimo hijo", "La Torá se adquiere con sufrimientos"],
  },
];

const bodies = [
  "Hoy vamos a comenzar con la pregunta que abre toda la Guemará: {t}. Rashi explica que la expresión viene a enseñarnos algo más profundo.",
  "Dice el Rambam en Hiljot Keriat Shemá que hay que tener kavaná desde el primer versículo, 'Shemá Yisrael Adonai Eloheinu Adonai Ejad'.",
  "Aquí hay una pregunta clásica: ¿por qué la Mishná empieza con la noche y no con el día? La respuesta de la Guemará es 'ki-dejtiv: va-yehí erev va-yehí boker'.",
  "El Rabino Najmán de Breslov enseña en el Likutei Moharán que cada palabra de la tefilá abre un mundo, y que la emuná es la base de todo.",
  "Tosafot pregunta sobre esto en el dibur ha-matjil, y trae la opinión de Rabenu Tam, que difiere de lo que dijo Rashi.",
  "Fíjense en la lashón de la Mishná: no dice 'mimataiy' sino 'meematai'. Cada palabra de la Mishná está medida con precisión.",
  "La Guemará responde con una berajá, una baraíta, y luego introduce la maljojet de Rabí Eliezer contra los Jajamim.",
  "Esto nos enseña un principio de avodat Hashem: la persona debe prepararse antes de acercarse a la tefilá, con simjá y con yirá.",
  "Pregunta el Maharsha: ¿cómo es posible que Rabí Eliezer sostenga eso? Y contesta con un jidush hermoso sobre la hora de la tevilá de los kohanim.",
  "Acá termina el primer pshat; ahora pasamos al drash, al remez y al sod. Recuerden que la Torá tiene setenta caras.",
  "El Shulján Aruj, en Oraj Jaim simán 235, resuelve la halajá y el Mishná Berurá agrega que hay que ser cuidadoso con el zman.",
  "Y como dicen los Jajamim: 'Haveh zahir bi-divrei jajamim'. Este es el hilo que une toda la sugía, baruj Hashem.",
];

function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

const inventory: any[] = [];
for (const c of classes) {
  const segs: any[] = [];
  let t = 0;
  for (let i = 0; i < 40; i++) {
    const dur = 6000 + (hash(c.id + i) % 9000);
    const topic = c.topics[Math.floor(i / 10) % c.topics.length];
    const text = bodies[(i + hash(c.id)) % bodies.length].replace("{t}", topic);
    segs.push({ startMs: t, endMs: t + dur, text: i % 10 === 0 ? `${topic}. ${text}` : text });
    t += dur;
  }
  inventory.push({
    id: c.id, name: c.name, order: c.order, ext: "mp3", mimeType: "audio/mpeg", sizeBytes: Math.round(t / 1000 * 16000),
    durationMs: t, mdId: null, mdName: null, transcript: "none", inShiurim: true,
  });
  fs.writeFileSync(path.join(out, "polished", `${c.id}.json`), JSON.stringify({
    id: c.id, segments: segs, summary: c.summary, tags: c.tags, daf: c.daf, title: c.title,
    newName: `${c.order} - ${c.title}`,
  }, null, 1));
}
fs.writeFileSync(path.join(out, "inventory.json"), JSON.stringify(inventory, null, 1));
console.log("fixtures written", inventory.length);
