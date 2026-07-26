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
 * Headless unit tests for the game registry in pages/games.mjs.
 * Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    GAMES, getGame, DEFAULT_GAME_KEY, LEADER_DISTANCE_GAME, CADENCE_GAME,
    AVERAGE_POWER_GAME, MAX_POWER_GAME, MAX_CADENCE_GAME, MAX_TORQUE_GAME,
    TORQUE_NEAR_GAME, POWER_NEAR_GAME, RIDEONS_GAME,
} from '../pages/games.mjs';

test('registry is a non-empty ordered array with unique keys', () => {
    assert.ok(Array.isArray(GAMES) && GAMES.length >= 2);
    const keys = GAMES.map(g => g.key);
    assert.equal(new Set(keys).size, keys.length, 'keys are unique');
});

test('DEFAULT_GAME_KEY is the first game and is the leader-distance game', () => {
    assert.equal(DEFAULT_GAME_KEY, GAMES[0].key);
    assert.equal(GAMES[0], LEADER_DISTANCE_GAME);
});

test('every game defines the required fields and callable functions', () => {
    for (const g of GAMES) {
        assert.equal(typeof g.key, 'string');
        assert.equal(typeof g.name, 'string');
        assert.equal(typeof g.description, 'string');
        assert.equal(typeof g.higherIsBetter, 'boolean');
        assert.equal(typeof g.needsReference, 'boolean');
        assert.ok(['avg', 'max', 'delta'].includes(g.aggregate), `${g.key} has a valid aggregate`);
        assert.equal(typeof g.carryForward, 'boolean');
        assert.equal(typeof g.read, 'function');
        assert.equal(typeof g.score, 'function');
        assert.equal(typeof g.anomalyThreshold, 'function');
        assert.equal(typeof g.format, 'function');
        assert.equal(typeof g.defaultInstructions, 'string');
        assert.ok(g.messages && typeof g.messages.start === 'function');
        assert.ok(g.defaultInstructions.trim().length > 0);
        // Every game formats floats with 2 decimals (project rule — no integer rounding).
        assert.match(g.format(42.5), /42\.50/);
        if (g.needsReference) {
            assert.equal(typeof g.gate === 'undefined' || typeof g.gate === 'function', true);
        }
    }
});

test('the new games are registered under stable keys', () => {
    for (const key of ['average-power', 'max-power', 'max-cadence', 'max-torque',
                       'avg-torque-near', 'min-power-near', 'rideons-received']) {
        assert.equal(getGame(key).key, key, `${key} resolves`);
    }
});

test('aggregate modes are wired as intended', () => {
    assert.equal(AVERAGE_POWER_GAME.aggregate, 'avg');
    assert.equal(MAX_POWER_GAME.aggregate, 'max');
    assert.equal(MAX_CADENCE_GAME.aggregate, 'max');
    assert.equal(MAX_TORQUE_GAME.aggregate, 'max');
    assert.equal(RIDEONS_GAME.aggregate, 'delta');
    assert.equal(AVERAGE_POWER_GAME.carryForward, true, 'averaging games carry forward');
    assert.equal(MAX_POWER_GAME.carryForward, false, 'peak games do not');
    assert.equal(RIDEONS_GAME.carryForward, false);
});

test('power / cadence reads pull off entry.state and skip when missing', () => {
    assert.equal(AVERAGE_POWER_GAME.read({state: {power: 240}}), 240);
    assert.equal(AVERAGE_POWER_GAME.read({state: {}}), null);
    assert.equal(AVERAGE_POWER_GAME.read({}), null);
    assert.equal(MAX_CADENCE_GAME.read({state: {cadence: 95}}), 95);
});

test('torque = power·60/(2π·cadence); undefined at 0 rpm', () => {
    const t = MAX_TORQUE_GAME.read({state: {power: 200, cadence: 90}});
    assert.ok(Math.abs(t - (200 * 60) / (2 * Math.PI * 90)) < 1e-9);
    assert.ok(Math.abs(t - 21.22) < 0.01, `~21.22 N·m, got ${t}`);
    assert.equal(MAX_TORQUE_GAME.read({state: {power: 200, cadence: 0}}), null, 'no torque at 0 rpm');
    assert.equal(MAX_TORQUE_GAME.read({state: {power: 200}}), null, 'no cadence -> null');
    assert.match(MAX_TORQUE_GAME.format(21.22), /21\.22N·m/);
});

test('ride-ons game reads cumulative count and uses delta aggregate', () => {
    assert.equal(RIDEONS_GAME.read({state: {rideons: 7}}), 7);
    assert.equal(RIDEONS_GAME.read({state: {}}), null);
    assert.equal(RIDEONS_GAME.aggregate, 'delta');
    assert.match(RIDEONS_GAME.format(3), /3\.00 ride-ons/);
});

test('proximity games gate on distance from the leader and require a reference', () => {
    for (const g of [POWER_NEAR_GAME, TORQUE_NEAR_GAME]) {
        assert.equal(g.needsReference, true);
        assert.equal(typeof g.gate, 'function');
        assert.equal(g.gate({}, {relGap: 20}), true, 'within 30m counts');
        assert.equal(g.gate({}, {relGap: -25}), true, 'sign-independent');
        assert.equal(g.gate({}, {relGap: 45}), false, 'beyond 30m excluded');
    }
    assert.equal(POWER_NEAR_GAME.higherIsBetter, false, 'lowest power wins');
    assert.equal(TORQUE_NEAR_GAME.higherIsBetter, true, 'highest torque wins');
});

test('getGame resolves known keys and falls back to the default for unknown/missing', () => {
    assert.equal(getGame('cadence'), CADENCE_GAME);
    assert.equal(getGame('leader-distance'), LEADER_DISTANCE_GAME);
    assert.equal(getGame('does-not-exist'), GAMES[0]);
    assert.equal(getGame(undefined), GAMES[0]);
    assert.equal(getGame(null), GAMES[0]);
});

test('leader-distance: read/score/format behave as before', () => {
    assert.equal(LEADER_DISTANCE_GAME.read({gapDistance: 110}), 110);
    assert.equal(LEADER_DISTANCE_GAME.score(110, {offset: 100}), 10);
    assert.equal(LEADER_DISTANCE_GAME.score(90, {offset: 100}), 10, 'absolute distance');
    assert.equal(LEADER_DISTANCE_GAME.format(42), '42.00m');
    assert.equal(LEADER_DISTANCE_GAME.anomalyThreshold({anomalyThresholdM: 150}), 150);
    assert.equal(LEADER_DISTANCE_GAME.higherIsBetter, false);
    assert.equal(LEADER_DISTANCE_GAME.needsReference, true);
});

test('cadence: read/score/format and no-reference config', () => {
    assert.equal(CADENCE_GAME.read({state: {cadence: 90}}), 90);
    assert.equal(CADENCE_GAME.read({state: {}}), null, 'missing cadence -> null (skip)');
    assert.equal(CADENCE_GAME.read({}), null, 'missing state -> null (skip)');
    assert.equal(CADENCE_GAME.score(90), 90, 'score is the reading itself');
    assert.equal(CADENCE_GAME.format(85.4), '85.40rpm');
    assert.equal(CADENCE_GAME.anomalyThreshold({anomalyThresholdM: 150}), null, 'no anomaly check');
    assert.equal(CADENCE_GAME.higherIsBetter, true);
    assert.equal(CADENCE_GAME.needsReference, false);
});
