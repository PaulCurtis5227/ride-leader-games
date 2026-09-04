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
 * Headless unit tests for the persistent rider history in pages/rider-history.mjs.
 * Run: `npm test` (node --test). No DOM / no Sauce / no localStorage needed — the store is injected.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RiderHistory, STORE_KEY, STORE_VERSION, MILESTONES, PRESENCE_MS, SESSION_RESUME_MS,
    normalizeEventName, keyForEvent, parseMilestones,
} from '../pages/rider-history.mjs';

// Minimal localStorage stand-in.
function mkStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        _map: map,
    };
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// A history bound to `storage`, series selected, ready to ride.
function mkHistory(storage = mkStorage(), opts = {}) {
    const h = new RiderHistory({storage, ...opts});
    h.load();
    h.useSeries('series:99', {label: 'Sunday Social'});
    return h;
}

/*
 * Run one whole ride: everyone present from t0, committed after the presence threshold.
 * Returns the history so a caller can chain weeks.
 */
function rideWith(h, ids, t0, {names} = {}) {
    h.beginSession(t0);
    for (const id of ids) {
        h.observe(id, names ? names[id] : `Rider${id}`, t0);
    }
    const t1 = t0 + PRESENCE_MS + 1000;
    for (const id of ids) {
        h.observe(id, names ? names[id] : `Rider${id}`, t1);
    }
    h.commit(t1);
    return t1;
}

function ridesOf(h, id) {
    const rec = h.recordFor(id);
    return rec ? rec.rides : null;
}


// ---------------------------------------------------------------- event identity

test('normalizeEventName strips trailing week / round / date markers', () => {
    const cases = [
        ['Sunday Social', 'sunday social'],
        ['Sunday Social - Week 12', 'sunday social'],
        ['Sunday Social — Week 13', 'sunday social'],
        ['Sunday Social (Week 4)', 'sunday social'],
        ['Sunday Social #7', 'sunday social'],
        ['Sunday Social | Rd 3', 'sunday social'],
        ['Sunday Social 2026-08-13', 'sunday social'],
        ['Sunday Social - Week 12 (2026-08-13)', 'sunday social'],
        ['  Sunday Social  ', 'sunday social'],
    ];
    for (const [input, want] of cases) {
        assert.equal(normalizeEventName(input), want, input);
    }
});

test('normalizeEventName does not eat a name that is only a number, or distinct rides', () => {
    assert.equal(normalizeEventName('12'), '12', 'would otherwise normalize to empty');
    assert.notEqual(normalizeEventName('Sunday Social'), normalizeEventName('Tuesday Hills'));
    // A trailing number that is part of the identity is a known, accepted cost of normalizing.
    assert.equal(normalizeEventName('Zone 2'), 'zone');
});

test('keyForEvent prefers the stable series id, then the name, then a manual label', () => {
    assert.equal(keyForEvent({seriesId: 42, eventName: 'Whatever - Week 3'}), 'series:42');
    assert.equal(keyForEvent({eventName: 'Sunday Social - Week 3'}), 'name:sunday social');
    assert.equal(keyForEvent({label: 'My Ride'}), 'manual:my ride');
    assert.equal(keyForEvent({}), 'manual:default');
    assert.equal(keyForEvent({seriesId: 0, eventName: 'Social'}), 'name:social', '0 is not a series');
});

test('parseMilestones cleans a leader-edited ladder and falls back when empty', () => {
    assert.deepEqual(parseMilestones('10, 50,100'), [10, 50, 100]);
    assert.deepEqual(parseMilestones('100 50 10 50'), [10, 50, 100], 'sorted + deduped');
    assert.deepEqual(parseMilestones(''), MILESTONES);
    assert.deepEqual(parseMilestones('nonsense'), MILESTONES);
    assert.deepEqual(parseMilestones('0, 10'), [10], 'zero dropped');
    // Any non-digit run separates, so a dash is punctuation — "10-50" is two milestones, and a
    // negative cannot be expressed at all (it would be meaningless in this field anyway).
    assert.deepEqual(parseMilestones('10-50'), [10, 50]);
});


