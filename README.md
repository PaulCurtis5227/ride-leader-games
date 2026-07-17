# Ride Leader Games

A [Sauce for Zwift](https://github.com/SauceLLC/sauce4zwift) **mod** — a set of games and tools for Zwift ride leaders.

**First game:** over a configurable duration, the rider with the **lowest average distance from the ride leader** wins.

## Install (development)

This repo lives in Sauce's unpacked mods folder so Sauce auto-loads it:

```
C:\Users\<you>\Documents\SauceMods\ride-leader-games\
```

Then in Sauce: **Settings → Mods**, enable *Ride Leader Games*, and restart Sauce. One window becomes available:

- **Ride Leader Games — Control** — the leader's panel: configuration, live leaderboard, Start/Stop/Reset, chat review queue, and diagnostics.

## How scoring works

Sauce's `nearby` stream gives every rider a signed `gapDistance` (meters) relative to **whoever your Sauce instance is watching**. To score against a chosen **ride leader** regardless of who you're watching, we re-base using the leader's own gap as an offset:

```
score_i = | gapDistance_i − gapDistance_leader |
```

- **No ride leader configured** → the reference falls back to the currently watched rider (`offset = 0`).
- **Leader configured but not visible this tick** → that tick's scoring is skipped and a warning is logged (rather than silently corrupting averages).
- The leader is excluded from their own ranking.

This lets a *different* player run the mod in debug mode and still score against the real ride leader — no need to watch or follow the leader.

## Send modes (staged rollout)

All outgoing chat is generated centrally and routed through a single **send mode**:

- **Silent** — messages are generated and logged to an on-screen outbox; nothing is sent. (Start here.)
- **Review** — each message lands in an editable queue; you Send or Discard it.
- **Auto** — messages are sent immediately as global in-game chat.

Because a non-ride-leader Zwift account has limited chat, every message is split into a configurable **max length** (word-boundary chunks with `(i/n)` markers) and drained through a queue with a configurable **delay** between messages. Write one long message; the mod breaks it up and paces the pieces. In **Silent** mode you still see every chunk in the Messages pane exactly as it *would* be sent — nothing reaches Zwift.

## Game communication flow

When you hit **Start**, the mod runs a short pre-roll *before* the timer begins:

1. **Instructions** — the text in the **Instructions** config field is sent first (one message per
   blank-line-separated block; each block is chunked/paced like any other message). The field is
   persisted, and **Load from file…** imports a `.txt`/`.md` into it, so your instructions can live
   in a file. Toggle **Send instructions at start** to skip this.
2. **Start delay** — after the instructions have gone out, the mod waits a configurable number of
   seconds (**Delay before start message**).
3. **Start message + GO** — the start message is sent and the game timer/scoring begin.

During the game, enable **Announce periodic standings** to send a "who's leading" update every
**Standings interval** seconds. When the game ends, the top **Winners to announce** finishers
(default **5**) are sent. Both the periodic standings and the final results include each rider's
**average distance** from the leader.

Stop or Reset during the pre-roll cancels it cleanly — no start message, no game.

## Known limitations / diagnostics

- Sauce's `nearby` list is capped at **100 riders**; larger events will drop riders from the list.
- Around **intersections**, `nearby` won't list riders on the *other side* of the intersection — they drop out of the list until the group is back together on a shared stretch of road.
- **Interim handling:** if a tracked rider disappears from `nearby`, we keep scoring them using their last known gap (carry-forward).
- The Control window logs carry-forwards, list saturation, leader-visibility gaps, and large per-tick `gapDistance` jumps, and can **export** the full session (JSON + CSV) for offline analysis of intersection behavior.

## Development: record & replay real rides

This mod consumes its `nearby` data through the shared [`s4z-streams.mjs`](pages/s4z-streams.mjs) service (see the **S4Z Stream Recorder** mod), which means you can develop against real rides without being on a bike:

1. During a real ride, use **S4Z Stream Recorder** to capture `nearby` to an `.ndjson` file.
2. In the Control window, open **Replay (dev)** → **Load recording**, pick a speed, set the ride leader, and hit **Play**.
3. The leaderboard, diagnostics, and CSV export all populate from the recording — the game's clock follows the recording's own timeline. Hit **Go Live** to return to the live feed.

This is the loop for tuning intersection handling (anomaly thresholds, carry-forward) offline.

## Releasing

The version lives in `package.json` and is mirrored into `manifest.json` (Sauce shows it as
`v<version>` in **Settings → Mods**). Never edit `manifest.json`'s version by hand — bump both
together with `npm version`, which also runs the tests, commits, tags, and builds the zip:

```
# 1. commit all your work first (npm version requires a clean tree)
npm version patch          # or minor / major
#   → runs tests, bumps package.json + manifest.json to the same version,
#     makes one commit tagged vX.Y.Z, then builds dist/ride-leader-games-vX.Y.Z.zip
git push --follow-tags     # push the commit and tag to GitHub
npm run release            # attach the zip to a GitHub Release (see below)
```

- **Artifact:** `npm run package` (also run automatically by `npm version`) produces
  `dist/ride-leader-games-v<version>.zip` — a `git archive` of exactly the committed files
  (so `CLAUDE.md` and anything untracked/gitignored are excluded), prefixed with a
  `ride-leader-games/` folder so it unzips ready to drop into `SauceMods`.
- **GitHub Release:** `npm run release` uses the [`gh` CLI](https://cli.github.com) if it is
  installed and authenticated (`gh release create v<version> … --generate-notes`). If `gh` is not
  installed it prints the manual steps: push the tag, open the repo's **Releases → Draft a new
  release** page, and upload the zip from `dist/`.

A test (`test/version.test.mjs`) fails the build if `manifest.json` and `package.json` versions ever
drift, so a mislabeled release can't be cut.

## Status

`0.1.0` — first game, Silent-mode-first. See the diagnostics export while we work out intersection handling.

## License

Copyright (C) 2026 Paul Curtis.

Ride Leader Games is free software, released under the **GNU General Public License v3.0 or later**
(`GPL-3.0-or-later`). See the [LICENSE](LICENSE) file for the full text. Each source file carries an
`SPDX-License-Identifier: GPL-3.0-or-later` header.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
