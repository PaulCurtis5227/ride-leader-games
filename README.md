# Ride Leader Games

A [Sauce for Zwift](https://github.com/SauceLLC/sauce4zwift) **mod** — a set of games and tools for Zwift ride leaders.

Over a configurable duration the mod scores every nearby rider and announces the standings and
winners in chat. Which metric it scores is chosen from a **game picker** in the Control window; nine
games ship today (see [Games](#games)), scoring by **average**, **peak**, or **ride-ons received**.
Separately, a **Since event start** panel tracks any metric — plus whole-ride totals for the group,
sendable to chat as a summary — across the entire ride, independently of the timed games, and **rider
announcements** congratulate riders in chat when something happens to them (a level-up today). A
**Riders** panel remembers who rides with you week after week, so you can welcome the newcomers and
celebrate ride milestones at a moment you choose. All scored values are reported to two decimal
places.

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
  leaderboard, a **Since event start** metric viewer and ride totals, a **Riders** panel for welcoming
  newcomers and marking ride milestones, Start/Stop/Reset, chat review queue, a bicycle-joke sender,
  and diagnostics. The title bar stays hidden until you **right-click** the window (right-click again
  to hide it); while it's shown you can drag the window, and its **settings gear (⚙)** opens a separate Settings window for the
  rest of the configuration (send mode, prefixes, instructions, announce options, rider history,
  font scale, etc.).

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

## Who counts

In a Zwift **event**, only the riders on your ride count — towards the games, the **Since event
start** panel, the ride totals and your rider history. Everyone else nearby is ignored, and the count
under the ride-leader picker shows both numbers, e.g.
`21 on the ride · 33 nearby ignored (not in the event)`.

- Membership sticks: a rider counts from the first time they're seen on your ride and keeps counting
  for the rest of it, so finishing the event or dropping out of sight at an intersection doesn't
  un-ride them. The **ride leader always counts**, registered or not.
- **Outside** an event — a free ride, or a meetup Zwift doesn't report as one — nothing is filtered,
  so the **minutes with the group** setting is your only passer-by filter.
- **Settings ▸ Who counts** turns the filtering off.

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
  distance; pedal strokes; calories; Zwift level; rides with us) and see a live leaderboard of every
  nearby rider for it, computed over the **whole ride** rather than a single game round. Level comes
  in two flavours — **Level (highest first)** and **Level (lowest first)** — the same reading sorted
  both ways, so you can see the group's most experienced riders or spot the newcomers to welcome.
  **Rides with us** (most/fewest first) and **Consecutive rides** come from the rider history below,
  so you can sort the group by loyalty rather than by watts. Counts are shown as whole numbers.
- **Ride totals** — headline totals across *all* riders: total **miles ridden**, **pedal strokes**,
  **ride-ons received**, **calories burnt**, and **levels gained** during the ride. (More metrics to
  come.)
- **Send summary** — sends those totals to chat as a single message, worded by the **Ride summary**
  announcement (see [Rider announcements](#rider-announcements), where you can edit it or switch it
  off). Nothing is used up, so you can send it again at the halfway point, at the top of a lap, and
  in the cool-down. The numbers sent are exactly the ones on the tiles.
- **Reset event** — zeroes everything to begin a fresh event (e.g. a new lap or a new group).

This runs whether or not a game is active, so you can keep an eye on the group's cumulative effort at
any time. (Leader-relative metrics aren't offered here — they're specific to a timed round.)

> [!NOTE]
> A rider's level comes from their Zwift **profile**, which Sauce loads and refreshes in the
> background rather than reading it every tick. So the level column lags, a rider whose profile
> hasn't loaded yet is left out of the level standings, and one who just joined may briefly show the
> level they were on last time you rode with them. **Levels gained** counts only *confirmed*
> level-ups, so that catching-up never inflates it. See
> [Why level-ups behave oddly](#why-level-ups-behave-oddly) for the whole story.

## Welcoming new riders and celebrating milestones

The **Riders** panel keeps a persistent record of who rides with you, ride after ride, and turns it
into two things you can say when the moment is right. Nothing is sent automatically: the panel shows
what's pending and *you* press the button — typically once the group has settled and the late-join
window has closed.

- **👋 New riders** — everyone present who has never been welcomed to this ride. One message names
  them all. Because it tracks *never welcomed* rather than *first ride*, someone you missed a few
  weeks ago is still offered rather than lost.
- **🎂 Milestones** — riders reaching 10, 50, 100 … rides with you. **One message per milestone**, so
  a group who all started together on the same week produces a single "celebrating 10 rides"
  message rather than thirty near-identical ones.
- **Live pending count** in the panel header (`3 to welcome · 1 milestone`) so you know something is
  waiting without going looking, plus a hint for when late join closes when the event declares one.
- **Skip** on any bucket marks it done without saying anything.

Both messages have an on/off switch and an editable template in **Settings ▸ Rider announcements**,
alongside the automatic ones. The rider list is a *suggestion* — you see exactly who will be named
before you send, which is why the record doesn't need to be perfect.

### First ride: Mark all as known

On your very first ride the panel will offer to welcome your entire group, including regulars of three
years. Press **Mark all as known** once and they're recorded as already-welcomed, silently.

This is unavoidable rather than an oversight: **attendance from before you started using the mod
cannot be recovered** — Zwift offers no way to look up who was on last week's ride. So the record
starts the day you turn this on, and ride counts mean "rides with us since then" rather than a
Zwift-wide total.

### It follows the event, not you

A leader may run two different rides a week, and a rider is a regular *of a ride*. So each ride keeps
its own counts, streaks and welcome list, keyed on Zwift's own **event series** id where the organizer
configured one, otherwise on the event name with any trailing week number or date stripped.

If that key changes — an organizer renames the event, or a series id disappears — the panel says so
and offers **"This is that ride"**, which points the new name at the existing history. That prompt
exists precisely so a rename can't silently start a fresh ledger and make your whole group look new
again. **Keep separate** is there for when it really is a different ride.

### Tuning it

In **Settings ▸ Rider history**:

- **Milestone ride counts** — the ladder, default `10, 50, 100, 200, 300, 400, 500, 750, 1000`. Keep
  the gaps wide: a weekly rider hits a milestone roughly once every *gap* weeks, so with a 40-rider
  group a gap of 50–100 works out to well under one celebration a week.
- **Minutes with the group before a rider counts** (default 5) — stops riders who merely pass you on
  the road from becoming regulars.
- **Names per message before "and N others"** (default 8) — keeps a busy week to a line or two of
  chat.
- **Ride name** — used only outside a Zwift event.
- **Export / Import history** — the ledger is the one thing the mod can't rebuild, so back it up and
  carry it between machines.

## Rider announcements

Independently of the games, the mod watches for things that happen *to* a rider and congratulates
them in chat. Each announcement has its own on/off switch and a fully editable message template in
the Settings window (**Rider announcements**):

- **Level up** — sent when a rider in the group gains a Zwift level. Default message:
  `🎉 LEVEL UP! Huge congratulations to {name}, now Level {level}! 🎉`
- **Welcome new riders** and **Ride milestones** — the two above, sent from the Riders panel rather
  than automatically. Their templates and switches live here with the rest.
- **Ride summary** — the group's combined totals, sent when you press **Send summary** in the
  **Since event start** panel. Default message:
  `📊 Ride so far: {riders} riders, {miles} mi, {rideons} ride-ons, {strokes} pedal strokes, {calories} kcal, {levels} levels gained 💪`
  Six numbers don't fit one chat line, so this arrives as two; `{km}` and `{elapsed}` are offered
  too if you'd rather report those, or trim a value to get it down to one.

Templates use `{placeholder}` names that are substituted per event; the Settings window lists the
ones each announcement offers right below its field (for a level-up: `{name}`, `{level}` and
`{previousLevel}`). A placeholder you mis-spell is left in the message verbatim so the mistake is
visible rather than silently blank, and **clearing a template mutes that announcement** just as
unticking it does.

Announcements go through the same send pipeline as everything else, so they honour your **send mode**
— in **Silent** they only appear in the Messages pane, in **Review** you get to edit before sending —
along with length chunking and message pacing.

This is a general capability rather than a one-off: level-up is simply the first entry in the
announcement registry ([`pages/announcements.mjs`](pages/announcements.mjs)), and the Settings window
builds its fields from that registry, so future rider events slot in the same way.

### Why level-ups behave oddly

Level is the one value the mod reads from a rider's Zwift **profile** instead of the live data
stream, and Sauce loads and refreshes profiles in the background. Every oddity below follows from
that, and none of it is something the mod can see around — so it's worth knowing what you're looking
at before you wonder why chat just congratulated nobody, or congratulated someone late:

- **Level-ups are late — up to about five minutes.** Sauce re-reads each rider's profile roughly
  every five minutes, so a level-up is noticed at the next refresh, not when it happens in game.
  There is no faster signal available; instantaneous is unfortunately not on the menu.
- **A rider who has just joined the group may show a stale level** — the one they were on the last
  time you rode with them — for the second or two before their profile loads. Riders whose profile
  hasn't loaded at all are missing from the level standings, and some first appear as **Level 1**.
- **Only a rise of exactly one level is announced.** Nobody gains two levels in an instant, so a
  bigger jump (Lv 30 → Lv 34) is always a profile catching up, and is passed over in silence.
- **Rises are ignored for the first minute after a rider appears**, and for the first five minutes
  for someone first seen at Level 1 (which usually means their profile hadn't really loaded). This
  is what stops a settling profile from reading as a level-up.
- **So a real level-up in a rider's first minute in the group is missed.** Given the refresh lag
  above, most level-ups surface well after that window, so this is rare — and the alternative is
  congratulating half the group as they join.
- **Levels gained** in the ride totals counts confirmed level-ups only, matching what was announced.

Two switches in **Settings → Rider announcements** if you'd rather trade differently:

- **Announce: Level up** — untick (or clear the message template) to turn level-up announcements off
  entirely.
- **Ignore level changes just after a rider joins** — on by default. Untick it to announce every
  one-level rise the instant it is seen: earlier, but you will get some false congratulations for
  riders who have only just joined. It cannot make announcements instant — the five-minute profile
  refresh is Sauce's, not the mod's — so this only helps for riders in their first minute.

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
- **Riders outside your event are ignored** (see [Who counts](#who-counts)) — but only when the event
  can be identified. On a free ride, in a meetup Zwift doesn't report as an event, or in the first
  seconds before the event lookup lands, everyone nearby counts.
- Around **intersections**, `nearby` won't list riders on the *other side* of the intersection — they drop out of the list until the group is back together on a shared stretch of road.
- **Interim handling:** if a tracked rider disappears from `nearby`, we keep scoring them using their last known gap (carry-forward).
- **Drops can't be scored or totalled.** Sauce doesn't expose Zwift drops anywhere — neither on the
  per-tick player state nor on the athlete profile it builds — so there is no data behind a
  drops game or a drops ride total. (The only mention in the host source is the `curRideStreakDrops`
  / `maxRideStreakDrops` ride-streak fields in `zwift.proto`, which Sauce never decodes.) If Sauce
  starts exposing drops, both drop straight into the existing game/metric registries.
- **Levels lag, and settle.** Level is read from the rider's profile rather than the live state
  stream, so level standings, the levels-gained total, and the level-up announcement all follow
  Sauce's profile-refresh cadence — up to about five minutes. A rider's first readings after they
  appear can be stale or missing, so a rise counts as a real level-up only when it is exactly one
  level and the rider's reading has had time to settle. Both the announcement and the settling delay
  can be switched off — see [Why level-ups behave oddly](#why-level-ups-behave-oddly).
- **Rider history starts when you turn it on.** Past attendance cannot be recovered from Zwift or
  Sauce (see [First ride: Mark all as known](#first-ride-mark-all-as-known)), so ride counts and
  milestones mean "since you started tracking". A rider only counts towards a ride once they've been
  with the group for the configured few minutes, and the 100-rider cap above means someone present in
  a very large event may not be seen at all — attendance is a good record, not a perfect one.
- **The ledger lives in this Sauce profile's local storage.** It isn't synced anywhere, so use
  **Settings ▸ Rider history ▸ Export history** to back it up or move it to another machine.
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

`1.1.0` — **in an event, only riders in the event count** — see [Who counts](#who-counts). Also a
**Riders** panel backed by persistent, ride-over-ride rider history: welcome riders who
have never been greeted, and celebrate 10/50/100+ ride milestones — one message per bucket, sent when
you press the button rather than automatically. History is keyed to the *event* (Zwift's event series
where there is one) so two rides a week keep separate counts, with a prompt to re-link a renamed event
rather than silently starting over. Adds **Rides with us** and **Consecutive rides** metrics, a
**Mark all as known** seed for your first ride, and export/import of the ledger. The ride totals can
now be **sent to chat** with one button (**Send summary**), worded by an editable **Ride summary**
announcement.

`1.0.1` — fixes the Messages pane timestamp, which showed `0:00` on every message unless a game was
running (it was stamping time since the current game's start); messages now carry a local
time-of-day.

`1.0.0` — nine games chosen from a game picker (Closest to Leader, Average Power, Cadence Challenge,
Max Power, Max Cadence, Max Torque, Torque Near Leader, Draft Master, Ride-Ons Received), scoring by
average / peak / delta, with the round **Duration** on the main window; a **Since event start**
metric viewer (now including Zwift level, sorted either way) plus whole-ride totals (miles, pedal
strokes, ride-ons, calories, levels gained); configurable **rider announcements**, starting with a
level-up congratulation; all scores to 2 decimal places. Silent-mode-first, with a live chat-link
indicator (red/green) and version + attribution shown in the window title. See the diagnostics export
while we work out intersection handling.

## License

Copyright (C) 2026 Paul Curtis.

Ride Leader Games is free software, released under the **GNU General Public License v3.0 or later**
(`GPL-3.0-or-later`). See the [LICENSE](LICENSE) file for the full text. Each source file carries an
`SPDX-License-Identifier: GPL-3.0-or-later` header.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
