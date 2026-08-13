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
 * Ride Leader Games — rider-event announcements (framework-agnostic, no DOM).
 *
 * A game scores a timed round; an *announcement* reacts to something that just happened to one rider
 * and says so in chat. The event tracker (event-tracker.mjs) spots these as it ingests each `nearby`
 * snapshot and returns them from `ingest()`; this module owns what gets said about them.
 *
 * The capability is deliberately generic — a level-up is only the first of these. Everything about an
 * announcement lives in ONE registry entry below, and the rest of the mod is written against the
 * registry rather than against any particular event:
 *   - settings.mjs BUILDS its on/off checkbox and message-template field from the registry, so a new
 *     announcement needs no settings HTML;
 *   - control.mjs merges `announcementDefaults()` into its setting defaults and pipes every event
 *     through `announcementMessages()`, so a new announcement needs no control wiring either.
 * Adding one is therefore: emit `{type: <key>, …}` from the tracker, add the entry here, done.
 *
 * Announcement interface:
 *   key              stable id; MUST equal the `type` of the event the tracker emits
 *   name             label shown in the settings window
 *   description      one-line hint shown above the template field
 *   enabledSetting   settings-store key of the on/off checkbox
 *   templateSetting  settings-store key of the (leader-editable) message template
 *   defaultEnabled   whether it is on out of the box
 *   defaultTemplate  default message text; `{placeholder}` names are substituted per event
 *   placeholders     [{name, description}] — the placeholders offered to the leader
 *   vars(event)      event -> {name: value} used for the substitution
 *   options          (optional) [{setting, label, description, defaultValue}] extra on/off switches
 *                    shown under this announcement. These tune HOW the underlying event is detected
 *                    rather than what is said, so the tracker — not this module — reads them.
 */

/*
 * Substitute `{placeholder}` names. Unknown names are left verbatim rather than blanked, so a typo
 * in a leader's template shows up as `{levl}` in chat instead of silently vanishing. Values are
 * stringified as-is; the send pipeline handles chunking and the chat prefix.
 */
export function renderTemplate(template, vars) {
    return String(template == null ? '' : template).replace(/\{(\w+)\}/g, (whole, name) =>
        (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : whole);
}


export const LEVEL_UP_ANNOUNCEMENT = {
    key: 'level-up',
    name: 'Level up',
    description: 'Sent when a rider in the group gains a Zwift level during the ride.',
    enabledSetting: 'announceLevelUp',
    templateSetting: 'levelUpMessage',
    defaultEnabled: true,
    defaultTemplate: '🎉 LEVEL UP! Huge congratulations to {name}, now Level {level}! 🎉',
    placeholders: [
        {name: 'name', description: "the rider's name"},
        {name: 'level', description: 'their new level'},
        {name: 'previousLevel', description: 'the level they just left'},
    ],
    vars: ev => ({name: ev.name, level: ev.to, previousLevel: ev.from}),
    options: [{
        // Read by the event tracker (see LEVEL SETTLING in event-tracker.mjs), not by this module.
        setting: 'levelUpSettling',
        label: 'Ignore level changes just after a rider joins',
        description: 'A rider’s level is read from their Zwift profile, which loads a moment ' +
            'after they appear — so their level often jumps from a stale or missing value to ' +
            'the real one, which looks just like a level-up. Leave this on to ignore changes in ' +
            'that settling period. Turning it off announces every one-level rise the instant it is ' +
            'seen, at the cost of congratulating riders who did not actually level up.',
        defaultValue: true,
    }],
};


// Ordered registry — the settings window lists announcements in this order.
export const ANNOUNCEMENTS = [
    LEVEL_UP_ANNOUNCEMENT,
];

const BY_KEY = new Map(ANNOUNCEMENTS.map(a => [a.key, a]));

// Resolve an announcement by event type. Unlike getGame() this does NOT fall back to a default —
// an event with no registry entry is simply not announced.
export function getAnnouncement(key) {
    return BY_KEY.get(key);
}

/*
 * Every announcement setting and its out-of-the-box value, ready to merge into the control window's
 * SETTING_DEFAULTS so a new registry entry needs no edit there. Includes each announcement's extra
 * `options` switches, which are ordinary settings like the rest.
 */
export function announcementDefaults() {
    const defaults = {};
    for (const a of ANNOUNCEMENTS) {
        defaults[a.enabledSetting] = a.defaultEnabled;
        defaults[a.templateSetting] = a.defaultTemplate;
        for (const o of a.options || []) {
            defaults[o.setting] = o.defaultValue;
        }
    }
    return defaults;
}

/*
 * Turn tracker events into the chat messages to send. `getSetting(key)` reads the effective setting
 * (the caller's store-with-defaults accessor). Events with no registry entry, or whose announcement
 * is switched off, are dropped; an emptied-out template is treated as "say nothing" rather than
 * falling back to the default, so blanking the field is a valid way to mute one.
 */
export function announcementMessages(events, getSetting) {
    const out = [];
    for (const ev of events || []) {
        const def = getAnnouncement(ev && ev.type);
        if (!def || !getSetting(def.enabledSetting)) {
            continue;
        }
        const template = getSetting(def.templateSetting);
        const text = renderTemplate(template, def.vars(ev)).trim();
        if (text) {
            out.push(text);
        }
    }
    return out;
}
