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

function entry(id, name, {power, cadence, distance, kj, rideons, level} = {}) {
    return {athleteId: id, athlete: {sanitizedFullname: name, level},
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
    assert.equal(tot.levelsGained, 0, 'no levels in this fixture');
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


test('firstSeenAt records the tick a rider appeared, and does not move when they return', () => {
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {power: 100})], 1000);
    t.ingest([], 2000);                                   // Alice drops out (intersection)
    t.ingest([entry(2, 'Alice', {power: 100})], 9000);     // ...and comes back
    assert.equal(t.athletes.get(2).firstSeenAt, 1000);
});


// ---- history metrics --------------------------------------------------------------------------
// These come from the persistent ledger (rider-history.mjs), not from the nearby ticks: the tracker
// just copies them onto each record via historyLookup so they can be viewed like any other metric.

test('the history metrics rank riders by the stamped ledger values', () => {
    const history = {2: {rides: 3, streak: 1}, 3: {rides: 40, streak: 12}};
    const t = new EventTracker({historyLookup: id => history[id] || null});
    t.ingest([entry(2, 'Alice', {power: 100}), entry(3, 'Bob', {power: 100})], 1000);

    assert.deepEqual(t.standings('rides-desc').map(r => r.name), ['Bob', 'Alice']);
    assert.deepEqual(t.standings('rides-asc').map(r => r.name), ['Alice', 'Bob']);
    assert.equal(t.standings('rides-desc')[0].value, 40);
    assert.deepEqual(t.standings('streak-desc').map(r => r.name), ['Bob', 'Alice']);
});

test('counts format as whole numbers (not the 2-decimal convention) and pluralize', () => {
    assert.equal(getMetric('rides-desc').format(12), '12 rides');
    assert.equal(getMetric('rides-desc').format(1), '1 ride');
    assert.equal(getMetric('streak-desc').format(4), '4 in a row');
});

test('a rider with no ledger entry is omitted, and with no history wired nobody is listed', () => {
    const history = {2: {rides: 3, streak: 1}};
    const t = new EventTracker({historyLookup: id => history[id] || null});
    t.ingest([entry(2, 'Alice', {power: 100}), entry(3, 'Bob', {power: 100})], 1000);
    assert.deepEqual(t.standings('rides-desc').map(r => r.name), ['Alice'], 'Bob not credited yet');

    const bare = new EventTracker();
    bare.ingest([entry(2, 'Alice', {power: 100})], 1000);
    assert.equal(bare.standings('rides-desc').length, 0, 'no history wired -> nobody, not a throw');
});

test('the stamped values follow the ledger when it changes mid-ride', () => {
    let rides = 9;
    const t = new EventTracker({historyLookup: () => ({rides, streak: 1})});
    t.ingest([entry(2, 'Alice', {power: 100})], 1000);
    assert.equal(t.standings('rides-desc')[0].value, 9);
    rides = 10;                                        // credited during the ride
    t.ingest([entry(2, 'Alice', {power: 100})], 2000);
    assert.equal(t.standings('rides-desc')[0].value, 10);
});


// ---- levels -----------------------------------------------------------------------------------

test('the two level metrics show the current level, sorted opposite ways', () => {
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {level: 12}), entry(3, 'Bob', {level: 45})], 1000);

    const desc = t.standings('level-desc');
    assert.deepEqual(desc.map(r => r.name), ['Bob', 'Alice']);
    assert.equal(desc[0].value, 45);

    const asc = t.standings('level-asc');
    assert.deepEqual(asc.map(r => r.name), ['Alice', 'Bob'], 'same values, reversed order');

    assert.equal(getMetric('level-desc').format(45), 'Lv 45.00', '2 decimals like every other value');
});

test('riders whose profile has no level yet are omitted from the level standings', () => {
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {level: 12}), entry(3, 'Bob', {power: 100})], 1000);
    assert.deepEqual(t.standings('level-desc').map(r => r.name), ['Alice']);
});

// A rider's level has to have been known for a while before a rise off it is believed — see the
// LEVEL_SETTLE_MS block in event-tracker.mjs. These sit either side of that window.
const SETTLED = 61_000;
const PROVISIONAL_SETTLED = 301_000;

test('ingest reports a level-up event when a settled rider gains one level', () => {
    const t = new EventTracker();
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 41})], 1000), [],
        'the first level seen is a baseline, not a level-up');

    const at = 1000 + SETTLED;
    const events = t.ingest([entry(2, 'Alice', {level: 42})], at);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0], {type: 'level-up', athleteId: 2, name: 'Alice',
        from: 41, to: 42, at});
});

test('a level that arrives late, repeats, or goes backwards raises no event', () => {
    const t = new EventTracker();
    // Profile not loaded yet: no level at all, then it appears — that is a baseline, not a level-up.
    assert.deepEqual(t.ingest([entry(2, 'Alice', {power: 100})], 1000), []);
    assert.deepEqual(t.ingest([entry(2, 'Alice', {power: 100, level: 42})], 2000), []);
    // Unchanged, then a bogus lower reading, both well after the settle window.
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 42})], 2000 + SETTLED), []);
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 41})], 3000 + SETTLED), []);
    assert.deepEqual(t.ingest([], 4000 + SETTLED), [], 'an empty snapshot still returns an array');
});

