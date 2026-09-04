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
 * bespoke logic is the game-specific Instructions default display, the load-from-file helper, and
 * generating the rider-announcement fields from the announcements.mjs registry.
 */
import * as Common from '/pages/src/common.mjs';
import {getGame, DEFAULT_GAME_KEY} from './games.mjs';
import {ANNOUNCEMENTS} from './announcements.mjs';
import {instructionMessages} from './engine.mjs';
import {RiderHistory} from './rider-history.mjs';

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

/*
 * Generate the rider-announcement fields from the registry — one on/off checkbox plus one editable
 * message template each, with the available `{placeholder}` names listed underneath. MUST run
 * before initSettingsForm() so the new inputs get bound to the store like any hand-written field.
 *
 * The registry defaults go into the `checked` attribute / textarea content rather than the store,
 * which is exactly what initSettingsForm expects: it only overwrites a field when the store holds a
 * value, so the markup IS the default until the leader changes something.
 */
function buildAnnouncementFields() {
    const host = document.querySelector('#announcements');
    if (!host) {
        return;
    }
    host.innerHTML = ANNOUNCEMENTS.map(a => `
        <div class="announcement">
            <label class="checkbox">
                <input type="checkbox" name="${a.enabledSetting}"${a.defaultEnabled ? ' checked' : ''}/>
                Announce: ${Common.sanitize(a.name)}
            </label>
            ${a.manual ? `<div class="ann-note">${Common.sanitize(a.manualNote ||
                'Sent when you press the button for it in the control window, never automatically.')}</div>` : ''}
            <label>${Common.sanitize(a.description)}
                <textarea name="${a.templateSetting}" rows="2">${Common.sanitize(a.defaultTemplate)}</textarea>
            </label>
            <div class="ann-tokens">${a.placeholders.map(p =>
                `<code>{${Common.sanitize(p.name)}}</code> ${Common.sanitize(p.description)}`).join(' · ')}</div>
            ${(a.options || []).map(o => `
                <label class="checkbox">
                    <input type="checkbox" name="${o.setting}"${o.defaultValue ? ' checked' : ''}/>
                    ${Common.sanitize(o.label)}
                </label>
                <div class="ann-note">${Common.sanitize(o.description)}</div>`).join('')}
        </div>`).join('');
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
    buildAnnouncementFields();          // must precede initSettingsForm so the fields get bound
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

    wireHistoryBackup();

    // The game is picked in the control window; when it changes (and instructions are still unset)
    // refresh the shown default so it always reflects what Start will send.
    settings.addEventListener('set', () => showDefaultInstructionsIfUnset());
}

/*
 * Export / import the rider-history ledger. It is the only state the mod cannot rebuild — attendance
 * from past rides is not recoverable from Zwift or Sauce (see rider-history.mjs) — so a backup, and a
 * way to carry it to another machine, matters more here than anywhere else in the mod.
 *
 * This window reads the same localStorage key as the control window. An import while a ride is in
 * progress would be overwritten by the control window's next flush, hence the warning.
 */
function wireHistoryBackup() {
    const note = document.querySelector('#historyNote');
    const fileEl = document.querySelector('#historyFile');
    const exportBtn = document.querySelector('#btnExportHistory');
    const importBtn = document.querySelector('#btnImportHistory');
    if (!note || !fileEl || !exportBtn || !importBtn) {
        return;
    }
    const history = new RiderHistory({storage: window.localStorage});

    const describe = () => {
        history.load();
        const series = history.listSeries();
        const riders = series.reduce((n, s) => n + s.riders, 0);
        note.textContent = series.length ?
            `${series.length} ride${series.length === 1 ? '' : 's'}, ${riders} rider${
                riders === 1 ? '' : 's'}: ` + series.map(s => `${s.label} (${s.sessions})`).join(', ') :
            'No history yet.';
    };
    describe();

    exportBtn.addEventListener('click', () => {
        history.load();
        const blob = new Blob([history.exportJSON()], {type: 'application/json'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `rlg-rider-history-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    importBtn.addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
        const file = fileEl.files && fileEl.files[0];
        fileEl.value = '';                       // allow re-loading the same file later
        if (!file) {
            return;
        }
        try {
            history.load();                      // so a failed import leaves what was there
            history.importJSON(await file.text());
            history.save();
            describe();
            note.textContent += ' — imported. Close the control window first if a ride is running, ' +
                'or its next update will overwrite this.';
        } catch(e) {
            note.textContent = `Import failed: ${e.message}`;
        }
    });
}
