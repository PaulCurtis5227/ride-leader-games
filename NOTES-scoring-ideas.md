# Note for the next agent: game ideas from ride scoring (2026-10-30)

The user asked for this note to be left here. These came up while building "video game scoring" for the
Director Sportif ride report (repo `../caffecter`, `report/scores.mjs`; research in `../EfficiencyMeter`). The user
thinks they may make good ride leader games. **Nothing is built here yet. Ask the user before building any of it.**

## The three scores (1 point = 1 kJ)

- **Workhorse: "I did my share."** Pulls on the front of your group: 10 s+ first in the group, with at least half of
  the group still behind you at the end (no points for blowing it apart). Points = the draft the puller gave up
  (their usual draft sitting in, minus their draft on the front) × the riders sheltered behind them.
- **Wheelsucker: "I did as little work as possible."** The draft Zwift gave you while in a group (`state.draft`, in
  watts), minus what a bad spot cost and minus watts lost pushing into wheels. Skip riders with no draft at all
  (TT bikes in some events read 0 W of draft the whole ride).
- **Saboteur: "I hindered as many as possible."** Riders coming past beside you (0.4–1.5 m to the side, closing
  1–5 km/h faster for 2+ ticks) who end up level with you and no faster for 2 s+: held. About 150 W lost per held
  second (EfficiencyMeter's passing research: what a held second costs the passer). Faster than 5 km/h goes through.

Each score is reported for the whole ride and its best 1, 5 and 20 minutes, like a power curve.

## Why they may suit this mod better than the report

- The ride leader's Sauce sees **everyone's** power, speed and draft live. The Director Sportif's recording keeps no
  power for other riders, so the report has to estimate the Saboteur score; a live game could confirm a hold from
  the passer's power going up while their speed doesn't.
- They fit the existing engine: per-rider, per-tick scores with an `aggregate` mode (`pages/games.mjs`).
  - Workhorse and Wheelsucker are per-rider sums: they would need a `sum` aggregate (only `avg`, `max` and `delta`
    exist today).
  - Workhorse needs each rider's place in their group (who is first). Group membership: riders chained within about
    a second of each other.
- Saboteur in a social group ride is a bit antisocial. It might work as a mini-game ("hold off the ride leader"), but
  check with the user first.

## Facts worth knowing

- `gapDistance` is center to center. Zwift's draft treats a bike as about 1.5 m long: the draft starts falling once
  a follower is closer than 1.5 m center to center.
- Blocking (watts vanishing when you push into a wheel) happens within 2 m between wheels, overlapped or not, and
  nearly stops beyond that.
- On roads Sauce has no map for (Watopia's new roads, October 2026) every `gapDistance` is exactly 0. Any distance
  game needs to handle that (EfficiencyMeter `pages/road-gaps.mjs` rebuilds gaps from road completion).
