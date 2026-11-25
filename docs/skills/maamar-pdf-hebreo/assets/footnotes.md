# Notas al pie en WeasyPrint 69

Usar **notas al pie nativas de CSS**, no `<sup>` manual.

```html
<p>טקסט הגוף <span class="nota">תוכן ההערה</span> המשך.</p>
```
```css
.nota { float: footnote; }
@page { @footnote { border-top:.5pt solid #000; padding-top:4pt; } }
```

WeasyPrint numera solo, pone el marcador volado y baja el contenido al pie de
la página correcta, gestionando los saltos.

**No usar `<sup>` manual:** obliga a numerar a mano, no baja el contenido y se
rompe al reordenar (y en este skill se reordena bastante).

En modo maamar, una nota al pie es buen lugar para la **referencia exacta de
una fuente** (mar'eh makom) que en el audio el rav mencionó de pasada, sin
inventar nada: solo lo que esté en el original.