test('a profile that settles just after a rider appears is not a level-up', () => {
    const t = new EventTracker();
    // Sauce serves the level it had cached from a previous ride, then the real profile lands a
    // couple of seconds later. Both a big catch-up and a one-level one must stay quiet.
    t.ingest([entry(2, 'Alice', {level: 30}), entry(3, 'Bob', {level: 33})], 1000);
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 34}), entry(3, 'Bob', {level: 34})], 3000),
        [], 'stale cached level replaced by the real one');
    assert.equal(t.rideTotals().levelsGained, 0);
    assert.equal(t.standings('level-desc')[0].value, 34, 'but the standings do show the real level');

    // Having re-baselined silently, a genuine level-up later still fires — once.
    const events = t.ingest([entry(2, 'Alice', {level: 35}), entry(3, 'Bob', {level: 34})],
        3000 + SETTLED);
    assert.deepEqual(events.map(e => e.name), ['Alice']);
    assert.deepEqual([events[0].from, events[0].to], [34, 35]);
});

test('a rider first seen at Level 1 gets a longer probation before any level-up', () => {
    const t = new EventTracker();
    // Lv 1 on first sighting usually means the profile has not really loaded, so even the +1 to
    // Lv 2 that would otherwise pass the normal settle window is not announced.
    t.ingest([entry(2, 'Alice', {level: 1})], 1000);
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 2})], 1000 + SETTLED), [],
        'still inside the Level 1 probation');
    // A real Level 2 novice, whose profile has been re-read since, does get their level-up.
    const at = 1000 + SETTLED + PROVISIONAL_SETTLED;
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 3})], at).map(e => e.to), [3]);
});

test('a rider first seen at Level 1 whose real profile then lands is not a level-up', () => {
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {level: 1})], 1000);
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 27})], 3000), [], 'the profile arriving');
    assert.equal(t.rideTotals().levelsGained, 0);
    // Now on a real level, the normal (shorter) settle window applies.
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 28})], 3000 + SETTLED).map(e => e.to), [28]);
});

test('levelSettling:false announces a one-level rise immediately', () => {
    // The leader's opt-out: early and occasionally wrong beats late. The impossible-jump rule is
    // not part of the switch, so a settling profile that leaps several levels is still silent.
    const t = new EventTracker({levelSettling: false});
    t.ingest([entry(2, 'Alice', {level: 41}), entry(3, 'Bob', {level: 30})], 1000);
    const events = t.ingest([entry(2, 'Alice', {level: 42}), entry(3, 'Bob', {level: 34})], 2000);
    assert.deepEqual(events.map(e => e.name), ['Alice'], 'Bob jumped 4 levels — profile settling');
    assert.equal(t.rideTotals().levelsGained, 1);

    // And it is a live setting: switching it back on restores the settle windows.
    t.setConfig({levelSettling: true});
    assert.deepEqual(t.ingest([entry(2, 'Alice', {level: 43})], 3000), []);
});

test('levels gained counts confirmed level-ups and is totalled across the ride', () => {
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {level: 41}), entry(3, 'Bob', {level: 9})], 1000);
    // Alice jumps two levels at once — impossible in game, so it is a settling profile, not a gain.
    t.ingest([entry(2, 'Alice', {level: 43}), entry(3, 'Bob', {level: 10})], 1000 + SETTLED);
    assert.equal(t.rideTotals().levelsGained, 1, 'Bob +1; Alice +2 rejected as data settling');
    // The standings still show the CURRENT level, not the gain.
    assert.equal(t.standings('level-desc')[0].value, 43);

    t.ingest([entry(2, 'Alice', {level: 44}), entry(3, 'Bob', {level: 11})], 2000 + 2 * SETTLED);
    assert.equal(t.rideTotals().levelsGained, 3, 'one each on top');
});

test('retain forgets riders who turn out not to be on the ride', () => {
    // The event a ride is in resolves a beat after the window opens, so the first ticks can
    // accumulate passers-by. Once the roster is known they should leave no trace — not even a
    // one-sample entry in the standings or a slice of the ride totals.
    const t = new EventTracker();
    t.ingest([entry(2, 'Alice', {power: 100, distance: 0, rideons: 0}),
        entry(3, 'Bob', {power: 100, distance: 0, rideons: 0}),
        entry(9, 'Passer-by', {power: 500, distance: 0, rideons: 0})], 1000);
    t.ingest([entry(2, 'Alice', {power: 100, distance: 100, rideons: 0}),
        entry(3, 'Bob', {power: 100, distance: 100, rideons: 0}),
        entry(9, 'Passer-by', {power: 500, distance: 400, rideons: 7})], 2000);
    assert.equal(t.standings('max-power')[0].name, 'Passer-by');

    const ours = new Set([2, 3]);
    assert.equal(t.retain(id => ours.has(id)), 1, 'one record dropped');
    assert.deepEqual(t.standings('max-power').map(r => r.name), ['Alice', 'Bob']);
    const totals = t.rideTotals();
    assert.equal(totals.riders, 2);
    assert.equal(totals.rideOns, 0, 'the stranger\'s ride-ons are gone from the ride totals');
    assert.equal(Math.round(totals.miles * METERS_PER_MILE), 200, 'and their distance');

    // Idempotent, and harmless when everyone counts.
    assert.equal(t.retain(id => ours.has(id)), 0);
    assert.equal(t.retain(() => true), 0);
});
