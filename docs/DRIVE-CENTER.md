# Centro de transcripción de Drive (guía de administración)

> Fase 1: carpeta General, series (colecciones), explorador `/admin/drive`, transcripción con Fal y salidas `.md`/`.json` en Drive. Las secciones siguientes se completan en las fases 2–4. El resto de este documento es la guía técnica de la ingesta original (que sigue vigente: la serie «ברכות שר לשמחה» es la colección #1).

## Uso rápido (Fase 1)
1. Entra a `/admin` → **Centro de transcripción de Drive** (`/admin/drive`).
2. **Carpeta General**: la primera vez eliges, navegando por tu Drive, la carpeta que contiene tus series (se guarda en `$STORAGE_DIR/center.json`). Se puede cambiar cuando quieras.
3. **Series**: pulsa «⚙ Ajustes» en cualquier carpeta y guarda: esa carpeta pasa a ser una serie (`$STORAGE_DIR/collections.json`). Cada ajuste puede quedar en «Heredar»: se toma de la serie superior más cercana (se muestra «heredado de …») o de los valores del sistema. Ajustes: modelo Fal (Scribe v2 por defecto, Scribe v1, Wizper, Whisper), idioma, sincronización automática, posproceso (sin pulido / OpenAI), modelo y esfuerzo OpenAI, nombres (mantener / plantilla) y **Publicar en la web** (por carpeta).
4. **Transcribir**: marca carpetas o audios → «Transcribir selección» → se muestra el **estimado** (minutos, costo Fal por modelo, OpenAI aproximado, tiempo) → «Confirmar y encolar». Las carpetas se recorren recursivamente. Los audios que ya tienen un `.md` (p. ej. de Plaud) se re-transcriben con Fal.
5. Resultado en Drive junto al audio, **mismo nombre base**: `<nombre>.md` (formato de `polished-to-md.py`, crudo si no hay pulido) y `<nombre>.json` (`{version, audioId, model, segments:[{startMs,endMs,text}], summary?, tags?, meta}`). Si existen se actualizan; nunca se borra un audio.
6. Estados: sin transcribir · en cola · transcribiendo · transcrito · pulido en curso · pulido · paquete pendiente · error (reintentar / ver log / abrir en Drive / abrir en la web).
7. Auto-sync: las series con sincronización automática se revisan cada `INGEST_POLL_MINUTES` (recorrido por carpeta, sin la API de cambios); un audio nuevo se encola cuando su tamaño es estable en 2 revisiones y no tiene ya un `<nombre>.json` al lado.
8. Costos por serie en `/admin/drive` (estado) y totales en `/admin`.

### Plantillas de nombres (Fase 2)
En **Ajustes → Nombres de los archivos** eliges el modo (mantener / plantilla) y la plantilla de la serie (heredable). Variables: `{n}` (número inicial del nombre, o el siguiente libre de la serie), `{obra}`, `{daf}`, `{amud}` (junto a `{daf}` se escribe `{daf} ע׳׳{amud}` y se renderiza ע׳׳א / ע׳׳ב / rangos `ג ע׳׳א-ע׳׳ב`), `{temas}` (2–4 temas en hebreo, ≤ ~50 caracteres), `{tema_es}`, `{torá}`, `{parashá}`, `{fecha}` (fecha del archivo), `{original}` (nombre original sin número ni extensión) y `{ext}` (se agrega sola si no la pones). Predefinidas: **Guemará** `{n}. {obra} {daf} ע׳׳{amud} - {temas}`, **Likutey Moharán** `{n}. ליקוטי מוהר״ן {torá} - {temas}`, **Parashá** `{n}. {parashá} - {temas}`, **General** `{n}. {temas}`. El editor muestra una vista previa en vivo con una clase de ejemplo y los errores de la plantilla.

Al pulir, la IA recibe un JSON schema con *solo* las variables que la plantilla necesita; el servidor renderiza y valida el nombre (sin `/ \ : "`, prefijo de orden correcto, extensión, daf en letras hebreas, amud א/ב…) y reintenta con los errores. El audio, el `.md` y el `.json` se renombran juntos en Drive; cada renombrado queda en `data/rename-log.json` (por lote) y el botón **Deshacer renombrado** de cada archivo restaura los nombres anteriores. «Obra fija» permite fijar `{obra}` sin preguntarle a la IA.

El prompt de pulido (`prompts/polish.md` §7) se adapta a la serie; **Sefaria solo se consulta** en series de Guemará (`{daf}`), Likutey Moharán (`{torá}`) y Tanaj/Parashá (`{parashá}`).

### Paquete para IA (Fase 3, alternativa a OpenAI)
Con **Posproceso = Paquete para IA (ChatGPT/Claude)** el servidor no llama a OpenAI: tras transcribir crea en Drive, junto al audio, `<nombre>.ai.json` (si hay más de ~250 segmentos, partes `<nombre>.ai.parte1de4.json`…) y deja el archivo en estado **paquete pendiente**. Cada paquete es autosuficiente (`format: "shiurim-ai-package/v1"`): `package_id`, `upload` (`url` = `https://ofirsegal.app/api/paquete/<token>` con `POST` + `application/json`, `page` = `https://ofirsegal.app/subir/<token>`, `drive_fallback`), `prompt` completo (reglas de pulido de la serie + variables de la plantilla de nombres + reglas estrictas de salida), `output_schema` (JSON Schema del archivo corregido: mismo `package_id`, mismos `i/startMs/endMs`, `text` corregido, `meta` con resumen, tags y variables del nombre; solo en la parte 1), `context` (serie, daf adivinado del nombre, texto de Sefaria si aplica, segmentos vecinos), `segments` e `instructions_for_ai` (pasos en español e inglés).

**Flujo**
1. En `/admin/drive`, sección **Paquetes para IA** → **Copiar prompt** (copia el JSON completo del paquete) → pégalo en ChatGPT/Claude (o adjunta el archivo `.ai.json` de Drive).
2. La IA responde SOLO con el JSON corregido. Entrégalo por cualquiera de estas vías: (a) la IA hace `POST` a `upload.url` si puede hacer peticiones HTTP; (b) arrastra o pega el JSON en `upload.page` (**Página de subida**); (c) guárdalo en la misma carpeta de Drive como `<nombre>.ai.corregido.json` (o `.parteNdeM.corregido.json`): el servidor revisa Drive cada ~2 min y también con **Buscar corregidos en Drive**.
3. El servidor valida (igual que `merge-polished.py`: `package_id`, cantidad/orden/tiempos de segmentos, textos no vacíos, sin letras hebreas salvo que la serie lo permita, variables de la plantilla válidas, nombre sin `/ \ : "`). Si falla, **no aplica nada** y muestra exactamente qué segmentos/campos están mal (en la página de subida, en la respuesta del POST y en el panel). Si es válido y están todas las partes, se escriben `.md`/`.json`, se renombra por la plantilla y se publica si la serie es pública.

**Tokens**: 32 bytes aleatorios, solo se guarda su hash (`$STORAGE_DIR/packages/packages.json`); válidos 30 días; cada token sirve para un único paquete; el último resultado válido reemplaza al anterior (volver a subir rehace `.md`/`.json`/nombre). **Nuevo enlace** invalida el anterior y actualiza el archivo de Drive. El endpoint acepta CORS desde cualquier origen, cuerpo ≤ 5 MB y limita intentos con token inválido.

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
