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
 *   key              stable id; for an automatic announcement it MUST equal the `type` of the event
 *                    the tracker emits
 *   name             label shown in the settings window
 *   description      one-line hint shown above the template field
 *   enabledSetting   settings-store key of the on/off checkbox
 *   templateSetting  settings-store key of the (leader-editable) message template
 *   defaultEnabled   whether it is on out of the box
 *   defaultTemplate  default message text; `{placeholder}` names are substituted per event
 *   placeholders     [{name, description}] — the placeholders offered to the leader
 *   vars(event)      event -> {name: value} used for the substitution
 *   manual           (optional) true when the leader SENDS this from a button rather than it firing
 *                    off a detected event — see below
 *   manualNote       (optional) the "sent when you press …" hint the settings window shows for a
 *                    manual announcement, naming the button; a generic line is used without it
 *   options          (optional) [{setting, label, description, defaultValue}] extra on/off switches
 *                    shown under this announcement. These tune HOW the underlying event is detected
 *                    rather than what is said, so the tracker — not this module — reads them.
 *
 * AUTOMATIC vs MANUAL. A level-up is news the moment it happens, so it is announced automatically as
 * the tracker spots it. Recognising new riders and ride milestones, or reporting the group's totals,
 * is a *social* act with a good moment for it — after the late-join window closes, at the top of a
 * lap, when the leader chooses — and it is far more forgiving if a human glances at the numbers
 * first. Those are `manual: true`: the wording, the on/off switch and the settings UI work exactly
 * the same, but `announcementMessages()` ignores them and the control window composes them through
 * `manualAnnouncementMessage()` on a button press.
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


/*
 * Sent from the Riders panel, listing everyone present who has never been welcomed to THIS ride —
 * whatever their ride count, so a rider missed on an earlier week is still caught. One message for
 * the whole group: naming them individually would be a flood on a first run.
 */
export const WELCOME_ANNOUNCEMENT = {
    key: 'welcome',
    name: 'Welcome new riders',
    description: 'Sent when you press Welcome in the control window’s Riders panel, naming everyone ' +
        'who has not been welcomed to this ride before.',
    enabledSetting: 'announceWelcome',
    templateSetting: 'welcomeMessage',
    defaultEnabled: true,
    manual: true,
    manualNote: 'Sent when you press Welcome in the control window’s Riders panel, never ' +
        'automatically.',
    defaultTemplate: '👋 Please give a warm welcome to our new riders: {names}! Great to have you ' +
        'with us!',
    placeholders: [
        {name: 'names', description: 'the new riders, comma separated'},
        {name: 'count', description: 'how many there are'},
        {name: 'others', description: 'how many were not named (0 when everyone fitted)'},
    ],
    vars: ev => ({names: ev.names, count: ev.count, others: ev.others}),
};

/*
 * Sent from the Riders panel, one message per milestone value — everyone reaching 10 rides is a
 * single message, everyone reaching 50 another. That is what keeps a group who all started together
 * from producing thirty near-identical congratulations in the same week.
 *
 * `{rides}` is the milestone reached, and it counts rides *with this ride* since the mod started
 * keeping track — not a Zwift-wide total — so the default wording says "with us".
 */
export const MILESTONE_ANNOUNCEMENT = {
    key: 'milestone',
    name: 'Ride milestones',
    description: 'Sent when you press a milestone button in the control window’s Riders panel, ' +
        'naming everyone who has reached that number of rides with this ride.',
    enabledSetting: 'announceMilestone',
    templateSetting: 'milestoneMessage',
    defaultEnabled: true,
    manual: true,
    manualNote: 'Sent when you press a milestone button in the control window’s Riders panel, ' +
        'never automatically.',
    defaultTemplate: '🎂 Celebrating {rides} rides with us: {names}! Thanks for riding with us! 🎂',
    placeholders: [
        {name: 'rides', description: 'the milestone reached (10, 50, …)'},
        {name: 'names', description: 'the riders reaching it, comma separated'},
        {name: 'count', description: 'how many there are'},
        {name: 'others', description: 'how many were not named (0 when everyone fitted)'},
    ],
    vars: ev => ({rides: ev.rides, names: ev.names, count: ev.count, others: ev.others}),
};


/*
 * Sent from the "Since event start" panel: what the whole group has done together so far. It reads
 * off the same totals the panel shows (event-tracker.mjs `rideTotals`/`formatRideTotals`, which is
 * where the number formatting lives), so the message can't drift from the tiles.
 *
 * Manual because there is no moment that is automatically the right one — the totals only mean
 * something when the leader picks the point to report them (a halfway mark, the end of a lap, the
 * cool-down), and a group summary sent on a timer would just be noise.
 */
