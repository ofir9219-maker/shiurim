# Champiñones en la web: pipeline recomendado

Objetivo: el usuario escribe un tema o pregunta ("¿qué conecta la barba de Rabí Elazar ben Azaryá con el sueño de Rabán Gamliel?", "tefilá y cama", "Jizkiyahu y la pared") y la app devuelve un análisis de champiñones —pasajes reales, ganchos textuales, profundidad, momentos del shiur— como JSON validado que se dibuja como mapa + tarjetas + línea de tiempo.

Referencias: metodología en `docs/champinones/metodologia.md`; prompt fijo de la pasada 2 en `prompts/champinones.md`. Stack actual: Next.js en Railway, SQLite (`lib/db.ts`, tablas `classes`, `segments`, `segments_fts`, `chunks` con embeddings), `hybridSearch` (`lib/search.ts`), proveedor LLM en `lib/chat-llm.ts` (`OPENAI_API_KEY`, `CHAT_MODEL`), audio vía `usePlayer().playAt(classId, startMs)`.

## 1. Vista general

```
pregunta ──► 0. normalizar (idioma, entidades, términos hebreos)          [LLM barato o heurística, ~1 s]
          ├► 1a. shiurim: hybridSearch + índice de champiñones del rabino  [local, <100 ms]
          ├► 1b. Sefaria: refs ancla (daf de las clases + refs nombrados)  [5–8 fetches en paralelo]
          └► 1c. Sefaria: ganchos (links/related + search-wrapper)         [4–10 fetches en paralelo]
             2. armar contexto (≤ 12 nodos candidatos, ≤ ~14k tokens)
             3. Pasada 1 (LLM): ganchos candidatos (JSON corto)            [~5–10 s]
             4. fetch de las refs nuevas que pidió la pasada 1             [0–4 fetches]
             5. Pasada 2 (LLM): prompts/champinones.md → JSON estricto     [~15–30 s, en streaming de estado]
             6. validar (refs, extractos, timestamps) + caché + render
```

Ruta sugerida: `POST /api/champinones` `{question, classId?, model?}` → ndjson como `/api/chat`: `{"type":"status","stage":"sefaria"}` … `{"type":"result","data":{…JSON…},"cached":false}`. Página: `/champinones` (+ botón "Champiñones de esta clase" en `/shiur/[id]`, que pasa `classId`).

## 2. Paso 0: normalizar la pregunta

- Detectar idioma (`question_language`) con una heurística (caracteres hebreos → `he`; stopwords es/en/fr) y confirmarlo en la pasada 1.
- Extraer entidades: nombres (Rabí Elazar ben Azaryá, Jizkiyahu), términos transliterados (*tefilá*, *mitá*, *jivartá*), refs explícitas ("Berajot 10b", "Bereshit 41") → resolverlas con `GET https://www.sefaria.org/api/name/<texto>` (`is_ref`).
- Generar 3–6 formas hebreas/arameas de los términos clave (מטה, תפלה, חיורתא) para la búsqueda en Sefaria. Lo más barato es pedirlo en la misma llamada de la pasada 1 sobre un "contexto preliminar", pero da mejor recall hacerlo antes con un modelo mini (≈300 tokens de salida, <1 s). Mantener un diccionario local translit → hebreo con los ~300 términos más frecuentes del corpus (se puede extraer de los `tags` y del texto pulido) para no depender del LLM.

## 3. Paso 1: elegir pasajes candidatos

### 1a. Dónde el rabino ya hizo champiñones (shiurim)

1. **Índice curado de champiñones** (nuevo, offline, una sola vez): tabla `champinones(class_id, start_ms, end_ms, refs_json, hook_text, hook_type, summary)` con las ~144 apariciones de "champiñ" en `data/segments` + `data/md` (¡no sólo `data/polished`: allí muchas quedaron como `[inaudible]`!) y las frases equivalentes ("la misma palabra", "el mismo lashón", "paralelo", "kesher entre…"). Se genera con un script que toma una ventana de ±3 min y le pide a un LLM `{refs, hook, depth}` en JSON; se revisa a mano (es ~1 hora de revisión). Este índice es la señal más valiosa: son los champiñones "de la casa".
2. `hybridSearch(question_rewritten, 12)` sobre el transcript (FTS + vectores). Reescribir la consulta en el estilo del transcript (transliterado, español).
3. Puntuación: `score = rrf(hybrid) + 0.5·[hit en índice champiñones] + 0.3·[la ventana contiene "champiñ|mismo lashón|misma palabra|paralelo"] + 0.2·[clase con classId pedido]`. Quedarse con 4–6 extractos de ~60–90 s (expandir a segmentos vecinos como hace `/api/chat`), cada uno con `classId`, `startMs`, título, daf y mm:ss.
4. De cada extracto se obtienen **refs ancla**: el `daf` de la clase (`classes.daf`, p. ej. ח ע״א → `Berakhot 8a`) y refs del índice curado.

