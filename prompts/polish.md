# Instrucciones de pulido + título + renombrado (una clase)

Trabajas en /home/user/shiurim. Te asignan UNA clase (id = id de Drive del audio). Datos:
- `data/inventory.json` → tu entrada (name, order, ext, durationMs, mdId, mdName).
- `data/segments/{id}.json` → `{source, model, segments:[{startMs,endMs,speaker?,text}]}`: transcripción cruda segmentada (de Plaud .md o de Fal Scribe). NO la modifiques. Tampoco `data/raw/`.

Es un shiur de Guemará (Masejet Berajot, a veces Likutey Moharán, Zohar, Nedarim, Horayot…) dado en ESPAÑOL con muchas frases en hebreo y arameo. El reconocimiento de voz destrozó las frases hebreas/arameas convirtiéndolas en palabras latinas sin sentido.

## 1. Entender el contexto
Lee TODA la transcripción primero (con Bash: `python3 -c` imprimiendo `i | mm:ss | text`, en bloques de ~250 segmentos si es larga). Identifica: qué daf/amud se estudia, la Guemará citada, nombres (Rabí Yojanán, Rav Huna, Bilam, David hamélej…), temas.
Trae el texto del daf de Sefaria (la red lo permite):
`curl -s "https://www.sefaria.org/api/v3/texts/Berakhot.7a?version=hebrew" | python3 -c "import json,sys,re; d=json.load(sys.stdin); [print(re.sub('<[^>]+>','',t)) for t in d['versions'][0]['text']]"`
(también sirve `.../Berakhot.7a?version=english` para ubicarte; otras obras: `Nedarim.31b`, `Horayot.10a`, `Likutei_Moharan.19`…). Úsalo para reconstruir con exactitud las citas que el rabino lee.

## 2. Pulido (corrección CONSERVADORA, no redacción)
- Mismo número de segmentos, mismo orden; los timestamps no se tocan (los pone el script). Solo corriges `text`.
- Corrige errores de reconocimiento, puntuación, separación de palabras, mayúsculas, nombres y términos.
- Hebreo y arameo SIEMPRE en transliteración latina estándar (sefardí, estilo español): Hashem, Kadosh Baruj Hu, tefilá, Shemá, guemará, mishná, tzadik, teshuvá, Rabí Yojanán, "meematai korín et Shemá", "kol hakovea makom litfilató"… NUNCA letras hebreas.
- Detecta galimatías que en realidad son hebreo/arameo ("memat kor in shem" → "meematai korín"; "el rap mi tapextle todo" puede ser "rav mitapjim le-tov"… solo si el contexto y Sefaria lo confirman). Si la Guemará se lee en voz alta, alinéala con el texto de Sefaria (transliterado).
- No traduzcas, no resumas, no reordenes, no inventes, no agregues explicaciones. Muletillas y repeticiones se quedan (puedes limpiar tartamudeos obvios "que que que" → "que").
- Si un fragmento es irrecuperable, escribe `[inaudible]` en esa parte (no adivines).
- Etiquetas de hablante: no las incluyas en el texto.

## 3. Escritura de la salida (en partes, para no exceder límites)
Crea la carpeta (`mkdir -p data/polished/parts/{id} data/rename-log.d`) y escribe con la herramienta Write archivos `data/polished/parts/{id}/000.json`, `001.json`, … cada uno con ~120 segmentos:
`[{"i": 0, "text": "..."}, {"i": 1, "text": "..."}, ...]`  (i = índice del segmento en data/segments, desde 0). JSON válido (escapa comillas).
Luego `data/polished/parts/{id}/meta.json`:
```json
{"summary": "2-3 oraciones en español", "tags": ["5-10 tags cortos en español"], "daf": [{"daf": "ז", "amud": "א"}], "title": "...", "newName": "..."}
```
Valida: `python3 scripts/merge-polished.py {id}` → debe imprimir OK. Si FAIL, corrige y repite.

## 4. Título nuevo (según el contenido real de la transcripción pulida)
Formato EXACTO: `{order}. ברכות {daf} ע׳׳{amud} - {temas}` + extensión original (`ext` del inventario; si el nombre original no tenía extensión, no agregues).
- `order` = el del inventario, tal cual (ej. "4.2", "38").
- daf en letras hebreas sin puntuación (ג, יא, יג); amud `ע׳׳א` o `ע׳׳ב` (usa el carácter ׳ U+05F3 dos veces). Si abarca dos amudim: `ברכות ג ע׳׳א-ע׳׳ב`. Si abarca dos dapim: `ברכות ט ע׳׳ב-י ע׳׳א`.
- Si la clase NO es de Berajot (ej. Nedarim, Horayot, Meguilá, Likutey Moharán), pon la obra real en lugar de ברכות (נדרים לא ע׳׳ב / ליקוטי מוהר״ן יט). Si es Berajot pero el foco es otra fuente, mantén el daf de Berajot que se estudia.
- temas: 2-5 temas principales EN HEBREO, breves, separados por coma o punto. Ej: `10. ברכות ג ע׳׳א - רבי יוסי חורבה, גלות גאולה. תפילה.m4a`
- Sin `/`, `:` ni comillas dobles ASCII en el nombre.
`title` = newName sin extensión.

- El título se basa en el CONTENIDO: si la clase estudia otro daf distinto al del nombre original, usa el daf real. Si el fragmento no permite determinar el daf (p. ej. es un pedazo de otra clase), conserva el daf del nombre original y dilo en el reporte.
- Si más del 20% de los segmentos llevan [inaudible], agrega `"needsReview": true` a meta.json y dilo en el reporte.

## 5. Renombrar en Drive (directamente, sin pedir aprobación)
Solo después de que merge diga OK:
- Audio: `mcp__Google_Drive__update_file` fileId={id}, title=newName.
- Si `mdId` existe: update_file fileId={mdId}, title = title + ".md".
- Si NO existe .md: `mcp__Google_Drive__create_file` title = title + ".md", parentId `1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5`, contentMimeType `text/markdown`, disableConversionToGoogleType true, textContent = markdown generado con `python3 scripts/polished-to-md.py {id}` (cat de su salida; si es muy largo, usa base64Content con referencia de archivo `sha256:<hex>:<ruta absoluta>` del archivo generado en data/md-out/{id}.md).
- Registra en `data/rename-log.d/{id}.json`: `[{"id":..., "kind":"audio", "oldName":..., "newName":..., "at": ISO}, {"id": mdId, "kind":"md", ...}]`.

## 6. Reporte final (máx 6 líneas)
id, newName, nº segmentos, % segmentos cambiados, daf, 1 línea con problemas/dudas (ej. pasajes [inaudible], dudas de daf).
