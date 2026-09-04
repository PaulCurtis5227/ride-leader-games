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
 * Ride Leader Games — persistent rider history (framework-agnostic, no DOM).
 *
 * The event tracker remembers one ride; this remembers ALL of them. It is the only durable state the
 * mod keeps, and it exists to answer two social questions a ride leader wants to ask mid-ride:
 *   - who here has never been welcomed?  (the welcome bucket)
 *   - who just reached a milestone number of rides with us?  (10, 50, 100, …)
 * Both are computed as *buckets of riders*, one chat message each, because a group that all started
 * together reaches the same milestone in the same week — 30 riders hitting 10 rides has to be one
 * message, not 30.
 *
 * WHY NOT SAUCE'S OWN DATA: there is no way to backfill this. The host can fetch a past event's
 * roster if you already know its subgroup id (`getEventSubgroupEntrants`), but nothing can DISCOVER
 * last week's occurrence — there is no search-by-name/date RPC, the event feed walks back in 1.5h
 * hops over an API the host itself calls broken, and the only persisted local event data is
 * (subgroupId, eventId, eventType). So history is accumulated from the leader's own rides, and day
 * one is handled by `seedKnown()` — one click that marks everyone currently present as already known.
 *
 * KEYED TO THE EVENT, NOT THE LEADER. A leader may run two different rides a week, and a rider is a
 * regular *of a ride*. So every counter lives under a series key (see keyForEvent / useSeries), and
 * `welcomedAt` is per series too: being welcomed to the Sunday social is not being welcomed to the
 * Tuesday hill ride.
 *
 * Pure and storage-injected (`{getItem, setItem}`) so it unit-tests headlessly with a plain object.
 * The control window passes `localStorage` — deliberately NOT Common.settingsStore, whose writes
 * fire a cross-window `set` event that makes the control window re-read config and re-render.
 */

export const STORE_KEY = 'rlg-rider-history-v1';
export const STORE_VERSION = 1;

/*
 * Ride counts at which a rider is celebrated. Deliberately sparse and widening: a rider attending
 * every week hits a milestone with probability 1/gap per week, so for a group of N riders the
 * expected celebrations per week is about N/gap. Gaps of 50–100 keep a 40-rider group under one a
 * week. The ladder starts at 10 because ride #1 is covered by the welcome bucket — a literal
 * "1 ride" milestone would greet every new rider twice.
 */
export const MILESTONES = [10, 50, 100, 200, 300, 400, 500, 750, 1000];

/*
 * How long a rider must have been with us in this ride before they count as having attended (and so
 * become eligible for a welcome). This is the passer-by filter: `nearby` reports whoever is on the
 * same road, so without it every rider who drifts past on Tempus Fugit becomes one of your regulars.
 */
export const PRESENCE_MS = 5 * 60_000;

/*
 * Reopening the control window mid-ride starts a fresh in-memory tracker, and a naive implementation
 * would mint a new session and count everybody a SECOND time for the same ride. So a session is
 * durable: if the stored session started less than this ago, we resume it rather than start a new
 * one. (`commit` is also idempotent per session, which covers the rest.)
 */
export const SESSION_RESUME_MS = 6 * 3600_000;


// ---------------------------------------------------------------- event identity

/*
 * Strip the part of an event name that changes every week, so "Sunday Social — Week 12" and
 * "Sunday Social (Week 13)" resolve to one series. Conservative on purpose: it only removes a
 * TRAILING week/round/date/#N marker, because over-normalizing would silently merge two genuinely
 * different rides. Used only when the event has no real EventSeries id.
 */
