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
 * Headless unit tests for the event roster in pages/event-roster.mjs — who counts as being on the
 * ride. Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventRoster} from '../pages/event-roster.mjs';

const SG = 7297286;   // the subgroup of the group ride that prompted all this

// One `nearby` entry. `sg` omitted = not in any event (which is how Zwift reports most riders).
function entry(id, {sg, self, watching} = {}) {
    return {athleteId: id, athlete: {sanitizedFullname: `#${id}`}, self, watching,
        state: {eventSubgroupId: sg}};
}

const ids = list => list.map(e => e.athleteId);


test('no event: nothing is filtered', () => {
    const r = new EventRoster();
    const tick = [entry(1, {sg: SG}), entry(2), entry(3)];
    const out = r.filter(tick);
    assert.equal(out, tick, 'the very same array — a free ride costs nothing');
    assert.equal(r.active, false);
    assert.equal(r.lastIgnored, 0);
});

test('turned off: nothing is filtered even inside an event', () => {
    const r = new EventRoster({subgroupId: SG, enabled: false});
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(2)])), [1, 2]);
    assert.equal(r.active, false);
    assert.equal(r.lastIgnored, 0);
});

test('in an event: riders who are not in it are dropped', () => {
    const r = new EventRoster({subgroupId: SG});
    const out = r.filter([entry(1, {sg: SG}), entry(2), entry(3, {sg: 999}), entry(4, {sg: SG})]);
    assert.deepEqual(ids(out), [1, 4]);
    assert.equal(r.lastTotal, 4);
    assert.equal(r.lastKept, 2);
    assert.equal(r.lastIgnored, 2, 'a stranger and another event\'s rider');
    assert.equal(r.size, 2);
});

test('a subgroup id that arrives as a string still matches', () => {
    const r = new EventRoster({subgroupId: String(SG)});
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(2)])), [1]);
});

test('membership is sticky: a rider who leaves the event keeps counting', () => {
    // Real case: 4 of 29 riders finished the event and rode on with the group, reporting no
    // subgroup at all for the rest of the ride. They are still on the ride.
    const r = new EventRoster({subgroupId: SG});
    r.filter([entry(1, {sg: SG}), entry(2, {sg: SG})]);
    const out = r.filter([entry(1, {sg: SG}), entry(2), entry(3)]);
    assert.deepEqual(ids(out), [1, 2], 'rider 2 stays, the newly-arrived stranger does not');
});

test('membership is sticky across an absence (intersections drop riders from nearby)', () => {
    const r = new EventRoster({subgroupId: SG});
    r.filter([entry(1, {sg: SG}), entry(2, {sg: SG})]);
    r.filter([entry(1, {sg: SG})]);                          // 2 vanished at an intersection
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(2)])), [1, 2], 'back, still ours');
});

test('a rider who joins the event mid-ride is picked up', () => {
    const r = new EventRoster({subgroupId: SG});
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(9)])), [1]);
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(9, {sg: SG})])), [1, 9], 'late join');
});

test('self and the configured leader count even when not registered for the event', () => {
    const r = new EventRoster({subgroupId: SG, leaderId: 42});
    const out = r.filter([entry(1, {sg: SG}), entry(42), entry(7, {self: true}), entry(8)]);
    assert.deepEqual(ids(out), [1, 42, 7], 'a leader is often not signed up to their own ride');
    assert.equal(r.has(42), true);
    assert.equal(r.has(8), false);
});

test('the watched rider is NOT kept — that is camera state, not a claim about the ride', () => {
    const r = new EventRoster({subgroupId: SG});
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(2, {watching: true})])), [1]);
});

test('a different event clears the previous membership', () => {
    const r = new EventRoster({subgroupId: SG});
    r.filter([entry(1, {sg: SG}), entry(2, {sg: SG})]);
    r.setConfig({subgroupId: 12345});
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(2, {sg: 12345})])), [2]);
    assert.equal(r.has(1), false, 'last week\'s roster means nothing to this event');
});

test('enabling mid-ride rebuilds membership from live ticks', () => {
    const r = new EventRoster({subgroupId: SG, enabled: false});
    r.filter([entry(1, {sg: SG}), entry(2)]);
    r.setConfig({enabled: true});
    assert.deepEqual(ids(r.filter([entry(1, {sg: SG}), entry(2)])), [1]);
});

test('junk entries are dropped while filtering', () => {
    const r = new EventRoster({subgroupId: SG});
    assert.deepEqual(ids(r.filter([null, {athlete: {}}, entry(1, {sg: SG})])), [1]);
    assert.deepEqual(ids(r.filter(undefined)), [], 'no snapshot, no crash');
});

test('reset forgets the event and its membership', () => {
    const r = new EventRoster({subgroupId: SG});
    r.filter([entry(1, {sg: SG})]);
    r.reset();
    assert.equal(r.size, 0);
    assert.equal(r.lastIgnored, 0);
});

test('the ride that prompted this: 21 in the event, 33 strangers', () => {
    // The tail of a real 2026-08-21 recording: the group rolled through another event's start pen
    // and `nearby` jumped from 21 riders to 54.
    const r = new EventRoster({subgroupId: SG});
    const ours = Array.from({length: 21}, (_, i) => entry(100 + i, {sg: SG}));
    r.filter(ours);
    const crowd = [...ours, ...Array.from({length: 33}, (_, i) => entry(900 + i))];
    const out = r.filter(crowd);
    assert.equal(out.length, 21);
    assert.equal(r.lastIgnored, 33);
});

test('has() answers the same for a numeric and a string athleteId', () => {
    // The tracker keys its records by the raw athleteId; the ledger keys its sightings by string.
    // Both prune themselves through has(), so it must not care which it is handed.
    const r = new EventRoster({subgroupId: SG});
    r.filter([entry(1234, {sg: SG})]);
    assert.equal(r.has(1234), true);
    assert.equal(r.has('1234'), true);
    assert.equal(r.has('9999'), false);
});

test('a configured leaderId given as a string still counts', () => {
    const r = new EventRoster({subgroupId: SG, leaderId: '42'});
    assert.deepEqual(ids(r.filter([entry(42), entry(8)])), [42]);
});
