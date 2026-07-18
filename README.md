# Ride Leader Games

A [Sauce for Zwift](https://github.com/SauceLLC/sauce4zwift) **mod** — a set of games and tools for Zwift ride leaders.

Over a configurable duration the mod scores every nearby rider and announces the standings and
winners in chat. Which metric it scores is chosen from a **game picker** in the Control window; two
games ship today (see [Games](#games)). All scored values are reported to two decimal places.

> [!IMPORTANT]
> **Sending chat requires Sauce's Game Connection to be enabled — which effectively means you can't
> also run the Zwift Companion app.** Announcing standings, winners, and jokes in-game rides the same
> command channel as Sauce's camera control, so it only works when **Game Connection** is turned on
> in Sauce (**Settings ▸ General**, restart required). Zwift allows just **one** companion connection
> per rider, so if the **Zwift Companion app** is running it holds that slot and Sauce can never
> connect — close Companion before starting Sauce. Reading data (the leaderboard and standings) works
> without it; only outgoing chat needs it. See [Sending chat needs Sauce's Game
> Connection](#sending-chat-needs-sauces-game-connection) for the full details.

## Install

Sauce loads mods as unpacked folders inside its **SauceMods** directory. Most users want a released
version (below); developers hacking on the mod can symlink the repo instead.

### Install a released version (recommended)

1. **Download the zip.** Go to the repo's [**Releases**
   page](https://github.com/PaulCurtis5227/ride-leader-games/releases) and, under the latest release,
   download `ride-leader-games-vX.Y.Z.zip` from its **Assets**.
2. **Find your SauceMods folder.** In Sauce, open **Settings → Mods** — there's an **Open mods
   folder** button (or the folder path is shown). It is typically:
   ```
   C:\Users\<you>\Documents\SauceMods\
   ```
   (on some setups Documents is redirected into OneDrive, e.g.
   `C:\Users\<you>\OneDrive\Documents\SauceMods\`). Create the `SauceMods` folder if it doesn't exist.
3. **Unzip into it.** Extract the zip directly into `SauceMods\`. The zip already contains a
   top-level `ride-leader-games/` folder, so you should end up with:
   ```
   C:\Users\<you>\Documents\SauceMods\ride-leader-games\manifest.json
   ```
   (If your unzip tool created a doubled `ride-leader-games\ride-leader-games\` folder, move the inner
   one up a level so `manifest.json` sits directly under `ride-leader-games\`.)
4. **Enable it.** In Sauce open **Settings → Mods**, enable *Ride Leader Games*, and **restart
   Sauce**.
5. **Upgrading later:** delete the old `SauceMods\ride-leader-games\` folder, unzip the new release
   in its place, and restart Sauce.

### Install for development

To hack on the mod, clone this repo somewhere outside SauceMods and let the included script create a
directory junction from SauceMods into your working copy (so edits are picked up live):

```
git clone https://github.com/PaulCurtis5227/ride-leader-games.git
cd ride-leader-games
npm run dev-link      # junctions SauceMods\ride-leader-games → this repo
```

Then in Sauce: **Settings → Mods**, enable *Ride Leader Games*, and restart Sauce.

### After installing

One window becomes available:

- **Ride Leader Games — Control** — the leader's panel: configuration, live leaderboard, Start/Stop/Reset, chat review queue, a bicycle-joke sender, and diagnostics.

Mod windows pick up new HTML/JS/CSS on **reopen**; new mods or `manifest.json` changes need a **full
Sauce restart**.

## Games

Pick the active game from the **Game** dropdown at the top of the Control window. The choice is
persisted, and is locked while a game is running or pre-rolling. Each game brings its own default
instructions and chat wording; your standings, winner announcements, and CSV export all follow the
selected game. Scored values are always formatted to **2 decimal places**.

- **Closest to Leader** *(default)* — over the duration, the rider with the **lowest average distance
  from the ride leader** wins. Requires a ride leader as the scoring reference (see below).
- **Cadence Challenge** — the rider with the **highest average cadence (RPM)** wins. No ride leader
  is needed, and coasting (0 RPM) counts against your average, so it rewards *sustained* spinning.

## How scoring works

The **Closest to Leader** game scores against a chosen ride leader. Sauce's `nearby` stream gives every rider a signed `gapDistance` (meters) relative to **whoever your Sauce instance is watching**. To score against a chosen **ride leader** regardless of who you're watching, we re-base using the leader's own gap as an offset:

```
score_i = | gapDistance_i − gapDistance_leader |
```

- **No ride leader configured** → the reference falls back to the currently watched rider (`offset = 0`).
- **Leader configured but not visible this tick** → that tick's scoring is skipped and a warning is logged (rather than silently corrupting averages).
- The leader is excluded from their own ranking.

This lets a *different* player run the mod in debug mode and still score against the real ride leader — no need to watch or follow the leader.

The **Cadence Challenge** game reads each rider's cadence directly and needs no reference, so the ride-leader field is ignored while it's selected.

## Send modes (staged rollout)

All outgoing chat is generated centrally and routed through a single **send mode**:

- **Silent** — messages are generated and logged to an on-screen outbox; nothing is sent. (Start here.)
- **Review** — each message lands in an editable queue; you Send or Discard it.
- **Auto** — messages are sent immediately as global in-game chat.

Because a non-ride-leader Zwift account has limited chat, every message is split into a configurable **max length** (word-boundary chunks with `(i/n)` markers) and drained through a queue with a configurable **delay** between messages. Write one long message; the mod breaks it up and paces the pieces. In **Silent** mode you still see every chunk in the Messages pane exactly as it *would* be sent — nothing reaches Zwift.

### Sending chat needs Sauce's Game Connection

Actually sending chat into Zwift (Review → Send, Auto, and the joke sender) rides the same Zwift command channel as camera control, so it requires Sauce's **Game Connection** to be enabled *and* connected. Reading data (the leaderboard, standings, `nearby`) does **not** need it — only outgoing chat does. The **Messages** pane shows a live chat-link indicator next to the mode badge:

- **chat link ✓** — connected; chat will send.
- **chat off (Silent)** — you're in Silent mode; nothing is sent by design.
- **chat link off — enable Game Connection in Sauce Settings ▸ General (restart required)** — Game Connection is turned off in Sauce (see below).
- **chat link waiting — close Zwift Companion app, then restart Sauce** — enabled, but the game hasn't connected (see below).

**Enabling Game Connection:** open the Sauce window, click the **gear/Settings** icon, and under **General** tick **Game Connection**, then **restart Sauce** (this setting requires a restart). Hover the chat-link indicator for the same steps inline.

**The Companion-app gotcha:** Zwift allows only **one** companion connection per rider. If the **Zwift Companion app** is already running when Sauce registers itself, the Companion app holds that single slot and the game never dials back to Sauce — so the Game Connection sits in the **waiting** state (connected = false) forever and chat silently fails. Fix: **close the Zwift Companion app, then restart Sauce** (or toggle Game Connection off/on). Starting Sauce *before* the Companion app avoids it. The chat-link indicator calls this case out explicitly so you don't have to guess.

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
average score for the selected game (average distance from the leader, average cadence, etc.),
formatted to 2 decimal places.

Stop or Reset during the pre-roll cancels it cleanly — no start message, no game.

## Jokes

The Control window has a **Jokes** panel for entertaining the group between efforts. It ships with
~200 original short bicycle jokes, each a two-part question/answer:

- **Send joke** — sends the setup to chat now, then the punchline after a configurable **Joke answer
  delay (setup → punchline)** (default **8 s**). A live "Punchline in *N*s…" countdown shows while
  it waits, and the next joke auto-loads once it's sent.
- **Skip** — discards the current joke and draws the next one (also cancels a punchline still
  waiting to send).

Jokes are drawn in a shuffled order so none repeats until the whole deck has been shown. Both parts
go through the same send pipeline as game messages, so they honor your **send mode**
(Silent/Review/Auto) and length chunking, and carry a configurable **Joke prefix** (default 😂). In
**Silent** mode the setup and punchline appear in the Messages pane exactly as they *would* be sent,
so you can preview a joke without posting it.

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

`0.2.0` — game picker with two games (Closest to Leader, Cadence Challenge); all scores reported to
2 decimal places. Silent-mode-first. See the diagnostics export while we work out intersection handling.

## License

Copyright (C) 2026 Paul Curtis.

Ride Leader Games is free software, released under the **GNU General Public License v3.0 or later**
(`GPL-3.0-or-later`). See the [LICENSE](LICENSE) file for the full text. Each source file carries an
`SPDX-License-Identifier: GPL-3.0-or-later` header.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
