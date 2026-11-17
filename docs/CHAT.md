# AI chat

`POST /api/chat` `{messages:[{role,content}], classId?}` streams **ndjson** (`application/x-ndjson`):
`{"type":"delta","text":"..."}` (many) then `{"type":"done","refs":[{classId,title,startMs,quote}],"cited":[1,3],"mode":"ai|noai|error"}`.
`[n]` markers in the text map to `refs[n-1]`; `cited` lists the markers the model used (all refs in `noai`).

## Flow (`lib/chat.ts`)
1. **Intent** (`lib/chat-core.ts`): "resume / de qué trata / sobre qué trata..." + a class found by order number ("shiur 23", "clase 1.2") or title/daf/tag match (or the `classId` sent by the page) -> *summary*; otherwise *Q&A*.
2. **Q&A**: query rewrite (LLM using history when a key exists, else heuristic: keywords of the last user message + keywords of earlier ones), `hybridSearch` (FTS, + vectors when embeddings exist), retry per keyword if empty, top 8 deduped passages expanded to surrounding transcript segments, each numbered with title, daf, mm:ss. With `classId`, results are restricted to that class.
3. **Summary**: class summary + 8 evenly spaced transcript excerpts within a ~9k char budget; refs are those key moments.
4. **LLM** (`lib/chat-llm.ts`, plain `fetch` via the proxy dispatcher): Spanish, 2-4 sentences, only from excerpts, `[n]` citations, "No encontré esto en los shiurim" when absent.
5. **No key / LLM failure**: "modo sin IA" note plus the top hits as refs; never throws.

## Env
- `LLM_PROVIDER` = `openai` (default) | `anthropic`
- OpenAI: `OPENAI_API_KEY`, `CHAT_MODEL` (default `gpt-4.1-mini`), `OPENAI_BASE_URL` (also used by embeddings)
- Anthropic: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`), `ANTHROPIC_BASE_URL`

## UI
`components/ChatPanel.tsx` (default export, client; optional `classId` prop). History is kept in state and `sessionStorage`. Chips call `usePlayer().playAt(classId, startMs)` and link to `/shiur/[id]?t=<seconds>`. Colors are inline hex (ink `#1c2a4a`, gold `#b8893a`, parchment `#f6efdc`) because `tailwind.config.ts` defines no tokens yet.

## Tests
`DB_PATH=/tmp/fx.db npm run build:db -- --fixtures && npx tsx --test tests/chat.test.ts tests/chat-flow.test.ts` (LLM fetch is mocked).