export const RIDE_TOTALS_ANNOUNCEMENT = {
    key: 'ride-totals',
    name: 'Ride summary',
    description: 'Sent when you press Send summary in the control window’s “Since event start” ' +
        'panel, reporting the group’s combined totals for the ride so far.',
    enabledSetting: 'announceRideTotals',
    templateSetting: 'rideTotalsMessage',
    defaultEnabled: true,
    manual: true,
    manualNote: 'Sent when you press Send summary in the control window’s “Since event start” ' +
        'panel, never automatically.',
    // Six numbers don't fit the default 90-character chunk, so this reads as two chat lines with the
    // usual (i/n) markers — the reason to reach for {km} instead of {miles}, or to drop a value, if
    // you want one. {km} and {elapsed} are offered as placeholders rather than spent in the default.
    defaultTemplate: '📊 Ride so far: {riders} riders, {miles} mi, {rideons} ride-ons, ' +
        '{strokes} pedal strokes, {calories} kcal, {levels} levels gained 💪',
    placeholders: [
        {name: 'riders', description: 'how many riders are counted'},
        {name: 'elapsed', description: 'time since the event start (m:ss)'},
        {name: 'miles', description: 'combined distance in miles'},
        {name: 'km', description: 'combined distance in kilometres'},
        {name: 'rideons', description: 'total ride-ons received'},
        {name: 'strokes', description: 'total pedal strokes'},
        {name: 'calories', description: 'total calories burnt'},
        {name: 'levels', description: 'levels gained during the ride'},
    ],
    vars: ev => ({
        riders: ev.riders, elapsed: ev.elapsed, miles: ev.miles, km: ev.km,
        rideons: ev.rideons, strokes: ev.strokes, calories: ev.calories, levels: ev.levels,
    }),
};


// Ordered registry — the settings window lists announcements in this order.
export const ANNOUNCEMENTS = [
    LEVEL_UP_ANNOUNCEMENT,
    WELCOME_ANNOUNCEMENT,
    MILESTONE_ANNOUNCEMENT,
    RIDE_TOTALS_ANNOUNCEMENT,
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
 * Render one announcement, or '' when it should stay silent (unknown key, switched off, or a template
 * the leader has blanked — blanking is a valid way to mute one without unticking the box).
 */
function render(def, vars, getSetting) {
    if (!def || !getSetting(def.enabledSetting)) {
        return '';
    }
    return renderTemplate(getSetting(def.templateSetting), vars).trim();
}

/*
 * Turn tracker events into the chat messages to send. `getSetting(key)` reads the effective setting
 * (the caller's store-with-defaults accessor). Events with no registry entry, or whose announcement
 * is switched off, are dropped; an emptied-out template is treated as "say nothing" rather than
 * falling back to the default, so blanking the field is a valid way to mute one.
 *
 * `manual` announcements are skipped here even if some caller passes one in: they are sent from a
 * button, not from a detected event (see manualAnnouncementMessage).
 */
export function announcementMessages(events, getSetting) {
    const out = [];
    for (const ev of events || []) {
        const def = getAnnouncement(ev && ev.type);
        if (!def || def.manual) {
            continue;
        }
        const text = render(def, def.vars(ev), getSetting);
        if (text) {
            out.push(text);
        }
    }
    return out;
}

/*
 * Compose a `manual: true` announcement for the leader's button press. Returns '' when it should stay
 * silent. Keeping this here (rather than formatting the text in the control window) is what keeps ALL
 * announcement wording — automatic or manual — owned by the registry.
 */
export function manualAnnouncementMessage(key, vars, getSetting) {
    const def = getAnnouncement(key);
    if (!def || !def.manual) {
        return '';
    }
    return render(def, vars, getSetting);
}

/*
 * Render a rider list for the {names}/{count}/{others} placeholders. A bucket can hold the whole
 * group — 40 names would become several chat lines after chunking — so only `max` are named and the
 * rest are counted. `max <= 0` names everyone.
 */
export function riderNameVars(riders, max) {
    const names = (riders || []).map(r => (r && r.name) || `#${r && r.athleteId}`);
    const limit = Number.isFinite(max) && max > 0 ? Math.min(max, names.length) : names.length;
    const shown = names.slice(0, limit);
    const others = names.length - shown.length;
    let text = shown.join(', ');
    if (others > 0) {
        text += `${shown.length ? ' ' : ''}and ${others} other${others === 1 ? '' : 's'}`;
    }
    return {names: text, count: names.length, others};
}
