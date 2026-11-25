# Shiurim "ברכות שר לשמחה" — shared conventions (for all agents)

- Drive folder: "ברכות שר לשמחה" id `1qjOmvVykyiYnODxTdUEnBqiNgQkqgUp5` (owner ofir; files are link-shared).
- Container CAN download Drive files: `https://drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`
- Container CAN reach: *.fal.media CDN (v3b/v3/v2/fal.media), www.sefaria.org, package registries. Nothing else (no OpenAI, no R2, no fal queue API).
- Shiurim MCP: Sidra 49. audioId == Drive file id. It has NO tool to read transcript text (only estado_clase counts).
- `id` everywhere = Drive file id of the AUDIO.

## Data layout
- data/inventory.json     — array of {id, name, order (string, e.g. "4.2"), ext, mimeType, sizeBytes, durationMs, mdId|null, mdName|null, transcript: "drive_md"|"shiurim"|"none", inShiurim: bool}
- data/raw/{id}.json      — raw Fal result, untouched.
- data/segments/{id}.json — normalized raw segments {source, model, segments:[{startMs,endMs,text}]}
- data/polished/{id}.json — {id, segments:[{startMs,endMs,text}], summary, tags:[], daf:[{daf:"ג", amud:"א"}], title, newName}
- data/rename-log.json    — [{id, kind:"audio"|"md", oldName, newName, at}]
