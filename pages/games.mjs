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
 * what to read off each `nearby` entry, how to turn that reading into a per-tick score, how to reduce
 * per-tick scores over the game (aggregate mode), which way to rank, how to format a value, plus its
 * own instructions and message wording. The engine owns everything else (timer, per-rider
 * accumulation, carry-forward, diagnostics, export).
 *
 * GameType interface (all games implement the same shape so the engine treats them interchangeably):
 *   key                 stable id, persisted in settings and used by getGame()
 *   name                shown in the control-window dropdown
 *   description         one-line summary shown under the dropdown
 *   higherIsBetter      standings sort + winner pick (false: lower value wins; true: higher wins)
 *   needsReference      true if scoring/gating is relative to the ride leader (distance/proximity)
 *   aggregate           'avg' (mean) | 'max' (best single score) | 'delta' (last − first reading)
 *   carryForward        true to keep scoring a rider who dropped out of the list at their last
 *                       reading (averaging games); false to freeze them (max/delta/proximity games)
 *   read(entry)         raw per-rider reading this tick, or null/non-finite to skip the rider
 *   score(reading, ctx) sample value from a reading; ctx = {offset, relGap} (relGap = rider − leader
 *                       distance in metres, when needsReference)
 *   gate(entry, ctx)    optional; return false to not count the rider this tick (e.g. out of range)
 *   anomalyThreshold(config)  reading-jump (in reading units) that flags a diag anomaly, or null
 *   format(value)       result formatter, always 2 decimals + unit, e.g. "42.00m" / "250.00W"
 *   defaultInstructions start-of-game instructions blob for this game
 *   messages            {start, rankEntry, standings, winner, noQualifiers} (see messages.mjs)
 */

import {
    DEFAULT_INSTRUCTIONS, MESSAGES,
    CADENCE_INSTRUCTIONS, CADENCE_MESSAGES,
    makeInstructions, makeMessages,
} from './messages.mjs';
import {readPower, readCadence, readTorque, readRideons} from './metrics.mjs';

// Whether coasting (0 rpm) counts toward the cadence average. Included so the game rewards
// *sustained* spinning (coasting drags your average down). Flip to false to average only pedaling.
const CADENCE_INCLUDE_ZEROS = true;

// Proximity window (metres) for the "near the target rider" games.
const PROXIMITY_M = 30;

// Value formatters (2 decimals + unit, per the project rule — no integer rounding).
const fmtW = v => `${v.toFixed(2)}W`;
const fmtRpm = v => `${v.toFixed(2)}rpm`;
const fmtNm = v => `${v.toFixed(2)}N·m`;
const fmtRideons = v => `${v.toFixed(2)} ride-ons`;

// Cadence reading shared by the average- and peak-cadence games (honours CADENCE_INCLUDE_ZEROS).
function readCadenceGame(entry) {
    const c = readCadence(entry);
    if (c == null) {
        return null;
    }
    return (c === 0 && !CADENCE_INCLUDE_ZEROS) ? null : c;
}

// gate() for the proximity games: only score a rider while within PROXIMITY_M of the target.
const withinProximity = (entry, ctx) => Math.abs(ctx.relGap) <= PROXIMITY_M;

const identity = reading => reading;
const noAnomaly = () => null;


export const LEADER_DISTANCE_GAME = {
    key: 'leader-distance',
    name: 'Closest to Leader',
    description: 'Lowest average distance from the ride leader wins.',
    higherIsBetter: false,
    needsReference: true,
    aggregate: 'avg',
    carryForward: true,
    read: entry => entry.gapDistance,
    score: (reading, ctx) => Math.abs(reading - (ctx.offset || 0)),
    anomalyThreshold: config => config.anomalyThresholdM,
    format: value => `${value.toFixed(2)}m`,
    defaultInstructions: DEFAULT_INSTRUCTIONS,
    messages: MESSAGES,
};

export const AVERAGE_POWER_GAME = {
    key: 'average-power',
    name: 'Average Power',
    description: 'Highest average power (watts) wins — no leader needed.',
    higherIsBetter: true,
    needsReference: false,
    aggregate: 'avg',
    carryForward: true,
    read: readPower,
    score: identity,
    anomalyThreshold: noAnomaly,
    format: fmtW,
    defaultInstructions: makeInstructions({
        intro: "Average Power! The goal is simple: push the biggest watts you can sustain. " +
            "Your score each moment is your power output.",
        howToWin: "The winner is the rider with the highest AVERAGE power over the whole game. " +
            "Steady and strong beats spiky — pace it and don't blow up early!",
    }),
    messages: makeMessages({
        start: d => `Average Power ON! Highest average watts over ${d} min wins. Empty the tank!`,
        winnerVerb: 'avg',
    }),
};

export const CADENCE_GAME = {
    key: 'cadence',
    name: 'Cadence Challenge',
    description: 'Highest average cadence (RPM) wins — no leader needed.',
    higherIsBetter: true,
    needsReference: false,
    aggregate: 'avg',
    carryForward: true,
    read: readCadenceGame,
    score: identity,
    anomalyThreshold: noAnomaly,   // cadence swings are normal; no intersection-style anomaly
    format: fmtRpm,
    defaultInstructions: CADENCE_INSTRUCTIONS,
    messages: CADENCE_MESSAGES,
};

export const MAX_POWER_GAME = {
    key: 'max-power',
    name: 'Max Power',
    description: 'Highest single power spike (watts) wins.',
    higherIsBetter: true,
    needsReference: false,
    aggregate: 'max',
    carryForward: false,
    read: readPower,
    score: identity,
    anomalyThreshold: noAnomaly,
    format: fmtW,
    defaultInstructions: makeInstructions({
        intro: "Max Power! One big effort is all it takes: your score is your single highest " +
            "power reading.",
        howToWin: "The winner is whoever hits the highest peak power at any moment during the " +
            "game. Pick your spot and sprint!",
    }),
    messages: makeMessages({
        start: d => `Max Power ON! Biggest single power spike over ${d} min wins. Go all out!`,
        winnerVerb: 'peak',
    }),
};

