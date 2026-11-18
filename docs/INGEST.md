# Ingesta automática (Drive → R2 → Fal → OpenAI → sitio)

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