### 1b. Textos ancla (Sefaria)

- `GET /api/v3/texts/{ref}?version=hebrew` y `?version=english` (o `version=english|Sefaria Community Translation` según disponibilidad). Pedir el **amud completo** sólo una vez y recortar a segmentos (`Berakhot 28a:1-3`) en el servidor.
- Elegir el bloque: segmento con mejor coincidencia de términos hebreos + sus 2–3 memrot vecinas (la unidad natural del método son 3–5 memrot contiguas).

### 1c. Ganchos textuales (Sefaria)

Para cada segmento ancla (máx. 3):
- `GET /api/links/{ref}?with_text=0` → filtrar `category` ∈ {Tanakh, Talmud, Midrash, Chasidut (Likutei Moharan)}; `Tanakh` da los pesukim citados (proof texts), `mesorat hashas` da paralelos en otros masejtot. Es el gancho `same_verse` / `same_phrase` gratis.
- `GET /api/related/{ref}` sólo si hace falta (devuelve links + sheets + topics; útil para topics).
- **Palabras raras compartidas**: tokenizar el hebreo sin nikud del bloque, quitar stopwords y prefijos (ו ה ב ל מ ש כ), y para cada palabra candidata pedir su frecuencia en el Bavli con `POST /api/search-wrapper` (`{"query": w, "type":"text", "field":"naive_lemmatizer", "filters":["Talmud/Bavli"], "filter_fields":["path"], "size":10}`; `hits.total` = frecuencia; `_id` = "Ref (versión)"). Palabras con pocos hits (p. ej. חיורי ≈ 70 en todo el Bavli) son candidatas a `rare_form`/`same_word`; los hits dentro de Berajot o en el Tanaj citado son candidatos a nodo. Esto replica el criterio del seder: "¿qué tan común es la palabra *lirdof*?". Cachear la frecuencia por palabra para siempre.
- **Pre-cómputo recomendado (offline)**: bajar una vez todo Berajot (128 amudim, hebreo+inglés) y los pesukim que cita (vía links). Guardar en SQLite (`sefaria_text(ref, he, en, fetched_at)`), con un índice de lemas por segmento y un IDF calculado sobre el Bavli. Con eso, los ganchos `same_word`/`rare_form`/`shared_root` *dentro de Berajot* salen de una consulta local en milisegundos, y sólo se va a Sefaria para Tanaj/otros masejtot.

### Presupuesto de fetches por pregunta (sin caché)

| Qué | Llamadas |
|---|---|
| texto ancla (amud he + en) | 2–4 |
| links de 2–3 segmentos ancla | 2–3 |
| textos linkeados elegidos (pesukim, paralelos) | 3–6 |
| frecuencias search-wrapper (sólo palabras no cacheadas) | 0–8 |
| refs adicionales pedidas por la pasada 1 | 0–4 |
| **Total** | **~8–20** (con Berajot precargado: **~3–8**) |

Paralelizar con `Promise.allSettled`, timeout 6 s, reintento ×3 en 5xx/429 con backoff 0.5/1/2 s, concurrencia máx. 6. Si Sefaria falla, seguir sólo con los textos cacheados y avisarlo en `caveats`.

## 4. Pasadas LLM

### Pasada 1 — ganchos candidatos (modelo barato)

Entrada: pregunta + bloque ancla + textos linkeados + frecuencias + 4–6 extractos de shiur (truncados a ~600 caracteres). Salida JSON corta:

```json
{"question_language":"es","anchor_refs":["Berakhot 28a:1"],
 "candidates":[{"a":"Berakhot 28a:1","b":"Berakhot 28a:3","hook_type":"rare_form","hook_text":"חיור","why":"…"}],
 "need_refs":["Berakhot 11a:15"], "hebrew_terms":["חיורתא","תוכו כברו"]}
```

