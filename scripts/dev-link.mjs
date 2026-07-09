/*
 * Install this repo into SauceMods as a junction (live testing — edits are picked up on
 * the next Sauce restart, no copy step). Replaces any existing dev link or release copy.
 */
import fs from 'node:fs';
import path from 'node:path';
import {repoRoot, modId, sauceModsRoot, removeInstalled} from './_common.mjs';

const dst = path.join(sauceModsRoot(), modId);
removeInstalled(dst);
fs.symlinkSync(repoRoot, dst, 'junction');
console.log(`dev-link (junction):\n  ${dst}\n  -> ${repoRoot}`);
console.log('Restart Sauce and enable the mod in Settings → Mods.');
