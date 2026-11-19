# QA de contenido — 82 clases (revisión independiente, 2026-11-17)

Alcance: data/polished vs data/segments / data/raw / data/md, títulos, estado de Drive, calidad del pulido según `prompts/polish.md`.
Resultado: **29 PASS · 52 MINOR · 1 FAIL**. Ninguna clase necesita re-pulido completo.

## 1. Completitud (script, 82/82)
- 82/82 tienen `data/polished/{id}.json`; nº de segmentos == data/segments en todas; startMs/endMs idénticos en todas (0 discrepancias).
- summary, tags (5-10), daf, title, newName presentes en todas; title == newName sin extensión en todas.
- 0 segmentos con letras hebreas (tampoco en data/gapfill); 0 segmentos vacíos.
- summary 2-3 oraciones: todas salvo **28** (4 oraciones). Varios resúmenes (17, 39, 20) son de 3 oraciones muy largas.
- `data/polished/parts/` también está en data/polished (por eso 83 entradas).
- 5 archivos de gapfill vacíos (`[]`): 1BTlVkq7 (61), 1cf7kfHP (78), 1f2ua9MJ (81), 1jbE7YDr (56), 1pi89GYY (18).

## 2. Títulos
- Todos cumplen el formato `{order}. {obra} {daf} ע׳׳{amud} - {temas}{ext}`: orden == inventario (38 y 46 están duplicados en el propio inventario), amud presente en todo Talmud (Likutey Moharán 41 sin amud, correcto), extensión == inventario (36 sin extensión, correcto), sin `/ : "`, sin comillas ASCII.
- Temas > 50 caracteres (el límite del prompt es ~50): 3 (57), 5 (62), 8 (56), 9 (57), 10 (64), 12 (52), 80 (54).
- Estilo inconsistente de gershayim: `הקב״ה` vs `הקב׳׳ה` (24), `קוב׳׳ה` (38), `בק׳׳ש` (84). Cosmético.
- Daf: plausibles en todas. 30 = Meguilá 19, 33 = Nedarim 31b-32a, 41 = Likutey Moharán 19, 55 = Rosh Hashaná 16b, 80 = Horayot 10 coinciden con el contenido. 20 (ט) es defendible (el rabino dice "tet, empieza en daf álef"), aunque el tema "aneni" es de 6b. 76: meta.daf incluye además ז ע׳׳א.

## 3. Estado de Drive
Se listaron las 164 entradas que no son PDF de la carpeta `1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5` (82 audios + 82 .md).
- Los 82 audios tienen título == newName.
- Cada clase tiene exactamente un .md con título == title + ".md"; el mdId del inventario apunta a ese archivo.
- No hay archivos huérfanos ni duplicados.
- **No hizo falta corregir nada en Drive.** `data/rename-log.json` (182 entradas) == concatenación de `data/rename-log.d/*` (82 archivos).

## 4. Calidad del pulido
Método:
- 3 segmentos aleatorios por clase (semilla = id+"qa", 246 pares) comparados crudo vs pulido.
- Tramos de 20-40 segmentos leídos a fondo en 1, 27, 56, 41, 80, 22, 28, 34, 24, 77 y 23, contrastando los casos dudosos con las palabras crudas de Fal y con Plaud (data/md).
- Detectores por script para todas las clases: segmentos que crecen o se encogen mucho, densidad de texto por segundo y segmentos largos con poco texto.
- Citas comprobadas en Sefaria y correctas:
  - Berajot 4b "leolam keRabán Gamliel sevira lehu… vejotaftó sheiná" (6/20).
  - Berajot 10b "kol hatolé bizjut atzmó… / shesamaj gueulá litfilá / Rabí Leví: sheganaz séfer refuot" (56/594-600).
  - Berajot 27b "veRabí Yehoshúa omed al raglav ad sherinenú kol haam" (64/36).
  - El fragmento de Likutey Moharán 19 (41/537-564) y los pesukim de Tehilim 34 (22/618-622) están bien reconstruidos.

Valoración general:
- La corrección es conservadora y de buena calidad: no hay resúmenes, traducciones ni reordenamientos.
- La transliteración es sefardí y consistente en lo esencial: Guemará, Rabí, Rashí, Kriat Shemá. "Rebbi" se normalizó a Rabí y "la hermana" (error de Scribe por Guemará) se corrigió bien.
- Los huecos de Scribe en pasajes hebreos ("." donde se cayó el hebreo) se rellenaron con el texto bíblico o talmúdico. En 12/297-342, 40/244 y 519-520, 74/408, 75/420-475 y 77/596 lo comprobé contra Plaud: el rabino sí lo leyó. Es aceptable, aunque el texto cae en segmentos de 0-8 s.
- Los segmentos de inicio de bloque en que Scribe "se pierde" (repetidos o traducidos, p. ej. 23/356-371 y 14/138-147) se corrigieron según la regla 0.

