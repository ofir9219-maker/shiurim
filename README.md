# ברכות שר לשמחה — shiurim site

Next.js 15 (App Router, TypeScript) + SQLite (better-sqlite3, FTS5). Runs on any Node 20+ host.

## Local run
```bash
npm install
cp .env.example .env.local      # all keys optional
npm run build:db                # inventory.json + data/polished -> data/shiurim.db (idempotent)
npm run build && npm start      # http://localhost:3000
```
- `npm run build:db -- --fixtures` builds from `data/fixtures` (demo data); `DB_PATH=...` changes the DB location.
- `npm run embed` = build:db + embeddings (needs `OPENAI_API_KEY`; skips unchanged chunks by hash). Without a key search is full-text only.
- `npm run sync` lists the Drive folder (needs `GOOGLE_API_KEY` or `GOOGLE_SERVICE_ACCOUNT_JSON`), reports new audios that need transcription. Dry-run by default; `--write` appends to `data/inventory.json`; `--upload-r2` copies audio to R2 (needs R2_* vars; writes `data/r2-keys.json`, picked up by build:db).
- Audio: `R2_PUBLIC_BASE_URL` -> R2 presigned -> `/api/audio/[id]` (Drive proxy with Range support).
- Behind an HTTP proxy, set `HTTPS_PROXY`; the server routes `fetch` through it (`instrumentation.ts`).

## Generic Node hosting
Build step: `npm install && npm run build:db && npm run build`. Start: `npm start` (port 3000; set `PORT` via `next start -p`). Ship `data/shiurim.db` or run build:db on the host. Requires a writable-less filesystem only (DB opened read-only at runtime). Set env vars per `.env.example`.

See `docs/API.md` for routes and library signatures.


## Drive transcription center
`/admin/drive` (admin password) manages series (Drive folders), Fal transcription, OpenAI/AI-package polishing, naming templates and publication. See `docs/DRIVE-CENTER.md`. Public series live at `/c/<slug>`.
