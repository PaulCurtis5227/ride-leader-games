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
 * Headless tests for the pure Sauce Mod Store entry-building logic (no network / no gh).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
    sha256Hex, loadConfig, buildRelease, buildEntry, upsertDirectory, findExistingEntry,
    validateEntry, serializeDirectory,
} from '../scripts/mod-store-entry.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = {name: 'Ride Leader Games', version: '0.2.0', description: 'from manifest'};
const config = {
    id: 'test-id-1', created: 111, description: 'from config',
    tags: ['a', 'b'], homeURL: 'https://home', logoURL: 'https://logo',
    authorName: 'Paul', authorURL: 'https://author', minVersion: '', releaseNotes: '',
};

test('sha256Hex matches a known vector', () => {
    // echo -n "" | sha256sum
    assert.equal(sha256Hex(Buffer.from('')),
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('the shipped mod-store.json loads and has a stable id', () => {
    const cfg = loadConfig(repoRoot);
    assert.match(cfg.id, /^[0-9a-f-]{36}$/);
    assert.ok(cfg.homeURL.includes('github.com'));
});

test('buildRelease prunes empty optionals and stamps updated', () => {
    const rel = buildRelease({
        version: '0.2.0', url: 'https://a/x.zip', hash: 'abc', size: 123,
        notes: '', minVersion: '', now: 999,
    });
    assert.deepEqual(rel, {url: 'https://a/x.zip', version: '0.2.0', hash: 'abc', size: 123, updated: 999});
    assert.ok(!('notes' in rel));
    assert.ok(!('minVersion' in rel));
});

test('buildRelease keeps notes and minVersion when present', () => {
    const rel = buildRelease({
        version: '1.0.0', url: 'u', hash: 'h', size: 1, notes: 'hi', minVersion: '1.2.0', now: 1,
    });
    assert.equal(rel.notes, 'hi');
    assert.equal(rel.minVersion, '1.2.0');
});

test('buildEntry prefers config description and carries fields', () => {
    const rel = buildRelease({version: '0.2.0', url: 'u', hash: 'h', size: 1, now: 5});
    const entry = buildEntry({manifest, config, release: rel});
    assert.equal(entry.id, 'test-id-1');
    assert.equal(entry.name, 'Ride Leader Games');
    assert.equal(entry.description, 'from config');
    assert.deepEqual(entry.tags, ['a', 'b']);
    assert.equal(entry.created, 111);
    assert.equal(entry.releases.length, 1);
});

test('buildEntry falls back to manifest description when config omits it', () => {
    const rel = buildRelease({version: '0.2.0', url: 'u', hash: 'h', size: 1, now: 5});
    const entry = buildEntry({manifest, config: {...config, description: ''}, release: rel});
    assert.equal(entry.description, 'from manifest');
});

test('buildEntry preserves prior releases and supersedes the same version', () => {
    const existingEntry = {
        id: 'test-id-1', created: 100,
        releases: [
            {url: 'old1', version: '0.1.0', hash: 'h1', size: 1, updated: 1},
            {url: 'old2', version: '0.2.0', hash: 'h2', size: 2, updated: 2},
        ],
    };
    const rel = buildRelease({version: '0.2.0', url: 'new', hash: 'h3', size: 3, now: 9});
    const entry = buildEntry({manifest, config, release: rel, existingEntry});
    assert.equal(entry.created, 100, 'keeps the original created timestamp');
    assert.equal(entry.releases.length, 2);
    assert.deepEqual(entry.releases.map(r => r.version), ['0.1.0', '0.2.0']);
    assert.equal(entry.releases.at(-1).url, 'new', 'same-version release is replaced, not duplicated');
});

test('upsertDirectory adds a new entry immutably', () => {
    const dir = [{id: 'other', name: 'Other'}];
    const entry = {id: 'test-id-1', name: 'Ride Leader Games', releases: []};
    const out = upsertDirectory(dir, entry);
    assert.equal(out.length, 2);
    assert.equal(dir.length, 1, 'input is not mutated');
});

test('upsertDirectory replaces an entry with the same id', () => {
    const dir = [{id: 'test-id-1', name: 'Ride Leader Games', releases: [1]}];
    const entry = {id: 'test-id-1', name: 'Ride Leader Games', releases: [2]};
    const out = upsertDirectory(dir, entry);
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].releases, [2]);
});

test('upsertDirectory rejects a name owned by a different id', () => {
    const dir = [{id: 'someone-else', name: 'Ride Leader Games'}];
    const entry = {id: 'test-id-1', name: 'Ride Leader Games', releases: []};
    assert.throws(() => upsertDirectory(dir, entry), /already uses the name/);
});

test('findExistingEntry matches by id, then by name', () => {
    const byId = [{id: 'test-id-1', name: 'X'}];
    assert.equal(findExistingEntry(byId, config, manifest).id, 'test-id-1');
    const byName = [{id: 'zzz', name: 'Ride Leader Games'}];
    assert.equal(findExistingEntry(byName, config, manifest).id, 'zzz');
    assert.equal(findExistingEntry([], config, manifest), undefined);
});

test('validateEntry: clean entry has no errors', () => {
    const rel = buildRelease({version: '0.2.0', url: 'u', hash: 'h', size: 1, now: 5});
    const entry = buildEntry({manifest, config, release: rel});
    const {errors, warnings} = validateEntry({entry, manifest, config});
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
});

test('validateEntry: missing url errors only when requireUrl', () => {
    const rel = buildRelease({version: '0.2.0', hash: 'h', size: 1, now: 5}); // no url
    const entry = buildEntry({manifest, config, release: rel});
    assert.deepEqual(validateEntry({entry, manifest, config, requireUrl: false}).errors, []);
    assert.match(validateEntry({entry, manifest, config, requireUrl: true}).errors[0], /asset url/);
});

test('validateEntry: warns on "sauce"/"mod" in name and on dup version', () => {
    const m = {name: 'My Sauce Mod', version: '0.2.0', description: 'd'};
    const rel = buildRelease({version: '0.2.0', url: 'u', hash: 'h', size: 1, now: 5});
    const existingEntry = {releases: [{version: '0.2.0'}]};
    const entry = buildEntry({manifest: m, config, release: rel, existingEntry});
    const {warnings} = validateEntry({entry, manifest: m, config, existingEntry});
    assert.ok(warnings.some(w => /sauce/i.test(w)));
    assert.ok(warnings.some(w => /\bmod\b/i.test(w)));
    assert.ok(warnings.some(w => /already listed/.test(w)));
});

test('validateEntry: warns when no logoURL', () => {
    const rel = buildRelease({version: '0.2.0', url: 'u', hash: 'h', size: 1, now: 5});
    const cfg = {...config, logoURL: ''};
    const entry = buildEntry({manifest, config: cfg, release: rel});
    const {warnings} = validateEntry({entry, manifest, config: cfg});
    assert.ok(warnings.some(w => /logoURL/.test(w)));
});

test('serializeDirectory round-trips with trailing newline', () => {
    const dir = [{id: 'x', name: 'X'}];
    const text = serializeDirectory(dir, 4);
    assert.ok(text.endsWith('}\n]\n') || text.endsWith(']\n'));
    assert.deepEqual(JSON.parse(text), dir);
});
