/*
 * Ride Leader Games — a Sauce for Zwift mod.
 * Copyright (C) 2026 Paul Curtis
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify it under the terms of the
 * GNU General Public License as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version. This program is distributed WITHOUT ANY WARRANTY;
 * see the GNU General Public License <https://www.gnu.org/licenses/> for details.
 *
 * Ride Leader Games — default message text (framework-agnostic, no DOM).
 *
 * Single source of truth for the default text of every message the mod sends. Kept as plain
 * strings + template functions (no locale/ResourceBundle machinery), mirroring the sibling
 * Velodrome mod's messages module.
 *
 * Two kinds live here:
 *  - DEFAULT_INSTRUCTIONS — the default value for the *configurable* instructions blob. The leader
 *    can override it in the control window; this is just the out-of-the-box starting text.
 *  - MESSAGES — templates for the auto-generated (non-configurable) messages the engine emits.
 *    Numeric formatting and the chat prefix stay in the engine, so these receive already-formatted
 *    strings and hold nothing but wording.
 *
 * These come in one set per game (see games.mjs): the *_INSTRUCTIONS blob + a *_MESSAGES template
 * object. `DEFAULT_INSTRUCTIONS`/`MESSAGES` are the leader-distance game; `CADENCE_*` the cadence
 * game. Each *_MESSAGES exposes the same shape (start, rankEntry, standings, winner, noQualifiers)
 * so the engine can treat them interchangeably via the active game's `messages`.
 */

/*
 * Default instructions, sent at game start (one message per blank-line-separated block — see
 * instructionMessages() in engine.mjs). Editable per game in the control window.
 */
export const DEFAULT_INSTRUCTIONS =
    "Ride Leader Game! The goal is simple: stay as close to the ride leader as you can. " +
    "Your score each moment is how far you are from the leader.\n\n" +
    "The winner is the rider with the lowest AVERAGE distance from the leader over the whole game. " +
    "Hold the wheel, don't half-wheel, and don't get gapped!\n\n" +
    "Heads up: only about 100 riders can be scored at once, and results can get a little noisy " +
    "around intersections and road-segment transitions. Have fun and ride safe.";

/*
 * Auto-generated message templates. `avgM` params are pre-formatted distance strings (e.g. "42m");
 * the chat prefix is prepended by the engine, not here.
 */
export const MESSAGES = {
    start: durationMin =>
        `Ride Leader Game ON! Closest average distance to the leader over ` +
        `${durationMin} min wins. Hold the wheel!`,

    // One ranking entry, shared by the standings list and the winner runner-ups.
    rankEntry: (rank, name, avgM) => `${rank}) ${name} ${avgM}`,

    standings: (seconds, parts) => `${seconds} to go. Standings: ${parts.join('  ')}`,

    winner: (name, avgM, restParts) => {
        let msg = `Winner: ${name} — avg ${avgM} from the leader!`;
        if (restParts && restParts.length) {
            msg += ` Then ${restParts.join('  ')}`;
        }
        return msg;
    },

    noQualifiers: minSamples => `Game over — no winner winners needed ${minSamples}+ samples.`,
};


/*
 * Cadence game — highest AVERAGE cadence over the game wins. No ride leader is involved; every
 * rider is scored on their own cadence. `avgV` params are pre-formatted (e.g. "85rpm").
 */
export const CADENCE_INSTRUCTIONS =
    "Cadence Challenge! The goal is simple: keep your legs spinning. " +
    "Your score each moment is your cadence (RPM).\n\n" +
    "The winner is the rider with the highest AVERAGE cadence over the whole game. " +
    "Coasting counts against you, so keep those pedals turning — spin to win!\n\n" +
    "Heads up: only about 100 riders can be scored at once, and results can get a little noisy " +
    "around intersections and road-segment transitions. Have fun and ride safe.";

export const CADENCE_MESSAGES = {
    start: durationMin =>
        `Cadence Challenge ON! Highest average cadence over ${durationMin} min wins. ` +
        `Keep spinning — don't coast!`,

    // One ranking entry, shared by the standings list and the winner runner-ups.
    rankEntry: (rank, name, avgV) => `${rank}) ${name} ${avgV}`,

    standings: (seconds, parts) => `${seconds} to go. Standings: ${parts.join('  ')}`,

    winner: (name, avgV, restParts) => {
        let msg = `Winner: ${name} — avg ${avgV}!`;
        if (restParts && restParts.length) {
            msg += ` Then ${restParts.join('  ')}`;
        }
        return msg;
    },

    noQualifiers: minSamples => `Game over — no winner winners needed ${minSamples}+ samples.`,
};


// ---- factory for the additional games (games.mjs) --------------------------------------------
//
// The two games above have bespoke, hand-tuned wording. The rest of the roster (power/cadence/torque
// peaks and averages, proximity games, ride-ons) share one structure, so their text is built from
// these helpers instead of hand-writing a full *_INSTRUCTIONS + *_MESSAGES pair each. The wording for
// each such game is passed in from games.mjs (co-located with the game definition).

// Shared closing paragraph — the scoring caveats every game inherits.
export const SAFETY_NOTE =
    "Heads up: only about 100 riders can be scored at once, and results can get a little noisy " +
    "around intersections and road-segment transitions. Have fun and ride safe.";

/*
 * Build a start-of-game instructions blob from parts. `intro` states the goal, `howToWin` explains
 * the scoring; both become their own message (blank line between), followed by the shared safety
 * note — so the result always splits into >= 3 messages (see instructionMessages()).
 */
export function makeInstructions({intro, howToWin, safety = SAFETY_NOTE}) {
    return `${intro}\n\n${howToWin}\n\n${safety}`;
}

/*
 * Build a MESSAGES-shaped object. `start(durationMin)` is the on-air announcement (game-specific).
 * `winnerVerb` is the short label before the value in the winner line ("avg", "peak", ""); an empty
 * verb prints just the value (used when the formatted value already reads as a total, e.g. ride-ons).
 * rankEntry / standings / noQualifiers are identical across these games.
 */
export function makeMessages({start, winnerVerb = ''}) {
    return {
        start,
        rankEntry: (rank, name, val) => `${rank}) ${name} ${val}`,
        standings: (seconds, parts) => `${seconds} to go. Standings: ${parts.join('  ')}`,
        winner: (name, val, restParts) => {
            const label = winnerVerb ? `${winnerVerb} ${val}` : val;
            let msg = `Winner: ${name} — ${label}!`;
            if (restParts && restParts.length) {
                msg += ` Then ${restParts.join('  ')}`;
            }
            return msg;
        },
        noQualifiers: minSamples => `Game over — no winner; needed ${minSamples}+ samples.`,
    };
}
