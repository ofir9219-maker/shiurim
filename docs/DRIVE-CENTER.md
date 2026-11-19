# Centro de transcripción de Drive (guía de administración)

> Fase 1: carpeta General, series (colecciones), explorador `/admin/drive`, transcripción con Fal y salidas `.md`/`.json` en Drive. Las secciones siguientes se completan en las fases 2–4. El resto de este documento es la guía técnica de la ingesta original (que sigue vigente: la serie «ברכות שר לשמחה» es la colección #1).

## Uso rápido (Fase 1)
1. Entra a `/admin` → **Centro de transcripción de Drive** (`/admin/drive`).
2. **Carpeta General**: la primera vez eliges, navegando por tu Drive, la carpeta que contiene tus series (se guarda en `$STORAGE_DIR/center.json`). Se puede cambiar cuando quieras.
3. **Series**: pulsa «⚙ Ajustes» en cualquier carpeta y guarda: esa carpeta pasa a ser una serie (`$STORAGE_DIR/collections.json`). Cada ajuste puede quedar en «Heredar»: se toma de la serie superior más cercana (se muestra «heredado de …») o de los valores del sistema. Ajustes: modelo Fal (Scribe v2 por defecto, Scribe v1, Wizper, Whisper), idioma, sincronización automática, posproceso (sin pulido / OpenAI), modelo y esfuerzo OpenAI, nombres (mantener / plantilla) y **Publicar en la web** (por carpeta).
4. **Transcribir**: marca carpetas o audios → «Transcribir selección» → se muestra el **estimado** (minutos, costo Fal por modelo, OpenAI aproximado, tiempo) → «Confirmar y encolar». Las carpetas se recorren recursivamente. Los audios que ya tienen un `.md` (p. ej. de Plaud) se re-transcriben con Fal.
5. Resultado en Drive junto al audio, **mismo nombre base**: `<nombre>.md` (formato de `polished-to-md.py`, crudo si no hay pulido) y `<nombre>.json` (`{version, audioId, model, segments:[{startMs,endMs,text}], summary?, tags?, meta}`). Si existen se actualizan; nunca se borra un audio.
6. Estados: sin transcribir · en cola · transcribiendo · transcrito · pulido en curso · pulido · en Zona IA · error (reintentar / ver log / abrir en Drive / abrir en la web).
7. Auto-sync: las series con sincronización automática se revisan cada `INGEST_POLL_MINUTES` (recorrido por carpeta, sin la API de cambios); un audio nuevo se encola cuando su tamaño es estable en 2 revisiones y no tiene ya un `<nombre>.json` al lado.
8. Costos por serie en `/admin/drive` (estado) y totales en `/admin`.

### Plantillas de nombres (Fase 2)
En **Ajustes → Nombres de los archivos** eliges el modo (mantener / plantilla) y la plantilla de la serie (heredable). Variables: `{n}` (número inicial del nombre, o el siguiente libre de la serie), `{obra}`, `{daf}`, `{amud}` (junto a `{daf}` se escribe `{daf} ע׳׳{amud}` y se renderiza ע׳׳א / ע׳׳ב / rangos `ג ע׳׳א-ע׳׳ב`), `{temas}` (2–4 temas en hebreo, ≤ ~50 caracteres), `{tema_es}`, `{torá}`, `{parashá}`, `{fecha}` (fecha del archivo), `{original}` (nombre original sin número ni extensión) y `{ext}` (se agrega sola si no la pones). Predefinidas: **Guemará** `{n}. {obra} {daf} ע׳׳{amud} - {temas}`, **Likutey Moharán** `{n}. ליקוטי מוהר״ן {torá} - {temas}`, **Parashá** `{n}. {parashá} - {temas}`, **General** `{n}. {temas}`. El editor muestra una vista previa en vivo con una clase de ejemplo y los errores de la plantilla.

Al pulir, la IA recibe un JSON schema con *solo* las variables que la plantilla necesita; el servidor renderiza y valida el nombre (sin `/ \ : "`, prefijo de orden correcto, extensión, daf en letras hebreas, amud א/ב…) y reintenta con los errores. El audio, el `.md` y el `.json` se renombran juntos en Drive; cada renombrado queda en `data/rename-log.json` (por lote) y el botón **Deshacer renombrado** de cada archivo restaura los nombres anteriores. «Obra fija» permite fijar `{obra}` sin preguntarle a la IA.

El prompt de pulido (`prompts/polish.md` §7) se adapta a la serie; **Sefaria solo se consulta** en series de Guemará (`{daf}`), Likutey Moharán (`{torá}`) y Tanaj/Parashá (`{parashá}`).

### Zona IA: cómo usarla (reemplaza al «paquete por archivo»)
Con **Posproceso = Zona IA (JSON)** el servidor no llama a OpenAI: tras transcribir, cada clase se convierte en **jobs** de una cola central (`$STORAGE_DIR/ai-zone/`). Una IA los toma de ahí, los corrige y los devuelve; tú solo le das **un enlace**.

**Uso**
1. En `/admin` o `/admin/drive`, tarjeta **Zona IA** → **Copiar enlace para la IA**. El enlace es `https://ofirsegal.app/ia/<TOKEN>` (secreto: quien lo tiene puede leer y devolver jobs; no se comparte). **Regenerar enlace** crea uno nuevo y el anterior deja de funcionar.
2. Pégalo en una IA **agéntica con acceso a internet** (ChatGPT agent, Codex, Claude Code, etc.) con una frase como: «Entra a este enlace, lee las instrucciones y corrige todos los jobs pendientes hasta que la cola quede vacía». La IA lee la página, lista los jobs, toma uno (`claim`), lo corrige, lo envía y repite; si el servidor rechaza algo (`errors: [{where, problem}]`) corrige y reenvía.
3. **IA solo de chat (sin POST HTTP)**: también sirve. Abre `/ia/<TOKEN>/job/<job_id>` (página HTML sin JavaScript): muestra los datos del job en un bloque JSON y un formulario donde pegar el JSON corregido; la validación se muestra en la misma página. Las reglas están en `/ia/<TOKEN>`.
4. Cuando todas las partes de una clase están hechas, el servidor la aplica sola: escribe `.md`/`.json` en Drive con el mismo nombre base, renombra por la plantilla de la serie y la indexa en el sitio si la serie es pública.

**La página de la zona** (`/ia/<TOKEN>`, HTML plano renderizado en servidor, sin login ni JS; también `?format=json` y `/ia/<TOKEN>/llms.txt` en texto plano) contiene, en este orden: tabla de estado de la cola (pending/claimed/done/failed), qué es la zona y el flujo en pasos (español y luego inglés), las **reglas de corrección una sola vez** (de `prompts/polish.md`, por tipo de serie) + reglas de nombres (cómo se llenan las variables de la plantilla) + esquema JSON del resultado + ejemplo mínimo, y la referencia de la API con `curl`. Los jobs **ya no llevan prompt ni instrucciones**, solo datos.

**API** (el token del enlace es la autenticación; CORS abierto; cuerpo ≤ 5 MB; límite de peticiones por token, `AI_ZONE_RATE_PER_MIN`, 240 por defecto; token inválido = 404 y límite por IP)
- `GET  /api/ia/<TOKEN>/jobs?status=pending|claimed|done|failed|all` → `[{job_id, part, parts, series, title_hint, segments_count, status, claimed_until?}]` (`pending` incluye los rechazados que se pueden reintentar).
- `POST /api/ia/<TOKEN>/jobs/<job_id>/claim` → lease de **60 min**, devuelve el job + `lease_id`; repetir con `{"lease_id"}` lo renueva; `409` si otro lo tiene. `job_id = next` toma el primero disponible.
- `GET  /api/ia/<TOKEN>/jobs/<job_id>` → `{job_id, part, parts, series, series_kind, template, template_variables_required, needs_meta, allow_hebrew, context{daf_guess, sefaria_text, neighbors}, segments:[{i,startMs,endMs,text}], expected_result}`.
- `POST /api/ia/<TOKEN>/jobs/<job_id>/result` → cuerpo = JSON corregido (`{format:"shiurim-ai-result/v1", job_id, segments, meta?}`); respuesta `{ok:true, applied}` o `422 {ok:false, errors:[{where, problem}]}`.
- `POST /api/ia/<TOKEN>/jobs/<job_id>/release` → suelta el lease. Un lease vencido devuelve el job a *pending* solo.

**Validación** (igual que `merge-polished.py` + variables de la plantilla): `job_id`, cantidad/orden/`i`/`startMs`/`endMs` de los segmentos, textos no vacíos, sin letras hebreas (salvo que la serie lo permita), `meta` en la parte 1 (resumen, ≥3 tags, variables del nombre válidas, nombre sin `/ \ : "`). Si falla, **no se aplica nada**; si es válido reemplaza al resultado anterior de ese job. Clases largas: partes de ~250 segmentos (`AI_ZONE_PART_SEGMENTS`), solo la parte 1 lleva `meta`; las partes llevan como contexto los segmentos frontera de la anterior/siguiente.

**Admin**: la tarjeta Zona IA muestra el conteo de la cola y, en `/admin/drive`, cada job con su estado, quién lo tiene tomado y hasta cuándo, los errores del último envío, y los botones **Reabrir** (vuelve a pendiente y borra el resultado) y **Descartar** (sale de la cola; la clase no se aplica hasta reencolarla). **Ajustes → Zona IA: copiar también a Drive** (por serie, apagado por defecto) escribe además `<nombre>.ai.json` (solo datos) junto al audio; esos jobs también se recogen de `<nombre>.ai.corregido.json` en Drive (revisión cada ~2 min o **Buscar corregidos en Drive**).

**Enlace**: se guarda solo su hash (`$STORAGE_DIR/ai-zone/token.json`) más una copia cifrada con `ADMIN_PASSWORD` para poder copiarlo de nuevo (si cambias la contraseña, regenera el enlace). `AI_ZONE_TOKEN` (opcional) fija el enlace desde el entorno y deshabilita «Regenerar».

**Migración**: los paquetes por archivo pendientes se importan solos como jobs (id = `package_id`) la primera vez que arranca el servidor; las rutas viejas `/api/paquete/<token>` y `/subir/<token>` siguen funcionando para ellos (mismo resultado, formato de respuesta anterior). Los paquetes nuevos ya no se crean.

**Demo de punta a punta**: `STORAGE_DIR=/tmp/z AI_ZONE_TOKEN=<token> npx tsx scripts/ia-zone-seed.ts` crea un job con una clase real corta; con el servidor corriendo, `OPENAI_API_KEY=… npx tsx scripts/ia-agent-demo.ts http://localhost:3123/ia/<token> [--inject-error]` hace que un modelo real lea `llms.txt`, tome el job, lo corrija, lo envíe y maneje los errores de validación, partiendo solo de la URL.

### Sitio público con varias series (Fase 4)
- **Publicar en la web** se decide por carpeta/serie (Ajustes → Serie y publicación). Solo las series publicadas llegan a la base del sitio (`classes.collection_id`; `scripts/build-db.ts` filtra por `collections.json`, también al arrancar con `npm run start:prod`). Al publicar/despublicar una serie el servidor copia sus audios a R2 (si faltan) y reconstruye la base.
- `/` muestra una **cuadrícula de series** publicadas; si solo hay una, redirige a ella. Cada serie vive en `/c/<slug>` (la home original de Berajot es `/c/berajot`); las clases siguen en `/shiur/<id>`.
- **Búsqueda, chat y champiñones** tienen un filtro de series (chips «Todas / serie…», visible solo con 2+ series publicadas; se recuerda en `localStorage["shiurim:series"]`). Por defecto buscan en todas las publicadas. APIs: `GET /api/search?c=slug1,slug2`, `POST /api/chat {collections:[…]}`, `POST /api/champinones {collections:[…]}`, `GET /api/classes?collection=slug`, `GET /api/series`.
- Las clases nuevas aparecen sin reiniciar: tras indexarse, el paso final ejecuta `build-db` (incremental para embeddings).

## Variables de entorno nuevas
Ninguna obligatoria. Opcionales: `PUBLIC_BASE_URL` (por defecto `https://ofirsegal.app`, base del enlace de la Zona IA), `AI_ZONE_TOKEN` (fija el enlace de la Zona IA), `AI_ZONE_RATE_PER_MIN`, `AI_ZONE_PART_SEGMENTS`, `FAL_USD_PER_MIN`, `FAL_USD_PER_MIN_SCRIBE_V1`, `FAL_USD_PER_COMPUTE_SEC_WIZPER`, `FAL_USD_PER_COMPUTE_SEC_WHISPER`, `FAL_WIZPER_COMPUTE_SEC_PER_MIN`, `FAL_WHISPER_COMPUTE_SEC_PER_MIN` (precios del estimado), `POLISH_USD_PER_M_IN/OUT`. Archivos nuevos en el volumen: `center.json`, `collections.json`, `ai-zone/` (token, `jobs.json`, `jobs/`, `results/`), `center/durations.json`.

## Pruebas
`npm run test:ingest` (unidad de la ingesta original), `npm run test:center` (colecciones/herencia, normalización de Fal por modelo, plantillas, Zona IA (`tests/zone.test.ts`), series, y un e2e con Drive/Fal/R2 simulados; con `OPENAI_API_KEY` también pule con OpenAI real).

Modelos Fal: partes de 19 min para Scribe (palabras con tiempos), 25 min para Wizper/Whisper (segmentos ≤29 s); todos se normalizan al mismo formato `{startMs,endMs,text}` (`lib/center/fal-models.ts`). Precios por defecto: Scribe v2 US$0.008/min, Scribe v1 US$0.03/min, Wizper/Whisper ≈ US$0.0011 por segundo de cómputo (estimado ~4–8 s de cómputo por minuto de audio); ajustables con `FAL_USD_PER_MIN`, `FAL_USD_PER_MIN_SCRIBE_V1`, `FAL_USD_PER_COMPUTE_SEC_WIZPER`, `FAL_WIZPER_COMPUTE_SEC_PER_MIN`, etc.

---
# Ingesta automática original (Drive → R2 → Fal → OpenAI → sitio)

Cuando se sube un audio nuevo a la carpeta de Drive `1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5`, el servidor (siempre encendido en Railway) lo detecta, lo transcribe, lo pule siguiendo `prompts/polish.md`, lo renombra en Drive, crea el `.md` y lo publica en el sitio, sin aprobación humana.

## Flujo (máquina de estados por archivo)

`detected → uploaded → transcribed → polished → renamed → indexed`

| Paso | Qué hace | Código |
|---|---|---|
| detectar | Scheduler (`instrumentation.ts`) lista la carpeta cada `INGEST_POLL_MINUTES` (10). Nuevo = id que no está en `data/inventory.json` ni en `$STORAGE_DIR/data/inventory.json` ni en el estado. Se exige el mismo tamaño en 2 revisiones seguidas (subida terminada); mientras haya archivos creciendo revisa cada 90 s. `order` = número inicial del nombre (como `build-inventory.py`); si falta, max existente + 1. | `lib/ingest/scheduler.ts`, `naming.ts` |
| uploaded | Descarga de Drive (OAuth), duración con ffmpeg, sube el original a R2 como `shiurim/<driveId><ext>`. | `pipeline.ts`, `lib/r2-sync.ts` |
| transcribed | ffmpeg → partes mono mp3 ≤19 min → `tmp/<id>/partNN.mp3` en R2 → Fal Scribe v2 (cola REST, `spa`) → words con offsets → segmentos (`normalize.py`). Huecos >40 s y segmentos "huecos" (>45 s con <4 car/s) se recortan, se transcriben y se agregan como gap-fill (`find-gaps.py` + `gaps-to-segments.py`). Raw intacto. | `fal.ts`, `ffmpeg.ts`, `segments.ts` |
| polished | Pasada 0 (contexto: daf, nombres, citas) → texto del daf en Sefaria → lotes de ~100 segmentos (JSON estricto `{items:[{i,text}]}`) con vecinos → validación idéntica a `merge-polished.py` (conteo, sin hebreo, no vacío) con 1 reintento de reparación → meta (resumen, tags, daf, título). Título `{order}. {obra} {daf} ע׳׳{amud}[-…] - {temas}{ext}` validado (U+05F3 ×2, sin `/ : "`). `needsReview` si >20% `[inaudible]`. | `polish.ts`, `prompts.ts`, `naming.ts` |
| renamed | Renombra el audio en Drive; si existe un `.md` con el nombre viejo lo renombra, si no crea `<título>.md` (mismo formato que `polished-to-md.py`). Registra en `rename-log.json`. | `pipeline.ts`, `drive.ts`, `md.ts` |
| indexed | Agrega la clase a `inventory.json` del volumen y ejecuta `build-db` (`--embed` si hay `OPENAI_API_KEY`): inserta clase, segmentos, FTS, chunks y embeddings (solo los chunks nuevos, por hash). La clase aparece en inicio, búsqueda y chat sin reiniciar. | `scripts/build-db.ts` |

Concurrencia 1, cada paso es idempotente y los artefactos intermedios se guardan (partes Scribe, lotes pulidos), así que un reinicio o un fallo reanuda donde quedó. Reintentos con backoff exponencial (1, 2, 4… hasta 60 min); tras 8 fallos queda `failed` y se reintenta desde `/admin`.

## Datos en el volumen (`$STORAGE_DIR`, por defecto `./storage`; en Railway `/data`)

```
shiurim.db                     base SQLite (DB_PATH por defecto = $STORAGE_DIR/shiurim.db cuando STORAGE_DIR está definido)
google-token.json              refresh token OAuth (0600)
ingest/state.json              estado, logs y costos por clase
data/inventory.json            clases nuevas (mismo formato que data/inventory.json)
data/{raw,segments,polished,gapfill,gapfill-raw,gaps,md-out}/<id>.json|md
data/gaps-hollow.json, data/rename-log.json
work/<id>/                     temporales (se borran al terminar)
```

`npm run start:prod` (Railway) construye la DB al ARRANCAR desde `data/` del repo + `$STORAGE_DIR/data` (reutiliza embeddings por hash: reinicios rápidos y baratos) y luego `next start`. El primer arranque con volumen vacío embebe todos los chunks una vez (≈7000; por eso `healthcheckTimeout` es 900 s). En local sin volumen todo sigue funcionando (`data/shiurim.db`).

## Puesta en marcha

1. **Volumen**: Railway → servicio → Volumes → mount path `/data`.
2. **Google Cloud** (con la cuenta Gmail dueña de la carpeta): proyecto nuevo → APIs y servicios → habilitar *Google Drive API* → Pantalla de consentimiento OAuth (Externo) → agregar scope `https://www.googleapis.com/auth/drive` → **Publicar la app ("In production")** para que el refresh token no caduque a los 7 días (aparece la advertencia "app no verificada": Avanzado → Continuar) → Credenciales → ID de cliente OAuth → *Aplicación web* → URI de redireccionamiento autorizado: `https://ofirsegal.app/api/admin/google/callback`. Copiar Client ID y Secret.
3. **Variables en Railway**: ver tabla. Redeploy.
4. Abrir `/admin`, entrar con `ADMIN_PASSWORD`, pulsar **Conectar Google Drive** y aceptar. Luego **Revisar ahora**.
5. Ffmpeg: viene con la dependencia `ffmpeg-static`; si falla en el build, definir `RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg` (o `FFMPEG_PATH`).

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `STORAGE_DIR` | sí (Railway) | `/data` (volumen). Local: `./storage` |
| `ADMIN_PASSWORD` | sí | Protege `/admin` (cookie firmada, 7 días) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | sí | Cliente OAuth web |
| `FAL_KEY` | sí | Fal Scribe v2 |
| `OPENAI_API_KEY` | sí | Pulido y embeddings |
| `R2_ACCOUNT_ID`/`R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | sí | R2; la URL pública es la que recibe Fal |
| `POLISH_MODEL` (gpt-5.2), `POLISH_EFFORT` (medium) | no | Modelo de pulido |
| `INGEST_POLL_MINUTES` (10), `INGEST_ENABLED` (1; `0` apaga el scheduler), `DRIVE_FOLDER_ID` | no | |
| `PUBLIC_BASE_URL` | no | Si el redirect OAuth no se deduce bien detrás del proxy |
| `GOOGLE_REFRESH_TOKEN` | no | Alternativa al botón (si no hay `google-token.json`) |
| `FAL_USD_PER_MIN`, `POLISH_USD_PER_M_IN`, `POLISH_USD_PER_M_OUT` | no | Precios para el estimado de `/admin` |
| `OPENAI_BASE_URL`, `DB_PATH`, `FFMPEG_PATH`, `FAL_POLL_MS` | no | Ajustes avanzados |

## Operación

- `/admin`: estado de Drive, claves presentes, última/próxima revisión, **Revisar ahora**, lista de clases con estado, log por clase, **Reintentar**, costos (minutos Fal, tokens OpenAI, estimado en USD; los embeddings no se cuentan).
- Una clase nueva termina en minutos (transcripción ≈ tiempo real/10; pulido ≈ 1–3 min por hora de clase).
- Clase con `needsReview` (>20% `[inaudible]`): se publica igual, avisa en `/admin`.
- Re-pulir: borrar su entrada en `ingest/state.json` y los archivos `data/*/<id>.json` del volumen (el archivo ya no se detecta porque su id está en el inventario del volumen: quitar también esa entrada).

## Prueba local sin Drive/R2/Fal

```bash
OPENAI_API_KEY=... npm run ingest:dry -- ./algun-audio.mp3 [--id <driveId>]
npm run test:ingest
```
`ingest:dry` parte el audio con ffmpeg, simula Fal con `data/raw/<id>.json` (default: clase 27), pule con OpenAI real + Sefaria real, valida como `merge-polished.py` y compara con `data/polished/<id>.json`.

## Problemas frecuentes

- *"Google Drive no conectado"*: repetir el paso 4. `invalid_grant` tras 7 días = la pantalla de consentimiento sigue en "Testing"; publicarla y reconectar.
- *Sin refresh token al conectar*: revocar el acceso en myaccount.google.com/permissions y reconectar (se pide `prompt=consent`).
- *Fal falla con la URL de audio*: revisar `R2_PUBLIC_BASE_URL` (debe ser accesible públicamente) y que `tmp/` sea legible.
- *Pulido falla validación*: se reintenta una vez con los errores; si persiste queda en cola con backoff (ver log de la clase).
- *Healthcheck falla al primer deploy*: el primer arranque embebe todo; subir `healthcheckTimeout` o esperar.
- *Dos instancias*: el scheduler usa un lock con heartbeat en el volumen; tras un reinicio puede esperar hasta 3 min.