// ---------------------------------------------------------------- presence threshold

test('a rider must be present for the threshold before a ride is credited', () => {
    const h = mkHistory();
    h.beginSession(0);
    h.observe(7, 'Passer By', 0);
    h.commit(60_000);                       // one minute later — a passer-by
    assert.equal(h.recordFor(7), null, 'not credited, not even created');

    h.observe(7, 'Passer By', PRESENCE_MS + 1);
    h.commit(PRESENCE_MS + 1);
    assert.equal(ridesOf(h, 7), 1, 'credited once past the threshold');
});

test('a rider who drops out and returns keeps their original presence clock', () => {
    const h = mkHistory();
    h.beginSession(0);
    h.observe(7, 'Alice', 0);
    h.observe(7, 'Alice', 60_000);          // vanishes at an intersection...
    h.observe(7, 'Alice', 4 * 60_000);      // ...and is back before the threshold
    h.commit(PRESENCE_MS + 1);
    assert.equal(ridesOf(h, 7), 1, 'presence measured from the FIRST sighting, not the latest');
});


// ---------------------------------------------------------------- session identity

test('commit is idempotent within a ride however often it is called', () => {
    const h = mkHistory();
    h.beginSession(0);
    h.observe(7, 'Alice', 0);
    for (let t = PRESENCE_MS; t < PRESENCE_MS + 10_000; t += 1000) {
        h.observe(7, 'Alice', t);
        h.commit(t);
    }
    assert.equal(ridesOf(h, 7), 1);
});

test('reopening the control window mid-ride resumes the session and does NOT double-count', () => {
    const storage = mkStorage();
    const h1 = mkHistory(storage);
    const t = rideWith(h1, [7, 8], 0);
    h1.save();
    assert.equal(ridesOf(h1, 7), 1);

    // Window reopened 20 minutes in: fresh object, same storage.
    const h2 = mkHistory(storage);
    const s = h2.beginSession(t + 20 * 60_000);
    assert.equal(s.resumed, true, 'within SESSION_RESUME_MS -> same session');
    assert.equal(s.index, 1, 'session index unchanged');
    rideWith(h2, [7, 8], t + 20 * 60_000);
    assert.equal(ridesOf(h2, 7), 1, 'still one ride, not two');
    assert.equal(ridesOf(h2, 8), 1);
});

test('the next week is a new session and credits another ride', () => {
    const storage = mkStorage();
    const h = mkHistory(storage);
    rideWith(h, [7], 0);
    h.save();

    const h2 = mkHistory(storage);
    const s = h2.beginSession(WEEK);
    assert.equal(s.resumed, false);
    assert.equal(s.index, 2);
    rideWith(h2, [7], WEEK);
    assert.equal(ridesOf(h2, 7), 2);
});


// ---------------------------------------------------------------- streaks

test('streak counts consecutive rides, resets after a missed week, and keeps a best', () => {
    const storage = mkStorage();
    let t = 0;
    for (const week of [0, 1, 2]) {                 // three in a row
        const h = mkHistory(storage);
        t = rideWith(h, [7], week * WEEK);
        h.save();
    }
    let h = mkHistory(storage);
    assert.equal(h.recordFor(7).streak, 3);
    assert.equal(h.recordFor(7).bestStreak, 3);

    // Week 3 happens without rider 7, week 4 they return.
    h = mkHistory(storage);
    rideWith(h, [8], 3 * WEEK);
    h.save();
    h = mkHistory(storage);
    rideWith(h, [7], 4 * WEEK);
    h.save();

    h = mkHistory(storage);
    assert.equal(h.recordFor(7).streak, 1, 'streak broken by the missed week');
    assert.equal(h.recordFor(7).bestStreak, 3, 'best remembered');
    assert.equal(h.recordFor(7).rides, 4, 'total still climbs');
    assert.ok(t > 0);
});


// ---------------------------------------------------------------- welcome bucket

