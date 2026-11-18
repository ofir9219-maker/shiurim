# AI chat

`POST /api/chat` `{messages:[{role,content}], memory?, classId?, model?, effort?}` streams **ndjson** (`application/x-ndjson`):
`{"type":"delta","text":"..."}` (many) then `{"type":"done","refs":[{classId,title,startMs,quote}],"cited":[1,3],"mode":"ai|noai|error", memory?, condensed?}`.
`[n]` markers in the text map to `refs[n-1]`; `cited` lists the markers the model used (all refs in `noai`).

## Flow (`lib/chat.ts`, `lib/retrieval.ts`, `lib/translit.ts`)
1. **Intent** (`lib/chat-core.ts`): "resume / de qué trata / sobre qué trata..." + a class found by order number ("shiur 23", "clase 1.2") or title/daf/tag match (or the `classId` sent by the page) -> *summary*; otherwise *Q&A*.
2. **Q&A, high-recall retrieval**
   - **Plan** (`planQueries`): a cheap model (`CHAT_PLANNER_MODEL`, default `gpt-4.1-mini`, JSON mode, ~1 s; independent of the user's model/effort) sees the last turns + memory and returns 4-6 distinct queries (standalone rewrite, key terms, Hebrew terms in several spellings, paraphrase, related concepts) and an optional `daf`. No key / failure: heuristic keywords + the raw question.
   - **Search** (`searchChunks`), per query: normalized-FTS OR (bm25, terms more common than 12% of chunks dropped), normalized-FTS AND of the rare terms, raw FTS, and a vector list (512-d, one batched embeddings call for all queries). All lists are fused with RRF (the first, standalone query weighs 1.4). A `daf` filter adds a second restricted pass. **Class stage**: FTS over class title+tags+summary and vectors over the same text (`class_vecs`) rank classes; chunks of the top 4 classes get a small boost and the top class summaries are put in the context.
   - **Transliteration normalization** (`lib/translit.ts`, `normText`): lowercase, no accents/apostrophes, hyphen -> space, ch/kh/h->j, sh->x, tz/ts/z->z, q/c->k, ph->f, w/v->b, gu(e|i)->g, doubled letters collapsed, initial schwa (Shemá/Shma), Rabí/Rabbi/Rav -> rab. The same function runs at build time (shadow tables) and on queries, so jesed/hesed/chesed, Shemá/Sh'ma, kavaná/kavana, tzadik/tsadik... match.
   - **Context** (`buildPassages`): top 36 chunks, the best 14 expanded +-1 neighbor chunk, contiguous chunks merged into windows, grouped by class in chronological order, ~60k chars budget, `(mm:ss)` marks inside each window. Each window is a numbered ref (`[n]`, `Ref.startMs..endMs`, `score`). Typical context: 20-35 passages.
   - Older DBs without the normalized tables fall back to the previous single-query hybrid search.
3. **Summary**: class summary + 8 evenly spaced transcript excerpts within a ~9k char budget; refs are those key moments.
4. **LLM** (`lib/chat-llm.ts`, plain `fetch` via the proxy dispatcher): answers in the user's language (Spanish by default), only from the excerpts, `[n]` citations, length adapts (up to 1500 tokens), never "No encontré esto en los shiurim" if related material exists (says what was found/where). With OpenAI the model gets a `buscar(query, daf?, clase?)` tool (`streamWithTools`): up to 2 extra retrieval rounds that skip chunks already sent; new passages are appended to `refs` with continuing numbers. Anthropic provider: same context, no tool.
5. **No key / LLM failure**: "modo sin IA" note plus the top 8 windows (FTS only) as refs; never throws.

## Index (built by `scripts/build-db.ts`; `npm run embed` on Railway when `OPENAI_API_KEY` is set)
Besides `segments`/`segments_fts`/`chunks`: `chunks_fts` (raw), `chunks_nfts` (normalized shadow text, rowid = chunk id), `classes_nfts` (normalized title+tags+summary), `class_vecs` (class embeddings, only with `--embed`). All FTS tables are rebuilt on every `build:db` (chunk ids change); embeddings are kept by hash.

## Eval (`scripts/eval-chat.ts`, `tests/eval/questions.json`)
37 questions (34 covered: rabbis, pesukim, concepts, transliteration variants, vague, "¿en qué clase...?"; 3 not covered) with accepted classes/time windows. `OPENAI_API_KEY=... npx tsx scripts/eval-chat.ts [--e2e] [--model gpt-5-mini] [--effort low] [--k 8] [--only q01,q02] [--out f.json]`. Retrieval mode reports recall@K (by retrieval score) and recall in the whole context; `--e2e` also reports wrong "no encontré" on covered questions, correct abstentions, whether a cited `[n]` points to the right class/window, token usage and latency. Results are in the "Results" table below.

### Results (34 covered + 3 not covered questions; `--effort low`, 3 concurrent)
| | baseline (1 query, 8 passages, 600 tok) | now |
|---|---|---|
| recall@8 (covered) | 82% (28/34) | 94% (32/34, ranked by score) |
| recall in the whole context | 82% (8 passages) | 100% (~27 passages, ~60k chars) |
| wrong "No encontré" with gpt-5-mini / gpt-5.2 | 21% (7/34) / 32% (11/34) | 0% / 0% |
| correct abstention on the 3 uncovered | 3/3 | 3/3 (mini), 2/3 (5.2) |
| `[n]` cites the right class | 79% | 91% (mini) / 97% (5.2) |
| latency (retrieval only / answer end-to-end) | 0.4 s / 3.5 s | ~2 s / 8-10 s (planner ~1.2 s + embeddings ~0.6 s + larger prompt, up to 2 tool rounds) |
| approx. cost per question | ~$0.001 / ~$0.006 | ~$0.007 (gpt-5-mini: ~21k input + ~0.7k output tokens) / ~$0.045 (gpt-5.2), + ~$0.0005 planner |

Prices assumed: gpt-5-mini $0.25/$2 per M tokens, gpt-5.2 $1.75/$14, gpt-4.1-mini $0.40/$1.60 (reasoning tokens are included in the output count). The dominant cost is the ~60k-char context; lower `CONTEXT_BUDGET` in `lib/chat.ts` to trade recall for cost/latency.

## Env
- `LLM_PROVIDER` = `openai` (default) | `anthropic`
- `CHAT_PLANNER_MODEL` (default `gpt-4.1-mini`): cheap model for the multi-query planning step (OpenAI provider; Anthropic uses its main model)
- OpenAI: `OPENAI_API_KEY`, `CHAT_MODEL` (default `gpt-4.1-mini`), `OPENAI_BASE_URL` (also used by embeddings)
- `CHAT_MODELS`: optional comma-separated model allowlist for the selector
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ANTHROPIC_BASE_URL`

## Models and reasoning effort (`lib/chat-models.ts`)
`GET /api/chat/models` -> `{models:[{id,label,reasoning}], default, efforts:["minimal","low","medium","high"], defaultEffort, enabled}`. `enabled` is false without an AI key (UI hides the settings row).
- Source: `CHAT_MODELS` (comma-separated allowlist) if set; else, with `OPENAI_API_KEY`, `GET {OPENAI_BASE_URL}/models` server-side (proxy dispatcher, cached 1h) filtered to `/^(gpt-|o\d|chatgpt-)/` minus audio/realtime/tts/transcribe/search/image/embedding/instruct, newest first; fallback `["gpt-4.1-mini"]`. Default = `CHAT_MODEL` if listed, else first.
- `reasoning` = id starts with `o<digit>` or `gpt-5`.
- `POST /api/chat` validates `model` against that list (unknown -> default) and `effort` against the enum (invalid -> `medium`). Reasoning models get `reasoning_effort` + `max_completion_tokens` and no `temperature`; other models ignore effort. On an OpenAI 400 mentioning effort/temperature the request is retried once without that param. The Anthropic provider ignores both.
- UI: model `<select>` + "Nivel de razonamiento" segmented control (only for reasoning models), stored in `localStorage` (`shiurim-chat-prefs-v1`); collapsible "Ajustes" row on mobile.

## Conversations and memory
- **Storage (client only; the server has no persistence)**: `lib/chat-store.ts`, `localStorage` key `shiurim-chats-v1` (`{v:1,chats:[...]}`), active chat in `shiurim-chat-active-v1`. Chat = `{id,title,createdAt,updatedAt,messages:[{role,content,refs?,cited?,mode?,model?,effort?}],memory?,memoryUpTo?,model,effort,classId?}`. Max 50 chats / 200 messages each; empty chats are never stored; on quota errors refs of older chats are stripped, then the oldest chats dropped. All reads/writes are in try/catch.
- **Memory** (`lib/chat-memory.ts`, `updateMemory` in `lib/chat.ts`): the client sends `messages.slice(memoryUpTo)` (max 40) plus `memory`. If that slice has > 12 messages or > 12k chars, after answering the server folds all but the last 6 into a rolling memory (LLM, Spanish, <= 1200 chars; no key / failure: `Preguntas anteriores: q1 | q2 ...`, newest kept) and returns `memory` and `condensed` (number of messages folded) in the `done` event; the client stores `memory` and advances `memoryUpTo`. Memory goes into the system prompt ("Memoria de esta conversación: ...") and into the query rewrite (LLM and heuristic).
- **Titles**: first question -> first ~6 words immediately, then `POST /api/chat/title {question}` -> `{title, ai}` upgrades it when an LLM key exists (unless the user renamed it meanwhile).
- **Class chat**: `<ChatPanel classId>` (embedded in the class page) opens/continues the single chat bound to that class (also listed in the /chat sidebar with a "Clase" badge); "Reiniciar" clears it.
- **Export/import**: sidebar "Más" menu; JSON `{app:"shiurim-chat",v:1,chats}`; import validates each chat and merges by id (newer `updatedAt` wins).

## UI
`components/ChatPanel.tsx` (default export, client; optional `classId`), `components/chat/ChatSidebar.tsx` (list, search, inline rename, inline delete confirm, export/import), `components/chat/RefChips.tsx`. `/chat` is two-pane from `lg`; below that the sidebar is a drawer (`.chat-drawer-toggle`, `.chat-backdrop`). Model/effort are per chat (new chats inherit the last choice, `shiurim-chat-prefs-v1`). Chips call `usePlayer().playAt(classId, startMs)` and link to `/shiur/[id]?t=<seconds>`. Styling uses `var(--ink|--gold|--bg|--card|--line|--text|--muted)` plus semantic classes (`chat-sidebar`, `chat-item`, `chat-main`, `chat-bubble`, ...). Screenshot: `docs/screenshots/chat-multi.png`.

## Tests
`DB_PATH=/tmp/fx.db npm run build:db -- --fixtures && npx tsx --test tests/chat*.test.ts` (also `chat-memory`, `chat-store`) (LLM fetch is mocked).
