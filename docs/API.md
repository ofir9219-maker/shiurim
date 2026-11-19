# API and library reference

All routes are dynamic JSON. `audioUrl` is the best playable URL (R2 public -> R2 presigned -> `/api/audio/<id>`). Hebrew query params must be URL-encoded.

## Routes
- `GET /api/classes[?daf=ג]` -> `{classes: ClassSummary[]}` ordered by `ord`. `daf` filters by daf letter (any amud).
- `GET /api/classes/:id` -> `ClassSummary & {segments: Segment[]}`; 404 `{error}`.
- `GET /api/search?q=&daf=&limit=30[&mode=hybrid]` -> `{q, hits: TextHit[], semantic?: ChunkHit[]}`. Hits contain `<mark>…</mark>` in `snippet`. Seek the player to `startMs`. Empty/garbage `q` -> `hits: []`.
- `GET /api/audio/:id` -> audio stream proxied from Drive; supports `Range` (206 + `Content-Range`).

## Types (lib/db.ts, lib/search.ts)
```ts
type Daf = {daf: string; amud: string}            // amud "א"|"ב"
type ClassSummary = {id; ord:number; ordLabel; title; fileName; daf: Daf[]; dafLabel; durationMs; summary; tags: string[]; audioUrl; hasTranscript: boolean}
type Segment = {idx; startMs; endMs; text}
type TextHit = {classId; title; segmentIdx; startMs; snippet}
type ChunkHit = {classId; title; startMs; endMs; text; score; source: "fts"|"vector"|"both"}
```

## Library (server-side only; import relatively, e.g. `../lib/db`)
- `lib/db.ts`: `getDb()`, `listClasses({daf?})`, `getClass(id)`, `getSegments(id)`, `rowToClass(row, audioUrl)`, `openDb({create})`. Returns empty results if DB not built.
- `lib/search.ts`: `textSearch(q,{daf?,limit?}): TextHit[]` (FTS5 bm25, prefix, accent-insensitive, sanitized); `hybridSearch(q,k): Promise<ChunkHit[]>` (RRF of FTS + cosine over chunk embeddings; FTS only without embeddings/key); `hasEmbeddings()`.
- `lib/embeddings.ts`: `embedTexts(string[]) -> Float32Array[]`, `cosine`, `vecToBlob`, `blobToVec`, `hasEmbeddingKey()`.
- `lib/audio.ts`: `audioUrlFor(id, r2Key?)`, `driveDownloadUrl(id)`, `getR2Client()`.
- `lib/proxy.ts`: `setupProxy()` (undici EnvHttpProxyAgent when HTTPS_PROXY set; auto-called in `instrumentation.ts`).

## Schema
`classes(id, ord, ord_label, title, file_name, daf JSON, daf_label, duration_ms, summary, tags JSON, audio_url, r2_key, has_transcript)`, `segments(id, class_id, idx, start_ms, end_ms, text)`, `segments_fts` (FTS5 external-content, unicode61 remove_diacritics 2), `chunks(id, class_id, start_ms, end_ms, text, hash, embedding BLOB float32 x EMBEDDING_DIMS)`.

## Notes for frontend
Note: `@/` path alias does not resolve under the installed toolchain in API routes; use relative imports. `typescript` is pinned to 5.x (Next 15 does not support TS 7).
