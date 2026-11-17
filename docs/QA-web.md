# QA — web (Next.js site)

Date: 2026-11-17. Server: `npm start` on :3000, real DB (82 classes, ~44k segments). No LLM key, so chat is in **no-AI mode** (it lists the top passages as refs and makes no judgement on relevance). Tools: curl, better-sqlite3, Playwright chromium (`--autoplay-policy=no-user-gesture-required`). Scripts are in the session scratchpad, not the repo.

## Summary

| # | Test | Result |
|---|------|--------|
| 1 | Text search (API + /buscar, snippet ↔ segment, click → seek) | PASS (after fix B1) |
| 2 | Chat (API + /chat, ref chips, nonsense question) | PASS in no-AI mode (after fixes B2, B3) |
| 3 | Real audio (play, highlight follow, tap-seek, persistence, Range) | PASS |
| 4 | Mobile (iPad Pro 11, iPhone 13) | PASS (after fixes B4, B5, B6) |
| 5 | Performance | PASS |

## 1. Search
- API: `meematai korín` (1 hit, the only segment with both words), `Bilam`, `Rabán Gamliel`, `Shunamit`, `tefilín` (30 hits each). For **every** hit (121 in all), the text of the snippet, with the marks removed, is in the DB segment `(classId, segmentIdx)` and `startMs == segments.start_ms`. 121/121 OK. Garbage or empty `q` → `hits: []`.
- UI: for each query, clicking the first result → `/shiur/<id>?t=…`. `audio.currentTime` equals the hit's startMs, it plays, and the `.seg.active` row is the hit's segment (idx 0/569/520/858/652).
- **B1 (fixed):** the highlighted row ended up 1.8k–5.3k px *off-screen* (it scrolled to the wrong place) on long classes. Cause: smooth `scrollIntoView` over rows that use `content-visibility:auto` (their heights are estimates). After the fix the active row sits at y≈330 of 720 in all 5 cases.
- Minor (fixed with B1): `?t=` was floored to whole seconds, so on a direct or shared link the *previous* segment was highlighted. Links from search and chat now use 0.1 s, rounded up.

## 2. Chat (`POST /api/chat`, no-AI mode)
| Question | Top refs (all checked: `startMs` = exact segment start, and the segment text contains the topic) |
|---|---|
| rezar detrás del beit hakneset | class 40 18:19 "ajoré … pétaj bet hakneset, detrás de la puerta"; 15 "mitpalel ajorei beit haknéset"; 42 "mitpalel ajorei beit hakneset" ✔ |
| Resume el shiur 23 | summary intent → 8 evenly spaced moments of class 23 ✔ |
| Bilam y el momento de ira | **before fix:** 7/8 refs were about "momento" in general (class 80, 3, 24…). **After:** class 26 1:10:41 "Bilam sabía… el rega que se enoja", 26 "agarrarse de ese momento", 76 "shelo kaasti bimei Bilam" ✔ |
| ¿Qué es plag haminjá? | 8 refs, all class 1 (Rabenu Tam / plag haminjá) ✔ |
| ¿Qué dijo el rabino sobre la Shunamit? | 53 1:59:53, 57, 54, 52 — all "Shunamit" ✔ (a regression in the UI, 8 refs about "rabino", found and fixed, B3) |
| `asdkjh qwpoe zzxv` | "No encontré esto en los shiurim: prueba con otras palabras.", 0 refs ✔ |
| receta del flan … quinoa marciana | Remaining issue: no-AI mode returns 2–8 weak "receta" hits instead of "no encontré". With no LLM, nothing judges relevance. With a key, the prompt tells the model to answer NOT_FOUND. |
- UI /chat: answers stream, chips play the class in the bottom player (it starts 3–6 s after the click because of Drive latency), and "Abrir" lands on the shiur with the cited segment highlighted.
- Note: a ref's `quote` starts one segment *before* `startMs` (it includes context), while the chip seeks to the matched segment itself. This is acceptable.