Problemas encontrados (también figuran por clase en la tabla):
- **FAIL 46 (1mxCuMhw…, "ט משיכיר")**: en los segs 382, 427, 428, 430, 432, 433, 434 y 713 hay ~2.700 caracteres de español copiados de Plaud dentro de segmentos de Scribe.
  - Ejemplo: el seg 428 dura 0,4 s y el crudo dice "No"; el pulido trae un párrafo entero.
  - Viola "Nunca copies segmentos de Plaud" y desalinea texto y tiempo.
  - Las faltas de Scribe que hay debajo (seg 382 de 68 s, seg 430 de 151 s) nunca pasaron por gapfill.
  - Arreglo: devolver esos segmentos a su texto de Scribe pulido y cubrir 50:32-51:40 y 57:16-60:51 con gapfill.
- **Exceso de [inaudible]**: se tapan palabras recuperables o directamente correctas.
  - 24/114: el crudo "Sefer Mitzvot" pasa a "séfer [inaudible]".
  - 41/77: "Bar Jaú" (= Bar Yojai) pasa a [inaudible].
  - 1/151: "tira, filostira" queda en [inaudible], cuando en el seg 279 de la misma clase se resolvió como "tartei desatrei".
  - 56/606: "remo" (= remez) se tapa.
  - 7/337: también se tapa una palabra recuperable.
  - 17 clases pasan del 20% (needsReview) y otras 11 están entre 15-20%.
- Correcciones erróneas o especulativas aisladas:
  - 3/197 "Mataná" -> "matará".
  - 5/132 "en 50" -> "en emuná".
  - 18/410 "Jichu el Goen" -> "hijo del Gaón".
  - 44/690 "Rabbi" -> "Rabí Akiva" (se añadió un nombre).
  - 34/416 pasuk añadido ("Vayihyú vené Yaakov shnem asar") sin apoyo en el crudo ni en Plaud.
  - 46a/507: se reescribe el español ("Anoche" -> "En la noche").
- Transliteración inconsistente entre clases:
  - betsem / betzem / be'etzem / beétzem ("betsem" ×63 en 7 y ×73 en 50).
  - mimeilá / mimelá / mimeila.
  - Kadosh Baruj Hu / Hakadosh Baruj Hu.
  - Comillas «», "" y “” mezcladas.
  - Nombres: "Rubén" se conserva en 34/36 pero en 35 pasa a "Reuvén".

## 5. Problema sistémico de completitud (no es del pulido)
Hay **37 segmentos de Scribe de 45-229 s con menos de 4 caracteres/s** en 30 clases, ~60 min de audio en total.
- Ninguno lo cubre data/gapfill, porque el detector de huecos solo mira entre segmentos.
- Con Plaud verifiqué que son clase real y no silencio:
  - 71 seg 220 (229 s, 31:07-34:56): tzitzit/emuná/meraglim. Falta ~3,5 min.
  - 53 seg 231 (152 s).
  - 7 seg 473 (186 s).
- Lista completa en la columna de problemas. Arreglo: correr gapfill dentro de esos segmentos (no re-pulir).

## needsReview (>20% [inaudible])
| orden | id | segs | [inaudible] |
|---|---|---|---|
| 7 | `1Bddd547WEOtYW0DRexAh801SB2brGlQH` | 494 | 27.3% |
| 9 | `1P9uGCYv2FTh0JXgKL6Vx90UamabExFJX` | 365 | 24.7% |
| 14 | `1CPAQb4l7NPSSO8CT4jYHomTYH4TMYlbj` | 211 | 22.7% |
| 15 | `1vPoD1Gd7U3Ko92DiCsA364vbctC3BC-p` | 413 | 25.2% |
| 18 | `1pi89GYYpeZ4vRakO8JHYTfvsVupU1Q2q` | 473 | 21.4% |
| 21 | `15yNhd62DD2NmUmv9p0Pfq0TjOIycYcvw` | 360 | 25.0% |
| 22 | `10ZYh0w2h8p_bXijE3toqBN9vKg-I1q4X` | 666 | 23.3% |
| 24 | `1_Tt0i6QsSu4sF4rVJnZAEVqa3F79vXyW` | 163 | 30.1% |
| 27 | `196mMNJsoOgfnU60utfsok4H9zH--XuUU` | 34 | 50.0% |
| 28 | `1jr89eZMxHTVfK1qNCA_wpIW5ERnDMV7f` | 762 | 29.9% |
| 34 | `1OWSYmyIFG9QNmx4w1vpZ7Bz7uXOCbMGL` | 593 | 20.4% |
| 39 | `1SOFsZrxzs-8-ye5Ah1v9n9n7NgcrWLRb` | 761 | 23.7% |
| 56 | `1jbE7YDr3iB2MB6Ojt15lWa2SE8-0akiD` | 727 | 30.3% |
| 59 | `1nSuOjhhz0W1YqGf86dmxXZEHQ3kSnQVf` | 439 | 22.3% |
| 60 | `16ZPBXxI8nPB3C3xXy8LT2Wh7kIoJ1I8I` | 125 | 20.8% |
| 77 | `1MnoOfkhhmqLKfaqVTh-nN1mAsEdTxb2T` | 659 | 25.9% |
| 79 | `1RDh0hbX5ihsQKUk2H6VQ7yDaNBaszKKv` | 755 | 24.5% |

