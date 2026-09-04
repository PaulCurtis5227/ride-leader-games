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
 * Headless unit tests for the rider-event announcement registry in pages/announcements.mjs.
 * Run: `npm test` (node --test). No DOM / no Sauce needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    ANNOUNCEMENTS, LEVEL_UP_ANNOUNCEMENT, WELCOME_ANNOUNCEMENT, MILESTONE_ANNOUNCEMENT,
    getAnnouncement, renderTemplate, announcementDefaults, announcementMessages,
    manualAnnouncementMessage, riderNameVars,
} from '../pages/announcements.mjs';

// A getSetting() over a plain object, mirroring the control window's store-with-defaults accessor.
function settings(overrides = {}) {
    const store = {...announcementDefaults(), ...overrides};
    return key => store[key];
}

const levelUp = {type: 'level-up', athleteId: 7, name: 'Alice', from: 41, to: 42, at: 1000};


test('registry: keys are unique and every entry is fully specified', () => {
    const keys = ANNOUNCEMENTS.map(a => a.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const a of ANNOUNCEMENTS) {
        for (const field of ['name', 'description', 'enabledSetting', 'templateSetting', 'defaultTemplate']) {
            assert.ok(a[field], `${a.key} is missing ${field}`);
        }
        assert.equal(typeof a.vars, 'function', `${a.key}.vars`);
        assert.ok(a.placeholders.length, `${a.key} declares no placeholders`);
    }
});

// One representative event per registry key, so the checks below cover every entry.
const SAMPLE = {
    'level-up': levelUp,
    'welcome': {names: 'Alice, Bob', count: 2, others: 0},
    'milestone': {rides: 10, names: 'Alice, Bob', count: 2, others: 0},
};

test('registry: every declared placeholder is actually produced by vars()', () => {
    // Guards the settings-window hint list against drifting from what substitution really offers.
    for (const a of ANNOUNCEMENTS) {
        const sample = SAMPLE[a.key];
        assert.ok(sample, `no sample event for ${a.key} — add one so this check covers it`);
        const vars = a.vars(sample);
        for (const p of a.placeholders) {
            assert.ok(Object.prototype.hasOwnProperty.call(vars, p.name),
                `${a.key} is missing var ${p.name}`);
        }
    }
});

test('registry: every default template substitutes fully, leaving no stray placeholder', () => {
    const get = settings();
    for (const a of ANNOUNCEMENTS) {
        const text = renderTemplate(get(a.templateSetting), a.vars(SAMPLE[a.key]));
        assert.ok(text && !text.includes('{'), `${a.key}: ${text}`);
    }
});

test('getAnnouncement resolves a key and does NOT fall back for unknown types', () => {
    assert.equal(getAnnouncement('level-up'), LEVEL_UP_ANNOUNCEMENT);
    assert.equal(getAnnouncement('does-not-exist'), undefined);
});

test('announcementDefaults exposes every setting an announcement declares', () => {
    const d = announcementDefaults();
    assert.equal(d.announceLevelUp, true);
    assert.equal(d.levelUpMessage, LEVEL_UP_ANNOUNCEMENT.defaultTemplate);
    assert.equal(d.levelUpSettling, true, 'extra option switches are defaulted too');
    const optionCount = ANNOUNCEMENTS.reduce((n, a) => n + (a.options || []).length, 0);
    assert.equal(Object.keys(d).length, ANNOUNCEMENTS.length * 2 + optionCount);
});

test('registry: every extra option is fully specified and uniquely named', () => {
    // The settings window builds a checkbox per option and the control window merges its default,
    // so a half-declared option would render an unbound field or a permanently-undefined setting.
    const seen = new Set(Object.keys(announcementDefaults()));
    for (const a of ANNOUNCEMENTS) {
        for (const o of a.options || []) {
            for (const field of ['setting', 'label', 'description']) {
                assert.ok(o[field], `${a.key} option is missing ${field}`);
            }
            assert.equal(typeof o.defaultValue, 'boolean', `${a.key}.${o.setting}.defaultValue`);
            assert.ok(seen.has(o.setting), `${o.setting} is not in the defaults`);
            assert.notEqual(o.setting, a.enabledSetting, 'must not shadow the on/off switch');
        }
    }
});

test('renderTemplate substitutes known placeholders and leaves unknown ones verbatim', () => {
    assert.equal(renderTemplate('Go {name}, Level {level}!', {name: 'Alice', level: 42}),
        'Go Alice, Level 42!');
    assert.equal(renderTemplate('{name} hit {levl}', {name: 'Alice'}), 'Alice hit {levl}',
        'a typo stays visible instead of silently blanking');
    assert.equal(renderTemplate(null, {}), '');
});