Prompt de sistema (corto, fijo): "Eres el detector de ganchos de la metodología champiñones. Con el 'chip apagado' lista sólo coincidencias literales o estructurales entre los textos dados (misma palabra, forma rara, raíz, frase, pasuk, nombre, número, imagen, estructura, rol). No expliques. Prioriza palabras raras (usa las frecuencias). Máximo 10 candidatos, cada uno con `hook_text` copiado literalmente de ambos textos. `need_refs`: hasta 4 refs (formato Sefaria) que quieras leer para confirmar; sólo refs que aparezcan en links o en los textos. JSON estricto."
Validar en el servidor: `hook_text` debe aparecer (sin nikud ni prefijos) en ambos textos; descartar los que no.

### Pasada 2 — profundidad + JSON final (modelo mejor)

Sistema: `prompts/champinones.md` (fijo, versión `champinones-v1`). Usuario: bloque `CONTEXT` (formato en la sección 6 del prompt) con ≤ 12 textos (he + en recortado) + extractos de shiur + candidatos validados de la pasada 1.
OpenAI: `response_format: {type: "json_schema", json_schema: {name: "champinones", strict: true, schema}}` con el mismo esquema que el prompt (todas las claves `required`, opcionales como `["string","null"]`). Modelos de razonamiento: `reasoning_effort: "medium"`, `max_completion_tokens` ≈ 6000; no razonadores: `temperature: 0.3`.

### Validación posterior (obligatoria; es lo que garantiza "no inventar")

1. `nodes[].ref` ∈ refs del contexto → si no, eliminar el nodo y sus links, y añadir un caveat.
2. `hebrew_excerpt` sin nikud debe ser substring (tolerando "…") del texto de esa ref → si no, reemplazarlo por el fragmento más parecido (ventana de 20 palabras con mayor solapamiento) y marcarlo.
3. `hook_text` presente en los dos extremos (salvo `structure`/`scene_role`/`concept`) → si no, bajar `strength` a 1 y avisar.
4. `shiur_refs[].classId/startMs` ∈ extractos dados → si no, eliminar.
5. Idioma: si `answer_language` ≠ idioma detectado y el usuario no lo pidió, reintentar una vez con un mensaje de corrección.
6. Si el JSON no parsea: 1 reintento con "Return only valid JSON for the schema"; si vuelve a fallar, modo sin IA (mostrar extractos del shiur + links de Sefaria).

## 5. Costo y latencia (estimación por pregunta, sin caché)

Tokens: el hebreo con nikud tokeniza caro (~3–4× el español); recortar a segmentos y **quitar nikud y cantilación** antes de mandar (≈ −40 % de tokens).

| | Entrada | Salida |
|---|---|---|
| Paso 0 (opcional, mini) | ~0.5k | ~0.3k |
| Pasada 1 | ~8–12k | ~0.8k |
| Pasada 2 | ~10–15k | ~2.5–4k (+ razonamiento) |

Con precios de referencia de OpenAI vigentes al escribir esto (verificar en la página de precios antes de decidir): pasada 1 con `gpt-4.1-mini` (~US$0.40/M in, ~US$1.60/M out) ≈ **US$0.005**; pasada 2 con `gpt-4.1` (~US$2/M in, ~US$8/M out) ≈ **US$0.06**, o con `gpt-4.1-mini` ≈ **US$0.012**. Total típico **US$0.02–0.08 por análisis**; 1.000 análisis/mes ≈ US$20–80.
Latencia: Sefaria 1–3 s (paralelo; ~0.2 s con caché), pasada 1 4–8 s, pasada 2 12–30 s → **20–40 s** en frío; mostrar progreso por etapas ("Buscando en los shiurim… Leyendo Berajot 28a… Buscando ganchos… Profundizando…"). Con caché de resultado: <300 ms.

## 6. Caché

- **Sefaria**: SQLite aparte y escribible (`data/cache.db` en un volumen de Railway; la base de shiurim se abre en solo lectura): `sefaria_text(ref PK, version, he, en, fetched_at)` TTL 30 días; `sefaria_links(ref PK, json, fetched_at)` TTL 30 días; `word_freq(word PK, corpus, total)` sin vencimiento. Precargar Berajot completo en el build (script `scripts/fetch-sefaria-berakhot.ts`) y commitear el JSON resultante (`data/sefaria/Berakhot.*.json`, ~3–4 MB) para no depender de la red en el arranque.
- **Resultados**: `champinones_result(key PK, question, lang, json, model, prompt_version, created_at)` con `key = sha256(normalize(question) + lang + classId + model + prompt_version)`; TTL 90 días; invalidar al cambiar `prompt_version`. Guardar también los resultados aprobados por el usuario (👍) como **ejemplos** para mostrar en la portada.
- **Memoria**: LRU en proceso (200 entradas) delante de SQLite.
- **Precomputar** el análisis por clase ("Champiñones de esta clase") para las 82 clases en un job nocturno: ~82 × US$0.05 ≈ US$4, y la página de clase queda instantánea.

