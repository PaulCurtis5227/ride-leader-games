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
        assert.equal(typeof g.read, 'function');
        assert.equal(typeof g.score, 'function');
        assert.equal(typeof g.anomalyThreshold, 'function');
        assert.equal(typeof g.format, 'function');
        assert.equal(typeof g.defaultInstructions, 'string');
        assert.ok(g.messages && typeof g.messages.start === 'function');
        assert.ok(g.defaultInstructions.trim().length > 0);
    }
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
