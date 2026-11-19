# Champiñones: implementación

Página `/champinones` + `POST /api/champinones` (ndjson). Metodología: `metodologia.md`; prompt fijo: `prompts/champinones.md` (se carga del archivo en cada llamada, versión `champinones-v1`); diseño original: `implementacion.md`.

## Pipeline (`lib/champinones/pipeline.ts`)
1. **Idioma/términos** (gpt-4.1-mini, JSON estricto): idioma de la pregunta, idioma pedido explícitamente (también por heurística en `text.ts`: "respond in English", "responde en hebreo", `ענה בעברית`), 3-6 términos hebreos, refs probables, consulta/keywords en español para los shiurim. Idioma de la respuesta = selector de la UI > petición explícita > idioma de la pregunta.
2. **Shiurim** (`shiurim.ts`): `hybridSearch` + FTS "champiñ <kw>" + ventanas de las clases cuyo daf coincide con las refs; ventanas de ~8 segmentos (~1 min) con `classId/startMs`; los pasajes con "champiñ" suben.
3. **Sefaria** (`sefaria.ts`): textos he+en (`/api/v3/texts`, `return_format=text_only`; traducción en el idioma de la respuesta si Sefaria la tiene), `/api/related` y `/api/links` (pesukim citados, paralelos), `/api/search-wrapper` con los términos hebreos (Bavli según alcance + Tanaj). Tope 16 segmentos. Caché memoria+disco 7 días, 6 en paralelo, reintentos 5xx/429.
4. **Pasada 1 (ganchos)**: gpt-4.1-mini sobre los textos + lista de solapamientos léxicos calculada en servidor; los candidatos se verifican (hook en ambos textos) y pueden pedir hasta 3 refs más de la lista de links.
5. **Pasada 2 (profundidad)**: `prompts/champinones.md` como system, `response_format` json_schema strict (`types.ts`), por defecto gpt-5.2 `medium` (modelos y esfuerzo seleccionables; si el modelo no existe cae a gpt-5-mini). Streaming interno para emitir progreso.
6. **Validación** (`validate.ts`, puro y testeado): ref en contexto, `hebrew_excerpt` literal (se repara con la ventana más parecida o se descarta el nodo), `hook_text` en ambos extractos (si sólo está en el texto completo: fuerza ≤2 y marca; si no está: se descarta el link), `strength 3` sólo con palabras no triviales, `shiur_refs` reales (clase existe, `startMs` dentro de un segmento y de un pasaje dado), nodos huérfanos fuera, idioma. Si >25% inválido o idioma equivocado: un reintento con la lista de problemas.
7. **Almacenamiento**: `$CHAMPINONES_DIR`, si no `$STORAGE_DIR/champinones` (volumen de Railway en `/data`), si no `data/.cache/champinones` (local): `results/<id>.json` (30 días; id = hash de pregunta+idioma+modelo+esfuerzo+alcance+clase+versión del prompt) y `sefaria/`. Sin escritura disponible cae a `os.tmpdir()`.

## API
- `GET /api/champinones` opciones/modelos. `POST /api/champinones {question, language?, model?, effort?, scope?: "berakhot"|"shas", classId?, refresh?}` → ndjson `status|progress|result|error`.
- `GET /api/champinones/:id` JSON; `?format=html[&download=1]` HTML autónomo (CSS inline, SVG, sin dependencias; las fuentes de Google son opcionales).
- Página: `/champinones?r=<id>` (enlace compartible), `?q=` (precarga), `?class=<id>` (prioriza una clase).

## Vista (`lib/champinones/render.ts`)
Un único renderizador de HTML se usa en la app (inyectado en `.champ`, tokens del sitio, claro/oscuro) y en el archivo descargable. Mapa SVG (nodos = pasajes, aristas = gancho en hebreo, grosor = fuerza, clic para enfocar), tarjetas de pasaje y de conexión (superficie → profundidad), capas, síntesis, lección, momentos del shiur (▶ `usePlayer().playAt` + enlace `/shiur/<id>?t=`), preguntas abiertas y salvedades.

## Tests / operación
`npx tsx --test tests/champinones.test.ts`. Requiere `OPENAI_API_KEY` (y `HTTPS_PROXY` si aplica). Skill de Claude Code: `.claude/skills/champinones/SKILL.md`. Precios en `models.ts` son de referencia (verificar).
