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
    ANNOUNCEMENTS, LEVEL_UP_ANNOUNCEMENT, getAnnouncement, renderTemplate,
    announcementDefaults, announcementMessages,
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

test('registry: every declared placeholder is actually produced by vars()', () => {
    // Guards the settings-window hint list against drifting from what substitution really offers.
    const vars = LEVEL_UP_ANNOUNCEMENT.vars(levelUp);
    for (const p of LEVEL_UP_ANNOUNCEMENT.placeholders) {
        assert.ok(Object.prototype.hasOwnProperty.call(vars, p.name), `missing var ${p.name}`);
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