test('welcome pending = present and never welcomed, whatever the ride count', () => {
    const storage = mkStorage();
    let h = mkHistory(storage);
    let t = rideWith(h, [7, 8], 0);
    let p = h.pending(t);
    assert.deepEqual(p.welcome.map(x => x.athleteId), ['7', '8'], 'both new');

    h.markWelcomed(['7'], t);
    p = h.pending(t);
    assert.deepEqual(p.welcome.map(x => x.athleteId), ['8'], 'welcoming 7 removes them');
    h.save();

    // Next week: 8 was never welcomed, so they are STILL pending on their 2nd ride.
    h = mkHistory(storage);
    t = rideWith(h, [7, 8], WEEK);
    p = h.pending(t);
    assert.deepEqual(p.welcome.map(x => x.athleteId), ['8']);
    assert.equal(h.recordFor(8).rides, 2, 'pending welcome is independent of the count');
});

test('a welcome is per series — greeting the Sunday ride does not greet the Tuesday one', () => {
    const storage = mkStorage();
    const h = new RiderHistory({storage});
    h.load();
    h.useSeries('series:1', {label: 'Sunday'});
    let t = rideWith(h, [7], 0);
    h.markWelcomed(['7'], t);
    assert.equal(h.pending(t).welcome.length, 0);

    h.useSeries('series:2', {label: 'Tuesday'});
    t = rideWith(h, [7], DAY * 2);
    assert.deepEqual(h.pending(t).welcome.map(x => x.athleteId), ['7'], 'new to this ride');
});

test('seedKnown marks everyone present as known without welcoming them', () => {
    const h = mkHistory();
    const t = rideWith(h, [7, 8, 9], 0);
    assert.equal(h.pending(t).welcome.length, 3);

    const n = h.seedKnown(null, t);              // no ids -> everyone currently seen
    assert.equal(n, 3);
    assert.equal(h.pending(t).welcome.length, 0, 'day one is silent');
    assert.equal(h.recordFor(7).seeded, true);
    assert.equal(h.recordFor(7).rides, 1, 'seeding does not invent history');
});

test('seedKnown covers riders below the presence threshold too', () => {
    const h = mkHistory();
    h.beginSession(0);
    h.observe(7, 'Alice', 0);                    // seen, but not yet credited
    assert.equal(h.recordFor(7), null);
    assert.equal(h.seedKnown(null, 0), 1);
    assert.equal(h.recordFor(7).welcomedAt, 0, 'record created so they are not "new" next week');
});


// ---------------------------------------------------------------- milestones

test('a milestone fires on landing, is announced once, and is grouped into one bucket', () => {
    const storage = mkStorage();
    const h = new RiderHistory({storage, milestones: [3, 10]});
    h.load();
    h.useSeries('series:1', {label: 'Sunday'});
    let t = 0;
    for (const week of [0, 1]) {
        t = rideWith(h, [7, 8], week * WEEK);
        assert.equal(h.pending(t).milestones.length, 0, `week ${week}: nothing due yet`);
    }
    t = rideWith(h, [7, 8], 2 * WEEK);            // both reach 3 rides in the same week

    const buckets = h.pending(t).milestones;
    assert.equal(buckets.length, 1, 'ONE bucket, not one per rider');
    assert.equal(buckets[0].value, 3);
    assert.deepEqual(buckets[0].riders.map(x => x.athleteId), ['7', '8']);

    h.markMilestoneAnnounced(3, ['7', '8']);
    assert.equal(h.pending(t).milestones.length, 0, 'announced once');
});

test('an unannounced milestone stays pending in later rides', () => {
    const storage = mkStorage();
    const opts = {milestones: [2]};
    let h = new RiderHistory({storage, ...opts});
    h.load();
    h.useSeries('series:1');
    rideWith(h, [7], 0);
    let t = rideWith(h, [7], WEEK);
    assert.equal(h.pending(t).milestones[0].value, 2, 'due');
    h.save();

    // Leader never pressed the button. Two weeks later it is still offered.
    h = new RiderHistory({storage, ...opts});
    h.load();
    h.useSeries('series:1');
    t = rideWith(h, [7], 2 * WEEK);
    assert.equal(h.recordFor(7).rides, 3);
    assert.equal(h.pending(t).milestones[0].value, 2, 'sticky until announced');
});

