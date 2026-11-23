---
name: "maamar-pdf-hebreo"
description: "Convierte una transcripción de shiur (Plaud u otra) en un Maamar hebreo redactado para un lector que no escuchó la clase, maquetado como PDF profesional B/N (y DOCX si se pide), con una ficha de enriquecimiento para búsqueda IA. Cuando el usuario lo pida (súbelo, publícalo, a la biblioteca), lo sube a la Biblioteca de Maamarim de ofirsegal.app con el conector. Úsalo siempre que pidan convertir un shiur en maamar o subir un maamar a la biblioteca."
---

# Maamar PDF Hebreo (WeasyPrint 69 + DOCX)

Transforma la transcripción de un shiur en un **Maamar redactado**: un texto
que se lee como escrito por su autor — no como una transcripción corregida —,
claro y fluido para **alguien que lo lee por primera vez y nunca escuchó la
clase**. Salida: PDF profesional en blanco y negro (portada, תוכן עניינים,
Frank Ruhl Libre, RTL justificado, títulos elegantes) y, cuando el usuario lo
pida, también DOCX editable con el mismo contenido.

El contenido del maamar va siempre en **hebreo**, aunque la clase haya sido en
español (con hebreo transliterado). La comunicación con el usuario, en español.
NO es el modo de preservación carácter-por-carácter.

---

## 1. Modo editorial: de transcripción a Maamar

> **Cambia la FORMA con libertad. Preserva el FONDO con exactitud.
> Escribe para quien llega al texto sin haber oído la clase.**

El maamar debe ser **autónomo**: todo lo necesario para entenderlo está en el
texto mismo. Si un lector inteligente que no estuvo en la clase se pierde en
algún punto, el maamar está incompleto.

### Claridad para el lector nuevo (obligatorio)

- **Orden claro.** Ordena por lógica, no por el orden del audio. Une
  fragmentos dispersos del mismo tema aunque estén separados en la grabación.
- **פתיחה con mapa.** La פתיחה presenta: (a) de qué trata la sugyá en su nivel
  simple, (b) qué tesis profunda se va a desarrollar, (c) el plan del maamar
  por bloques ("תחילה (פרקים א–ד)… אחר כך… ולבסוף…"), para que el lector sepa
  a dónde va.
- **Bloques temáticos.** Agrupa los פרקים en 3–5 bloques lógicos (la sugyá
  misma → el principio → las figuras/ejemplos → el relato central → la
  aplicación). Cada bloque construye sobre el anterior.
- **Cada פרק abre con su pregunta o tesis** en la primera línea y se conecta
  explícitamente con lo anterior y lo que viene ("נחזור להבדל שראינו בפרק א",
  "לפי מה שלמדנו בפרק ג", "נשוב לכך בפרק יב"). Nada de saltos sin puente.
- **Subtítulos internos en negrita** (`<b>…</b>` al inicio del párrafo) cuando
  un פרק trata varios elementos (ej.: <b>הפת והסולת.</b> / <b>הכוכב.</b>).
- **Términos explicados en su primer uso**, en una frase o paréntesis, sin
  extenderse: כהן משיח, שגגת מעשה / העלם דבר (con ejemplo concreto), גזירה
  שוה, מחנות, אחוזה, הנהגת המשפט / היחוד, יבום, gematriot, etc. No alargar más
  de lo necesario para la claridad, pero **tampoco acortar** lo que hace falta.
- **Citas largas en arameo o difíciles**: antes o después de la cita, un
  resumen/פירוש en hebreo claro, para que el lector siga el argumento sin
  descifrar la Guemará. Para un מעשה largo, primero se cuenta la historia en
  resumen y luego va la cita.
- **Relatos de otras sugyot** que el rav da por conocidos: se recuentan
  brevemente (quién, qué pasó, cómo terminó) antes de interpretarlos.
- **Juegos de palabras y dobles sentidos** (ej. "אשרי" como causa de la caída
  y como su tikún; "חפשית" = בחירה חפשית / בית החפשית) se explicitan, no se
  dejan implícitos.
- **Pasada final de claridad obligatoria**: releer todo el maamar de principio
  a fin *como lector nuevo* y corregir todo punto que presuponga algo que el
  texto no dio.

