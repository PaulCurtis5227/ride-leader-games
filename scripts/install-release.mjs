/*
 * Install the built release copy (dist/<id>/) into SauceMods as a REAL directory (no link),
 * so you can run the actual standalone release. Replaces any dev link or prior release copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import {repoRoot, modId, sauceModsRoot, removeInstalled, copyTree} from './_common.mjs';

const distDir = path.join(repoRoot, 'dist', modId);
if (!fs.existsSync(distDir)) {
    console.error('No release build found. Run `npm run build` first.');
    process.exit(1);
}
const dst = path.join(sauceModsRoot(), modId);
removeInstalled(dst);
copyTree(distDir, dst);
console.log(`install-release (copy):\n  ${dst}\n  (standalone copy of ${distDir})`);
console.log('Restart Sauce. This is the real release build, not a link.');
