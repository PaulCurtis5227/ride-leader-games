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
 * Submit (or preview) this mod's Official Sauce Mod Store listing — the automation of the manual
 * flow described at https://github.com/SauceLLC/sauce4zwift-mod-store:
 *
 *   1. compute the release zip's SHA-256 + size,
 *   2. PUT the zip to https://mod-api.sauce.llc/edit/release/asset (same anonymous call the store's
 *      web release tool makes) to have Sauce host it and return the canonical asset URL,
 *   3. build the directory.json entry (from manifest.json + mod-store.json),
 *   4. fork SauceLLC/sauce4zwift-mod-store, add/replace our entry, and open a pull request — via
 *      the `gh` CLI.
 *
 * SAFETY: the default run is a DRY RUN. It touches nothing external — it only fetches the public
 * directory.json (read-only) and prints the entry that WOULD be submitted. Uploading and opening a
 * PR are outward-facing, so they require an explicit flag:
 *
 *   node scripts/submit-mod-store.mjs                # dry run: build + print the entry, no network writes
 *   node scripts/submit-mod-store.mjs --upload-only  # upload the zip, print the finished entry (no PR)
 *   node scripts/submit-mod-store.mjs --submit       # upload the zip AND open the store PR via gh
 *
 *   --notes "..."   release notes for this version (else mod-store.json `releaseNotes`, else none)
 *   --branch NAME   PR branch name on your fork (default: ride-leader-games-v<version>)
 *
 * Run `npm run package` (or `npm version`) first so the versioned zip exists in dist/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repoRoot, modId, manifest} from './_common.mjs';
import {
    STORE_REPO, DIRECTORY_PATH, DIRECTORY_URL, ASSET_UPLOAD_URL,
    sha256Hex, loadConfig, buildRelease, buildEntry, upsertDirectory, findExistingEntry,
    validateEntry, serializeDirectory,
} from './mod-store-entry.mjs';

/* ---------- args ---------- */
const argv = process.argv.slice(2);
function flag(name) { return argv.includes(`--${name}`); }
function opt(name, dflt) {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : dflt;
}
const doUpload = flag('submit') || flag('upload-only');
const doPR = flag('submit');
const mode = doPR ? 'submit' : doUpload ? 'upload-only' : 'dry-run';

/* ---------- small helpers ---------- */
const log = (...a) => console.log('submit:', ...a);
function die(msg) { console.error('submit: ' + msg); process.exit(1); }

function gh(args, opts = {}) {
    return execFileSync('gh', args, {encoding: 'utf8', ...opts});
}
function git(args, opts = {}) {
    return execFileSync('git', args, {encoding: 'utf8', ...opts});
}
function haveGh() {
    try { execFileSync('gh', ['--version'], {stdio: 'ignore'}); return true; }
    catch { return false; }
}
function detectIndent(text) {
    const m = text.match(/\n([ \t]+)\S/);
    if (!m) { return 4; }
    return m[1][0] === '\t' ? '\t' : m[1].length;
}

/* ---------- 1. locate + hash the release zip ---------- */
const version = manifest.version;
const config = loadConfig(repoRoot);
const zipPath = path.join(repoRoot, 'dist', `${modId}-v${version}.zip`);
if (!fs.existsSync(zipPath)) {
    die(`no release artifact at ${zipPath}\n  Run \`npm run package\` (or \`npm version\`) first.`);
}
const zipBuf = fs.readFileSync(zipPath);
const hash = sha256Hex(zipBuf);
const size = zipBuf.length;
log(`mode: ${mode}`);
log(`artifact: ${path.basename(zipPath)} (${(size / 1024).toFixed(1)} KiB)`);
log(`sha256: ${hash}`);

/* ---------- 2. read the current public directory (read-only) ---------- */
async function fetchDirectory() {
    try {
        const resp = await fetch(DIRECTORY_URL);
        if (!resp.ok) { throw new Error(`HTTP ${resp.status}`); }
        return await resp.json();
    } catch (e) {
        log(`warning: could not fetch ${DIRECTORY_URL} (${e.message}); ` +
            `previewing against an empty directory.`);
        return [];
    }
}

/* ---------- 3. upload the zip to Sauce's asset host ---------- */
async function uploadAsset(buf) {
    log(`uploading zip to ${ASSET_UPLOAD_URL} …`);
    const resp = await fetch(ASSET_UPLOAD_URL, {
        method: 'PUT',
        body: buf,
        headers: {'content-type': 'application/octet-stream'},
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`asset upload failed [HTTP ${resp.status}] ${text}`);
    }
    const out = await resp.json();
    if (!out.url) { throw new Error(`asset upload returned no url: ${JSON.stringify(out)}`); }
    if (out.hash && out.hash !== hash) {
        throw new Error(`server hash ${out.hash} != local hash ${hash}`);
    }
    log(`uploaded: ${out.url}`);
    return out.url;
}

