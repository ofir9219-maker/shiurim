---
name: champinones
description: Produce a "champiñones" analysis (surface-first connections between Gemara passages, then depth) for a topic or question, as a self-contained HTML file. Use when the user asks for champiñones, "qué conecta X con Y", or textual hooks between passages in Berachot/Shas/Tanakh.
---

# Champiñones (Claude Code version)

Same method and same fixed prompt as the web feature `/champinones`. Do not paraphrase the method: read it.

1. Read `prompts/champinones.md` (system prompt + strict JSON schema `champinones-v1`; follow it as your own instructions and output schema) and skim `docs/champinones/metodologia.md` (why/what counts as a good hook).
2. Language: answer in the language of the user's question unless they explicitly ask for another. Hebrew/Aramaic quotes stay in Hebrew script, with transliteration and translation.
3. Gather CONTEXT (use ONLY what you fetched; never quote from memory):
   - Shiurim: search `data/polished` (and `data/segments`) with grep for the topic and for `champi[ñn]`; the live DB is `data/shiurim.db` (`segments(class_id,start_ms,end_ms,text)`, `classes`). Keep 4-6 passages with `classId` + `startMs`.
   - Sefaria (`https://www.sefaria.org`): `GET /api/v3/texts/<Ref_With_Underscores>?version=hebrew&version=english&return_format=text_only` (amud refs return one string per segment), `GET /api/links/<ref>?with_text=0` (verses quoted, parallels), `POST /api/search-wrapper` `{"query":<Hebrew term>,"type":"text","field":"naive_lemmatizer","filters":["Talmud/Bavli"],"filter_fields":["path"],"size":8}` for rare shared words. Cap about 12-16 segments.
4. Do the two passes yourself: (a) hooks only (literal shared words/roots/phrases/numbers/structure, `chip off`); (b) depth, producing the JSON of `prompts/champinones.md`.
5. Verify before rendering (the web app does this server-side, see `lib/champinones/validate.ts`): every `node.ref` is one you fetched; every `hebrew_excerpt` is verbatim (ignoring nikud/punctuation) from that ref; every `hook_text` is in both excerpts; `shiur_refs` only use real `classId`/`startMs`. Drop or flag what fails.
6. Render: write the JSON to a file and produce the standalone HTML with the project renderer:
   `npx tsx -e 'import {renderDocument} from "./lib/champinones/render"; import fs from "node:fs"; const d=JSON.parse(fs.readFileSync("analysis.json","utf8")); fs.writeFileSync("champinones.html", renderDocument({data:d, question:"..."}, {origin:"https://<site>"}))'`
   Give the user the path to the HTML (map + passage cards + surface/depth per link + shiur moments + open questions).
