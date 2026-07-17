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
 * Publish the built release zip to GitHub Releases.
 *
 * Uses the GitHub CLI (`gh`) if it is installed and authenticated; otherwise prints the manual
 * upload steps. Assumes the version's zip already exists — run `npm run package` (or `npm version`,
 * which builds it) first.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repoRoot, modId, manifest} from './_common.mjs';

const version = manifest.version;
const tag = `v${version}`;
const zipPath = path.join(repoRoot, 'dist', `${modId}-${tag}.zip`);

if (!fs.existsSync(zipPath)) {
    console.error(`release: no artifact at ${zipPath}\n  Run \`npm run package\` first.`);
    process.exit(1);
}

function haveGh() {
    try {
        execFileSync('gh', ['--version'], {stdio: 'ignore'});
        return true;
    } catch (e) {
        return false;
    }
}

if (haveGh()) {
    console.log(`release: creating GitHub release ${tag} with gh…`);
    execFileSync('gh', [
        'release', 'create', tag, zipPath,
        '--title', tag,
        '--generate-notes',
    ], {cwd: repoRoot, stdio: 'inherit'});
    console.log(`release: done — ${tag} published with ${path.basename(zipPath)} attached.`);
} else {
    console.log([
        'release: `gh` CLI not found — upload manually:',
        '',
        `  1. Push the tag if you have not already:  git push --follow-tags`,
        `  2. Open: https://github.com/PaulCurtis5227/${modId}/releases/new?tag=${tag}`,
        `  3. Set the release title to "${tag}", attach the artifact:`,
        `        ${zipPath}`,
        `  4. Publish the release.`,
        '',
        '  (To automate this later: install GitHub CLI from https://cli.github.com and `gh auth login`.)',
    ].join('\n'));
}
