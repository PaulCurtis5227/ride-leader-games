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
 * Headless unit tests for the joke deck (pages/jokedeck.mjs) and the joke data (pages/jokes-data.mjs).
 * Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {JokeDeck} from '../pages/jokedeck.mjs';
import {JOKES} from '../pages/jokes-data.mjs';

// A tiny deterministic RNG (mulberry32) so shuffles are reproducible in tests.
function seededRng(seed) {
    let a = seed >>> 0;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('JOKES is a sizable set of well-formed {setup, punchline} pairs', () => {
    assert.ok(Array.isArray(JOKES));
    assert.ok(JOKES.length >= 150, `expected ~200 jokes, got ${JOKES.length}`);
    for (const j of JOKES) {
        assert.equal(typeof j.setup, 'string');
        assert.equal(typeof j.punchline, 'string');
        assert.ok(j.setup.trim().length > 0);
        assert.ok(j.punchline.trim().length > 0);
    }
});

test('JOKES has no exact duplicates', () => {
    const seen = new Set();
    for (const j of JOKES) {
        const key = `${j.setup}||${j.punchline}`;
        assert.ok(!seen.has(key), `duplicate joke: ${j.setup}`);
        seen.add(key);
    }
});

test('empty deck returns null and reports size 0', () => {
    const deck = new JokeDeck([]);
    assert.equal(deck.size, 0);
    assert.equal(deck.current, null);
    assert.equal(deck.next(), null);
});

test('next() advances and sets current', () => {
    const deck = new JokeDeck([{setup: 'a', punchline: 'A'}], {rng: seededRng(1)});
    assert.equal(deck.current, null);
    const j = deck.next();
    assert.equal(j.setup, 'a');
    assert.equal(deck.current, j);
});

test('a single-joke deck just repeats that joke', () => {
    const only = {setup: 'a', punchline: 'A'};
    const deck = new JokeDeck([only], {rng: seededRng(2)});
    for (let i = 0; i < 5; i++) {
        assert.equal(deck.next(), only);
    }
});

test('deals every joke once before repeating any (bag behavior)', () => {
    const jokes = Array.from({length: 8}, (_, i) => ({setup: `s${i}`, punchline: `p${i}`}));
    const deck = new JokeDeck(jokes, {rng: seededRng(42)});
    const firstPass = new Set();
    for (let i = 0; i < jokes.length; i++) {
        firstPass.add(deck.next().setup);
    }
    assert.equal(firstPass.size, jokes.length, 'every joke should appear exactly once per bag');
});

test('never repeats back-to-back across a reshuffle seam', () => {
    const jokes = Array.from({length: 5}, (_, i) => ({setup: `s${i}`, punchline: `p${i}`}));
    // Run many seeds and many draws; no two consecutive draws may be identical.
    for (let seed = 1; seed <= 50; seed++) {
        const deck = new JokeDeck(jokes, {rng: seededRng(seed)});
        let prev = null;
        for (let i = 0; i < 40; i++) {
            const j = deck.next();
            assert.notEqual(j, prev, `back-to-back repeat at seed ${seed}, draw ${i}`);
            prev = j;
        }
    }
});