test('only the highest un-announced milestone is offered, so a big count is one message', () => {
    const storage = mkStorage();
    const h = new RiderHistory({storage, milestones: [10, 50, 100]});
    h.load();
    h.useSeries('series:1');
    h.beginSession(0);
    h.observe(7, 'Veteran', 0);
    h.observe(7, 'Veteran', PRESENCE_MS + 1);
    h.commit(PRESENCE_MS + 1);
    h.recordFor(7).rides = 120;                    // as if hand-seeded with a real history

    const buckets = h.pending(PRESENCE_MS + 1).milestones;
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].value, 100, 'not 10, not 50, and not three messages');
});

test('milestone buckets are ordered biggest achievement first', () => {
    const h = new RiderHistory({storage: mkStorage(), milestones: [10, 50]});
    h.load();
    h.useSeries('series:1');
    h.beginSession(0);
    for (const id of [7, 8]) {
        h.observe(id, `R${id}`, 0);
        h.observe(id, `R${id}`, PRESENCE_MS + 1);
    }
    h.commit(PRESENCE_MS + 1);
    h.recordFor(7).rides = 10;
    h.recordFor(8).rides = 50;
    const buckets = h.pending(PRESENCE_MS + 1).milestones;
    assert.deepEqual(buckets.map(b => b.value), [50, 10]);
});


// ---------------------------------------------------------------- series aliasing

test('a new series key is reported as new so the caller can ask instead of forking history', () => {
    const storage = mkStorage();
    const h = mkHistory(storage);                  // series:99 created above
    assert.equal(h.useSeries('series:99').isNew, false);
    assert.equal(h.useSeries('name:sunday social').isNew, true, 'renamed event looks new');
});

test('aliasing a renamed event preserves history instead of zeroing it', () => {
    const storage = mkStorage();
    let h = mkHistory(storage);                    // series:99, "Sunday Social"
    for (const week of [0, 1, 2]) {
        rideWith(h, [7], week * WEEK);
    }
    assert.equal(ridesOf(h, 7), 3);
    h.save();

    // Next week the organizer's series id is gone; we fall back to the name and it looks new.
    h = new RiderHistory({storage});
    h.load();
    const r = h.useSeries('name:sunday social', {label: 'Sunday Social'});
    assert.equal(r.isNew, true);
    const t = rideWith(h, [7], 3 * WEEK);
    assert.equal(ridesOf(h, 7), 1, 'forked: this is what the banner exists to prevent');

    assert.equal(h.aliasSeries('name:sunday social', 'series:99'), true);
    assert.equal(h.seriesKey, 'series:99');
    assert.equal(ridesOf(h, 7), 4, 'the forked ride folded back in');
    assert.equal(h.recordFor(7).streak >= 1, true);

    // And it stays aliased for future rides.
    h.save();
    const h2 = new RiderHistory({storage});
    h2.load();
    assert.equal(h2.useSeries('name:sunday social').seriesKey, 'series:99');
    assert.equal(ridesOf(h2, 7), 4);
    assert.ok(t > 0);
});

test('after a merge the ride in progress is not credited a second time', () => {
    const storage = mkStorage();
    let h = mkHistory(storage);                    // series:99
    for (const week of [0, 1]) {
        rideWith(h, [7], week * WEEK);
    }
    assert.equal(ridesOf(h, 7), 2);
    h.save();

    // This week the key resolves differently, so the ride is credited under the forked series...
    h = new RiderHistory({storage});
    h.load();
    h.useSeries('name:sunday social', {label: 'Sunday Social'});
    const t = rideWith(h, [7], 2 * WEEK);
    assert.equal(ridesOf(h, 7), 1);

    // ...then the leader merges. 2 + 1 = 3, and the streak continues rather than restarting.
    h.aliasSeries('name:sunday social', 'series:99');
    assert.equal(ridesOf(h, 7), 3);
    assert.equal(h.recordFor(7).streak, 3);

    // The caller re-enters the session. It must RESUME, and further ticks must not re-credit.
    const s = h.beginSession(t);
    assert.equal(s.resumed, true, 'the merged ride is the current session, not a new one');
    h.observe(7, 'Rider7', t);
    h.commit(t + PRESENCE_MS);
    assert.equal(ridesOf(h, 7), 3, 'still 3 — the ride was already counted');

    // And next week continues normally from there.
    h.save();
    h = new RiderHistory({storage});
    h.load();
    h.useSeries('name:sunday social');
    rideWith(h, [7], 3 * WEEK);
    assert.equal(ridesOf(h, 7), 4);
    assert.equal(h.recordFor(7).streak, 4);
});

