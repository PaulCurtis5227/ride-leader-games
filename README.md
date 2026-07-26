# Ride Leader Games

A [Sauce for Zwift](https://github.com/SauceLLC/sauce4zwift) **mod** — a set of games and tools for Zwift ride leaders.

Over a configurable duration the mod scores every nearby rider and announces the standings and
winners in chat. Which metric it scores is chosen from a **game picker** in the Control window; nine
games ship today (see [Games](#games)), scoring by **average**, **peak**, or **ride-ons received**.
Separately, a **Since event start** panel tracks any metric — plus whole-ride totals for the group —
across the entire ride, independently of the timed games. All scored values are reported to two
decimal places.

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

- **Ride Leader Games — Control** — the leader's panel: game picker + round **Duration**, live
  leaderboard, a **Since event start** metric viewer and ride totals, Start/Stop/Reset, chat review
  queue, a bicycle-joke sender, and diagnostics. A **settings gear (⚙)** in the title bar opens a
  separate Settings window for the rest of the configuration (send mode, prefixes, instructions,
  announce options, font scale, etc.).

Mod windows pick up new HTML/JS/CSS on **reopen**; new mods or `manifest.json` changes need a **full
Sauce restart**.

## Games

Pick the active game from the **Game** dropdown at the top of the Control window and set the round
length with the **Duration (min)** field beside it. The choice is persisted, and both the game and
duration are locked while a game is running or pre-rolling. Each game brings its own default
instructions and chat wording; your standings, winner announcements, and CSV export all follow the
selected game. Scored values are always formatted to **2 decimal places**.

Games differ in how a rider's per-moment readings are reduced to one score for the round: **average**
(mean over the whole game), **peak** (best single reading), or **delta** (how much a running total
grew during the game).

**Leader-relative** — need a ride leader as the scoring reference (see [How scoring
works](#how-scoring-works)):

- **Closest to Leader** *(default)* — lowest **average distance from the ride leader** wins.
- **Draft Master** — lowest **average power (W)** while staying **within 30 m** of the target rider
  wins. You're only scored while you're in range, so it's about hiding in the draft *and* holding the
  wheel.
- **Torque Near Leader** — highest **average crank torque (N·m)** while within 30 m of the target
  rider wins.

**Solo** — no ride leader needed; every rider is scored on their own data:

- **Average Power** — highest **average power (W)** wins.
- **Cadence Challenge** — highest **average cadence (RPM)** wins; coasting (0 RPM) counts against
  your average, so it rewards *sustained* spinning.
- **Max Power** — highest **single power spike (W)** wins.
- **Max Cadence** — highest **single cadence spike (RPM)** wins.
- **Max Torque** — highest **single crank torque (N·m)** wins. Torque is `power × 60 ÷ (2π ×
  cadence)`, so big gears at low cadence score.
- **Ride-Ons Received** — most **ride-ons received during the round** wins.

## How scoring works

The **Closest to Leader** game scores against a chosen ride leader. Sauce's `nearby` stream gives every rider a signed `gapDistance` (meters) relative to **whoever your Sauce instance is watching**. To score against a chosen **ride leader** regardless of who you're watching, we re-base using the leader's own gap as an offset:

```
score_i = | gapDistance_i − gapDistance_leader |
```

- **No ride leader configured** → the reference falls back to the currently watched rider (`offset = 0`).
- **Leader configured but not visible this tick** → that tick's scoring is skipped and a warning is logged (rather than silently corrupting averages).
- The leader is excluded from their own ranking.

This lets a *different* player run the mod in debug mode and still score against the real ride leader — no need to watch or follow the leader.

The **solo** games read each rider's own power / cadence / torque / ride-ons directly and need no reference, so the ride-leader field is ignored while one of them is selected.

### Aggregate modes

The engine collects a per-tick reading for each rider, then reduces the whole round to a single score three ways, depending on the game:

- **average** — the mean of every reading (Closest to Leader, Average Power, Cadence Challenge, and the two "near the leader" games).
- **peak** — the single highest reading (Max Power, Max Cadence, Max Torque).
- **delta** — `last − first` of a running total, i.e. how much it grew during the round (Ride-Ons Received).

### Proximity games

**Draft Master** and **Torque Near Leader** only count a rider on ticks where they are **within 30 m** of the target rider, measured the same way as above (`| gapDistance_i − gapDistance_leader |`). Ticks spent out of range neither help nor hurt — so you have to hold the wheel *and* manage your power/torque while you do. The target rider is excluded from their own ranking.

## Track any metric since the start of the ride

Independently of the timed games, the Control window has a **Since event start** panel that
accumulates continuously from the moment data starts flowing (or the last **Reset event**):

- **Metric picker** — choose any metric (average or peak power, cadence, or torque; ride-ons;
  distance; pedal strokes; calories) and see a live leaderboard of every nearby rider for it,
  computed over the **whole ride** rather than a single game round.
- **Ride totals** — headline totals across *all* riders: total **miles ridden**, **pedal strokes**,
  **ride-ons received**, and **calories burnt**. (More metrics to come.)
- **Reset event** — zeroes everything to begin a fresh event (e.g. a new lap or a new group).

This runs whether or not a game is active, so you can keep an eye on the group's cumulative effort at
any time. (Leader-relative metrics aren't offered here — they're specific to a timed round.)

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
value for the selected game — its average, peak, or ride-on count as appropriate — formatted to 2
decimal places.

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

## Maintainers

Cutting a release and listing the mod in the Sauce Mod Store are documented separately in
[MAINTAINING.md](MAINTAINING.md) — end users don't need those steps.

## Status

`1.0.0` — nine games chosen from a game picker (Closest to Leader, Average Power, Cadence Challenge,
Max Power, Max Cadence, Max Torque, Torque Near Leader, Draft Master, Ride-Ons Received), scoring by
average / peak / delta, with the round **Duration** on the main window; a **Since event start**
metric viewer plus whole-ride totals (miles, pedal strokes, ride-ons, calories); all scores to 2
decimal places. Silent-mode-first, with a live chat-link indicator (red/green) and version +
attribution shown in the window title. See the diagnostics export while we work out intersection
handling.

## License

Copyright (C) 2026 Paul Curtis.

Ride Leader Games is free software, released under the **GNU General Public License v3.0 or later**
(`GPL-3.0-or-later`). See the [LICENSE](LICENSE) file for the full text. Each source file carries an
`SPDX-License-Identifier: GPL-3.0-or-later` header.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