### Se espera que hagas (FORMA)

- **Reescribir** frases habladas en prosa escrita clara y fluida.
- **Eliminar** muletillas, titubeos, reinicios de frase, "como dije antes",
  "¿se entiende?", "¿me explico?", aclaraciones orales redundantes, logística
  de la clase (tiempo, Zoom, interrupciones) y digresiones que no aportan.
- **Quitar repeticiones**: si una idea se dice tres veces, aparece una vez,
  bien formulada.
- **Reestructurar el orden** para un flujo lógico coherente.
- **Crear títulos y subtítulos** que digan de qué trata cada parte y guíen la
  lectura.
- **Elevar el registro**: del lenguaje oral al literario-rabínico propio de un
  maamar.
- Si el usuario indica destilar conclusiones (sesión de mucho análisis), no
  reproducir todo el proceso: dejar el resultado en un maamar fluido.

### NUNCA hagas (FONDO — fidelidad al original)

- **No inventes** fuentes, pesukim, citas ni nombres de autoridades que no
  estén en el original. Si una fuente está incompleta, no la "completes" de
  memoria; déjala como está o márcala para revisión del usuario.
- **No cambies** conclusiones halájicas, chiddushim ni la tesis del rav.
- **No agregues** ideas, interpretaciones o derashot nuevas que el rav no dijo.
- **No alteres el לשון de las citas literales.** Pesukim, Guemará, Rashi,
  Rambam y lashon de Chazal/Rishonim van **verbatim**, copiados de la fuente
  (Sefaria, §4) — nunca tecleados a mano ni de memoria. Solo se reescribe la
  *exposición* del rav.
- Si el rav cita algo distinto al texto real (ej. dice "800" y la Guemará dice
  "ארבע מאה / שבע מאה"), en el maamar va el texto verbatim y se avisa al
  usuario en los pendientes.
- Ante ambigüedad real del original, **no la resuelvas inventando**: formula
  con cautela y márcala. Si es ininteligible, omítelo y dilo. Una discusión no
  resuelta en clase (ej. "hay que checar quién era levi") puede ir como nota al
  pie "לבירור".

### Entregable adicional obligatorio: lista de cambios y pendientes

Junto al PDF, en el chat (español), breve:
1. **Cambios estructurales**: qué se reordenó, qué se unió, qué repeticiones o
   digresiones se quitaron, qué títulos/bloques se crearon. No hace falta
   listar cada reescritura de frase.
2. **Pendientes de revisión**: discrepancias entre lo dicho y la fuente,
   pasajes ambiguos formulados con cautela, fragmentos omitidos por
   ininteligibles, datos faltantes (p. ej. nombre del Rab para la portada si la
   grabación no lo indica).

---

## 2. Flujo de trabajo

1. **Obtener la transcripción completa.** Si viene de Plaud: `list_files` (la
   más reciente = primera), luego `get_transcript` con `limit: 500` siguiendo
   `next_cursor` hasta el final. Las respuestas grandes se guardan en archivo:
   extraer con Python solo `start_time` + `content` a un texto compacto
   `[mm:ss] texto` y **leerlo entero** por tramos. Leer también `get_note`
   (resumen de Plaud) como guía de temas, nunca como fuente.
2. **Reconstruir las fuentes.** Las clases en español traen hebreo/arameo
   transliterado y deformado ("Asher adorsa nasi se lo me vikorbana skagato" =
   אשרי הדור שהנשיא שלו מביא קרבן על שגגתו). Identificar cada sugyá, pasuk y
   Rishón citado y **bajarlo de Sefaria** (§4) antes de redactar.
3. **Mapear las ideas** (no el orden del audio): tesis, fuentes, desarrollo,
   ejemplos, conclusión práctica.
4. **Diseñar la estructura**: פתיחה con mapa → bloques → פרקים con títulos →
   סיום.
5. **Redactar** en el formato de marcado (§3), aplicando §1.
6. **Generar** PDF (WeasyPrint) y, si se pidió, DOCX (docx-js) desde el mismo
   contenido.
