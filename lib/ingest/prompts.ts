// Server-side port of prompts/polish.md (rules kept verbatim; file/tool instructions replaced by the pipeline's own steps).

export const POLISH_RULES = `Eres el editor de transcripciones de un shiur de Guemará (Masejet Berajot, a veces Likutey Moharán, Zohar, Nedarim, Horayot, Meguilá…) dado en ESPAÑOL con muchas frases en hebreo y arameo. El reconocimiento de voz destrozó las frases hebreas/arameas convirtiéndolas en palabras latinas sin sentido.

## Pulido (corrección CONSERVADORA, no redacción)
- Mismo número de segmentos, mismo orden; los timestamps no se tocan (los pone el sistema). Solo corriges \`text\`.
- Corrige errores de reconocimiento, puntuación, separación de palabras, mayúsculas, nombres y términos.
- Hebreo y arameo SIEMPRE en transliteración latina estándar (sefardí, estilo español): Hashem, Kadosh Baruj Hu, tefilá, Shemá, guemará, mishná, tzadik, teshuvá, Rabí Yojanán, "meematai korín et Shemá", "kol hakovea makom litfilató"… NUNCA letras hebreas.
- Detecta galimatías que en realidad son hebreo/arameo ("memat kor in shem" → "meematai korín"; "el rap mi tapextle todo" puede ser "rav mitapjim le-tov"… solo si el contexto y Sefaria lo confirman). Si la Guemará se lee en voz alta, alinéala con el texto de Sefaria (transliterado).
- No traduzcas, no resumas, no reordenes, no inventes, no agregues explicaciones. Muletillas y repeticiones se quedan (puedes limpiar tartamudeos obvios "que que que" → "que").
- Si un fragmento es irrecuperable, escribe \`[inaudible]\` en esa parte (no adivines).
- Convenciones: Rabí (incluido "Rebbi" a secas → Rabí), Rav, Hashem, Kadosh Baruj Hu, Guemará, Mishná, Rashí, Tosafot.
- Etiquetas de hablante: no las incluyas en el texto.
- Scribe a veces se "pierde" al inicio de un bloque de 19 min (timestamps estirados, texto repetido o traducido al español en vez de hebreo/arameo, o letras hebreas). Corrige solo el texto usando Sefaria y el contexto; no toques timestamps.`;

export const CONTEXT_SYSTEM = `${POLISH_RULES}

# Tarea: pasada 0 — entender el contexto
Lee TODA la transcripción (compacta: \`i | mm:ss | texto\`). Identifica: qué daf/amud se estudia, la Guemará citada, nombres (Rabí Yojanán, Rav Huna, Bilam, David hamélej…), temas y citas que el rabino lee en voz alta.
Para cada daf/amud estudiado da la referencia de Sefaria en formato API: \`Berakhot.7a\`, \`Nedarim.31b\`, \`Horayot.10a\`, \`Megillah.19a\`, \`Rosh_Hashanah.16b\`, \`Likutei_Moharan.19\` (Likutey Moharán no lleva amud). Máximo 4 referencias, las más relevantes. Si no puedes determinar el daf, devuelve la lista vacía.
Todo el contenido en español, salvo nombres de obra/daf que van en hebreo.`;

export const CONTEXT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["refs", "topics", "names", "citations", "notes"],
  properties: {
    refs: { type: "array", items: { type: "object", additionalProperties: false, required: ["sefaria", "work_he", "daf_he", "amud_he"], properties: {
      sefaria: { type: "string" }, work_he: { type: "string" }, daf_he: { type: "string", description: "letras hebreas sin puntuación (ז, יא)" }, amud_he: { type: "string", description: "א, ב o cadena vacía" } } } },
    topics: { type: "array", items: { type: "string" } },
    names: { type: "array", items: { type: "string" }, description: "nombres propios con su transliteración correcta" },
    citations: { type: "array", items: { type: "string" }, description: "frases hebreas/arameas leídas, ya transliteradas" },
    notes: { type: "string" },
  },
} as const;

export const polishSystem = (ctx: string, sefaria: string) => `${POLISH_RULES}

# Tarea: pulir un lote de segmentos
Recibirás un lote de segmentos \`{i, text}\` de la transcripción cruda. Devuelve EXACTAMENTE los mismos índices \`i\`, cada uno con su \`text\` corregido (nunca vacío, nunca con letras hebreas). También verás segmentos vecinos (solo lectura) para dar continuidad; NO los devuelvas.

# Contexto de la clase (pasada 0)
${ctx}
${sefaria ? `\n# Texto del daf (Sefaria, hebreo) para reconstruir con exactitud las citas que el rabino lee\n${sefaria}\n` : ""}`;

export const POLISH_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items"],
  properties: { items: { type: "array", items: { type: "object", additionalProperties: false, required: ["i", "text"], properties: { i: { type: "integer" }, text: { type: "string" } } } } },
} as const;

export const META_SYSTEM = `Generas los metadatos de una clase a partir de su transcripción ya pulida.

- summary: 2-3 oraciones en español.
- tags: 5-10 tags cortos en español (en minúsculas salvo nombres propios).
- daf: lista [{daf, amud}] en orden, con daf en letras hebreas sin puntuación (ג, יא, יג) y amud "א" o "ב" (cadena vacía solo para obras sin amud como Likutey Moharán). Si abarca dos amudim, dos entradas.
- work_he: nombre de la obra en hebreo. Berajot = ברכות. Si la clase NO es de Berajot (ej. Nedarim, Horayot, Meguilá, Likutey Moharán) pon la obra real (נדרים, הוריות, מגילה, ליקוטי מוהר״ן). Si es Berajot pero el foco es otra fuente, mantén el daf de Berajot que se estudia.
- topics_he: 2-4 temas principales EN HEBREO, breves (máx ~50 caracteres en total), separados por coma o punto. Ej: "רבי יוסי חורבה, גלות גאולה. תפילה". Sin / ni : ni comillas dobles ASCII.
- El título se basa en el CONTENIDO: si la clase estudia otro daf distinto al del nombre original, usa el daf real. Si el fragmento no permite determinar el daf (p. ej. es un pedazo de otra clase), conserva el daf del nombre original y dilo en daf_note.
- daf_note: "" o una línea con dudas.`;

export const META_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "tags", "daf", "work_he", "topics_he", "daf_note"],
  properties: {
    summary: { type: "string" }, tags: { type: "array", items: { type: "string" } },
    daf: { type: "array", items: { type: "object", additionalProperties: false, required: ["daf", "amud"], properties: { daf: { type: "string" }, amud: { type: "string" } } } },
    work_he: { type: "string" }, topics_he: { type: "string" }, daf_note: { type: "string" },
  },
} as const;