## 3. Audio
- Class 50 (902 segs): Reproducir → currentTime goes 0.99 → 4.99 s in 4 s, and the highlight follows. Tapping seg 300 → currentTime 2457.8 (start 2456.6), active = 300, and 15 s later active = 302, still on screen.
- Navigating to /buscar keeps the bar and audio playing (2474.9 s, still playing). Going back, the transcript re-syncs (active 303).
- Reload: localStorage `shiurim:player` = {classId, 2476427}, restored *paused* at 2476.43 with active = 303. On the home page after a reload the bar shows 41:16. +15 works (→ 2491.4). Wheel/touch scroll turns follow off and shows "↓ Volver al actual".
- `curl -r 1000000-1001000 /api/audio/<id>` → **206**, `Content-Range: bytes 1000000-1001000/118075877`, `audio/mp4`, 1001 bytes, ~1.0 s.

## 4. Mobile (screenshots: `docs/screenshots/qa-{ipad,iphone}-{home,home-daf,shiur50,shiur50-bottom,buscar,chat}.png`)
- No horizontal page scroll on any page or device (`scrollWidth == clientWidth`). The daf chips scroll horizontally inside their own row (`overflow-x:auto`), by design.
- All `.he` elements have `direction: rtl`. No clipped Hebrew titles: they wrap, and the player title has an ellipsis.
- Tap targets: buttons ≥ 48 px. The only things under 32 px are the range scrubber (28 px tall, full width) and the player title link (28 px).
- Daf filter: "דף ג" → 82 → 4 classes (3, 4, 4.2, 4.3), all ג. `/api/classes?daf=ג` agrees.
- **B4 (fixed):** on /chat with the player open, the chat input sat *under* the player bar (form bottom 658 vs bar top 523 on iPhone; 1146 vs 1092 on iPad). Now 510 < 523 and 1038 < 1092.
- **B5 (fixed):** the iPhone player bar is 141 px tall but `--bar-h` (body padding) was 130 px, so the bar covered the last 11 px. `--bar-h` is now 148 px at ≤520 px; the last segment ends at 467, above the bar at 523.
- **B6 (fixed):** the chat ref chips mixed RTL title and LTR time in one truncated span, so they rendered as "1. 09:48 · …הזמן מדובק .ר". Now the title is its own RTL truncating span and the time is separate.

## 5. Performance (desktop chromium, local server)
- Class 50 (902 segments, 153 KB JSON in 4.5 ms): all rows in the DOM and clickable in 553 ms cold, 110–160 ms warm. iPhone emulation: 545–750 ms.
- Scroll, 334 frames scripted: p50/p95/max frame = 16.7/16.7/16.8 ms (no jank). No long tasks during 20 rapid seeks.
- `/api/search` latency: 4–10 ms (first call about 50 ms).

## Fixes made (all small; `npx tsc --noEmit` and `npm run build` pass; chat tests 10/10)
1. `components/ShiurView.tsx` — follow-scroll: skip when the row is already visible; when it is far away, jump instantly and re-center over a few frames (B1).
2. `components/SearchView.tsx`, `components/chat/RefChips.tsx` — `?t=` with 0.1 s precision, rounded up.
3. `lib/chat.ts` + `lib/search.ts` (`ftsCount`) — keyword fallback when the full query has no FTS match: rarest keywords first, keyword **pairs** before single keywords, and single-keyword lists interleaved so one word cannot fill every slot (B2, B3).
4. `lib/chat-core.ts` — "rabino/rabinos/rabbi/maestro" are now stopwords (B3).
5. `components/ChatPanel.tsx` (`chat-box` class) + `app/globals.css` — chat height takes off the player bar when it is visible (`body:has(.player-bar)`); mobile `--bar-h` 130 → 148 px (B4, B5).
6. `components/chat/RefChips.tsx` — bidi-safe chip layout (B6).

## Remaining issues / notes
- No-AI chat cannot say "no encontré" for real-word but off-topic questions (see the flan example).
- Two pairs of classes share an order label (38 ×2, 46 ×2, with different titles and files). This is in the data, not a site bug, but "shiur 38" / "shiur 46" in chat picks the first one.
- Audio starts 3–6 s after play/seek on a cold class because of the Drive proxy. R2 would remove this delay.
- Restarting the server: `pkill -f "next start"` does not kill the `next-server` child process. Use `pkill -f next-server` as well, or the old process keeps port 3000 and serves stale chunks.
- Chat suggestion "¿Qué dice Tosafot sobre este tema?" has no context on /chat.