(Nota: 8 está justo en 20,0% sin la marca needsReview; 41 está en 19,4%.)

## Tabla por clase
| orden | id | segs | % cambiados | % [inaudible] | gapfill | título | estado | problemas |
|---|---|---|---|---|---|---|---|---|
| 1 | `14P9ahb9tVfKliOgcfW-1yFlyErv35s1h` | 283 | 81% | 6.7% | 0 | 1. ברכות ב ע׳׳א - רבנו תם, פלג המנחה, תרתי דסתרי. הזמן מדובק | **MINOR** | Rabenu Tam "tira, filostira" left [inaudible] although rendered "tartei desatrei" elsewhere in same class; "el Maran" -> "el Maharal" unverified |
| 2 | `174X--3jtdMIFXEwRbRbI4woQ4PL95Qiw` | 211 | 79% | 4.7% | 0 | 2. ברכות ב ע׳׳ב - שיטות בזמן קריאת שמע של ערבית, עני וכהן, סימן לדבר | **PASS** | - |
| 3 | `1ukqiImRJHle9h8UTfiyBc5xGbVU11sP2` | 283 | 89% | 6.7% | 0 | 3. ברכות ג ע׳׳א - משמרות הלילה, רבי יוסי בחורבה, חמור שור וכלב. גאון מוילנא | **MINOR** | topics 57 chars (>50); un-gapfilled sparse segment(s): seg 129 (58s); seg 197 "Mataná" mis-corrected to "matará" |
| 4 | `1PV-_H64Cg4lIh4x3ZXFWWG0FSe-7JjJ7` | 220 | 70% | 1.8% | 0 | 4. ברכות ג ע׳׳א-ע׳׳ב - אין נכנסין לחורבה, משמרות הלילה, דוד רגל רביעית | **PASS** | - |
| 4.2 | `1Hc2aldBBpK3Sg65n5RUEtDkDNgJNm0zd` | 206 | 77% | 1.0% | 0 | 4.2. ברכות ג ע׳׳ב - ארבע משמרות, רבי ורבי נתן, דוד רגל רביעית, תשובה | **PASS** | - |
| 4.3 | `1VWOv8nAjBiuZ7b49cq1zh37QkAAfpLa_` | 314 | 52% | 2.9% | 0 | 4.3. ברכות ג ע׳׳ב - דוד המלך וחצות, כנור ורוח צפונית, אור בחושך | **PASS** | - |
| 5 | `1GFi6tjyIEH77mnRi5zCbbleNwDfER15G` | 388 | 74% | 7.2% | 0 | 5. ברכות ה ע׳׳א - יסורים, תורה ארץ ישראל ועולם הבא. המן ואמונה, המרגלים ועץ הדעת | **MINOR** | topics 62 chars (>50); seg 132 "Ya estamos en 50" -> "en emuná" (speculative) |
| 6 | `1olANThmyJZccngKoSsfxW-QKAhoPhQVL` | 475 | 83% | 5.9% | 0 | 6. ברכות ד ע׳׳ב - סייג חצות, שיטת רבן גמליאל, ערבית חובה, טבי עבדו | **MINOR** | un-gapfilled sparse segment(s): seg 230 (101s) |
| 7 | `1Bddd547WEOtYW0DRexAh801SB2brGlQH` | 494 | 84% | 27.3% | 0 | 7. ברכות ה ע׳׳ב - יסורים של אהבה, נגעים ובנים, דין גרמא. יוסף ודוד | **MINOR** | needsReview (27.3% [inaudible]); un-gapfilled sparse segment(s): seg 473 (186s); over-redaction: plausible words (e.g. "loaj/ruaj tzfonit") replaced by [inaudible]; "betsem" spelling |
| 8 | `1upJUwK6fXAw7L748xLSvJQ-K5wcqxOG4` | 270 | 83% | 20.0% | 0 | 8. ברכות ה ע׳׳א - רבי יהושע בן לוי, מתן תורה ומלאך המות, בעלי ראתן, אתהפכא | **MINOR** | topics 56 chars (>50); [inaudible] 20.0% |
| 9 | `1P9uGCYv2FTh0JXgKL6Vx90UamabExFJX` | 365 | 94% | 24.7% | 0 | 9. ברכות ה ע׳׳ב - רבי יוחנן וריש לקיש, אור וחושך, סיני ועוקר הרים, רבי חייא | **MINOR** | topics 57 chars (>50); needsReview (24.7% [inaudible]); un-gapfilled sparse segment(s): seg 340 (55s) |
| 10 | `1br5ERpG__sm4BR2XJQMZThnj0PE5s9-6` | 993 | 81% | 6.0% | 22 | 10. ברכות ה ע׳׳ב-ו ע׳׳א - אבא בנימין, קשר המימרות. יעקב ובנימין, צפון ודרום. מזיקין ושכינה | **MINOR** | topics 64 chars (>50) |
| 11 | `1zL2KVTRERB5oBOihMlLflxBY_HG4zBKQ` | 138 | 83% | 11.6% | 0 | 11. ברכות ה ע׳׳ב-ו ע׳׳א - יוסף ובנימין, גלות מצרים, אבא בנימין | **PASS** | - |
| 12 | `1_dYAWUuB3mS5DHQVkgUDy_pzrKF19eGj` | 558 | 87% | 4.5% | 0 | 12. ברכות ה ע׳׳ב - אבא בנימין ובנימין הצדיק, פילגש בגבעה, יהודה ובנימין | **MINOR** | topics 52 chars (>50); un-gapfilled sparse segment(s): seg 443 (179s) |
| 14 | `1CPAQb4l7NPSSO8CT4jYHomTYH4TMYlbj` | 211 | 89% | 22.7% | 4 | 14. ברכות ו ע׳׳ב - קובע מקום לתפילתו, ענוה וחסידות, מהר״ל | **MINOR** | needsReview (22.7% [inaudible]) |
| 15 | `1vPoD1Gd7U3Ko92DiCsA364vbctC3BC-p` | 413 | 82% | 25.2% | 5 | 15. ברכות ו ע׳׳ב - אגרא דפרקא, תעניתא צדקתא. אחורי בית הכנסת | **MINOR** | needsReview (25.2% [inaudible]) |
| 16 | `11f90WqpFZUWA3_SLLtwiAIczRQFbjEDG` | 340 | 86% | 13.8% | 5 | 16. ברכות ו ע׳׳ב - מתפלל אחורי בית הכנסת, אליהו וטייעא, פנחס | **PASS** | - |
| 17 | `1MEEWCmYhRq1B8BKNiySUqeFNj0zp2tVr` | 192 | 93% | 16.7% | 0 | 17. ברכות ד ע׳׳ב-ז ע׳׳א - קשר הסוגיות, יוסף ויהודה, כבוד ה׳ | **MINOR** | [inaudible] 16.7% |
| 18 | `1pi89GYYpeZ4vRakO8JHYTfvsVupU1Q2q` | 473 | 79% | 21.4% | 0 | 18. ברכות ו ע׳׳ב - אחורי בית הכנסת, כרום זלות, להט החרב המתהפכת | **MINOR** | needsReview (21.4% [inaudible]); seg 410 "Jichu el Goen" -> "hijo del Gaón" (dubious) |
| 19 | `1xL6NAv1uLYmRscGdADjq-OaK5VFuTtDs` | 203 | 93% | 12.8% | 0 | 19. ברכות ו ע׳׳ב - קובע מקום לתפילתו, סדום ולוט, להט החרב המתהפכת | **PASS** | - |
| 20 | `12bIAAYzHK1HjQFgPj8jmQiOKeRelIEdw` | 625 | 88% | 4.5% | 0 | 20. ברכות ט ע׳׳א-ע׳׳ב - אליהו ענני ענני, תפילה בבחינת דין, הר הכרמל | **MINOR** | un-gapfilled sparse segment(s): seg 96 (125s), seg 207 (118s); daf ט defensible (rabbi says "tet, empieza en daf alef"), but main topic "aneni" is 6b |
| 21 | `15yNhd62DD2NmUmv9p0Pfq0TjOIycYcvw` | 360 | 91% | 25.0% | 0 | 21. ברכות ו ע׳׳ב - אליהו ענני ה׳ ענני, אהיה אשר אהיה, גלות ופורים | **MINOR** | needsReview (25.0% [inaudible]) |
| 22 | `10ZYh0w2h8p_bXijE3toqBN9vKg-I1q4X` | 666 | 85% | 23.3% | 21 | 22. ברכות ו ע׳׳ב - משמח חתן, קולות מתן תורה, פנחס, שלום | **MINOR** | needsReview (23.3% [inaudible]); un-gapfilled sparse segment(s): seg 189 (47s) |
| 23 | `1hcNs1IgRyN2GY2avHSp3wtS0eU1yC2v5` | 590 | 90% | 8.5% | 5 | 23. ברכות ז ע׳׳א - הקב״ה מתפלל, בית תפילתי, ישמעאל בני ברכני | **MINOR** | un-gapfilled sparse segment(s): seg 132 (92s), seg 216 (46s) |
| 24 | `1_Tt0i6QsSu4sF4rVJnZAEVqa3F79vXyW` | 163 | 84% | 30.1% | 25 | 24. ברכות ז ע׳׳א - תפילת הקב׳׳ה, תפילה על הכלל. עת רצון | **MINOR** | needsReview (30.1% [inaudible]); over-redaction (e.g. seg 114 raw "Sefer Mitzvot" -> "séfer [inaudible]"; "Sefer Jaim" redacted in 111 but kept in 115) |
| 26 | `1ZymKQut-igtfLvmjl4229RBCUeoXGPaM` | 541 | 82% | 14.0% | 5 | 26. ברכות ז ע׳׳א - ואל זועם בכל יום, בלעם שתום העין, קללה לברכה | **PASS** | - |
| 27 | `196mMNJsoOgfnU60utfsok4H9zH--XuUU` | 34 | 91% | 50.0% | 0 | 27. ברכות ז ע׳׳א - רע מתהפך לטוב, תשובה, ונהפוך הוא. פורים | **MINOR** | needsReview (50.0% [inaudible]); 4-min fragment, 50% [inaudible]; some recoverable (e.g. "láhat hajérev hamithapéjet" in seg 32) |
| 28 | `1jr89eZMxHTVfK1qNCA_wpIW5ERnDMV7f` | 762 | 87% | 29.9% | 0 | 28. ברכות ז ע׳׳א - בלעם ורגע הזעם, עמלק. שער החמישים, פנחס | **MINOR** | needsReview (29.9% [inaudible]); summary has 4 sentences; heavy [inaudible] (351 tokens); summary 4 sent |
| 29 | `1fcggTD6ZXrkhMik3JoDlr0I089Idj6ds` | 486 | 81% | 13.6% | 4 | 29. ברכות ז ע׳׳א - מרדות אחת, נבואת הושע. צדיק ורע לו. משה ורבי עקיבא | **PASS** | - |
| 30 | `18hZkr4nVv1hbkX-sjs2JXG3BuC5SIKL7` | 742 | 82% | 12.8% | 0 | 30. מגילה יט ע׳׳א-ע׳׳ב - כוונות פורים. ספר ואגרת, שיור התפר, אורה | **PASS** | - |
| 30.2 | `1Dm2ek9SJipbdXgyyhEZ7mJamVrV0v8b3` | 445 | 90% | 6.7% | 5 | 30.2. ברכות ו ע׳׳ב - הקובע מקום לתפילתו, אברהם ופנחס, ברית | **MINOR** | un-gapfilled sparse segment(s): seg 422 (48s) |
| 33 | `1RvzP7TOvA38kzxzTOeiGxuBNJQkhwLGh` | 486 | 92% | 10.5% | 0 | 33. נדרים לא ע׳׳ב-לב ע׳׳א - משה ומילה במלון, אף וחמה, חרפת מצרים | **PASS** | - |
| 34 | `1OWSYmyIFG9QNmx4w1vpZ7Bz7uXOCbMGL` | 593 | 77% | 20.4% | 18 | 34. ברכות ז ע׳׳ב - אדנות אברהם, הודאת לאה, ראובן ועשו | **MINOR** | needsReview (20.4% [inaudible]); un-gapfilled sparse segment(s): seg 322 (113s); seg 416 pasuk "Vayihyú vené Yaakov shnem asar" added with no support in raw or Plaud (Plaud has only Spanish) |
| 35 | `12uXV3RF9S9K5Jbv6PIwXo8tZprTaVDXy` | 746 | 81% | 0.0% | 21 | 35. ברכות ז ע׳׳ב - אדנות והוי״ה, הודאת לאה, ראובן, אבשלום | **MINOR** | un-gapfilled sparse segment(s): seg 66 (123s) |
| 36 | `1jiL_jKQLYfd8hqijdZcdk3ivPELhnxb-` | 762 | 90% | 16.3% | 20 | 36. ברכות ז ע׳׳ב - מותר להתגרות ברשעים, יעקב ועשו, אבשלום | **MINOR** | [inaudible] 16.3% |
| 38 | `1WhrYMuxA7eG__uvR6OaTw3UlKvmeMeeO` | 333 | 88% | 8.7% | 0 | 38. ברכות ז ע׳׳ב-ח ע׳׳א - ואני תפילתי עת רצון, קוב׳׳ה ושכינתיה, נצח | **MINOR** | un-gapfilled sparse segment(s): seg 48 (82s) |
| 38 | `1qy_f-GgJxGdZzJ7Dyb3XVpQfu5DXDPQl` | 601 | 71% | 14.0% | 3 | 38. ברכות ח ע׳׳א - עת רצון, יחיד וציבור, דוד והשכינה | **PASS** | - |
| 39 | `1SOFsZrxzs-8-ye5Ah1v9n9n7NgcrWLRb` | 761 | 85% | 23.7% | 0 | 39. ברכות ח ע׳׳א-ע׳׳ב - שנים מקרא ואחד תרגום, בבל, שברי לוחות | **MINOR** | needsReview (23.7% [inaudible]) |
| 40 | `1Y96lGpJNss_pZEmNOX8h7OYhq7p8JdQ2` | 642 | 89% | 7.9% | 0 | 40. ברכות ח ע׳׳א-ע׳׳ב - סוד התרגום, מטת ארמית, שלמה ובת פרעה | **MINOR** | pesukim inserted in 0-2 s segs (244, 519-520) - Plaud-supported, OK |
| 41 | `1wUFXln2qAAO6uGj4cXQTRidhDZuqjjn8` | 573 | 91% | 19.4% | 9 | 41. ליקוטי מוהר״ן יט - לשון הקודש ותרגום, עץ הדעת, שנים מקרא | **MINOR** | [inaudible] 19.4%; un-gapfilled sparse segment(s): seg 102 (125s), seg 233 (61s); seg 77 "Bar Jaú" (=Bar Yojai, obvious in context) -> [inaudible] |
| 42 | `1I255D7gf-98c5QFiVd_SWGwZt2jWqiy0` | 796 | 78% | 12.1% | 0 | 42. ברכות ח ע׳׳ב - משפט שלמה ושמעי, מקץ ויגש, אחורי בית הכנסת | **PASS** | - |
| 43 | `1I8qU1PzLDeEkdLvy27eM2RCpBqI86dFC` | 621 | 89% | 14.2% | 7 | 43. ברכות ח ע׳׳ב - מדיים ופרסיים, תרפים, אכילה ואמונה | **PASS** | - |
| 44 | `17E3cBqYTGEZBN2Cid7byxrJx11rPYGI1` | 785 | 81% | 15.3% | 0 | 44. ברכות ט ע׳׳א-ע׳׳ב - חפזון, גאולה בלילה, רכוש גדול, אהיה | **MINOR** | [inaudible] 15.3%; seg 690 "Rabbi dice" -> "Rabí Akiva dice" (name added) |
| 45 | `1NJqfeVH9Sabp98sTE7RJNb8lM5HY6f1W` | 641 | 78% | 13.9% | 0 | 45. ברכות ט ע׳׳ב - עץ החיים אין לו מקום, רב טבות וקושטא | **PASS** | - |
| 46 | `131OSApIwOZI_4T0cbktHPUlUySyyBGwt` | 526 | 69% | 10.1% | 13 | 46. ברכות ט ע׳׳ב - משיכיר, תכלת, זאב וכלב, פני אדם. ותיקין | **MINOR** | un-gapfilled sparse segment(s): seg 63 (45s), seg 148 (48s), seg 307 (175s); seg 507 Spanish reworded ("Anoche" -> "En la noche") |
| 46 | `1mxCuMhwdIJMsI12zWwN1A7cbBqoi2gG-` | 772 | 73% | 18.4% | 8 | 46. ברכות ט ע׳׳ב - משיכיר, ותיקין, סמיכות גאולה לתפילה | **FAIL** | [inaudible] 18.4%; un-gapfilled sparse segment(s): seg 382 (68s), seg 430 (151s); segs 382,427,428,430,432,433,434 (+713): ~2,700 chars of Spanish copied from Plaud into Scribe segments (e.g. 0.4 s seg 428 carries a full paragraph) - violates "nunca copies segmentos de Plaud"; the underlying Scribe misses (segs 382 68s, 430 151s) were never gap-filled |
| 47 | `1kdN4JRLGdmLOUOKWjE4IU5VPnuCf5yyS` | 690 | 87% | 12.6% | 15 | 47. ברכות ט ע׳׳ב-י ע׳׳א - יהיו לרצון, ברוריה, סמוכין. בן ועבד | **PASS** | - |
| 48 | `1ElZ8SuZ7sWJmu6lbx1UrnLOT_nxgb3V4` | 646 | 72% | 12.5% | 0 | 48. ברכות ט ע׳׳ב - ליקוטי מוהר״ן נא, סמיכת גאולה לתפילה, אמת ושקר | **MINOR** | un-gapfilled sparse segment(s): seg 506 (135s) |
| 50 | `1UvKhL2VtJoiizbVeSctIOq1tphcMnG-z` | 902 | 87% | 18.4% | 0 | 50. ברכות י ע׳׳א-ע׳׳ב - ברכי נפשי, ניגון, חזקיהו וישעיהו | **MINOR** | [inaudible] 18.4% |
| 51 | `1XEy2-_UZpcxkd_LuOyteR7UEebNOlx0m` | 736 | 90% | 14.4% | 0 | 51. ברכות י ע׳׳א - חזקיה וישעיהו, ויהי, אמוץ ואמציה, חזק ואמץ | **PASS** | - |
| 52 | `1jMhcwvyo06U6LwxTqPzoGoyqnpGKUhUk` | 326 | 87% | 13.5% | 0 | 52. ברכות י ע׳׳ב - חזקיהו והקיר, סמך גאולה לתפילה, תשובת מנשה | **PASS** | - |
| 53 | `1DtLAMaprPlvoZROapEgOP_BI7OvbGDbm` | 896 | 82% | 6.2% | 38 | 53. ברכות י ע׳׳ב - חזקיהו ותחיית המתים, סנחריב, פורים ואמונה | **MINOR** | un-gapfilled sparse segment(s): seg 231 (152s) |
| 54 | `1ztghJ1GM8ZRhbIHbt00jbMbS0mZYgFL0` | 649 | 77% | 17.6% | 0 | 54. ברכות י ע׳׳ב - שונמית ועליית קיר, ממעמקים, יש ואין, שופר | **MINOR** | [inaudible] 17.6%; un-gapfilled sparse segment(s): seg 285 (57s) |
| 55 | `1Ry7a1Uj5NS_Z0JqALS3j5YWowuiP3k08` | 384 | 78% | 10.7% | 39 | 55. ראש השנה טז ע׳׳ב - שרה והגר, לך לך יש ואין, שער הנון | **PASS** | - |
| 56 | `1jbE7YDr3iB2MB6Ojt15lWa2SE8-0akiD` | 727 | 84% | 30.3% | 0 | 56. ברכות י ע׳׳ב - שונמית ועקידה, קיר חזקיהו, אין ייאוש | **MINOR** | needsReview (30.3% [inaudible]); un-gapfilled sparse segment(s): seg 417 (56s); heavy [inaudible]; e.g. seg 606 "como remo" (=remez) redacted |
| 57 | `1E8B9OLO8vtxKBaYyeFuZ0Lyi-XzLl4KX` | 652 | 86% | 9.5% | 0 | 57. ברכות י ע׳׳ב - שונא מתנות, זבוב וקרי, כיסופין | **PASS** | - |
| 58 | `19HXeQr5WvCtv3TjeIOBaAN_ledlEo6FW` | 846 | 83% | 13.6% | 0 | 58. ברכות י ע׳׳ב - שונמית ואלישע, אהבה בלי גבול, שים שלום | **MINOR** | un-gapfilled sparse segment(s): seg 0 (66s) |
| 59 | `1nSuOjhhz0W1YqGf86dmxXZEHQ3kSnQVf` | 439 | 88% | 22.3% | 9 | 59. ברכות י ע׳׳ב - קריאת שמע בזמנה, תלמוד תורה, מסירות נפש | **MINOR** | needsReview (22.3% [inaudible]); un-gapfilled sparse segment(s): seg 398 (49s) |
| 60 | `16ZPBXxI8nPB3C3xXy8LT2Wh7kIoJ1I8I` | 125 | 86% | 20.8% | 0 | 60. ברכות י ע׳׳ב - בית שמאי ובית הלל, רבי טרפון בדרך, יוסף | **MINOR** | needsReview (20.8% [inaudible]) |
| 61 | `1BTlVkq7DMXGpNu765jACakoyONpeWPyn` | 529 | 81% | 15.9% | 0 | 61. ברכות יא ע׳׳א - הטה ר׳ אלעזר, עשה כב״ש לא עשה כלום, זהב קונה כסף | **MINOR** | [inaudible] 15.9% |
| 62 | `1sHP6BeadMoF1ejlk89DHKCWqDq3oygyn` | 517 | 67% | 8.9% | 9 | 62. ברכות יא ע׳׳א - כסף וזהב, טבעא ופירא. אמונה ונתינה | **MINOR** | un-gapfilled sparse segment(s): seg 279 (124s) |
| 63 | `1OsYcMwjwxdv9DaYm7Vm3wBTkYlqeaZuz` | 696 | 88% | 11.9% | 0 | 63. ברכות יא ע׳׳א - בית שמאי ובית הלל, דין ורחמים, בבא בן בוטא | **MINOR** | un-gapfilled sparse segment(s): seg 369 (47s) |
| 64 | `1tjcXOIPURPvq1FYFJ5abLk9KhHbjB-5p` | 545 | 85% | 16.0% | 0 | 64. ברכות כז ע׳׳ב-כח ע׳׳א - הדחת רבן גמליאל, ראב״ע, יהודה גר עמוני | **MINOR** | [inaudible] 16.0% |
| 65 | `1zxzZGUx73BC2byvY8DiQ4JoNeJXPFa1w` | 644 | 81% | 14.9% | 17 | 65. ברכות כז ע׳׳ב-כח ע׳׳א - רבן גמליאל וראב״ע, תוכו כברו, מזה בן מזה | **MINOR** | un-gapfilled sparse segment(s): seg 358 (84s), seg 373 (65s) |
| 66 | `1tG9Uxpz693ivKNL5lklHJuuaI87-j2b8` | 798 | 81% | 12.4% | 0 | 66. ברכות יא ע׳׳א-ע׳׳ב - יוצר אור ובורא חושך, נוגה, שתי רשויות | **MINOR** | un-gapfilled sparse segment(s): seg 600 (138s) |
| 68 | `1N5jYNz-IGiTfIqlRPjdQtJ-SJSyfdYhV` | 560 | 81% | 5.7% | 0 | 68. ברכות יא ע׳׳ב - אהבה רבה ואהבת עולם. עולם הפוך. תניא מג | **PASS** | - |
| 69 | `1zDXx2XgJ935UR4760YSBGd1aNwvnSesQ` | 611 | 79% | 16.5% | 0 | 69. ברכות יא ע׳׳ב - ברכות התורה, אהבה רבה, כבוד וטוב | **MINOR** | [inaudible] 16.5% |
| 70 | `1LtlBkZpo3ss4Ke4VYodmBXu5f3gSSEBD` | 598 | 85% | 10.7% | 0 | 70. ברכות יא ע׳׳ב-יב ע׳׳א - ברכה אחת, אהבה ויראה, תרעומת המינין | **PASS** | - |
| 71 | `1VQTZkAyDvv3tqyispKj6JyZp9TbdZS_U` | 486 | 86% | 9.1% | 9 | 71. ברכות יב ע׳׳א-ע׳׳ב - אמת ואמונה ויציב, כורע בברוך, רב ששת והנחש | **MINOR** | un-gapfilled sparse segment(s): seg 220 (229s) |
| 73 | `1Qix-nk0nVdMCEe1UGcM32zhdzLxhWYfR` | 616 | 88% | 5.0% | 0 | 73. ברכות יב ע׳׳א-ע׳׳ב - כריעה וזקיפה, המלך הקדוש, בקשת רחמים, מלכות שאול | **PASS** | - |
| 74 | `1TzwS36F1O0eSka6uLRLImQ1nKuqAhCfV` | 715 | 77% | 3.4% | 0 | 74. ברכות יב ע׳׳ב - כורע וזוקף, חולה ומחילה. מלכות שאול | **PASS** | - |
| 75 | `1U48alsCWGxNooWfUp3h2-JgFv6Q8uclk` | 575 | 76% | 9.9% | 0 | 75. ברכות יב ע׳׳ב - שאול ושמואל, הנהגת היחוד והמשפט, יונתן | **PASS** | - |
| 76 | `1RynGDpU00RHY9iqywq0XN68OpvgfzxAz` | 622 | 78% | 11.3% | 27 | 76. ברכות יב ע׳׳ב - פרשת בלק בקריאת שמע, בלעם, ייחוד ומשפט | **MINOR** | meta.daf also lists ז ע׳׳א (not in title) |
| 77 | `1MnoOfkhhmqLKfaqVTh-nN1mAsEdTxb2T` | 659 | 82% | 25.9% | 0 | 77. ברכות יב ע׳׳ב - פרשת בלק, ציצית, אמת ואמונה | **MINOR** | needsReview (25.9% [inaudible]) |
| 78 | `1cf7kfHPgalFiI16do323nh9_wDQABAoO` | 678 | 88% | 9.0% | 0 | 78. ברכות יב ע׳׳ב-יג ע׳׳א - יציאת מצרים בלילות, אברם אברהם, ריש לקיש | **PASS** | - |
| 79 | `1RDh0hbX5ihsQKUk2H6VQ7yDaNBaszKKv` | 755 | 89% | 24.5% | 0 | 79. ברכות יב ע׳׳ב-יג ע׳׳א - שינוי שמות, ודאי איה אהיה, למפרע | **MINOR** | needsReview (24.5% [inaudible]); un-gapfilled sparse segment(s): seg 241 (125s), seg 242 (73s) |
| 80 | `1phk7xO41gATFsgiFH_Lyg3aY8MYlpAL_` | 667 | 89% | 3.9% | 0 | 80. הוריות י ע׳׳א-ע׳׳ב - אשר נשיא יחטא, עוזיהו, נשיא וכהן. רבן גמליאל ור׳ יהושע | **MINOR** | topics 54 chars (>50) |
| 81 | `1f2ua9MJfIC0xo1gBqP-CIX0jV2LMk1o6` | 415 | 85% | 4.8% | 0 | 81. ברכות יב ע׳׳ב-יג ע׳׳א - יעקב וישראל. ישעיה מג. גאולה העתידה | **MINOR** | un-gapfilled sparse segment(s): seg 348 (69s) |
| 84 | `1ZQKqJJNNUNHGR2-WqbJUhdrek8N-5iCk` | 289 | 78% | 7.6% | 0 | 84. ברכות יג ע׳׳א - משנה היה קורא, כבוד ויראה בק׳׳ש, שבט דן | **PASS** | - |
| 85 | `1W2vcpjilAne5Hzuu8xaKbmTifaWPrxRY` | 680 | 83% | 13.8% | 11 | 85. ברכות יג ע׳׳א - ר׳ מאיר ור׳ יהודה, עול מלכות ומצוות, וידוי | **PASS** | - |
| 86 | `10fnXKTTW1fLGy58ItyGpQpApbWpwR0y7` | 522 | 86% | 7.9% | 19 | 86. ברכות יג ע׳׳א - קורא להגיה, כוונה. שמע והיו, כל לשון | **PASS** | - |
| 87 | `1joVXBftwC1SxE6LZR43Ds32g6T8e9FTS` | 423 | 67% | 12.8% | 10 | 87. ברכות יג ע׳׳א - שמע בכל לשון, דיבור ועצמיות, פרד״ס | **MINOR** | un-gapfilled sparse segment(s): seg 162 (100s) |
