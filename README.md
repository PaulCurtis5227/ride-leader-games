# Ride Leader Games

A [Sauce for Zwift](https://github.com/SauceLLC/sauce4zwift) **mod** — a set of games and tools for Zwift ride leaders.

**First game:** over a configurable duration, the rider with the **lowest average distance from the ride leader** wins.

## Install (development)

This repo lives in Sauce's unpacked mods folder so Sauce auto-loads it:

```
C:\Users\<you>\Documents\SauceMods\ride-leader-games\
```

Then in Sauce: **Settings → Mods**, enable *Ride Leader Games*, and restart Sauce. Two windows become available:

- **Ride Leader Games — Control** — the leader's panel: configuration, live leaderboard, Start/Stop/Reset, chat review queue, and diagnostics.
- **Ride Leader Games — Leaderboard Overlay** — a compact read-only leaderboard for players/streamers.

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

Because a non-ride-leader Zwift account has limited chat, every message is split into a configurable **max length** (word-boundary chunks with `(i/n)` markers) and drained through a queue with a configurable **delay** between messages.

## Known limitations / diagnostics

- Sauce's `nearby` list is capped at **100 riders**; larger events will drop riders from the list.
- `gapDistance` can behave oddly around **intersections** (road-position ambiguity).
- **Interim handling:** if a tracked rider disappears from `nearby`, we keep scoring them using their last known gap (carry-forward).
- The Control window logs carry-forwards, list saturation, leader-visibility gaps, and large per-tick `gapDistance` jumps, and can **export** the full session (JSON + CSV) for offline analysis of intersection behavior.

## Development: record & replay real rides

This mod consumes its `nearby` data through the shared [`s4z-streams.mjs`](pages/s4z-streams.mjs) service (see the **S4Z Stream Recorder** mod), which means you can develop against real rides without being on a bike:

1. During a real ride, use **S4Z Stream Recorder** to capture `nearby` to an `.ndjson` file.
2. In the Control window, open **Replay (dev)** → **Load recording**, pick a speed, set the ride leader, and hit **Play**.
3. The leaderboard, diagnostics, and CSV export all populate from the recording — the game's clock follows the recording's own timeline. Hit **Go Live** to return to the live feed.

This is the loop for tuning intersection handling (anomaly thresholds, carry-forward) offline.

## Status

`0.1.0` — first game, Silent-mode-first. See the diagnostics export while we work out intersection handling.