7. **QA visual**: rasterizar con `pdftoppm` portada, índice y 2–3 páginas de
   cuerpo; revisar índice numerado, cajas de cita, notas, glifos faltantes y
   los bugs conocidos. DOCX: `soffice --headless --convert-to pdf` y mirar.
8. **Pasada final de claridad** como lector nuevo (§1).
9. **Ficha de enriquecimiento** (§7, siempre): escribir `ficha.json` a partir del
   maamar final. No cambia el PDF; sirve para que la búsqueda IA de la
   biblioteca encuentre el maamar.
10. **Entregar** (§6).
11. **Subir a la Biblioteca** (§8) — solo cuando el usuario lo pida ("súbelo",
    "publícalo", "a la biblioteca", "a la web"), en este turno o más adelante.

---

## 3. Formato de marcado del contenido (fuente única para PDF y DOCX)

Escribir el maamar en `maamar.txt` con este marcado; un script lo convierte en
`blocks.json`, del que salen el HTML/PDF y el DOCX.

```
TITLE: עַבְדוּת אֲנִי נוֹתֵן לָכֶם
SUBTITLE: הנשיא והכהן — על המדרגה, על הנפילה ועל הדרך לקום ממנה
SOURCE: מאמר על פי שיעור בסוגיית הוריות דף י
DATE: חשון תשפ"ז

# פתיחה — על מה המאמר וכיצד לקרוא אותו
פסקה רגילה. הערת שוליים כך{{הוריות י.}} ומילה מודגשת <b>כך</b>.
> @Horayot.10a|12||| (הוריות י.)
> @Horayot.10a|13||| (שם)
```

- `# ` = título de פרק. Línea normal = párrafo. `{{…}}` = nota al pie.
  `<b>…</b>` = negrita / subtítulo interno.
- `> @REF|idx|inicio|fin| (etiqueta)` = cita verbatim desde Sefaria:
  - `REF`: referencia Sefaria (`Horayot.10a`, `I_Samuel.2.13-14`,
    `Mishneh_Torah,_Kings_and_Wars.1.1-2`, `Rashi_on_Sukkah.45b`).
  - `idx`: índice del segmento, o `*` para buscar el primer segmento que
    contenga `inicio`.
  - `inicio` / `fin`: recorte opcional (inclusivo), comparado **sin nikud**.
  - Una cita con etiqueta `(שם)` inmediatamente después de otra cita se
    **fusiona en la misma caja** (pasaje continuo = una sola caja).
- Citas cortas dentro de la prosa (unas palabras) van inline entre comillas,
  sin nikud.

---

## 4. Fuentes desde Sefaria (verbatim)

La API de Sefaria es accesible desde el entorno:

```python
import json, re, html, urllib.request, urllib.parse
def sefaria(ref):
    u = "https://www.sefaria.org/api/v3/texts/" + urllib.parse.quote(ref) + "?version=hebrew"
    t = json.load(urllib.request.urlopen(u, timeout=30))['versions'][0]['text']
    flat = lambda x: [y for z in x for y in flat(z)] if isinstance(x, list) else [x]
    return [re.sub(r'<[^>]+>', '', html.unescape(s)) for s in flat(t)]

def clean(s):
    s = re.sub(r'[֑-֯]', '', s)            # quitar טעמים
    s = s.replace('ׇ', 'ָ').replace('', '').replace('׀', '')
    s = re.sub(r'\{[ספ]\}', '', s)                     # {ס} {פ}
    s = re.sub(r'\([^)]*\)\s*(?=\[)', '', s)           # כתיב (..) antes de קרי [..]
    s = s.replace('[', '').replace(']', '').replace('\xa0', ' ')
    return re.sub(r'\s+', ' ', s).strip()
```

- Las citas conservan nikud (sin טעמים). Qamatz qatan U+05C7 → U+05B8.
- **Buscar/recortar sin nikud**: construir un "esqueleto" quitando
  U+0591–U+05C7 (salvo ־ ׀ ׃ ׆) con mapa de posiciones, buscar ahí y recortar
  en el texto original. Así los marcadores escritos a mano coinciden aunque el
  orden de los signos difiera.
