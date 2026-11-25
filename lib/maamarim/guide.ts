// Instructions for an AI that uploads maamarim (served by the MCP connector and the upload API).
export const UPLOAD_GUIDE = `# Biblioteca de Maamarim — cómo subir un maamar

## 1. Texto (campo "markup")
El mismo marcado del skill maamar-pdf-hebreo (maamar.txt):
TITLE: …            (obligatorio)
SUBTITLE: …
SOURCE: על פי שיעורו של … / מאמר על פי שיעור בסוגיית …
DATE: חשון תשפ"ז     DATE_ISO: 2026-11-02   (fecha civil para ordenar)
RAV: …
# פתיחה — …          -> capítulo (פרק)
## …                  -> subtítulo interno (opcional)
párrafo normal, con nota al pie {{הוריות י.}} y <b>negritas</b>
> @Horayot.10a|12||| (הוריות י.)      -> cita verbatim: el servidor la resuelve en Sefaria (REF|idx|inicio|fin|)
> טקסט הציטוט כבר מוכן (הוריות י.)     -> o la cita ya resuelta, con su etiqueta al final
Una cita con etiqueta (שם) justo después de otra se une a la misma caja.
Envía el maamar COMPLETO, tal cual quedó en el PDF (no un resumen).

## 2. Categoría (biblioteca)
Primero llama a listar_categorias y reutiliza una categoría existente siempre que encaje.
"categoria" = ruta de nombres en hebreo, de lo general a lo particular, máx. 3 niveles:
["גמרא", "ברכות"], ["גמרא", "הוריות"], ["ליקוטי מוהר״ן"], ["תנ״ך", "בראשית"], ["מועדים", "חנוכה"], ["מחשבה ומוסר", "אמונה"], ["הלכה", "תפילה"].
Si no existe, se crea. Para Guemará: ["גמרא", <מסכת>].

## 3. Ficha de enriquecimiento (campo "ficha") — MUY importante para la búsqueda IA
Los maamarim están en hebreo y los lectores preguntan sobre todo en español con transliteraciones variables.
La ficha es lo que permite encontrar el maamar. Escríbela a partir del maamar FINAL, sin inventar nada que no esté en él:
- summary_es: 3–5 frases en español: de qué trata, la tesis, cómo se desarrolla, a qué conclusión llega.
- summary_he: lo mismo en hebreo (2–4 frases).
- thesis: la tesis central en una frase.
- keywords: 20–40 términos: conceptos en hebreo (תשובה, יסורים של אהבה), su transliteración habitual en español (teshuvá, yisurim shel ahavá, también variantes: tshuva, isurim) y su traducción (arrepentimiento, sufrimientos de amor).
- concepts: 5–15 conceptos desarrollados (frases cortas, hebreo o español).
- people: personajes y autoridades (רבי יוחנן, דוד המלך, Rashí, Bilam…).
- sources: todas las fuentes citadas: [{"ref":"Berakhot.5a","label":"ברכות ה."}, {"ref":"Psalms.94.12","label":"תהלים צד יב"}].
- questions: 10–20 preguntas REALES que este maamar responde, como las haría un lector (mezcla español y hebreo; ej. "¿Por qué Rabí Yojanán dice que los sufrimientos limpian?", "מה ההבדל בין יסורים של אהבה ליסורים רגילים?").
- rav: el rav / autor de la clase.
- sections: [{ "title": <título exacto del פרק>, "summary": "1–2 frases en español", "keywords": ["…"] }] para cada פרק, en orden.
También "etiquetas": 3–8 etiquetas cortas en español para filtrar (ej. "sufrimiento", "teshuvá", "Berajot").

## 4. Actualizar
Para corregir un maamar ya subido, envía de nuevo con "id" = el id que devolvió la subida (se reemplaza; conserva categoría y PDF si no los cambias).

## 5. PDF (opcional)
El sitio muestra el maamar completo sin PDF. Para adjuntar el PDF: POST binario (application/pdf) a
<upload_url>/pdf?id=<id> desde un entorno con red, o súbelo desde /admin/maamarim.
`;

export const SERVER_INSTRUCTIONS = `Biblioteca de Maamarim de ofirsegal.app. Para subir un maamar terminado: (1) listar_categorias, (2) subir_maamar con el texto completo en el marcado del skill, la categoría y una ficha de enriquecimiento completa (resúmenes es/he, keywords en hebreo+transliteración+traducción, fuentes, personajes, 10–20 preguntas que responde, resumen por פרק). Llama a guia_biblioteca si necesitas el detalle del formato. Para consultar la biblioteca usa buscar_en_maamarim.`;
