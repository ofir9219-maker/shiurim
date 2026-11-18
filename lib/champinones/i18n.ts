// Labels of the result view, per answer language (es | en | he | fr). Unknown languages fall back to English.
type Dict = Record<string, string>;
const es: Dict = {
  eyebrow: "Champiñones", map: "Mapa de conexiones", mapHint: "Haz clic en un pasaje o en una arista para enfocar.", reset: "Ver todo",
  passages: "Pasajes", connections: "Conexiones", hook: "Gancho", surface: "Superficie", depth: "Profundidad", moves: "Movimientos de profundidad",
  layers: "Capas", synthesis: "Síntesis", lesson: "Lección práctica", shiurim: "En los shiurim", listen: "Escuchar", open: "Abrir",
  sefaria: "Ver en Sefaria", openQ: "Preguntas abiertas", caveats: "Salvedades", strength: "Fuerza", translit: "Transliteración",
  from: "de", to: "a", noLinks: "No se encontró un gancho textual verificable entre los pasajes recuperados.", validated: "Verificado contra Sefaria y las transcripciones",
  discarded: "elementos descartados por la validación", model: "Modelo", generated: "Generado", class: "Clase", surfaceDepth: "Superficie → profundidad",
  s1: "sugerente", s2: "sólido", s3: "explícito", role_anchor: "ancla", role_parallel: "paralelo", role_proof_text: "pasuk citado", role_context: "contexto", role_commentary: "comentario",
  toggleTheme: "Cambiar tema", standalone: "Análisis de champiñones · archivo independiente",
};
const en: Dict = {
  eyebrow: "Champiñones", map: "Connection map", mapHint: "Click a passage or an edge to focus.", reset: "Show all",
  passages: "Passages", connections: "Connections", hook: "Hook", surface: "Surface", depth: "Depth", moves: "Depth moves",
  layers: "Layers", synthesis: "Synthesis", lesson: "Practical lesson", shiurim: "In the shiurim", listen: "Listen", open: "Open",
  sefaria: "View on Sefaria", openQ: "Open questions", caveats: "Caveats", strength: "Strength", translit: "Transliteration",
  from: "from", to: "to", noLinks: "No verifiable textual hook was found among the retrieved passages.", validated: "Checked against Sefaria and the transcripts",
  discarded: "items discarded by validation", model: "Model", generated: "Generated", class: "Class", surfaceDepth: "Surface → depth",
  s1: "suggestive", s2: "solid", s3: "explicit", role_anchor: "anchor", role_parallel: "parallel", role_proof_text: "proof text", role_context: "context", role_commentary: "commentary",
  toggleTheme: "Toggle theme", standalone: "Champiñones analysis · standalone file",
};
const he: Dict = {
  eyebrow: "שמפיניונס", map: "מפת קשרים", mapHint: "לחצו על קטע או על קשר כדי למקד.", reset: "הצג הכול",
  passages: "קטעים", connections: "קשרים", hook: "הקשר הלשוני", surface: "פשט", depth: "עומק", moves: "דרכי העמקה",
  layers: "רבדים", synthesis: "סיכום", lesson: "לקח מעשי", shiurim: "בשיעורים", listen: "האזנה", open: "פתיחה",
  sefaria: "לספריא", openQ: "שאלות פתוחות", caveats: "הסתייגויות", strength: "עוצמה", translit: "תעתיק",
  from: "מ", to: "אל", noLinks: "לא נמצא קשר לשוני שניתן לאמת בין הקטעים שנאספו.", validated: "נבדק מול ספריא ותמלילי השיעורים",
  discarded: "פריטים שהוסרו בבדיקה", model: "מודל", generated: "נוצר", class: "שיעור", surfaceDepth: "מהפשט אל העומק",
  s1: "רמז", s2: "איתן", s3: "מפורש", role_anchor: "עוגן", role_parallel: "מקבילה", role_proof_text: "פסוק", role_context: "הקשר", role_commentary: "פרשן",
  toggleTheme: "החלפת ערכת צבעים", standalone: "ניתוח שמפיניונס · קובץ עצמאי",
};
const fr: Dict = {
  ...en, eyebrow: "Champiñones", map: "Carte des liens", mapHint: "Cliquez sur un passage ou un lien pour le mettre en avant.", reset: "Tout afficher",
  passages: "Passages", connections: "Liens", hook: "Crochet", surface: "Surface", depth: "Profondeur", moves: "Mouvements de profondeur",
  layers: "Couches", synthesis: "Synthèse", lesson: "Leçon pratique", shiurim: "Dans les cours", listen: "Écouter", open: "Ouvrir",
  sefaria: "Voir sur Sefaria", openQ: "Questions ouvertes", caveats: "Réserves", strength: "Force",
  s1: "suggestif", s2: "solide", s3: "explicite", role_anchor: "ancre", role_parallel: "parallèle", role_proof_text: "verset cité", role_context: "contexte", role_commentary: "commentaire",
};
const D: Record<string, Dict> = { es, en, he, fr };
export const tr = (lang: string, k: string): string => (D[lang] || en)[k] ?? en[k] ?? k;

const MOVES_ES: Dict = { word_meaning: "sentido de la palabra", function_transfer: "transferencia de función", situation: "situación", person: "persona", completion: "complemento", unifying_yesod: "yesod unificador", kabbalistic: "cabalístico", practical: "práctico" };
const MOVES_EN: Dict = { word_meaning: "word meaning", function_transfer: "function transfer", situation: "situation", person: "person", completion: "completion", unifying_yesod: "unifying yesod", kabbalistic: "kabbalistic", practical: "practical" };
const MOVES_HE: Dict = { word_meaning: "משמעות המילה", function_transfer: "העברת תפקיד", situation: "מצב", person: "אדם", completion: "השלמה", unifying_yesod: "יסוד מאחד", kabbalistic: "קבלי", practical: "מעשי" };
const HOOKS_ES: Dict = { same_word: "misma palabra", rare_form: "forma rara", shared_root: "raíz compartida", same_phrase: "misma frase", same_verse: "mismo pasuk", name_person: "nombre / persona", number: "número", image_object: "imagen / objeto", structure: "estructura", scene_role: "rol en la escena", concept: "concepto" };
const HOOKS_EN: Dict = { same_word: "same word", rare_form: "rare form", shared_root: "shared root", same_phrase: "same phrase", same_verse: "same verse", name_person: "name / person", number: "number", image_object: "image / object", structure: "structure", scene_role: "scene role", concept: "concept" };
const HOOKS_HE: Dict = { same_word: "אותה מילה", rare_form: "צורה נדירה", shared_root: "שורש משותף", same_phrase: "אותו ביטוי", same_verse: "אותו פסוק", name_person: "שם / אדם", number: "מספר", image_object: "דימוי / חפץ", structure: "מבנה", scene_role: "תפקיד בסצנה", concept: "מושג" };
export const moveLabel = (lang: string, m: string) => ({ es: MOVES_ES, he: MOVES_HE }[lang as "es"] || MOVES_EN)[m] || m;
export const hookLabel = (lang: string, h: string) => ({ es: HOOKS_ES, he: HOOKS_HE }[lang as "es"] || HOOKS_EN)[h] || h;