test('aliasSeries keeps a welcome and refuses an unknown target', () => {
    const storage = mkStorage();
    const h = mkHistory(storage);
    let t = rideWith(h, [7], 0);
    h.markWelcomed(['7'], t);

    h.useSeries('name:sunday social');
    t = rideWith(h, [7], WEEK);
    assert.equal(h.pending(t).welcome.length, 1, 'forked series lost the welcome');
    h.aliasSeries('name:sunday social', 'series:99');
    assert.equal(h.pending(t).welcome.length, 0, 'welcome restored by the merge');

    assert.equal(h.aliasSeries('name:whatever', 'series:does-not-exist'), false);
});

test('listSeries reports what the leader can merge into', () => {
    const storage = mkStorage();
    const h = new RiderHistory({storage});
    h.load();
    h.useSeries('series:1', {label: 'Sunday'});
    rideWith(h, [7, 8], 0);
    h.useSeries('series:2', {label: 'Tuesday'});
    rideWith(h, [9], DAY * 2);

    const list = h.listSeries();
    assert.equal(list.length, 2);
    const sunday = list.find(x => x.key === 'series:1');
    assert.equal(sunday.label, 'Sunday');
    assert.equal(sunday.riders, 2);
    assert.equal(sunday.sessions, 1);
});


// ---------------------------------------------------------------- persistence

test('history survives a reload and ignores a corrupt or foreign blob', () => {
    const storage = mkStorage();
    const h = mkHistory(storage);
    rideWith(h, [7], 0);
    assert.equal(h.save(), true);
    assert.ok(storage.getItem(STORE_KEY), 'written under the documented key');

    const h2 = new RiderHistory({storage});
    h2.load();
    h2.useSeries('series:99');
    assert.equal(ridesOf(h2, 7), 1);

    storage.setItem(STORE_KEY, '{not json');
    const h3 = new RiderHistory({storage});
    h3.load();
    assert.deepEqual(h3.listSeries(), [], 'corrupt -> empty, not a throw');

    storage.setItem(STORE_KEY, JSON.stringify({version: 999, riders: {}}));
    const h4 = new RiderHistory({storage});
    h4.load();
    assert.deepEqual(h4.listSeries(), [], 'wrong version ignored');
});

test('flush only writes when something changed', () => {
    const storage = mkStorage();
    const h = mkHistory(storage);
    h.save();
    assert.equal(h.flush(), false, 'clean');
    rideWith(h, [7], 0);
    assert.equal(h.flush(), true, 'dirty after a commit');
    assert.equal(h.flush(), false, 'clean again');
});

test('a missing storage never throws (the ride still works, nothing persists)', () => {
    const h = new RiderHistory({});
    h.load();
    h.useSeries('series:1');
    const t = rideWith(h, [7], 0);
    assert.equal(ridesOf(h, 7), 1);
    assert.equal(h.save(), false);
    assert.equal(h.pending(t).welcome.length, 1);
});

