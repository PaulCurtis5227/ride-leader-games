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
 * Pre-release hygiene gate. Scans the files that ship in the release for leaked secrets/keys,
 * this machine's absolute paths, personal identifiers, and missing copyright headers, then exits
 * non-zero on any blocking (error) finding so a bad release can't be published.
 *
 * Runs automatically before `npm run release` (npm's `prerelease` lifecycle) and standalone via
 * `npm run scan`. The detection logic lives in scripts/release-scan.mjs (pure, unit-tested).
 *
 * Usage:
 *   node scripts/scan-release.mjs                 # scan every git-tracked file (the shipped set)
 *   node scripts/scan-release.mjs --since v0.2.0  # only files changed since a ref
 *   node scripts/scan-release.mjs --staged        # only staged changes
 *   node scripts/scan-release.mjs path [path...]  # scan explicit files
 *   node scripts/scan-release.mjs --warn-only     # never fail; print findings only
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repoRoot} from './_common.mjs';
import {scanFile, isBinary, SUPPRESS_MARKER} from './release-scan.mjs';

function parseArgs(argv) {
    const opts = {warnOnly: false, since: null, staged: false, paths: []};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--warn-only') {
            opts.warnOnly = true;
        } else if (a === '--staged') {
            opts.staged = true;
        } else if (a === '--since') {
            opts.since = argv[++i];
        } else if (a === '--help' || a === '-h') {
            opts.help = true;
        } else if (a.startsWith('--')) {
            console.error(`scan: unknown flag ${a}`);
            process.exit(2);
        } else {
            opts.paths.push(a);
        }
    }
    return opts;
}

const HELP = `scan-release — pre-release hygiene gate

Scans shipped files for secrets, this machine's absolute paths, personal info, and missing
copyright headers. Exits non-zero on any blocking finding (unless --warn-only).

  --since <ref>   only files changed since <ref> (git diff --name-only <ref>)
  --staged        only staged changes (git diff --name-only --cached)
  --warn-only     print findings but always exit 0
  <path>...       scan explicit files instead of the git set
  -h, --help      this help

Silence one line with a comment containing: ${SUPPRESS_MARKER}`;

function gitLines(args) {
    const out = execFileSync('git', args, {cwd: repoRoot, encoding: 'utf8'});
    return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

function collectFiles(opts) {
    if (opts.paths.length) {
        return opts.paths;
    }
    if (opts.staged) {
        return gitLines(['diff', '--name-only', '--cached']);
    }
    if (opts.since) {
        return gitLines(['diff', '--name-only', opts.since]);
    }
    return gitLines(['ls-files']);
}

/* This machine's identifiers — their presence inside an absolute path marks it as a real leak. */
function privateTokens() {
    const toks = new Set();
    try {
        const u = os.userInfo().username;
        if (u && u.length >= 2) {
            toks.add(u);
        }
    } catch {
        /* userInfo can throw on odd environments; a machine-agnostic scan is still useful. */
    }
    const home = os.homedir() || '';
    const base = home.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (base && base.length >= 2) {
        toks.add(base);
    }
    return [...toks];
}

function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log(HELP);
        return 0;
    }

    const toks = privateTokens();
    const files = collectFiles(opts);
    const findings = [];
    let scanned = 0;
    let skippedBinary = 0;

    for (const rel of files) {
        const abs = path.resolve(repoRoot, rel);
        let buf;
        try {
            buf = fs.readFileSync(abs);
        } catch {
            continue;  // listed-but-deleted (e.g. from a diff) — nothing to scan
        }
        if (isBinary(buf)) {
            skippedBinary++;
            continue;
        }
        scanned++;
        findings.push(...scanFile({path: rel, text: buf.toString('utf8'), privateTokens: toks}));
    }

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warn');

    if (findings.length) {
        const byFile = new Map();
        for (const f of findings) {
            if (!byFile.has(f.path)) {
                byFile.set(f.path, []);
            }
            byFile.get(f.path).push(f);
        }
        console.log('');
        for (const [file, fs_] of byFile) {
            console.log(`  ${file}`);
            for (const f of fs_.sort((a, b) => a.line - b.line || a.col - b.col)) {
                const loc = `${f.path}:${f.line}:${f.col}`;
                const tag = f.severity === 'error' ? 'ERROR' : 'warn ';
                console.log(`    ${tag}  ${loc}  ${f.label} — ${f.snippet}`);
            }
        }
        console.log('');
    }

    const tail = skippedBinary ? `, ${skippedBinary} binary skipped` : '';
    console.log(
        `scan: ${scanned} files scanned${tail} — ${errors.length} error(s), ${warnings.length} warning(s).`);

    if (errors.length && !opts.warnOnly) {
        console.error(
            'scan: FAILED — blocking findings above must be fixed before release ' +
            `(or add a "${SUPPRESS_MARKER}" comment on a line that is a verified false positive).`);
        return 1;
    }
    if (errors.length) {
        console.log('scan: --warn-only set, not failing despite errors.');
    } else if (!findings.length) {
        console.log('scan: clean — no findings.');
    }
    return 0;
}

process.exit(main());