- Antes de redactar, **imprimir el daf completo** (segmentos numerados) de cada
  sugyá principal para elegir índices y recortes exactos.
- Rashi/Rambam/otros comentarios: buscar el segmento por palabra clave.

---

## 5. Render

```bash
pip install weasyprint==69 --break-system-packages
```

### Fuente Frank Ruhl Libre

Cuerpo y títulos en distintos pesos. GitHub raw suele estar bloqueado: usar
npm (fontsource) y convertir a TTF, fusionando hebreo + latino (dígitos):

```bash
npm pack @fontsource/frank-ruhl-libre && tar xzf fontsource-frank-ruhl-libre-*.tgz
```
```python
from fontTools.ttLib import TTFont
from fontTools.merge import Merger
D = 'package/files'
for w in (400, 500, 700, 900):
    ps = []
    for sub in ('hebrew', 'latin'):
        f = TTFont(f'{D}/frank-ruhl-libre-{sub}-{w}-normal.woff'); f.flavor = None
        p = f'/tmp/{sub}{w}.ttf'; f.save(p); ps.append(p)
    Merger().merge(ps).save(f'FrankRuhlLibre-{w}.ttf')
```
Copiar los TTF también a `~/.fonts` + `fc-cache -f` (para LibreOffice al
verificar el DOCX). Verificar que todos los caracteres usados existan en el
cmap de la fuente.

### Estructura HTML

Orden de páginas: **Portada (שער) → תוכן עניינים → cuerpo del maamar**.

```html
<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<link rel="stylesheet" href="maamar.css"></head><body>
<section class="portada"><div class="portada-marco">
  <p class="portada-pre">בס"ד</p>
  <h1 class="portada-titulo">שם המאמר</h1>
  <p class="portada-subtitulo">תת־כותרת</p>
  <div class="orn">✦</div>
  <p class="portada-fuente">על פי שיעורו של …</p>
  <p class="portada-fecha">חודש ושנה</p>
</div></section>
<section class="toc"><h1 class="toc-titulo">תוכן עניינים</h1>
  <nav><a href="#sec1"><span class="pn">@@sec1@@</span>פתיחה — …</a> …</nav></section>
<section class="seccion" id="sec1"><h2 class="seccion-titulo">פתיחה — …</h2>
  <p>טקסט… <span class="nota">תוכן ההערה</span> המשך.</p>
  <blockquote class="pasuk">לשון הגמרא…<span class="mekor">(הוריות י.)</span></blockquote>
</section>
</body></html>
```

### CSS completo (todo en blanco y negro)

```css
@font-face { font-family:"FRL"; src:url("FrankRuhlLibre-400.ttf"); font-weight:400; }
@font-face { font-family:"FRL"; src:url("FrankRuhlLibre-500.ttf"); font-weight:500; }
@font-face { font-family:"FRL"; src:url("FrankRuhlLibre-700.ttf"); font-weight:700; }
@font-face { font-family:"FRL"; src:url("FrankRuhlLibre-900.ttf"); font-weight:900; }
@page { size: letter; margin: 2.4cm 2.3cm;
  @bottom-center { content: counter(page); font-family:"FRL"; font-size:10pt; }
  @top-center { content: "<título sin nikud>"; font-family:"FRL"; font-size:8.5pt; color:#555; letter-spacing:.08em; }
  @footnote { border-top:.5pt solid #000; padding-top:4pt; } }
@page portada { @bottom-center { content:none; } @top-center { content:none; } }
@page toc     { @bottom-center { content:none; } @top-center { content:none; } }
html { direction: rtl; }
body { font-family:"FRL", serif; font-size:12.5pt; line-height:1.75; text-align:justify; color:#000; }
.portada { page: portada; page-break-after: always; text-align:center; }
.portada-pre { text-align:left; font-size:10pt; margin:0; }
.portada-marco { margin-top:27%; border-top:1.5pt solid #000; border-bottom:1.5pt solid #000; padding:2.4em 1em 2em; }
.portada-titulo { font-weight:900; font-size:36pt; letter-spacing:.03em; margin:0 0 .35em; line-height:1.3; }
.portada-subtitulo { font-weight:400; font-size:16pt; margin:0 0 .8em; }
.orn { font-size:12pt; margin:.4em 0 .9em; }
.portada-fuente { font-weight:500; font-size:12.5pt; color:#222; margin:0 0 .3em; }
.portada-fecha { font-weight:400; font-size:11.5pt; color:#333; margin:0; }
.toc { page: toc; page-break-after: always; }
.toc-titulo { font-weight:900; font-size:22pt; text-align:center; letter-spacing:.06em; margin:1em 0 1.2em; padding-bottom:.4em; border-bottom:.8pt solid #000; }
.toc nav a { display:block; text-decoration:none; color:#000; font-size:13pt; padding:.32em 0; border-bottom:.4pt solid #bbb; }
.toc nav a .pn { float:left; font-weight:700; }
.seccion-titulo { font-weight:900; font-size:16.5pt; text-align:center; letter-spacing:.04em; margin:1.5em 0 .9em; padding:.35em 0; border-top:.8pt solid #000; border-bottom:.8pt solid #000; page-break-after:avoid; line-height:1.45; }
.seccion p { margin:0 0 .55em; }
.pasuk { background:#f3f3f3; border-right:2.5pt solid #000; padding:.5em .85em; margin:.75em 0; font-weight:500; line-height:1.65; page-break-inside:avoid; }
.mekor { display:block; text-align:left; font-weight:400; font-size:9.5pt; color:#444; margin-top:.15em; }
b { font-weight:700; }
.nota { float: footnote; font-size:9.5pt; line-height:1.45; text-align:justify; }
::footnote-call { font-size:8pt; vertical-align:super; line-height:0; }
::footnote-marker { font-weight:700; }
```

