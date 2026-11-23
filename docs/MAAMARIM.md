# Biblioteca de Maamarim

- **/maamarim** — biblioteca digital: catálogo por categorías (códigos 1, 1.1, …), estantes, signatura `<código>.<nº>` (ej. 1.1.03), filtro, etiquetas, orden por catálogo / fecha / título.
- **/maamarim/<id>** — lector: portada, תוכן עניינים, פרקים, citas, notas, ficha catalográfica, PDF (si hay), imprimir, tamaño de letra.
- **/maamarim/preguntar** — chat IA independiente del de los shiurim: busca SOLO en los maamarim (FTS sin nikud/prefijos + embeddings, consultas en hebreo y español generadas por el modelo), responde completo con citas [n] → פרק exacto. Varios chats con memoria por chat; `?m=<id>` limita a un maamar.
- **/admin/maamarim** — subir/editar (marcado + ficha JSON, o «Cargar JSON de subida»), PDF, categorías (renombrar, mover, ordenar, descripción), enlace del conector.

## Subida desde Claude (skill maamar-pdf-hebreo)
Conector MCP: `https://ofirsegal.app/api/maamarim/mcp/<token>` (copiar en /admin/maamarim; agregar en claude.ai → Configuración → Conectores → conector personalizado).
Herramientas: `listar_categorias`, `subir_maamar`, `listar_maamarim`, `obtener_maamar`, `buscar_en_maamarim`, `guia_biblioteca`.
API equivalente: `POST /api/maamarim/upload/<token>` (JSON), `POST …/upload/<token>/pdf?id=` (PDF binario).
El skill actualizado está en `docs/skills/maamar-pdf-hebreo/` (y `.zip` para subirlo en claude.ai → Skills).

## Datos
`$STORAGE_DIR/maamarim/items/<id>.json` (fuente de verdad), `categories.json`, `token.json`; índice `$STORAGE_DIR/maamarim.db` (reconstruible); PDFs en R2 `maamarim/<id>.pdf`.
Formato del texto y ficha: `lib/maamarim/guide.ts`. Tests: `npm run test:maamarim`.
