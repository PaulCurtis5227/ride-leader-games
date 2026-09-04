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
 * Ride Leader Games — event roster.
 *
 * WHO COUNTS. `nearby` is "everyone on the same stretch of road", not "everyone on your ride". In a
 * busy world that is most of the list: on a real 30-rider group ride it reported 64 distinct riders
 * — 29 in the event and 35 strangers, a third of them arriving in one lump at the end when the
 * group rolled through another event's start pen. Those strangers land in the leaderboard, in the
 * "since event start" standings, in the ride totals, and (after the presence window) in the
 * persistent ledger as regulars of a ride they were never on.
 *
 * So when we know which event subgroup we are in, every rider who is not in it is dropped before
 * anything sees the tick. Three details make that safe rather than merely strict:
 *
 *   - MEMBERSHIP IS STICKY. A rider is in the roster from the first tick they are seen in the event
 *     subgroup until the event changes. `state.eventSubgroupId` is not a stable label: riders who
 *     finished the event and rode on with the group reported no subgroup at all for the rest of the
 *     ride (4 of 29 on that same ride), and a rider dropping out of `nearby` at an intersection
 *     reports nothing at all. Neither should quietly stop counting.
 *   - THE LEADER IS ALWAYS KEPT. A ride leader is often not registered for their own ride (and the
 *     mod may be run by someone who isn't either), so `self` and the configured leader survive the
 *     filter regardless of subgroup. Otherwise picking an unregistered leader as the scoring
 *     reference would delete them from their own ride.
 *   - THE WATCHED RIDER IS NOT KEPT. That is transient camera state, not a claim about the ride, and
 *     the engine copes: gaps are already measured relative to the watched rider, so its fallback of
 *     offset 0 is exactly right when the watched rider isn't in the list.
 *
 * Outside an event (free ride, or an event we could not resolve) nothing is filtered — there is no
 * roster to compare against, and `presenceMs` in rider-history.mjs remains the only passer-by
 * filter. Filtering is by SUBGROUP, not event: a leader leads one pen, and riders in pen B of the
 * same event are not on the ride being led.
 *
 * Pure and DOM-free, like engine.mjs / event-tracker.mjs — control.mjs owns the wiring.
 */

export class EventRoster {

    /*
     * config:
     *   enabled    (bool, default true) — the leader's escape hatch (settings: "In an event, ignore
     *              riders who are not in it"). Off = pass every tick through untouched.
     *   subgroupId (number|null) — the event subgroup we are in, from control's event resolution.
     *              null (a free ride, or not resolved yet) also means "no filtering".
     *   leaderId   (number|null) — the configured scoring reference; always kept.
     */
    constructor(config = {}) {
        this.config = {enabled: true, subgroupId: null, leaderId: null, ...config};
        this.subgroupId = null;   // the event the current member set belongs to
        // Member ids are held as STRINGS so `has()` answers the same for 123 and '123' — the tracker
        // keys its records by the raw athleteId while the ledger keys its sightings by string.
        this.members = new Set();
        this.lastTotal = 0;       // riders in the last tick before filtering
        this.lastKept = 0;        // …and after
    }

    setConfig(config) {
        Object.assign(this.config, config);
    }

    // Are we actually filtering? False on a free ride or when the leader turned it off.
    get active() {
        return this.config.enabled !== false && this.config.subgroupId != null;
    }

    // Riders dropped from the last tick (0 when inactive) — the control window reports this.
    get lastIgnored() {
        return this.lastTotal - this.lastKept;
    }

    get size() {
        return this.members.size;
    }

    // Does this rider count? Used to prune anything accumulated before the event was known.
    has(athleteId) {
        return this.members.has(String(athleteId));
    }

    /*
     * The riders on this ride, out of one `nearby` snapshot. Returns the input array unchanged when
     * inactive, so a free ride costs nothing and behaves exactly as it did before.
     */
    filter(entries) {
        const list = Array.isArray(entries) ? entries : [];
        this.lastTotal = list.length;
        if (!this.active) {
            this.lastKept = list.length;
            return list;
        }
        const sgId = Number(this.config.subgroupId);
        if (sgId !== this.subgroupId) {
            // A different event: last week's members mean nothing to this one.
            this.subgroupId = sgId;
            this.members.clear();
        }
        const leaderId = this.config.leaderId;
        const kept = [];
        for (const e of list) {
            if (e == null || e.athleteId == null) {
                continue;
            }
            const sg = e.state ? Number(e.state.eventSubgroupId) : NaN;
            if (sg === sgId || e.self || (leaderId != null && Number(e.athleteId) === Number(leaderId))) {
                this.members.add(String(e.athleteId));   // sticky: see MEMBERSHIP IS STICKY above
            }
            if (this.members.has(String(e.athleteId))) {
                kept.push(e);
            }
        }
        this.lastKept = kept.length;
        return kept;
    }

    // Forget the current membership (a fresh event, or the leader hit Reset event).
    reset() {
        this.subgroupId = null;
        this.members.clear();
        this.lastTotal = 0;
        this.lastKept = 0;
    }
}
