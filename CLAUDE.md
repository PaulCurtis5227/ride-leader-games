# Ride Leader Games — mod notes

A Sauce4Zwift mod. Games/tools for ride leaders; first game: lowest average distance from the ride
leader wins. Full Sauce-mod authoring guide (manifest, APIs, gotchas) lives at
`../CLAUDE.md` (workspace root) — read it first if you're new to S4Z mods.

## This mod
- `pages/engine.mjs` — pure game logic (no DOM): scoring, carry-forward for riders that drop out of
  the `nearby` list, `(i/n)` message chunking + throttled send queue. Unit-testable with Node.
- `pages/control.{html,mjs,css}` — leader control window (`frame:true`): config, live leaderboard,
  game controls, chat review queue, diagnostics.
- `pages/overlay.{html,mjs,css}` — read-only leaderboard overlay (`overlay:true`, frameless — it has
  the `#titlebar` block so it can be closed via right-click → Close).
- `pages/s4z-streams.mjs` — copy of the shared stream service (see `../s4z-stream-recorder`). Data
  flows through `getSauceStreams(Common).subscribe('nearby', …)` so live today / replayable in dev.

## Essentials that bit us (see ../CLAUDE.md for detail)
- `manifest.json` window `file` MUST include the `pages/` prefix (`pages/control.html`).
- Install path is `C:\Users\paul\OneDrive\Documents\SauceMods\` via junction; restart Sauce for
  manifest changes, reopen a window for HTML/JS/CSS changes.
- Frameless overlay needs a `#titlebar` or it can't be closed.
- Scroll goes on `.rlg-control` (inner element), not `body` (host `html body{overflow:hidden}` wins);
  control window drops `passive-overlay-scrollbars` for a visible scrollbar.
- Use `streams.now()` (not `Date.now()`) on the game timeline so replay works.
- `nearby` is capped ~100 riders and gets weird at intersections → carry forward last gap + log.

## Verify
`validateMod` (0 warnings) → `node --check pages/*.mjs` → headless engine test → live dry-run needs a
running Zwift + Sauce (multi-rider `nearby` can't be faked headlessly).