/* ---------- 4. open the pull request via gh ---------- */
function openPullRequest({entry, isUpdate}) {
    if (!haveGh()) {
        die('`gh` CLI not found — install from https://cli.github.com and `gh auth login`, ' +
            'or re-run with --upload-only and submit the printed entry via the web tool.');
    }
    const login = gh(['api', 'user', '--jq', '.login']).trim();
    const base = gh(['repo', 'view', STORE_REPO, '--json', 'defaultBranchRef',
        '--jq', '.defaultBranchRef.name']).trim() || 'main';
    const branch = opt('branch', `${modId}-v${version}`);
    log(`fork: ensuring ${login}/${STORE_REPO.split('/')[1]} exists …`);
    gh(['repo', 'fork', STORE_REPO, '--clone=false'], {stdio: 'inherit'});

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rlg-modstore-'));
    try {
        log(`cloning upstream ${STORE_REPO} (shallow) …`);
        gh(['repo', 'clone', STORE_REPO, tmp, '--', '--depth', '1'], {stdio: 'inherit'});
        const g = args => git(args, {cwd: tmp});
        g(['checkout', '-b', branch]);

        // Edit the freshly-cloned file directly so the PR diff is exactly our one entry — never
        // clobber whatever else upstream currently contains.
        const dirFile = path.join(tmp, DIRECTORY_PATH);
        const raw = fs.readFileSync(dirFile, 'utf8');
        const indent = detectIndent(raw);
        const merged = upsertDirectory(JSON.parse(raw), entry);
        fs.writeFileSync(dirFile, serializeDirectory(merged, indent));
        g(['add', DIRECTORY_PATH]);
        const verb = isUpdate ? 'Update' : 'Add';
        g(['commit', '-m', `${verb} ${manifest.name} v${version}`]);

        const repoName = STORE_REPO.split('/')[1];
        g(['remote', 'add', 'fork', `https://github.com/${login}/${repoName}.git`]);
        log(`pushing ${branch} to your fork …`);
        g(['push', '--force', '-u', 'fork', branch], {stdio: 'inherit'});

        const body = [
            `${verb} **${manifest.name}** v${version}.`,
            '',
            (config.description || manifest.description || '').split('\n')[0],
            '',
            `Home: ${config.homeURL || ''}`,
        ].join('\n');
        log('opening pull request …');
        const prUrl = gh([
            'pr', 'create',
            '--repo', STORE_REPO,
            '--base', base,
            '--head', `${login}:${branch}`,
            '--title', `${verb} ${manifest.name} v${version}`,
            '--body', body,
        ]).trim();
        log(`pull request opened: ${prUrl}`);
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
}

/* ---------- main ---------- */
(async () => {
    const directory = await fetchDirectory();
    const existingEntry = findExistingEntry(directory, config, manifest);
    const isUpdate = !!existingEntry;
    log(existingEntry
        ? `store already lists this mod (id ${existingEntry.id}) — this will UPDATE it.`
        : 'this mod is not yet listed — this will ADD a new entry.');

    // Upload first (submit/upload-only) so the real asset URL lands in the entry.
    let url;
    if (doUpload) {
        url = await uploadAsset(zipBuf);
    }

    const release = buildRelease({
        version, url, hash, size,
        notes: opt('notes', config.releaseNotes || undefined),
        minVersion: config.minVersion || undefined,
    });
    const entry = buildEntry({manifest, config, release, existingEntry});

    const {errors, warnings} = validateEntry({
        entry, manifest, config, existingEntry, requireUrl: doUpload,
    });
    for (const w of warnings) { console.warn('  ! ' + w.replace(/\n/g, '\n    ')); }
    if (errors.length) {
        for (const e of errors) { console.error('  ✗ ' + e.replace(/\n/g, '\n    ')); }
        die(`${errors.length} blocking issue(s) — fix and retry.`);
    }

    console.log('\n--- directory.json entry ' + (doUpload ? '' : '(preview) ') + '---');
    console.log(JSON.stringify(entry, null, 4));
    console.log('---\n');

    if (mode === 'dry-run') {
        log('DRY RUN — nothing uploaded, no PR opened.');
        log('  Preview the finished entry with:  node scripts/submit-mod-store.mjs --upload-only');
        log('  Upload + open the store PR with:   node scripts/submit-mod-store.mjs --submit');
        return;
    }

    if (mode === 'upload-only') {
        log('Zip uploaded and entry built. Skipping the PR (--upload-only).');
        log('  Paste the entry above into your directory.json PR, or re-run with --submit.');
        return;
    }

    // mode === 'submit' — surface a name-clash error early (before any clone) then open the PR.
    upsertDirectory(directory, entry);
    openPullRequest({entry, isUpdate});
    log('done.');
})().catch(e => die(e.stack || e.message));