export const MAX_CADENCE_GAME = {
    key: 'max-cadence',
    name: 'Max Cadence',
    description: 'Highest single cadence spike (RPM) wins.',
    higherIsBetter: true,
    needsReference: false,
    aggregate: 'max',
    carryForward: false,
    read: readCadenceGame,
    score: identity,
    anomalyThreshold: noAnomaly,
    format: fmtRpm,
    defaultInstructions: makeInstructions({
        intro: "Max Cadence! Your score is your single highest cadence reading.",
        howToWin: "The winner is whoever spins up to the highest RPM at any moment during the " +
            "game. Light gear, fast legs — spin it up!",
    }),
    messages: makeMessages({
        start: d => `Max Cadence ON! Highest single cadence over ${d} min wins. Spin those legs!`,
        winnerVerb: 'peak',
    }),
};

export const MAX_TORQUE_GAME = {
    key: 'max-torque',
    name: 'Max Torque',
    description: 'Highest single crank torque (N·m) wins.',
    higherIsBetter: true,
    needsReference: false,
    aggregate: 'max',
    carryForward: false,
    read: readTorque,
    score: identity,
    anomalyThreshold: noAnomaly,
    format: fmtNm,
    defaultInstructions: makeInstructions({
        intro: "Max Torque! Your score is your single highest crank torque — big power at low " +
            "cadence.",
        howToWin: "The winner is whoever produces the highest torque at any moment. Drop into a " +
            "big gear and stomp — torque is power divided by how fast you're pedalling.",
    }),
    messages: makeMessages({
        start: d => `Max Torque ON! Biggest single crank torque over ${d} min wins. Stomp on it!`,
        winnerVerb: 'peak',
    }),
};

export const TORQUE_NEAR_GAME = {
    key: 'avg-torque-near',
    name: 'Torque Near Leader',
    description: `Highest average torque while within ${PROXIMITY_M}m of the target rider wins.`,
    higherIsBetter: true,
    needsReference: true,
    aggregate: 'avg',
    carryForward: false,
    read: readTorque,
    score: identity,
    gate: withinProximity,
    anomalyThreshold: noAnomaly,
    format: fmtNm,
    defaultInstructions: makeInstructions({
        intro: `Torque Near Leader! Stay within ${PROXIMITY_M}m of the target rider and grind ` +
            "the biggest torque you can. You're only scored while you're in range.",
        howToWin: `The winner is the rider with the highest AVERAGE crank torque while within ` +
            `${PROXIMITY_M}m of the target. Big gear, stay close!`,
    }),
    messages: makeMessages({
        start: d => `Torque Near Leader ON! Highest average torque over ${d} min WHILE within ` +
            `${PROXIMITY_M}m of the leader wins. Grind and hold on!`,
        winnerVerb: 'avg',
    }),
};

export const POWER_NEAR_GAME = {
    key: 'min-power-near',
    name: 'Draft Master',
    description: `Lowest average power while within ${PROXIMITY_M}m of the target rider wins.`,
    higherIsBetter: false,
    needsReference: true,
    aggregate: 'avg',
    carryForward: false,
    read: readPower,
    score: identity,
    gate: withinProximity,
    anomalyThreshold: noAnomaly,
    format: fmtW,
    defaultInstructions: makeInstructions({
        intro: `Draft Master! Stay within ${PROXIMITY_M}m of the target rider and spend as ` +
            "little power as possible. You're only scored while you're in range.",
        howToWin: `The winner is the rider with the LOWEST average power while within ` +
            `${PROXIMITY_M}m of the target. Master the draft — get pushed along for free!`,
    }),
    messages: makeMessages({
        start: d => `Draft Master ON! Lowest average power over ${d} min WHILE within ` +
            `${PROXIMITY_M}m of the leader wins. Hide in the draft!`,
        winnerVerb: 'avg',
    }),
};

export const RIDEONS_GAME = {
    key: 'rideons-received',
    name: 'Ride-Ons Received',
    description: 'Most ride-ons received during the game wins.',
    higherIsBetter: true,
    needsReference: false,
    aggregate: 'delta',
    carryForward: false,
    read: readRideons,
    score: identity,
    anomalyThreshold: noAnomaly,
    format: fmtRideons,
    defaultInstructions: makeInstructions({
        intro: "Ride-Ons Received! Your score is how many ride-ons you collect during the game.",
        howToWin: "The winner is whoever receives the most ride-ons over the whole game. Be " +
            "awesome, be seen — earn the love!",
    }),
    messages: makeMessages({
        start: d => `Ride-Ons ON! Most ride-ons received over ${d} min wins. Earn some love!`,
        winnerVerb: '',
    }),
};


// Ordered registry — the dropdown lists games in this order; the first is the default.
export const GAMES = [
    LEADER_DISTANCE_GAME,
    AVERAGE_POWER_GAME,
    CADENCE_GAME,
    MAX_POWER_GAME,
    MAX_CADENCE_GAME,
    MAX_TORQUE_GAME,
    TORQUE_NEAR_GAME,
    POWER_NEAR_GAME,
    RIDEONS_GAME,
];

export const DEFAULT_GAME_KEY = GAMES[0].key;

const BY_KEY = new Map(GAMES.map(g => [g.key, g]));

// Resolve a game by key, falling back to the default for unknown/missing keys.
export function getGame(key) {
    return BY_KEY.get(key) || GAMES[0];
}