test('the default level-up message names the rider and their new level', () => {
    const [msg] = announcementMessages([levelUp], settings());
    assert.ok(msg.includes('Alice'), msg);
    assert.ok(msg.includes('42'), msg);
    assert.ok(!msg.includes('{'), 'no placeholder left unsubstituted');
});

test('a custom template is used, with all three placeholders available', () => {
    const msgs = announcementMessages([levelUp],
        settings({levelUpMessage: '{name}: {previousLevel} -> {level}'}));
    assert.deepEqual(msgs, ['Alice: 41 -> 42']);
});

test('a disabled or blanked announcement produces nothing', () => {
    assert.deepEqual(announcementMessages([levelUp], settings({announceLevelUp: false})), []);
    assert.deepEqual(announcementMessages([levelUp], settings({levelUpMessage: '   '})), [],
        'blanking the template is a valid way to mute it — no fallback to the default');
});

test('unknown event types and empty input are ignored', () => {
    assert.deepEqual(announcementMessages([{type: 'not-a-thing'}], settings()), []);
    assert.deepEqual(announcementMessages([], settings()), []);
    assert.deepEqual(announcementMessages(undefined, settings()), []);
});

test('several events in one tick each produce a message, in order', () => {
    const bob = {type: 'level-up', athleteId: 8, name: 'Bob', from: 9, to: 10, at: 1000};
    const msgs = announcementMessages([levelUp, bob], settings({levelUpMessage: '{name}={level}'}));
    assert.deepEqual(msgs, ['Alice=42', 'Bob=10']);
});


// ---- manual announcements ---------------------------------------------------------------------
// Welcome and milestone are sent from the Riders panel on a button press, not off a detected event.

test('manual announcements are flagged, and the automatic path never emits them', () => {
    assert.equal(WELCOME_ANNOUNCEMENT.manual, true);
    assert.equal(MILESTONE_ANNOUNCEMENT.manual, true);
    assert.ok(!LEVEL_UP_ANNOUNCEMENT.manual, 'a level-up is news the moment it happens');

    // Even if a caller passes one in as though it were a tracker event, it is skipped.
    assert.deepEqual(announcementMessages([{type: 'welcome', names: 'Alice', count: 1, others: 0}],
        settings()), []);
});

test('manualAnnouncementMessage composes welcome and milestone text', () => {
    const get = settings();
    const welcome = manualAnnouncementMessage('welcome',
        {names: 'Alice, Bob', count: 2, others: 0}, get);
    assert.ok(welcome.includes('Alice, Bob'), welcome);
    assert.ok(!welcome.includes('{'), welcome);

    const milestone = manualAnnouncementMessage('milestone',
        {rides: 50, names: 'Carol', count: 1, others: 0}, get);
    assert.ok(milestone.includes('50'), milestone);
    assert.ok(milestone.includes('Carol'), milestone);
});

test('manualAnnouncementMessage honours the on/off switch, a blanked template, and bad keys', () => {
    const vars = {names: 'Alice', count: 1, others: 0};
    assert.equal(manualAnnouncementMessage('welcome', vars, settings({announceWelcome: false})), '');
    assert.equal(manualAnnouncementMessage('welcome', vars, settings({welcomeMessage: '  '})), '',
        'blanking is a valid way to mute it');
    assert.equal(manualAnnouncementMessage('nope', vars, settings()), '');
    assert.equal(manualAnnouncementMessage('level-up', vars, settings()), '',
        'the automatic announcements are not sendable by hand');
});

test('riderNameVars names up to the cap and counts the rest', () => {
    const riders = ['Alice', 'Bob', 'Carol', 'Dave'].map((name, i) => ({athleteId: i, name}));
    assert.deepEqual(riderNameVars(riders, 10),
        {names: 'Alice, Bob, Carol, Dave', count: 4, others: 0});
    assert.deepEqual(riderNameVars(riders, 2),
        {names: 'Alice, Bob and 2 others', count: 4, others: 2});
    assert.deepEqual(riderNameVars(riders, 3),
        {names: 'Alice, Bob, Carol and 1 other', count: 4, others: 1}, 'singular "other"');
    assert.deepEqual(riderNameVars(riders, 0),
        {names: 'Alice, Bob, Carol, Dave', count: 4, others: 0}, '0 means name everyone');
    assert.deepEqual(riderNameVars([], 8), {names: '', count: 0, others: 0});
});

test('riderNameVars falls back to an id when a rider has no name', () => {
    assert.deepEqual(riderNameVars([{athleteId: 42}], 8), {names: '#42', count: 1, others: 0});
});