### Títulos elegantes (blanco y negro)

La elegancia sin color viene de la tipografía, no de adornos: Frank Ruhl Libre
en peso fuerte, centrado, con `letter-spacing` amplio; filete fino arriba y
abajo del título de capítulo; portada grande y aireada con subtítulo ligero.
Sin colores: negro sobre blanco con grises tipográficos.

### Notas al pie

Usar `<span class="nota">…</span>` con `float: footnote` — WeasyPrint numera
solo, pone la llamada volada y baja el contenido a la página correcta. Nunca
`<sup>` manual (obliga a numerar a mano y se rompe al reordenar). Buen lugar
para el mar'eh makom exacto de algo que el rav mencionó de pasada, o para una
cuestión "לבירור".

### Índice con números de página: render en dos pasadas

`target-counter()` en WeasyPrint 69 numera solo la primera entrada. Usar
marcadores `@@secN@@` y dos pasadas:

```python
from weasyprint import HTML
d1 = HTML(string=doc, base_url=base).render()
pages = {}
for i, pg in enumerate(d1.pages, 1):
    for a in pg.anchors: pages.setdefault(a, i)
doc = re.sub(r'@@(sec\d+)@@', lambda m: str(pages[m.group(1)]), doc)
HTML(string=doc, base_url=base).write_pdf(base + 'maamar.pdf')
```

### Bugs conocidos de WeasyPrint 69 y sus soluciones

| Síntoma | Causa | Solución |
|---|---|---|
| Índice sin números / solo el primero | `target-counter` falla | Dos pasadas con `page.anchors` (arriba). |
| Altura/espaciado raro | `flex`+`height` en contenedores | Flujo de bloque; número de página del índice con `float:left`. |
| Sangría al lado equivocado | `text-indent` no respeta RTL | No usar sangría, o `padding-inline-start`. |
| Peso de fuente inconsistente | varios `@font-face` al mismo archivo | Un `@font-face` por peso real. |
| Márgenes que saltan entre páginas | colapso de márgenes en saltos | Fijar en `@page`; sin `margin` grande en primer/último hijo. |
| Notas al pie que no bajan | `<sup>` manual | `float: footnote`. |
| PDF pesado | bordes punteados | Bordes sólidos finos. |

### DOCX (docx-js, desde el mismo `blocks.json`)

`require('docx')` (preinstalado). Puntos clave:

- Página Carta: `width 12240, height 15840`, márgenes ~1300–1360 DXA;
  `titlePage: true` con header/footer vacíos en la primera página; encabezado
  con el título sin nikud y folio centrado.