export function normalizeEventName(name) {
    let s = String(name == null ? '' : name).trim();
    // Trailing separator + optional week/round word + number, e.g. "- Week 12", "| Rd 3", "#7", "12"
    const trailing =
        /[\s–—|:;,#(\[-]+\s*(?:week|wk|w|round|rd|ride|day|episode|ep|no|nr|part|pt)?\s*[#]?\s*\d{1,4}\s*[)\]]?\s*$/i;
    // Trailing ISO-ish or slashed date, e.g. "2026-08-13", "8/13/26", "13.08.2026"
    const trailingDate =
        /[\s–—|:;,(\[-]+\s*\d{1,4}[-/.]\d{1,2}(?:[-/.]\d{1,4})?\s*[)\]]?\s*$/;
    for (let i = 0; i < 3; i++) {          // e.g. "Social - Week 12 (2026-08-13)" needs two passes
        const before = s;
        s = s.replace(trailingDate, '').replace(trailing, '').trim();
        if (s === before) {
            break;
        }
    }
    return (s || String(name == null ? '' : name).trim()).toLowerCase();
}

/*
 * The series key for the ride currently being led. Prefers Zwift's own EventSeries id, which is
 * stable across weekly occurrences (zwift.proto `EventSeries`, Event field 30) — but it is only
 * populated when the organizer configured a series, and meetups never have one, so fall back to the
 * normalized name and finally to a leader-chosen label (also used for a free ride outside any event).
 */
export function keyForEvent({seriesId, eventName, label} = {}) {
    if (seriesId != null && seriesId !== 0 && String(seriesId).trim() !== '') {
        return `series:${seriesId}`;
    }
    const norm = eventName ? normalizeEventName(eventName) : '';
    if (norm) {
        return `name:${norm}`;
    }
    const manual = String(label == null ? '' : label).trim().toLowerCase();
    return `manual:${manual || 'default'}`;
}

/*
 * Parse a leader-edited ladder ("10, 50, 100") into sorted unique positive integers. Any non-digit
 * run separates values, so "10-50" reads as two milestones rather than a range or a negative — a
 * negative is meaningless here, and a dash between numbers is far more likely to be punctuation.
 * An unusable field falls back to the default ladder rather than leaving no milestones at all.
 */
export function parseMilestones(raw, fallback = MILESTONES) {
    if (Array.isArray(raw)) {
        raw = raw.join(',');
    }
    const nums = String(raw == null ? '' : raw)
        .split(/[^0-9]+/)
        .map(x => parseInt(x, 10))
        .filter(n => Number.isFinite(n) && n > 0);
    return nums.length ? Array.from(new Set(nums)).sort((a, b) => a - b) : fallback.slice();
}


// ---------------------------------------------------------------- store

function emptyData() {
    return {version: STORE_VERSION, aliases: {}, series: {}, riders: {}};
}

function newRider(name, nowMs) {
    return {name: name || '', firstSeen: nowMs, welcomedAt: null, seeded: false,
        rides: 0, streak: 0, bestStreak: 0, lastIndex: null, milestonesDone: []};
}


export class RiderHistory {

    /*
     * `storage` is anything with getItem/setItem (localStorage, or a plain shim in tests). Everything
     * else is a tunable the settings window feeds in: the milestone ladder, the presence threshold,
     * and the session-resume window.
     */
    constructor({storage, key = STORE_KEY, milestones = MILESTONES, presenceMs = PRESENCE_MS,
        resumeMs = SESSION_RESUME_MS} = {}) {
        this.storage = storage || null;
        this.key = key;
        this.milestones = milestones.slice().sort((a, b) => a - b);
        this.presenceMs = presenceMs;
        this.resumeMs = resumeMs;
        this.data = emptyData();
        this.seriesKey = null;      // resolved series (null until useSeries())
        this.sessionIndex = null;   // this ride's monotonic index within the series
        this.sessionId = null;
        this.seen = new Map();      // athleteId -> {name, firstSeenMs} for THIS ride only
        this.dirty = false;
    }

    setConfig({milestones, presenceMs, resumeMs} = {}) {
        if (milestones) {
            this.milestones = milestones.slice().sort((a, b) => a - b);
        }
        if (Number.isFinite(presenceMs)) {
            this.presenceMs = presenceMs;
        }
        if (Number.isFinite(resumeMs)) {
            this.resumeMs = resumeMs;
        }
    }

    // Read the store. A missing, unparseable or wrong-version blob yields an empty history rather
    // than throwing — losing history is bad, but refusing to run is worse.
    load() {
        this.data = emptyData();
        if (!this.storage) {
            return this.data;
        }
        let raw;
        try {
            raw = this.storage.getItem(this.key);
        } catch(e) {
            return this.data;
        }
        if (!raw) {
            return this.data;
        }
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.version === STORE_VERSION) {
                this.data = {...emptyData(), ...parsed};
                this.data.aliases = this.data.aliases || {};
                this.data.series = this.data.series || {};
                this.data.riders = this.data.riders || {};
            }
        } catch(e) {
            /* keep the empty history */
        }
        return this.data;
    }

    save() {
        this.dirty = false;
        if (!this.storage) {
            return false;
        }
        try {
            this.storage.setItem(this.key, JSON.stringify(this.data));
            return true;
        } catch(e) {
            return false;                 // quota / private mode: stay usable for this ride
        }
    }

    // Persist only when something actually changed (called freely from the per-tick path).
    flush() {
        return this.dirty ? this.save() : false;
    }

    // ---- series ----------------------------------------------------------

    resolveKey(rawKey) {
        const seen = new Set();
        let k = rawKey;
        while (this.data.aliases[k] && !seen.has(k)) {   // follow (and tolerate) alias chains
            seen.add(k);
            k = this.data.aliases[k];
        }
        return k;
    }

    /*
     * Select the series this ride belongs to. Returns `{seriesKey, isNew, rawKey}` — `isNew` is the
     * caller's cue to ASK rather than assume: an unrecognised key is usually a renamed event, and
     * silently starting a fresh series would zero every rider's count and streak. The control window
     * surfaces that as a banner offering `aliasSeries()`.
     */
    useSeries(rawKey, {label} = {}) {
        const seriesKey = this.resolveKey(rawKey);
        const isNew = !this.data.series[seriesKey];
        if (isNew) {
            this.data.series[seriesKey] = {label: label || seriesKey, sessions: 0,
                lastSessionId: null, lastSessionStart: null};
            this.data.riders[seriesKey] = this.data.riders[seriesKey] || {};
            this.dirty = true;
        } else if (label && this.data.series[seriesKey].label !== label) {
            this.data.series[seriesKey].label = label;      // keep the prettiest name we've seen
            this.dirty = true;
        }
        this.seriesKey = seriesKey;
        this.sessionIndex = null;
        this.sessionId = null;
        return {seriesKey, isNew, rawKey};
    }

    listSeries() {
        return Object.entries(this.data.series).map(([key, s]) => ({
            key,
            label: s.label || key,
            sessions: s.sessions || 0,
            riders: Object.keys(this.data.riders[key] || {}).length,
        })).sort((a, b) => b.sessions - a.sessions);
    }

    /*
     * Point `rawKey` at an existing series ("this renamed event is still the Sunday social"). Any
     * rows already written under the wrong key — normally just this ride's — are folded in rather
     * than dropped: counts sum, the earliest first-sighting wins, and an existing welcome sticks.
     *
     * The fiddly part is the session index. The forked series' latest session IS the ride happening
     * right now, so it becomes the target's newest session and everyone credited in it is re-stamped
     * with that index. Without this, the caller's next `beginSession` would mint yet another index,
     * see every rider as uncounted, and credit this one ride a SECOND time. The forked session's id
     * and start time move across too, so that `beginSession` resumes instead of starting over.
     *
     * A fork the leader left unmerged for several rides is folded in the same way; only the streak
     * across the seam is then approximate, which beats losing the history.
     */
    aliasSeries(rawKey, targetKey) {
        const from = this.resolveKey(rawKey);
        const into = this.resolveKey(targetKey);
        if (from === into || !this.data.series[into]) {
            return false;
        }
        const fromSeries = this.data.series[from];
        const intoSeries = this.data.series[into];
        const fromLatest = fromSeries ? (fromSeries.sessions || 0) : 0;
        // The ride in progress under the wrong key becomes the target's next session.
        const newIndex = (intoSeries.sessions || 0) + (fromLatest ? 1 : 0);
        const fromRiders = this.data.riders[from] || {};
        const intoRiders = this.data.riders[into] = this.data.riders[into] || {};
        for (const [id, r] of Object.entries(fromRiders)) {
            const inCurrentRide = r.lastIndex != null && r.lastIndex === fromLatest;
            const t = intoRiders[id];
            if (!t) {
                if (inCurrentRide) {
                    r.lastIndex = newIndex;
                }
                intoRiders[id] = r;
                continue;
            }
            const tPrevIndex = t.lastIndex;
            const tPrevStreak = t.streak || 0;
            t.rides += r.rides;
            t.firstSeen = Math.min(t.firstSeen ?? r.firstSeen, r.firstSeen ?? t.firstSeen);
            t.welcomedAt = t.welcomedAt || r.welcomedAt;
            t.seeded = t.seeded || r.seeded;
            t.name = t.name || r.name;
            t.milestonesDone = Array.from(new Set([...(t.milestonesDone || []),
                ...(r.milestonesDone || [])])).sort((a, b) => a - b);
            if (inCurrentRide) {
                t.streak = tPrevIndex === newIndex - 1 ? tPrevStreak + 1 : 1;
                t.lastIndex = newIndex;
            } else {
                t.streak = Math.max(tPrevStreak, r.streak || 0);
            }
            t.bestStreak = Math.max(t.bestStreak || 0, r.bestStreak || 0, t.streak);
        }
        intoSeries.sessions = newIndex;
        if (fromSeries && fromLatest) {
            intoSeries.lastSessionId = fromSeries.lastSessionId;
            intoSeries.lastSessionStart = fromSeries.lastSessionStart;
        }
        delete this.data.riders[from];
        delete this.data.series[from];
        this.data.aliases[rawKey] = into;
        if (from !== rawKey) {
            this.data.aliases[from] = into;
        }
        if (this.seriesKey === from) {
            this.seriesKey = into;
            this.sessionIndex = null;      // caller re-enters via beginSession (which now resumes)
        }
        this.dirty = true;
        return true;
    }

    // ---- session ---------------------------------------------------------

    /*
     * Start (or resume) this ride. Resuming is what makes a mid-ride window reopen safe: within
     * SESSION_RESUME_MS we keep the same session index, so `commit` sees every rider as already
     * counted. A genuinely new ride bumps the index, which is also what makes streaks measurable.
     */
    beginSession(nowMs) {
        if (!this.seriesKey) {
            return null;
        }
        const s = this.data.series[this.seriesKey];
        const resume = s.lastSessionStart != null && s.lastSessionId != null &&
            (nowMs - s.lastSessionStart) < this.resumeMs;
        if (resume) {
            this.sessionIndex = s.sessions;
            this.sessionId = s.lastSessionId;
        } else {
            s.sessions = (s.sessions || 0) + 1;
            s.lastSessionId = `${this.seriesKey}#${s.sessions}@${Math.round(nowMs)}`;
            s.lastSessionStart = nowMs;
            this.sessionIndex = s.sessions;
            this.sessionId = s.lastSessionId;
            this.seen.clear();
            this.dirty = true;
        }
        return {sessionId: this.sessionId, index: this.sessionIndex, resumed: resume};
    }

    // ---- per-tick --------------------------------------------------------

    /*
     * Note that a rider is here. Cheap enough for every rider every tick. Keeps the EARLIEST
     * sighting of this ride, so a rider who drops out at an intersection and returns doesn't restart
     * their presence clock.
     */
    observe(athleteId, name, nowMs) {
        if (athleteId == null || !this.seriesKey) {
            return;
        }
        const id = String(athleteId);
        const prev = this.seen.get(id);
        if (prev) {
            if (name) {
                prev.name = name;
            }
            prev.lastMs = nowMs;
        } else {
            this.seen.set(id, {name: name || '', firstSeenMs: nowMs, lastMs: nowMs});
        }
    }

    /*
     * Forget the riders the caller says are not on this ride (`keep(athleteId)` → false). Only this
     * ride's sighting map is touched — nothing persistent, so a rider already credited keeps their
     * ride and their streak.
     *
     * Needed because presence is measured from a rider's FIRST sighting, not from continuous
     * presence (a rider must be allowed to vanish at an intersection and come back). A stranger
     * sharing the road, seen once before the event filter knew which event this is — or while it was
     * switched off — would otherwise be credited a ride `presenceMs` later on the strength of that
     * one sighting, and offered up by name for a welcome. Returns how many sightings were dropped.
     */
    retain(keep) {
        let dropped = 0;
        for (const id of [...this.seen.keys()]) {
            if (!keep(id)) {
                this.seen.delete(id);
                dropped++;
            }
        }
        return dropped;
    }

    /*
     * Credit a ride to everyone who has now been with us long enough. Idempotent per session (the
     * `lastIndex` guard), so calling it every tick — and after a window reopen — is safe. Returns the
     * ids credited this call, which the caller can ignore; the panel reads `pending()` instead.
     */
    commit(nowMs) {
        const credited = [];
        if (!this.seriesKey || this.sessionIndex == null) {
            return credited;
        }
        const riders = this.data.riders[this.seriesKey] = this.data.riders[this.seriesKey] || {};
        for (const [id, s] of this.seen) {
            if ((nowMs - s.firstSeenMs) < this.presenceMs) {
                continue;
            }
            let rec = riders[id];
            if (!rec) {
                rec = riders[id] = newRider(s.name, nowMs);
                this.dirty = true;
            }
            if (s.name && rec.name !== s.name) {
                rec.name = s.name;
                this.dirty = true;
            }
            if (rec.lastIndex === this.sessionIndex) {
                continue;                       // already counted for this ride
            }
            rec.rides = (rec.rides || 0) + 1;
            rec.streak = rec.lastIndex === this.sessionIndex - 1 ? (rec.streak || 0) + 1 : 1;
            rec.bestStreak = Math.max(rec.bestStreak || 0, rec.streak);
            rec.lastIndex = this.sessionIndex;
            this.dirty = true;
            credited.push(id);
        }
        return credited;
    }

    // ---- reads -----------------------------------------------------------

    recordFor(athleteId) {
        if (!this.seriesKey) {
            return null;
        }
        return (this.data.riders[this.seriesKey] || {})[String(athleteId)] || null;
    }

    // A lookup suitable for EventTracker's `historyLookup` — the display fields, or null if unknown.
    lookup() {
        return athleteId => {
            const rec = this.recordFor(athleteId);
            return rec ? {rides: rec.rides, streak: rec.streak, bestStreak: rec.bestStreak,
                welcomed: rec.welcomedAt != null} : null;
        };
    }

    /*
     * The single milestone worth announcing for a rider: the HIGHEST ladder value they have reached
     * and not yet been celebrated for. Derived from the count rather than queued, which makes it
     * sticky (a milestone reached on a week nobody pressed the button is still pending next week) and
     * self-healing (a rider imported at 120 rides gets one message, not three).
     */
    _pendingMilestone(rec) {
        if (!rec || !rec.rides) {
            return null;
        }
        const done = new Set(rec.milestonesDone || []);
        let best = null;
        for (const m of this.milestones) {
            if (m <= rec.rides && !done.has(m)) {
                best = m;
            }
        }
        return best;
    }

    /*
     * What the leader could say right now, as buckets — one bucket is one chat message.
     * `welcome` is everyone present long enough who has never been welcomed to THIS series, whatever
     * their ride count (so a rider missed on earlier weeks is still caught). `milestones` groups the
     * riders present by the milestone they are due, so a cohort that started together produces one
     * message per milestone value instead of one per rider.
     */
    pending(nowMs) {
        const welcome = [];
        const byValue = new Map();
        if (!this.seriesKey) {
            return {welcome, milestones: [], seriesKey: null};
        }
        const riders = this.data.riders[this.seriesKey] || {};
        for (const [id, s] of this.seen) {
            if (nowMs != null && (nowMs - s.firstSeenMs) < this.presenceMs) {
                continue;
            }
            const rec = riders[id];
            if (!rec) {
                continue;                       // not credited yet (presence threshold)
            }
            const who = {athleteId: id, name: rec.name || s.name || `#${id}`,
                rides: rec.rides, streak: rec.streak};
            if (rec.welcomedAt == null) {
                welcome.push(who);
            }
            const m = this._pendingMilestone(rec);
            if (m != null) {
                if (!byValue.has(m)) {
                    byValue.set(m, []);
                }
                byValue.get(m).push(who);
            }
        }
        const cmp = (a, b) => String(a.name).localeCompare(String(b.name));
        welcome.sort(cmp);
        const milestones = Array.from(byValue.entries())
            .sort((a, b) => b[0] - a[0])                    // biggest achievement first
            .map(([value, riders_]) => ({value, riders: riders_.sort(cmp)}));
        return {welcome, milestones, seriesKey: this.seriesKey};
    }

    // ---- marking ---------------------------------------------------------

    markWelcomed(athleteIds, nowMs) {
        return this._mark(athleteIds, rec => {
            if (rec.welcomedAt == null) {
                rec.welcomedAt = nowMs;
                return true;
            }
            return false;
        });
    }

    markMilestoneAnnounced(value, athleteIds) {
        return this._mark(athleteIds, rec => {
            const done = new Set(rec.milestonesDone || []);
            if (done.has(value)) {
                return false;
            }
            done.add(value);
            rec.milestonesDone = Array.from(done).sort((a, b) => a - b);
            return true;
        });
    }

    /*
     * Day one: everyone here has been riding with you for years, so mark them known WITHOUT saying
     * anything. Same mechanism as a welcome (an un-welcomed rider is what "new" means), plus a
     * `seeded` flag so the UI can be honest that their ride count starts from now.
     */
    seedKnown(athleteIds, nowMs) {
        const ids = athleteIds && athleteIds.length ? athleteIds : Array.from(this.seen.keys());
        if (!this.seriesKey) {
            return 0;
        }
        const riders = this.data.riders[this.seriesKey] = this.data.riders[this.seriesKey] || {};
        let n = 0;
        for (const rawId of ids) {
            const id = String(rawId);
            let rec = riders[id];
            if (!rec) {
                const s = this.seen.get(id);
                rec = riders[id] = newRider(s ? s.name : '', nowMs);
            }
            if (rec.welcomedAt == null) {
                rec.welcomedAt = nowMs;
                rec.seeded = true;
                n++;
            }
        }
        if (n) {
            this.dirty = true;
        }
        return n;
    }

    _mark(athleteIds, fn) {
        if (!this.seriesKey) {
            return 0;
        }
        const riders = this.data.riders[this.seriesKey] || {};
        let n = 0;
        for (const rawId of athleteIds || []) {
            const rec = riders[String(rawId)];
            if (rec && fn(rec)) {
                n++;
            }
        }
        if (n) {
            this.dirty = true;
        }
        return n;
    }

    // ---- backup ----------------------------------------------------------

    exportJSON() {
        return JSON.stringify(this.data, null, 1);
    }

    /*
     * Replace the history from a previously exported blob. Rejects anything that isn't a store of
     * this version rather than half-importing it. Any ladder value strictly below a rider's count is
     * marked done on the way in, so a hand-edited file that gives someone 120 rides doesn't celebrate
     * the 10 and 50 they passed before you started counting (an exact landing still counts).
     */
    importJSON(text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch(e) {
            throw new Error('Not valid JSON');
        }
        if (!parsed || typeof parsed !== 'object' || parsed.version !== STORE_VERSION) {
            throw new Error(`Not a rider-history file (version ${STORE_VERSION})`);
        }
        this.data = {...emptyData(), ...parsed};
        this.data.aliases = this.data.aliases || {};
        this.data.series = this.data.series || {};
        this.data.riders = this.data.riders || {};
        for (const riders of Object.values(this.data.riders)) {
            for (const rec of Object.values(riders || {})) {
                rec.rides = Number(rec.rides) || 0;
                rec.milestonesDone = Array.from(new Set([...(rec.milestonesDone || []),
                    ...this.milestones.filter(m => m < rec.rides)])).sort((a, b) => a - b);
            }
        }
        this.seriesKey = null;
        this.sessionIndex = null;
        this.seen.clear();
        this.dirty = true;
        return this.listSeries();
    }
}