## 7. Vista HTML

Página de resultado, tres zonas que comparten selección (hover/click en un nodo o link resalta lo mismo en las tres):

1. **Mapa de conexiones** (arriba, ancho completo; en móvil, colapsable).
   - Nodos = pasajes: tarjeta pequeña con `label` + ref; color por `work` (Bavli dorado `var(--gold)`, Tanaj azul, Midrash/Rashi verde, Likutey Moharán violeta); borde grueso para `role: anchor`.
   - Aristas = `links`: grosor por `strength` (1 punteada, 2 normal, 3 gruesa); etiqueta = `hook_text` en hebreo (fuente hebrea, `dir="rtl"`) con icono por `hook_type` (palabra, raíz, frase, número, imagen, estructura…).
   - Layout: SVG propio con disposición radial (ancla al centro) o `d3-force` con ≤ 10 nodos; sin dependencias pesadas.
   - Interruptor "Superficie / Profundidad": en modo superficie las aristas muestran sólo el gancho; en profundidad se ilumina la capa (`layers`) seleccionada.
2. **Tarjetas** (columna principal):
   - Resumen (`summary`) y chips de idioma/modelo.
   - Una tarjeta por link, ordenadas por fuerza: cabecera "Gancho: חיור · jivar · blanco" + tipo; dos columnas con los extractos de cada nodo (hebreo RTL grande, transliteración en cursiva, traducción), con la palabra del gancho **resaltada** en ambos (marcar `hook_text` dentro de `hebrew_excerpt`); luego "Superficie" y "Profundidad" (esta última plegable, abierta por defecto) y chips de `depth_moves`. Botón "Ver en Sefaria" (`https://www.sefaria.org/{ref con _}`) y "Escuchar en el shiur" si el link tiene `shiur_ref_indexes`.
   - Capas (`layers`) como acordeón de lo textual a lo práctico; `synthesis` destacada; `practical_lesson` en un recuadro.
   - `open_questions` y `caveats` al final, con estilo discreto (honestidad visible).
3. **Línea de tiempo de shiurim** (lateral en escritorio, debajo en móvil): cada `shiur_ref` como fila "Clase 64 · 17:32 · título" + `why`; click → `usePlayer().playAt(classId, startMs)` y enlace a `/shiur/[id]?t=<s>`. Agrupar por clase en orden; marcar con un icono 🍄 los momentos que vienen del índice curado (champiñones del rabino) vs. los hallados por búsqueda.

Detalles: usar los tokens de color existentes (`--ink`, `--gold`, `--bg`, `--card`, `--line`, `--text`, `--muted`); fuente hebrea (p. ej. Frank Ruhl Libre vía Google Fonts) sólo para `lang="he"`; `dir="auto"` en los textos del usuario; botón "Copiar/Exportar" (JSON y Markdown); "¿Te sirvió?" para alimentar ejemplos. Accesibilidad: el mapa tiene una lista equivalente para lectores de pantalla (las tarjetas ya lo son).

## 8. Plan de implementación (orden sugerido)

1. Script del índice curado de champiñones del rabino (desde `data/segments` + `data/md`) y revisión manual.
2. Precarga de Berajot desde Sefaria + `word_freq` + `lib/sefaria.ts` (fetch con caché, reintentos, recorte de segmentos, quitar nikud).
3. `lib/champinones.ts`: candidatos (1a–1c) → pasada 1 → pasada 2 → validación; tests con fetch mockeado (como `tests/chat*.test.ts`) usando los ejemplos de `metodologia.md` (Berakhot 28a, Megillah 19b, Berakhot 7b) como casos dorados: el análisis debe encontrar `חיור`, `אורה`, `פני`.
4. `POST /api/champinones` (ndjson) y página `/champinones` + entrada desde `/shiur/[id]`.
5. Job nocturno de precomputación por clase y caché de resultados.