test('export / import round-trips and rejects a foreign file', () => {
    const storage = mkStorage();
    const h = mkHistory(storage);
    const t = rideWith(h, [7, 8], 0);
    h.markWelcomed(['7'], t);

    const blob = h.exportJSON();
    const fresh = new RiderHistory({storage: mkStorage()});
    fresh.load();
    fresh.importJSON(blob);
    fresh.useSeries('series:99');
    assert.equal(ridesOf(fresh, 7), 1);
    assert.equal(fresh.recordFor(7).welcomedAt, t);
    assert.equal(fresh.recordFor(8).welcomedAt, null);

    assert.throws(() => fresh.importJSON('{not json'), /valid JSON/);
    assert.throws(() => fresh.importJSON('{"version":42}'), /rider-history file/);
});

test('import marks milestones already passed as done', () => {
    const h = new RiderHistory({storage: mkStorage(), milestones: [10, 50, 100]});
    h.load();
    const blob = JSON.stringify({version: STORE_VERSION, aliases: {},
        series: {'series:1': {label: 'S', sessions: 60, lastSessionId: null, lastSessionStart: null}},
        riders: {'series:1': {'7': {name: 'Vet', rides: 60, milestonesDone: [],
            welcomedAt: 1, streak: 1, bestStreak: 1, lastIndex: 59, firstSeen: 0, seeded: true}}}});
    h.importJSON(blob);
    h.useSeries('series:1');
    assert.deepEqual(h.recordFor(7).milestonesDone, [10, 50], 'passed -> not news');
});


// ---------------------------------------------------------------- misc

test('lookup() exposes the display fields the metric viewer needs', () => {
    const h = mkHistory();
    const t = rideWith(h, [7], 0);
    const look = h.lookup();
    assert.deepEqual(look(7), {rides: 1, streak: 1, bestStreak: 1, welcomed: false});
    h.markWelcomed(['7'], t);
    assert.equal(look(7).welcomed, true);
    assert.equal(look(12345), null, 'unknown rider');
});

test('nothing is credited or pending before a series is selected', () => {
    const h = new RiderHistory({storage: mkStorage()});
    h.load();
    assert.equal(h.beginSession(0), null);
    h.observe(7, 'Alice', 0);
    assert.deepEqual(h.commit(PRESENCE_MS + 1), []);
    assert.deepEqual(h.pending(PRESENCE_MS + 1), {welcome: [], milestones: [], seriesKey: null});
    assert.equal(h.recordFor(7), null);
    assert.equal(h.seedKnown(null, 0), 0);
});

test('setConfig retunes the ladder and the presence threshold live', () => {
    const h = mkHistory();
    h.setConfig({presenceMs: 1000, milestones: [2]});
    h.beginSession(0);
    h.observe(7, 'Alice', 0);
    h.commit(1500);
    assert.equal(ridesOf(h, 7), 1, 'shorter threshold honoured');
    h.recordFor(7).rides = 2;
    assert.equal(h.pending(1500).milestones[0].value, 2, 'new ladder honoured');
    assert.equal(SESSION_RESUME_MS > 0, true);
});

test('retain drops a stranger seen before the event was known, without touching the credited', () => {
    // Presence runs from a rider's FIRST sighting (so an intersection can't restart their clock),
    // which means a single sighting is enough to be credited five minutes later. The event filter
    // resolves a beat after the window opens, so control prunes the strangers it caught in between.
    const h = mkHistory();
    const t0 = 1000;
    h.beginSession(t0);
    for (const id of [2, 3, 99]) {
        h.observe(id, `Rider${id}`, t0);
    }
    const ours = new Set(['2', '3']);
    assert.equal(h.retain(id => ours.has(id)), 1, 'the stranger only');
    const t1 = t0 + PRESENCE_MS + 1000;
    for (const id of [2, 3]) {
        h.observe(id, `Rider${id}`, t1);
    }
    assert.deepEqual(h.commit(t1).sort(), ['2', '3'], 'the stranger is not credited a ride');
    assert.equal(h.recordFor(99), null, 'and left no record at all');
    assert.deepEqual(h.pending(t1).welcome.map(r => r.athleteId), ['2', '3'], 'nor a welcome');

    // Nothing persistent is touched: a rider already credited keeps their ride even if dropped.
    assert.equal(h.retain(id => id === '2'), 1);
    assert.equal(ridesOf(h, 3), 1);
});
