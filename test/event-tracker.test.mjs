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
 * Headless unit tests for the event-long tracker in pages/event-tracker.mjs.
 * Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventTracker, METRICS, getMetric, DEFAULT_METRIC_KEY} from '../pages/event-tracker.mjs';

const METERS_PER_MILE = 1609.344;

function entry(id, name, {power, cadence, distance, kj, rideons} = {}) {
    return {athleteId: id, athlete: {sanitizedFullname: name},
        state: {power, cadence, distance, kj, rideons}};
}

// Alice & Bob over three 1s ticks (t = 1000, 2000, 3000).
function feed() {
    const t = new EventTracker();
    const snaps = [
        [entry(2, 'Alice', {power: 100, cadence: 60, distance: 0, kj: 0, rideons: 1}),
         entry(3, 'Bob', {power: 400, cadence: 90, distance: 0, kj: 0, rideons: 0})],
        [entry(2, 'Alice', {power: 200, cadence: 60, distance: 100, kj: 5, rideons: 1}),
         entry(3, 'Bob', {power: 400, cadence: 90, distance: 50, kj: 2, rideons: 0})],
        [entry(2, 'Alice', {power: 300, cadence: 60, distance: 200, kj: 10, rideons: 3}),
         entry(3, 'Bob', {power: 400, cadence: 90, distance: 100, kj: 4, rideons: 0})],
    ];
    let ms = 0;
    for (const snap of snaps) {
        ms += 1000;
        t.ingest(snap, ms);
    }
    return t;
}


test('registry: metrics have unique keys and the default is first', () => {
    const keys = METRICS.map(m => m.key);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(DEFAULT_METRIC_KEY, METRICS[0].key);
    assert.equal(getMetric('does-not-exist'), METRICS[0], 'unknown falls back to default');
});

test('avg / max power standings rank correctly since event start', () => {
    const t = feed();
    const avg = t.standings('avg-power');
    assert.equal(avg[0].name, 'Bob', 'Bob avg 400 > Alice avg 200');
    assert.equal(avg.find(r => r.name === 'Alice').value, 200);

    const max = t.standings('max-power');
    assert.equal(max[0].name, 'Bob');
    assert.equal(max.find(r => r.name === 'Alice').value, 300, 'Alice peak');
});

test('ride-ons and distance use cumulative deltas', () => {
    const t = feed();
    const ro = t.standings('rideons');
    assert.equal(ro[0].name, 'Alice', 'Alice received 2, Bob 0');
    assert.equal(ro[0].value, 2);

    const dist = t.standings('distance');
    assert.equal(dist[0].name, 'Alice');
    assert.ok(Math.abs(dist[0].value - 200 / METERS_PER_MILE) < 1e-6, 'metres → miles');
});

test('pedal strokes integrate cadence over elapsed time', () => {
    const t = feed();
    const strokes = t.standings('strokes');
    // Alice: 60rpm over two 1s steps = 60 * (1/60) * 2 = 2 revolutions. Bob: 90rpm → 3.
    assert.equal(strokes.find(r => r.name === 'Alice').value, 2);
    assert.equal(strokes.find(r => r.name === 'Bob').value, 3);
});

test('rideTotals sums across all riders', () => {
    const t = feed();
    const tot = t.rideTotals();
    assert.equal(tot.riders, 2);
    assert.ok(Math.abs(tot.miles - 300 / METERS_PER_MILE) < 1e-6, '(200 + 100) m in miles');
    assert.equal(tot.strokes, 5, '2 + 3');
    assert.equal(tot.rideOns, 2, '2 + 0');
    assert.equal(tot.calories, 14, '(10 + 4) kJ ≈ kcal');
});

test('reset clears all accumulation', () => {
    const t = feed();
    t.reset();
    assert.equal(t.standings('avg-power').length, 0);
    assert.equal(t.rideTotals().riders, 0);
    assert.equal(t.startTime, null);
});

test('riders with no readings for a metric are omitted from its standings', () => {
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {power: 100})], 1000);   // no cadence at all
    assert.equal(t.standings('avg-cadence').length, 0);
    assert.equal(t.standings('avg-power').length, 1);
});