- Cada `Paragraph`: `bidirectional: true`, alineación JUSTIFIED (títulos
  CENTER). Cada `TextRun`: `rightToLeft: true`,
  `font: {ascii, hAnsi, cs, eastAsia: 'Frank Ruhl Libre'}`, `size` y
  `sizeComplexScript` iguales, `bold` + `boldComplexScript`.
- Títulos de פרק: `HeadingLevel.HEADING_1` con estilo `Heading1` propio
  (`outlineLevel: 0`), bordes superior/inferior, `keepNext`; el primer פרק con
  `pageBreakBefore`.
- Caja de cita: párrafo con `shading {type: CLEAR, fill: 'F3F3F3'}` y borde
  derecho grueso; la fuente `(הוריות י.)` en párrafo aparte, alineada a la
  izquierda, 9.5pt gris, misma caja.
- Notas: `footnotes: {id: {children:[Paragraph]}}` + `FootnoteReferenceRun(id)`.
- Índice en DOCX: lista estática de títulos **sin números de página** (Word en
  iPad no actualiza campos TOC y la paginación difiere del PDF).
- Verificar: `soffice --headless --convert-to pdf` + `pdftoppm`.

---

## 6. Entrega

- Guardar en `/mnt/user-data/outputs/` con nombre **título-del-maamar_fecha**,
  con guiones y sin espacios (ej. `עבדות-אני-נותן-לכם_2026-11-02.pdf` /
  `.docx`). Al rehacer una versión, reemplazar la anterior.
- Enviar con SendUserFile (PDF siempre; DOCX cuando se pida).
- En el chat: lista de cambios estructurales + pendientes de revisión (§1).

---

## 7. Ficha de enriquecimiento (para la búsqueda IA)

El maamar está en hebreo; los lectores de la biblioteca preguntan sobre todo en
**español**, con transliteraciones variables (teshuvá / tshuva / teshuva), o en
hebreo con otras palabras. La ficha es el puente: se indexa junto al texto.
Escríbela **siempre**, al terminar el maamar, desde el texto FINAL (no desde la
transcripción) y **sin inventar nada** que no esté en el maamar. Guárdala como
`ficha.json` junto a `maamar.txt`:

```json
{
  "summary_es": "3–5 frases: de qué trata, la tesis, cómo se desarrolla, a qué conclusión llega.",
  "summary_he": "2–4 משפטים: על מה המאמר והטענה המרכזית.",
  "thesis": "La tesis central en una frase.",
  "keywords": ["יסורים של אהבה", "yisurim shel ahavá", "isurim", "sufrimientos de amor", "מירוק", "purificación"],
  "concepts": ["יסורים של אהבה", "פשפוש במעשים"],
  "people": ["רבא", "ריש לקיש", "דוד המלך"],
  "sources": [{"ref": "Berakhot.5a", "label": "ברכות ה."}, {"ref": "Proverbs.3.12", "label": "משלי ג יב"}],
  "questions": ["¿Qué debe hacer una persona cuando le llegan sufrimientos?", "מה ההבדל בין יסורים של אהבה ליסורים של עונש?"],
  "rav": "שם הרב",
  "sections": [{"title": "<título exacto del פרק>", "summary": "1–2 frases en español", "keywords": ["…"]}]
}
```

- `keywords`: 20–40 términos. Cada concepto importante en **tres formas**: hebreo
  (תשובה), transliteración habitual en español con sus variantes (teshuvá,
  tshuva) y traducción (arrepentimiento). Incluye nombres de sugyot, pesukim y
  figuras.
- `questions`: 10–20 preguntas **reales** que el maamar responde, como las
  haría un lector (mezcla español y hebreo; de las generales a las puntuales).
- `sources`: todas las fuentes que el maamar cita, con la referencia de Sefaria
  cuando la tengas (la misma que usaste en `> @REF`).
- `sections`: una entrada por פרק, **en orden**, con el título exacto.
- Elige también **categoría** (ruta en hebreo, de lo general a lo particular,
  máx. 3 niveles: `["גמרא","ברכות"]`, `["ליקוטי מוהר״ן"]`, `["תנ״ך","בראשית"]`,
  `["מועדים","חנוכה"]`, `["מחשבה ומוסר","אמונה"]`) y 3–8 **etiquetas** cortas
  en español.

