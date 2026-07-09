/*
 * Build a clean, self-contained release copy under dist/<id>/ (folder only, no dev tooling).
 * Drop that folder into any SauceMods directory to run the release.
 */
import fs from 'node:fs';
import path from 'node:path';
import {repoRoot, modId, manifest, copyTree} from './_common.mjs';

const out = path.join(repoRoot, 'dist', modId);
fs.rmSync(out, {recursive: true, force: true});
copyTree(repoRoot, out);
console.log(`build: ${modId} v${manifest.version}\n  -> ${out}`);
