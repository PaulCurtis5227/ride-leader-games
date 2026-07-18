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
 * Headless tests for the pure pre-release scan logic (no git / no filesystem side effects), plus a
 * baseline smoke test: every currently-tracked source file must scan with zero ERROR findings.
 *
 * NOTE: the fixture strings below intentionally contain shapes the scanner flags. The lines that
 * hold a literal are tagged with a `release-scan-allow` comment so that scanning THIS file (in the
 * baseline test and in `npm run scan`) skips them — the unit assertions still exercise the values
 * because they are passed as arguments, which the scanner sees as clean synthetic text.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
    scanText, scanFile, headerFinding, needsHeader, hasHeader, isBinary, redact, RULES,
    SUPPRESS_MARKER,
} from '../scripts/release-scan.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HEADER = '/*\n * SPDX-License-Identifier: GPL-3.0-or-later\n */\n';

function ruleIds(text, opts = {}) {
    return scanText({path: opts.path || 'x.mjs', text, privateTokens: opts.privateTokens || []})
        .map(f => f.ruleId);
}

test('flags a hard-coded credential and redacts the value', () => {
    const findings = scanText({path: 'a.mjs', text: 'const password = "hunter2secret"'}); // release-scan-allow
    assert.equal(findings.length, 1);
    assert.equal(findings[0].ruleId, 'assigned-secret');
    assert.equal(findings[0].severity, 'error');
    assert.ok(!findings[0].snippet.includes('hunter2secret'), 'must not reprint the secret');
    assert.match(findings[0].snippet, /…/);
});

test('ignores placeholder credential values', () => {
    for (const v of ['<your-key>', 'CHANGEME', 'xxxxxx', 'example-token', '${API_KEY}']) {
        assert.deepEqual(ruleIds(`api_key: "${v}"`), [], `should ignore ${v}`);
    }
});

test('matches each structured secret family', () => {
    // Assembled at runtime so the fixtures never appear contiguously in this file's source.
    const samples = {
        'aws-access-key': 'AKIA' + 'IOSFODNN7EXAMPLE',
        'github-token': 'ghp_' + 'a'.repeat(36),
        'slack-token': 'xoxb' + '-2222222222-abcdefabcdef',
        'google-api-key': 'AIza' + 'B'.repeat(35),
        'sk-token': 'sk-ant' + '-' + 'c'.repeat(24),
        'jwt': ['eyJhdGVzdGluZw', 'eyJwYXlsb2FkeA', 'c2lnbmF0dXJlUXg'].join('.'),
    };
    for (const [id, sample] of Object.entries(samples)) {
        const ids = ruleIds(`const x = "${sample}"`);
        assert.ok(ids.includes(id), `expected ${id} for ${sample}, got ${ids.join(',')}`);
    }
});

test('private key block is detected and error severity', () => {
    const f = scanText({path: 'k.txt', text: '-----BEGIN RSA ' + 'PRIVATE KEY-----'});
    assert.equal(f[0].ruleId, 'private-key');
    assert.equal(f[0].severity, 'error');
});

test('every redacting rule masks its match', () => {
    for (const rule of RULES.filter(r => r.redact)) {
        assert.equal(typeof rule.label, 'string');
    }
    assert.equal(redact('secretvalue'), 'secr…ue');
    assert.equal(redact('abcd'), 'a…d');
    assert.ok(!redact('abcdefghijklmnop').includes('efghij'));
});

test('email is a warning, not a blocker', () => {
    const f = scanText({path: 'a.mjs', text: 'contact me@example.com now'}); // release-scan-allow
    assert.equal(f.length, 1);
    assert.equal(f[0].ruleId, 'email');
    assert.equal(f[0].severity, 'warn');
});

test('host-absolute web imports are NOT flagged as paths', () => {
    const text = [
        `import * as Common from '/pages/src/common.mjs';`,
        `background: url(/pages/images/icon128.png);`,
        `fetch('/mods/ride-leader-games/pages/control.html');`,
    ].join('\n');
    assert.deepEqual(ruleIds(text, {privateTokens: ['paul']}), []);
});