---

## 8. Subir a la Biblioteca de Maamarim (ofirsegal.app)

Solo cuando el usuario lo pida. Requiere el conector **Biblioteca de Maamarim**
(herramientas `listar_categorias`, `subir_maamar`, `listar_maamarim`,
`obtener_maamar`, `buscar_en_maamarim`, `guia_biblioteca`).

1. `listar_categorias` → reutiliza una categoría existente siempre que encaje
   (misma ortografía); si no hay ninguna adecuada, propón una ruta nueva.
2. `subir_maamar` con:
   - `markup`: el contenido COMPLETO de `maamar.txt` (TITLE/SUBTITLE/SOURCE/DATE,
     `#` פרקים, párrafos, `{{notas}}`, `<b>`, citas). Las citas `> @REF|idx|inicio|fin| (etiqueta)`
     se resuelven en Sefaria en el servidor con las mismas reglas de §4; también
     puedes mandar la cita ya resuelta: `> טקסט הציטוט (etiqueta)`. Agrega
     `DATE_ISO: aaaa-mm-dd` (fecha civil) bajo DATE para el orden por fecha.
   - `categoria`, `etiquetas`, `ficha` (§7), `fecha_iso`.
3. Lee la respuesta: devuelve **id**, **signatura** (ej. 1.1.03) y **enlace**.
   Si hay avisos de citas ("no encontré el final «…»"), corrige esas líneas en
   el markup (ortografía exacta de Sefaria, o el texto ya resuelto) y vuelve a
   llamar a `subir_maamar` con el mismo `id`.
4. Para corregir un maamar ya subido: `subir_maamar` con su `id` (lo reemplaza;
   conserva categoría y PDF si no los cambias). Si no recuerdas el id,
   `listar_maamarim` con `texto` = parte del título.
5. Dile al usuario: el enlace, la signatura/categoría y los avisos. El PDF es
   opcional en la web (el sitio muestra el maamar completo); si quiere
   adjuntarlo: ofirsegal.app/admin/maamarim → «Adjuntar PDF».

**Si el conector no está disponible:** no inventes otra vía. Genera
`subida-maamar.json` con `{"markup": "...", "categoria": [...], "etiquetas": [...], "ficha": {...}}`,
entrégalo con los demás archivos y explica: "súbelo en
ofirsegal.app/admin/maamarim → Cargar JSON de subida", y que para que yo lo suba
directamente debe agregar el conector (claude.ai → Configuración → Conectores →
Agregar conector personalizado, con el enlace que muestra
ofirsegal.app/admin/maamarim).

---

## Checklist final

- [ ] Transcripción leída al 100%; resumen de Plaud usado solo como guía.
- [ ] Todas las fuentes identificadas y bajadas de Sefaria; citas verbatim.
- [ ] Modo editorial aplicado: se lee como maamar, no como transcripción.
- [ ] פתיחה con mapa del maamar; bloques y פרקים en orden lógico.
- [ ] Cada פרק abre con su tesis y se conecta con lo anterior.
- [ ] Términos explicados en su primer uso; relatos resumidos antes de citarlos;
      citas arameas largas acompañadas de פירוש claro.
- [ ] Nada inventado; ambigüedades marcadas; tesis del rav intacta.
- [ ] Pasada final como lector nuevo: se entiende sin haber oído la clase.
- [ ] Portada + índice con números (dos pasadas) + encabezado + folios.
- [ ] Frank Ruhl Libre, RTL justificado, todo en blanco y negro, títulos elegantes.
- [ ] Glifos completos; QA visual del PDF (y del DOCX si aplica).
- [ ] Entregado con nombre+fecha, lista de cambios y pendientes.
- [ ] `ficha.json` escrita desde el maamar final (resúmenes es/he, keywords en
      hebreo + transliteración + traducción, 10–20 preguntas, fuentes, פרקים).
- [ ] Si el usuario pidió subirlo: subido con el conector, avisos revisados,
      enlace y signatura entregados.