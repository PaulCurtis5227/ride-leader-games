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
 * Ride Leader Games — Settings window (opened from the control window's titlebar gear).
 *
 * This is a plain Sauce settings child window: `initSettingsForm` two-way-binds every field to the
 * shared settings store (same data-settings-key as the control window), so edits here propagate to
 * the live control window via the cross-window `storage` event with no extra wiring. The only
 * bespoke logic is the game-specific Instructions default display and the load-from-file helper.
 */
import * as Common from '/pages/src/common.mjs';
import {getGame, DEFAULT_GAME_KEY} from './games.mjs';
import {instructionMessages} from './engine.mjs';

const settings = Common.settingsStore;

// The active game (its key is set by the control window's picker). Falls back to the default.
function activeGame() {
    const k = settings.get('gameKey');
    return getGame(k === undefined ? DEFAULT_GAME_KEY : k);
}

/*
 * When the leader hasn't customized the instructions, mirror the active game's default into the
 * visible textarea (display only — no store write) so they see exactly what Start will send. A
 * customized (persisted) blob is left untouched and applies to whichever game is selected.
 */
function showDefaultInstructionsIfUnset() {
    if (settings.get('instructions') !== undefined) {
        return;
    }
    const ta = document.querySelector('#configForm [name="instructions"]');
    if (ta) {
        ta.value = activeGame().defaultInstructions;
    }
}

function applyFontScaleOutput(raw) {
    const scale = Math.min(2, Math.max(0.6, Number(raw) || 1));
    const out = document.querySelector('#fontScaleVal');
    if (out) {
        out.textContent = `${Math.round(scale * 100)}%`;
    }
}


export async function settingsMain() {
    Common.initInteractionListeners();
    await Common.initSettingsForm('#configForm')();

    // initSettingsForm only fills a field when the store holds a defined value, so an unsaved
    // instructions setting leaves the textarea blank. Show the active game's default (display only).
    showDefaultInstructionsIfUnset();

    // Live font-scale % readout while dragging (the control window applies the clamped value on the
    // store's 'set' event once the slider commits on 'change').
    const fontScaleEl = document.querySelector('#configForm [name="fontScale"]');
    if (fontScaleEl) {
        applyFontScaleOutput(fontScaleEl.value);
        fontScaleEl.addEventListener('input', () => applyFontScaleOutput(fontScaleEl.value));
    }

    // Load instructions from a text/markdown file into the (persisted) instructions field.
    const instructionsFile = document.querySelector('#instructionsFile');
    const instructionsNote = document.querySelector('#instructionsNote');
    document.querySelector('#btnLoadInstructions').addEventListener('click', () => instructionsFile.click());
    instructionsFile.addEventListener('change', async () => {
        const file = instructionsFile.files && instructionsFile.files[0];
        if (!file) {
            return;
        }
        const text = await file.text();
        settings.set('instructions', text);   // persists + notifies the control window
        const ta = document.querySelector('#configForm [name="instructions"]');
        if (ta) {
            ta.value = text;                   // keep the visible textarea in sync (programmatic set)
        }
        instructionsNote.textContent = `loaded ${file.name} (${instructionMessages(text).length} msg)`;
        instructionsFile.value = '';           // allow re-loading the same file later
    });

    // The game is picked in the control window; when it changes (and instructions are still unset)
    // refresh the shown default so it always reflects what Start will send.
    settings.addEventListener('set', () => showDefaultInstructionsIfUnset());
}