test('URLs like https:// are not mistaken for a drive path', () => {
    const text = `see https://www.gnu.org/licenses/ and http://x.io/a`;
    assert.deepEqual(ruleIds(text), []);
});

test('documentation placeholder paths are not flagged', () => {
    const text = [
        'C:\\Users\\<you>\\Documents\\SauceMods\\',
        '/Users/$USER/mods',
        '/home/username/thing',
    ].join('\n');
    assert.deepEqual(ruleIds(text, {privateTokens: ['paul']}), []);
});

test('a concrete foreign path warns; this machine\'s path errors', () => {
    const win = scanText({path: 'a.mjs', text: 'C:\\Users\\bob\\secret.txt', privateTokens: ['paul']}); // release-scan-allow
    assert.equal(win[0].ruleId, 'abs-path-win');
    assert.equal(win[0].severity, 'warn');

    const mine = scanText({path: 'a.mjs', text: 'C:\\Users\\paul\\OneDrive\\x', privateTokens: ['paul']}); // release-scan-allow
    assert.equal(mine[0].severity, 'error');

    const nix = scanText({path: 'a.mjs', text: '/home/paul/.ssh/id', privateTokens: ['paul']}); // release-scan-allow
    assert.equal(nix[0].ruleId, 'abs-path-nix');
    assert.equal(nix[0].severity, 'error');
});

test('the author name in a copyright line is not treated as a leak', () => {
    // `paul` is a private token, but it only escalates PATHS — a bare name must not fire.
    const text = ' * Copyright (C) 2026 Paul Curtis\nconst author = "Paul";';
    assert.deepEqual(ruleIds(text, {privateTokens: ['paul']}), []);
});

test('SUPPRESS_MARKER silences a line', () => {
    const text = `password = "x-real-secret-123" // ${SUPPRESS_MARKER} example`; // release-scan-allow
    assert.deepEqual(ruleIds(text), []);
});

test('needsHeader / hasHeader classify by extension and content', () => {
    assert.ok(needsHeader('pages/control.mjs'));
    assert.ok(needsHeader('a/b.css'));
    assert.ok(!needsHeader('manifest.json'));
    assert.ok(!needsHeader('README.md'));
    assert.ok(!needsHeader('LICENSE'));
    assert.ok(hasHeader(HEADER + 'code'));
    assert.ok(!hasHeader('const x = 1;'));
});

test('headerFinding fires for a headerless source file only', () => {
    assert.equal(headerFinding({path: 'a.mjs', text: 'const x=1'}).ruleId, 'missing-header');
    assert.equal(headerFinding({path: 'a.mjs', text: HEADER}), null);
    assert.equal(headerFinding({path: 'data.json', text: '{}'}), null);
});

test('isBinary detects NUL bytes', () => {
    assert.ok(isBinary(Buffer.from([1, 2, 0, 3])));
    assert.ok(!isBinary(Buffer.from('plain text', 'utf8')));
});

test('scanFile combines content + header findings', () => {
    const f = scanFile({path: 'a.mjs', text: 'const k = "AKIA' + 'IOSFODNN7EXAMPLE"'});
    const ids = f.map(x => x.ruleId).sort();
    assert.deepEqual(ids, ['aws-access-key', 'missing-header']);
});

test('BASELINE: every tracked source file scans with zero ERROR findings', () => {
    const files = execFileSync('git', ['ls-files'], {cwd: repoRoot, encoding: 'utf8'})
        .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const offenders = [];
    for (const rel of files) {
        const buf = fs.readFileSync(path.join(repoRoot, rel));
        if (isBinary(buf)) {
            continue;
        }
        // Use this machine's real username so an accidental personal-path commit also trips this.
        const errs = scanFile({path: rel, text: buf.toString('utf8'), privateTokens: ['paul']})
            .filter(f => f.severity === 'error');
        for (const e of errs) {
            offenders.push(`${e.path}:${e.line} ${e.ruleId}`);
        }
    }
    assert.deepEqual(offenders, [], 'tracked files must be clean of blocking findings');
});
