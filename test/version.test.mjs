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
 * Guard: manifest.json and package.json must carry the same version. This runs under `npm test`
 * (and therefore `preversion`), so any drift fails the build before a release is cut.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

test('manifest.json and package.json versions match', () => {
    assert.equal(manifest.version, pkg.version,
        `manifest.json v${manifest.version} != package.json v${pkg.version} — run npm version (or scripts/sync-version.mjs)`);
});

test('version is a semver string', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});
