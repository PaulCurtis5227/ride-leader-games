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
 * Ride Leader Games — game registry (framework-agnostic, no DOM).
 *
 * A "game" is a small definition object that tells the generic engine (engine.mjs) how to score:
 * what to read off each `nearby` entry, how to turn that reading into a per-tick score, which way
 * to rank, how to format a value for display/chat, plus its own instructions and message wording.
 * The engine owns everything else (timer, per-rider averaging, carry-forward, diagnostics, export).
 *
 * GameType interface (all games implement the same shape so the engine treats them interchangeably):
 *   key                 stable id, persisted in settings and used by getGame()
 *   name                shown in the control-window dropdown
 *   description         one-line summary shown under the dropdown
 *   higherIsBetter      standings sort + winner pick (false: lower avg wins; true: higher avg wins)
 *   needsReference      true if scoring is relative to the ride leader (distance); false otherwise
 *   read(entry)         raw per-rider reading this tick, or null/non-finite to skip the rider
 *   score(reading, ctx) sample value from a reading; ctx = {offset} (offset is the leader's reading)
 *   anomalyThreshold(config)  reading-jump (in reading units) that flags a diag anomaly, or null
 *   format(value)       result formatter, e.g. "42.00m" / "85rpm"
 *   defaultInstructions start-of-game instructions blob for this game
 *   messages            {start, rankEntry, standings, winner, noQualifiers} (see messages.mjs)
 */

import {
    DEFAULT_INSTRUCTIONS, MESSAGES,
    CADENCE_INSTRUCTIONS, CADENCE_MESSAGES,
} from './messages.mjs';

// Whether coasting (0 rpm) counts toward the cadence average. Included so the game rewards
// *sustained* spinning (coasting drags your average down). Flip to false to average only pedaling.
const CADENCE_INCLUDE_ZEROS = true;


export const LEADER_DISTANCE_GAME = {
    key: 'leader-distance',
    name: 'Closest to Leader',
    description: 'Lowest average distance from the ride leader wins.',
    higherIsBetter: false,
    needsReference: true,
    read: entry => entry.gapDistance,
    score: (reading, ctx) => Math.abs(reading - (ctx.offset || 0)),
    anomalyThreshold: config => config.anomalyThresholdM,
    format: value => `${value.toFixed(2)}m`,
    defaultInstructions: DEFAULT_INSTRUCTIONS,
    messages: MESSAGES,
};

export const CADENCE_GAME = {
    key: 'cadence',
    name: 'Cadence Challenge',
    description: 'Highest average cadence (RPM) wins — no leader needed.',
    higherIsBetter: true,
    needsReference: false,
    read: entry => {
        const c = entry.state ? entry.state.cadence : undefined;
        if (!Number.isFinite(c)) {
            return null;
        }
        return (c === 0 && !CADENCE_INCLUDE_ZEROS) ? null : c;
    },
    score: reading => reading,
    anomalyThreshold: () => null,   // cadence swings are normal; no intersection-style anomaly
    format: value => `${value.toFixed(2)}rpm`,
    defaultInstructions: CADENCE_INSTRUCTIONS,
    messages: CADENCE_MESSAGES,
};


// Ordered registry — the dropdown lists games in this order; the first is the default.
export const GAMES = [LEADER_DISTANCE_GAME, CADENCE_GAME];

export const DEFAULT_GAME_KEY = GAMES[0].key;

const BY_KEY = new Map(GAMES.map(g => [g.key, g]));

// Resolve a game by key, falling back to the default for unknown/missing keys.
export function getGame(key) {
    return BY_KEY.get(key) || GAMES[0];
}
