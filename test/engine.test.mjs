/*
 * Headless unit tests for the pure game logic in pages/engine.mjs.
 * Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    RideLeaderGame, STATES, chunkMessage, instructionMessages,
} from '../pages/engine.mjs';

// A nearby entry with a signed gapDistance (relative to the watched rider).
function entry(id, gapDistance, name, extra = {}) {
    return {athleteId: id, gapDistance, athlete: {sanitizedFullname: name}, ...extra};
}

// Drive N ticks of the same snapshot into a running game.
function runGame(config, snapshots) {
    const g = new RideLeaderGame({config});
    g.start(0);
    let t = 0;
    for (const snap of snapshots) {
        t += 1000;
        g.ingest(snap, t);
    }
    return g;
}


test('instructionMessages: splits on blank lines, trims, drops empties', () => {
    assert.deepEqual(instructionMessages('one\n\ntwo'), ['one', 'two']);
    assert.deepEqual(
        instructionMessages('  first block\nline two\n\n\n  second block  \n\n'),
        ['first block\nline two', 'second block'],
    );
    assert.deepEqual(instructionMessages('\r\nalpha\r\n\r\nbeta\r\n'), ['alpha', 'beta']);
});

test('instructionMessages: empty / whitespace input -> []', () => {
    assert.deepEqual(instructionMessages(''), []);
    assert.deepEqual(instructionMessages('   \n\n  \n'), []);
    assert.deepEqual(instructionMessages(null), []);
    assert.deepEqual(instructionMessages(undefined), []);
});

test('chunkMessage: short message is a single chunk with no marker', () => {
    const out = chunkMessage('hello world', 90);
    assert.deepEqual(out, ['hello world']);
});

test('chunkMessage: long message splits on word boundaries with (i/n) markers', () => {
    const words = Array.from({length: 40}, (_, i) => `word${i}`).join(' ');
    const out = chunkMessage(words, 40);
    assert.ok(out.length > 1, 'should split into multiple chunks');
    const n = out.length;
    out.forEach((c, i) => {
        assert.ok(c.endsWith(`(${i + 1}/${n})`), `chunk ${i} carries its marker: ${c}`);
        assert.ok(c.length <= 40, `chunk ${i} within max length: ${c.length}`);
    });
});

test('winnerMessage: announces top 5 with average distance', () => {
    // Leader = 1 (offset 100). Riders 2..7 at increasing distance from the leader.
    const snap = [
        entry(1, 100, 'Leader', {watching: true}),
        entry(2, 110, 'Alice'),   // 10m
        entry(3, 130, 'Bob'),     // 30m
        entry(4, 150, 'Cara'),    // 50m
        entry(5, 180, 'Dan'),     // 80m
        entry(6, 220, 'Eve'),     // 120m
        entry(7, 300, 'Finn'),    // 200m
    ];
    const g = runGame({leaderId: 1, minSamples: 1}, [snap, snap, snap]);
    const msg = g.winnerMessage();   // default top 5
    assert.match(msg, /Winner: Alice/);
    for (const name of ['Alice', 'Bob', 'Cara', 'Dan', 'Eve']) {
        assert.ok(msg.includes(name), `results include ${name}`);
    }
    assert.ok(!msg.includes('Finn'), '6th place excluded from a top-5 announcement');
    assert.match(msg, /\d+m/, 'contains an average distance in metres');
    // The leader must not appear in their own ranking.
    assert.ok(!/Leader/.test(msg), 'leader excluded from ranking');
});

test('winnerMessage(topN) honours a custom count', () => {
    const snap = [
        entry(1, 0, 'Leader', {watching: true}),
        entry(2, 10, 'Alice'),
        entry(3, 20, 'Bob'),
        entry(4, 30, 'Cara'),
    ];
    const g = runGame({leaderId: 1, minSamples: 1}, [snap, snap]);
    const msg = g.winnerMessage(2);
    assert.ok(msg.includes('Alice') && msg.includes('Bob'));
    assert.ok(!msg.includes('Cara'), 'topN=2 excludes 3rd place');
});

test('winnerMessage: no qualifiers -> explanatory fallback', () => {
    const snap = [entry(1, 0, 'Leader', {watching: true}), entry(2, 10, 'Alice')];
    const g = runGame({leaderId: 1, minSamples: 50}, [snap, snap]);  // nobody reaches 50 samples
    const msg = g.winnerMessage();
    assert.match(msg, /no winner/i);
    assert.match(msg, /50/);
});

test('standingsMessage: contains leader and average distance, null when empty', () => {
    const snap = [
        entry(1, 0, 'Leader', {watching: true}),
        entry(2, 25, 'Alice'),
        entry(3, 60, 'Bob'),
    ];
    const g = runGame({leaderId: 1, minSamples: 1}, [snap, snap]);
    const msg = g.standingsMessage(2000);
    assert.match(msg, /Alice/);
    assert.match(msg, /\d+m/, 'includes average distance');
    assert.match(msg, /\d+:\d{2} to go/, 'includes time remaining');

    const empty = new RideLeaderGame({config: {leaderId: 1, minSamples: 5}});
    empty.start(0);
    assert.equal(empty.standingsMessage(2000), null);
});

test('game finishes automatically when the planned end time passes', () => {
    const g = new RideLeaderGame({config: {durationMin: 1, leaderId: null, minSamples: 1}});
    g.start(0);
    assert.equal(g.state, STATES.RUNNING);
    g.ingest([entry(1, 0, 'W', {watching: true}), entry(2, 5, 'A')], 30000);
    assert.equal(g.state, STATES.RUNNING);
    g.ingest([entry(1, 0, 'W', {watching: true}), entry(2, 5, 'A')], 61000);  // past 60s
    assert.equal(g.state, STATES.FINISHED);
});
