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
 * Headless unit tests for the default message text in pages/messages.mjs.
 * Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEFAULT_INSTRUCTIONS, MESSAGES, CADENCE_INSTRUCTIONS, CADENCE_MESSAGES,
    makeInstructions, makeMessages, SAFETY_NOTE,
} from '../pages/messages.mjs';
import {instructionMessages} from '../pages/engine.mjs';

test('DEFAULT_INSTRUCTIONS is a non-empty multi-block blob', () => {
    assert.equal(typeof DEFAULT_INSTRUCTIONS, 'string');
    assert.ok(DEFAULT_INSTRUCTIONS.trim().length > 0);
    // Blank lines separate messages; the default should split into more than one.
    assert.ok(instructionMessages(DEFAULT_INSTRUCTIONS).length >= 2);
});

test('MESSAGES.start embeds the duration', () => {
    assert.match(MESSAGES.start(20), /20 min/);
    assert.match(MESSAGES.start(20), /Ride Leader Game ON!/);
});

test('MESSAGES.rankEntry formats rank, name and distance', () => {
    assert.equal(MESSAGES.rankEntry(2, 'Alice', '42m'), '2) Alice 42m');
});

test('MESSAGES.standings prepends time to go and joins the ranking parts', () => {
    assert.equal(
        MESSAGES.standings('5:00', ['1) A 1m', '2) B 2m']),
        '5:00 to go. Standings: 1) A 1m  2) B 2m',
    );
});

test('MESSAGES.winner appends runner-ups only when present', () => {
    assert.equal(MESSAGES.winner('Alice', '10m', []), 'Winner: Alice — avg 10m from the leader!');
    assert.match(MESSAGES.winner('Alice', '10m', ['2) Bob 20m']), /Then 2\) Bob 20m$/);
});

test('MESSAGES.noQualifiers cites the sample threshold', () => {
    assert.match(MESSAGES.noQualifiers(5), /no winner winners needed 5\+ samples/);
});


// ---- cadence game text ----

test('CADENCE_INSTRUCTIONS is a non-empty multi-block blob', () => {
    assert.equal(typeof CADENCE_INSTRUCTIONS, 'string');
    assert.ok(CADENCE_INSTRUCTIONS.trim().length > 0);
    assert.ok(instructionMessages(CADENCE_INSTRUCTIONS).length >= 2);
});

test('CADENCE_MESSAGES.start embeds the duration', () => {
    assert.match(CADENCE_MESSAGES.start(20), /20 min/);
    assert.match(CADENCE_MESSAGES.start(20), /Cadence Challenge ON!/);
});

test('CADENCE_MESSAGES.rankEntry formats rank, name and value', () => {
    assert.equal(CADENCE_MESSAGES.rankEntry(2, 'Alice', '85rpm'), '2) Alice 85rpm');
});

test('CADENCE_MESSAGES.standings prepends time to go and joins the ranking parts', () => {
    assert.equal(
        CADENCE_MESSAGES.standings('5:00', ['1) A 90rpm', '2) B 80rpm']),
        '5:00 to go. Standings: 1) A 90rpm  2) B 80rpm',
    );
});

test('CADENCE_MESSAGES.winner has no leader wording and appends runner-ups when present', () => {
    assert.equal(CADENCE_MESSAGES.winner('Alice', '90rpm', []), 'Winner: Alice — avg 90rpm!');
    assert.ok(!/from the leader/.test(CADENCE_MESSAGES.winner('Alice', '90rpm', [])));
    assert.match(CADENCE_MESSAGES.winner('Alice', '90rpm', ['2) Bob 80rpm']), /Then 2\) Bob 80rpm$/);
});


// ---- message/instruction factory (the additional games) ----

test('makeInstructions builds a >= 3-block blob ending in the safety note', () => {
    const blob = makeInstructions({intro: 'Goal here.', howToWin: 'Win like this.'});
    const blocks = instructionMessages(blob);
    assert.ok(blocks.length >= 3, 'intro + how-to-win + safety');
    assert.equal(blocks[0], 'Goal here.');
    assert.equal(blocks[blocks.length - 1], SAFETY_NOTE);
});

test('makeMessages: rankEntry / standings / noQualifiers match the shared format', () => {
    const m = makeMessages({start: d => `ON ${d}`, winnerVerb: 'peak'});
    assert.equal(m.start(20), 'ON 20');
    assert.equal(m.rankEntry(2, 'Alice', '300W'), '2) Alice 300W');
    assert.equal(m.standings('5:00', ['1) A 1W', '2) B 2W']), '5:00 to go. Standings: 1) A 1W  2) B 2W');
    assert.match(m.noQualifiers(5), /needed 5\+ samples/);
});

test('makeMessages winner: uses the verb, or just the value when the verb is empty', () => {
    const peak = makeMessages({start: () => '', winnerVerb: 'peak'});
    assert.equal(peak.winner('Alice', '300W', []), 'Winner: Alice — peak 300W!');
    assert.match(peak.winner('Alice', '300W', ['2) Bob 250W']), /Then 2\) Bob 250W$/);

    const bare = makeMessages({start: () => '', winnerVerb: ''});
    assert.equal(bare.winner('Alice', '5.00 ride-ons', []), 'Winner: Alice — 5.00 ride-ons!');
});
