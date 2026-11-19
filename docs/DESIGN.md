# Design system

"Sefer" aesthetic: ivory parchment, deep ink-navy, restrained brass. All tokens live in `app/globals.css` (`:root`; dark overrides under `prefers-color-scheme` + `[data-theme="dark"]`; `[data-theme="light"]` forces light). Theme choice is stored in `localStorage["shiurim:theme"]` (`light`|`dark`, absent = system) and applied by an inline script in `app/layout.tsx` before first paint.

## Tokens (CSS variables)
- Surfaces: `--bg`, `--bg-deep`, `--surface` (alias `--card`), `--surface-2`, `--overlay` (translucent, for blur bars)
- Ink: `--ink` (headings/primary), `--text`, `--muted`, `--on-ink` (text on `--ink` backgrounds)
- Brass: `--gold` (decorative), `--gold-strong` (gold text, AA), `--gold-soft` (tint), `--gold-line` (hairlines); `--line`, `--line-strong`, `--mark`, `--focus`, `--danger`
- Fonts: `--font-he` (Frank Ruhl Libre), `--font-display` (Cormorant Garamond), `--font-read` (EB Garamond), `--font-ui` (Inter). Loaded via a runtime Google Fonts `<link>`; every stack has system fallbacks.
- Type scale: `--fs-2xs … --fs-3xl` (xl+ are fluid `clamp`), `--lh-tight|snug|read`, `--tx-size` (transcript size, set by A-/A+)
- Spacing: `--sp-1…--sp-8`, `--gutter`, `--w-wide` (1120), `--w-read` (720)
- Radii: `--r-sm|md|lg|xl|pill`; shadows: `--sh-1|2|float`; `--header-h`, `--bar-h` (space reserved for the player), `--ease`

## Reusable classes
`.card` (add `.hoverable` for lift on non-links), `.btn` (solid ink pill), `.btn-ghost` (outlined), `.btn-sm`, `.btn-icon`, `.chip` (+ `.on` / `aria-pressed`, `.chip-sm`), `.badge` (`.solid`), `.input` (pill; `textarea.input`/`select.input` use `--r-md`), `.sidebar`, `.drawer` (+ `.side` for a right-hand panel >=900px) with `.drawer-backdrop`, `.state` (+ `.glyph`) for empty/error, `.skeleton`, `.orn` (rule with diamond: `<div class="orn"><i></i></div>`), `.eyebrow`, `.he`, `.display`, `.muted`, `.tnum`, `.measure`, `.clamp2`, `mark`.

## Chat skin
Chat markup keeps its Tailwind `var(--…)` utilities; `globals.css` re-skins the semantic classes (`chat-main`, `chat-bubble`, `chat-input`, `chat-send`, `chat-sidebar`, `chat-item`, `chat-badge`, …). Keep those class names when editing chat markup.

## Behaviors
Reduced motion disables transitions/animations; focus uses `--focus` outlines; tap targets >= 44px; the player is `.player-bar` (floating, safe-area aware) and `body:has(.player-bar)` reserves `--bar-h` of bottom padding. Titles are shown through `cleanTitle()` (`components/format.ts`), which drops the "51." prefix and the redundant "ברכות י ע״א -" lead-in.
