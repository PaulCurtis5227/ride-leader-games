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
 * Pure logic for building a Sauce Mod Store `directory.json` entry from this repo's manifest +
 * mod-store.json config + a computed release. No network, no filesystem side effects beyond
 * loadConfig() — kept side-effect-free so test/mod-store.test.mjs can exercise it headlessly.
 *
 * The shapes here mirror what the official web release tool (mods.sauce.llc/src/release-tool.mjs)
 * emits: an entry {id, name, description, tags, logoURL, homeURL, author*, created, releases[]},
 * each release {url, version, hash, size, updated, notes?, minVersion?}. The tool uploads the zip
 * to https://mod-api.sauce.llc/edit/release/asset (PUT, octet-stream) and uses the returned URL;
 * scripts/submit-mod-store.mjs replicates that call.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STORE_REPO = 'SauceLLC/sauce4zwift-mod-store';
export const DIRECTORY_PATH = 'directory.json';
export const ASSET_UPLOAD_URL = 'https://mod-api.sauce.llc/edit/release/asset';
export const DIRECTORY_URL = 'https://mods.sauce.llc/directory.json';

/* SHA-256 hex of a Buffer/Uint8Array — matches the store's crypto.subtle.digest("SHA-256", …). */
export function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

export function loadConfig(repoRoot) {
    const p = path.join(repoRoot, 'mod-store.json');
    if (!fs.existsSync(p)) {
        throw new Error(`mod-store.json not found at ${p}`);
    }
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!cfg.id) {
        throw new Error('mod-store.json is missing a stable "id" (UUID).');
    }
    return cfg;
}

/* Drop undefined / null / empty-string values so optional fields are simply absent from the JSON. */
function pruned(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null || v === '') {
            continue;
        }
        if (Array.isArray(v) && v.length === 0) {
            continue;
        }
        out[k] = v;
    }
    return out;
}

/* Build a single release object for the given version/asset. `now` is injectable for tests. */
export function buildRelease({version, url, hash, size, notes, minVersion, now = Date.now()}) {
    return pruned({
        url,
        version,
        hash,
        size,
        updated: now,
        notes,
        minVersion,
    });
}

/*
 * Build the full entry. `existingEntry` (if the store already lists this id) contributes its prior
 * releases: we keep every release EXCEPT one matching the new version (which the new release
 * supersedes), then append the new release. This preserves the version history the store shows.
 */
export function buildEntry({manifest, config, release, existingEntry}) {
    const priorReleases = (existingEntry?.releases || []).filter(r => r.version !== release.version);
    return pruned({
        id: config.id,
        name: manifest.name,
        description: config.description || manifest.description,
        tags: config.tags,
        logoURL: config.logoURL,
        homeURL: config.homeURL,
        authorName: config.authorName,
        authorURL: config.authorURL,
        authorAvatarURL: config.authorAvatarURL,
        created: existingEntry?.created ?? config.created,
        releases: [...priorReleases, release],
    });
}

/*
 * Insert or replace `entry` in a directory array, matched by id. Returns a NEW array (input is not
 * mutated). Throws if a DIFFERENT entry already claims our name — the store keys display on name,
 * so two ids with one name would collide and the maintainer would reject the PR.
 */
export function upsertDirectory(directory, entry) {
    const nameClash = directory.find(x => x.id !== entry.id && x.name === entry.name);
    if (nameClash) {
        throw new Error(
            `Another store entry (id ${nameClash.id}) already uses the name "${entry.name}". ` +
            `Rename this mod or coordinate with that entry's author.`);
    }
    const out = directory.slice();
    const idx = out.findIndex(x => x.id === entry.id);
    if (idx === -1) {
        out.push(entry);
    } else {
        out[idx] = entry;
    }
    return out;
}

export function findExistingEntry(directory, config, manifest) {
    return directory.find(x => x.id === config.id) ||
        directory.find(x => x.name === manifest.name);
}

/*
 * Replicate the release tool's advisory checks so `npm run submit-mod-store` flags the same issues
 * the maintainer's tooling would, before a PR is opened. Returns {errors, warnings} (strings).
 * Errors should block a submit; warnings are informational.
 */
export function validateEntry({entry, manifest, config, existingEntry, requireUrl = true}) {
    const errors = [];
    const warnings = [];

    if (!entry.name) {
        errors.push('manifest.name is empty.');
    }
    if (!entry.description) {
        errors.push('No description (set one in mod-store.json or manifest.json).');
    }
    const rel = entry.releases.at(-1);
    if (!rel || !rel.hash || !rel.size || !rel.version) {
        errors.push('Release is incomplete (needs version, hash and size).');
    } else if (requireUrl && !rel.url) {
        errors.push('Release has no asset url — upload the zip first (this happens automatically ' +
            'on --submit / --upload-only).');
    }

    // Same name-hygiene warnings the release tool raises.
    if (/\bsauce\b/i.test(manifest.name)) {
        warnings.push('manifest "name" contains the word "sauce" — the store discourages this; ' +
            'reference Sauce in your README instead.');
    }
    if (/\bmods?\b/i.test(manifest.name)) {
        warnings.push('manifest "name" contains the word "mod" — the store discourages this.');
    }

    if (existingEntry?.releases?.some(r => r.version === manifest.version)) {
        warnings.push(`Version ${manifest.version} is already listed — this submit REPLACES that ` +
            `release. Bump the version first if that is not intended.`);
    }

    if (!config.logoURL) {
        warnings.push('No logoURL set — the store shows a generic placeholder. A 1:1 image ' +
            '(384–1500px) is recommended.');
    }

    return {errors, warnings};
}

/*
 * Serialize a directory array the way the store's file is formatted (4-space indent, trailing
 * newline). `indent` is detected from the existing file by the caller and passed through so we
 * don't reformat the whole file and bloat the PR diff.
 */
export function serializeDirectory(directory, indent = 4) {
    return JSON.stringify(directory, null, indent) + '\n';
}
