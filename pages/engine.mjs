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
 * Ride Leader Games — game engine (framework-agnostic, no DOM).
 *
 * The engine is game-agnostic: it owns the timer, per-rider accumulation, carry-forward for riders
 * that drop out of the `nearby` list, diagnostics, and export. WHAT gets scored is supplied by a
 * pluggable game definition (see games.mjs) via `config.game` — it reads a value off each `nearby`
 * entry, turns it into a per-tick score, optionally gates the rider (e.g. must be within Nm of the
 * target), and decides ranking direction + formatting. The engine reduces each rider's per-tick
 * scores per the game's `aggregate` mode:
 *
 *   - avg   (default): mean score over the game — e.g. leader-distance, average power/cadence/torque.
 *   - max:             best single score — e.g. peak power/cadence/torque.
 *   - delta:           lastReading − firstReading — e.g. ride-ons received during the game.
 *
 * The winner is the rider with the best aggregate value (best = lowest or highest per the game's
 * `higherIsBetter`).
 */

import {LEADER_DISTANCE_GAME} from './games.mjs';

export const SEND_MODES = {SILENT: 'silent', REVIEW: 'review', AUTO: 'auto'};
export const STATES = {IDLE: 'idle', RUNNING: 'running', FINISHED: 'finished'};

export const DEFAULT_CONFIG = {
    game: LEADER_DISTANCE_GAME, // active game definition (scoring/ranking/formatting/messages)
    durationMin: 20,          // game length in minutes
    leaderId: null,           // configured ride-leader athleteId, or null => use watched rider
    minSamples: 5,            // scoring samples required to qualify for the final ranking
    anomalyThresholdM: 150,   // per-tick reading jump that flags a possible data anomaly (e.g. a rider re-appearing far away after dropping out of the list at an intersection); used by games that opt in (leader-distance)
    maxRiders: 100,           // Sauce nearby cap; used to detect list saturation
    chatPrefix: '\u{1F3C1}',  // 🏁
};

// Bounds so a long session can't grow memory without limit.
const MAX_DIAG = 5000;
const MAX_RAW = 20000;


export class RideLeaderGame {

    constructor({config, onDiag} = {}) {
        this.config = {...DEFAULT_CONFIG, ...(config || {})};
        this.onDiag = onDiag || (() => undefined);
        this.reset();
    }

    reset() {
        this.state = STATES.IDLE;
        this.athletes = new Map();   // athleteId -> {athleteId, name, sum, count, lastReading, lastSeenTick, carriedTicks}
        this.diagnostics = [];       // rolling diagnostic event log
        this.rawSamples = [];        // per-tick compact rows for export
        this.tick = 0;
        this.startTime = null;       // epoch ms
        this.endTime = null;         // epoch ms (planned)
        this.finishedAt = null;      // epoch ms (actual)
        this.leaderVisible = null;   // last-known leader visibility (null until first running tick)
        this.saturated = false;      // last tick hit the rider cap
    }

    setConfig(patch) {
        this.config = {...this.config, ...patch};
    }

    // The active game definition (falls back to the default so a bare config still works).
    _game() {
        return this.config.game || LEADER_DISTANCE_GAME;
    }

    start(nowMs) {
        this.reset();
        this.state = STATES.RUNNING;
        this.startTime = nowMs;
        this.endTime = nowMs + this.config.durationMin * 60000;
        this._diag('game', {msg: 'started', durationMin: this.config.durationMin, leaderId: this.config.leaderId});
    }

    stop(nowMs) {
        if (this.state === STATES.RUNNING) {
            this.finish(nowMs, {manual: true});
        }
    }

    finish(nowMs, {manual = false} = {}) {
        this.state = STATES.FINISHED;
        this.finishedAt = nowMs;
        this._diag('game', {msg: manual ? 'stopped (manual)' : 'finished', tick: this.tick});
    }

    remainingMs(nowMs) {
        if (this.state !== STATES.RUNNING || this.endTime == null) {
            return this.state === STATES.FINISHED ? 0 : this.config.durationMin * 60000;
        }
        return Math.max(0, this.endTime - nowMs);
    }

    elapsedMs(nowMs) {
        if (this.startTime == null) {
            return 0;
        }
        const end = this.state === STATES.FINISHED ? this.finishedAt : nowMs;
        return Math.max(0, end - this.startTime);
    }

    /*
     * Feed one `nearby` snapshot. `entries` is the array from Common.subscribe('nearby').
     * Returns true if the tick contributed scoring samples, false if it was skipped.
     */
    ingest(entries, nowMs) {
        if (this.state !== STATES.RUNNING) {
            return false;
        }
        if (nowMs >= this.endTime) {
            this.finish(nowMs);
            return false;
        }
        this.tick++;
        const tick = this.tick;
        const game = this._game();

        this.saturated = entries.length >= this.config.maxRiders;
        if (this.saturated) {
            this._diag('list-saturated', {tick, riders: entries.length, cap: this.config.maxRiders});
        }

        // Resolve the scoring reference. Games that score relative to the ride leader
        // (needsReference) require the leader in this tick's list; if a configured leader is absent
        // we skip scoring this tick rather than corrupt averages. The reference quantity is always
        // gapDistance: `offset` is the leader's gapDistance, so the per-rider `relGap` (rider −
        // leader, in metres) is what the leader-distance game scores AND what proximity games gate
        // on (e.g. "within 30m of the target"). Games without a reference (e.g. cadence) score every
        // rider on their own value, so no leader gating and no exclusions.
        let offset = 0;
        let effectiveLeaderId = null;   // recorded on raw rows for context
        let excludeId = null;           // rider excluded from scoring (the reference), or none
        if (game.needsReference) {
            const leaderId = this.config.leaderId;
            if (leaderId != null) {
                const leaderEntry = entries.find(e => e.athleteId === leaderId);
                if (!leaderEntry || !Number.isFinite(leaderEntry.gapDistance)) {
                    if (this.leaderVisible !== false) {
                        this._diag('leader-not-visible', {tick, leaderId});
                    }
                    this.leaderVisible = false;
                    return false;
                }
                this.leaderVisible = true;
                offset = leaderEntry.gapDistance;
                effectiveLeaderId = leaderId;
            } else {
                // Reference = watched rider (gapDistance is already relative to them, ≈ 0).
                const watched = entries.find(e => e.watching);
                offset = watched && Number.isFinite(watched.gapDistance) ? watched.gapDistance : 0;
                effectiveLeaderId = watched ? watched.athleteId : null;
            }
            excludeId = effectiveLeaderId;
        } else {
            const watched = entries.find(e => e.watching);
            effectiveLeaderId = watched ? watched.athleteId : null;   // context only; still scored
            this.leaderVisible = null;
        }

        const anomalyThreshold = game.anomalyThreshold ? game.anomalyThreshold(this.config) : null;
        const present = new Set();
        const rawRow = {tick, t: nowMs, leaderId: effectiveLeaderId, offset, saturated: this.saturated, riders: []};

        // Score every rider present this tick (except the reference rider, when there is one). ctx is
        // per-rider because relGap (distance from the leader) differs per rider; proximity games use
        // it to decide whether the rider counts this tick (game.gate).
        for (const e of entries) {
            const reading = game.read(e);
            if (!Number.isFinite(reading) || e.athleteId === excludeId) {
                continue;
            }
            const relGap = game.needsReference && Number.isFinite(e.gapDistance) ? e.gapDistance - offset : 0;
            const ctx = {offset, relGap};
            if (game.gate && !game.gate(e, ctx)) {
                continue;   // e.g. rider outside the proximity window this tick — neither helps nor hurts
            }
            present.add(e.athleteId);
            const score = game.score(reading, ctx);
            const rec = this._record(e.athleteId, e);

            if (anomalyThreshold != null && rec.lastReading != null) {
                const jump = Math.abs(reading - rec.lastReading);
                if (jump > anomalyThreshold) {
                    this._diag('anomaly', {
                        tick, athleteId: e.athleteId, name: rec.name,
                        jumpM: Math.round(jump), fromM: Math.round(rec.lastReading),
                        toM: Math.round(reading),
                    });
                }
            }

            rec.name = nameOf(e) || rec.name;
            if (rec.firstReading == null) {
                rec.firstReading = reading;
            }
            rec.lastReading = reading;
            rec.lastSeenTick = tick;
            rec.carriedTicks = 0;
            rec.sum += score;
            rec.count++;
            rec.maxScore = Math.max(rec.maxScore, score);
            rawRow.riders.push({id: e.athleteId, reading: round1(reading), score: round1(score), carried: false});
        }

        // Carry-forward: riders we were tracking that dropped out of this tick's list keep
        // scoring against their last known reading. Riders drop out at intersections (the far side
        // of the intersection isn't listed) or when the list saturates at the cap; this is interim
        // behavior until we know how we want to handle those gaps. Only games that opt in
        // (game.carryForward — the averaging games) do this; max/delta/proximity games leave a
        // vanished rider frozen (carrying forward would inflate their sample count without new data).
        if (game.carryForward) {
            const ctx = {offset, relGap: 0};   // leader-distance carry uses offset; relGap unused here
            for (const rec of this.athletes.values()) {
                if (present.has(rec.athleteId) || rec.athleteId === excludeId || rec.lastReading == null) {
                    continue;
                }
                const score = game.score(rec.lastReading, ctx);
                rec.carriedTicks++;
                rec.sum += score;
                rec.count++;
                rec.maxScore = Math.max(rec.maxScore, score);
                this._diag('carry-forward', {
                    tick, athleteId: rec.athleteId, name: rec.name,
                    carriedTicks: rec.carriedTicks, heldM: round1(rec.lastReading),
                });
                rawRow.riders.push({id: rec.athleteId, reading: round1(rec.lastReading), score: round1(score), carried: true});
            }
        }

        this._pushRaw(rawRow);
        return true;
    }

    _record(athleteId, entry) {
        let rec = this.athletes.get(athleteId);
        if (!rec) {
            rec = {
                athleteId,
                name: entry ? nameOf(entry) : String(athleteId),
                // avg: sum/count. max: maxScore. delta: lastReading - firstReading.
                sum: 0, count: 0, maxScore: -Infinity, firstReading: null,
                lastReading: null, lastSeenTick: null, carriedTicks: 0,
            };
            this.athletes.set(athleteId, rec);
        }
        return rec;
    }

    /*
     * Current ranking, best first. The ranked value per rider depends on the game's aggregate mode:
     *   avg   -> sum / count            (leader-distance, average power/cadence/torque)
     *   max   -> best single score      (peak power/cadence/torque)
     *   delta -> lastReading - first    (ride-ons received during the game)
     * The value is returned as `avg` regardless of mode (it's "the ranked value") so the control
     * window and message templates need no per-mode branching — they format it via the game.
     */
    standings() {
        const game = this._game();
        const higher = game.higherIsBetter;
        const agg = game.aggregate || 'avg';
        const rows = [];
        for (const rec of this.athletes.values()) {
            if (rec.count <= 0) {
                continue;
            }
            let value;
            if (agg === 'max') {
                value = rec.maxScore;
            } else if (agg === 'delta') {
                value = (rec.lastReading != null && rec.firstReading != null)
                    ? rec.lastReading - rec.firstReading : 0;
            } else {
                value = rec.sum / rec.count;
            }
            rows.push({
                athleteId: rec.athleteId,
                name: rec.name,
                avg: value,
                samples: rec.count,
                carriedTicks: rec.carriedTicks,
                qualified: rec.count >= this.config.minSamples,
            });
        }
        rows.sort((a, b) => higher ? b.avg - a.avg : a.avg - b.avg);
        return rows;
    }

    qualifiedStandings() {
        return this.standings().filter(r => r.qualified);
    }

    // ---- message generation (pure strings; the send pipeline lives in the control window) ----

    startMessage() {
        return this._prefix() + this._game().messages.start(this.config.durationMin);
    }

    standingsMessage(nowMs, topN = 3) {
        const game = this._game();
        const rows = this.qualifiedStandings().slice(0, topN);
        if (!rows.length) {
            return null;
        }
        const parts = rows.map((r, i) => game.messages.rankEntry(i + 1, shortName(r.name), game.format(r.avg)));
        return this._prefix() + game.messages.standings(fmtClock(this.remainingMs(nowMs)), parts);
    }

    winnerMessage(topN = 5) {
        const game = this._game();
        const rows = this.qualifiedStandings().slice(0, topN);
        if (!rows.length) {
            return this._prefix() + game.messages.noQualifiers(this.config.minSamples);
        }
        const win = rows[0];
        const rest = rows.slice(1).map((r, i) => game.messages.rankEntry(i + 2, shortName(r.name), game.format(r.avg)));
        return this._prefix() + game.messages.winner(shortName(win.name), game.format(win.avg), rest);
    }

    // Chat prefix + trailing space (empty when no prefix configured).
    _prefix() {
        return this.config.chatPrefix ? this.config.chatPrefix + ' ' : '';
    }

    // ---- diagnostics + export ----

    _diag(type, data) {
        const ev = {type, ...data, at: this.tick};
        this.diagnostics.push(ev);
        if (this.diagnostics.length > MAX_DIAG) {
            this.diagnostics.splice(0, this.diagnostics.length - MAX_DIAG);
        }
        try {
            this.onDiag(ev);
        } catch (e) { /* never let a listener break ingest */ }
    }

    _pushRaw(row) {
        this.rawSamples.push(row);
        if (this.rawSamples.length > MAX_RAW) {
            this.rawSamples.splice(0, this.rawSamples.length - MAX_RAW);
        }
    }

    exportJSON(nowMs) {
        return {
            meta: {
                mod: 'ride-leader-games',
                exportedAt: nowMs,
                state: this.state,
                startTime: this.startTime,
                endTime: this.endTime,
                finishedAt: this.finishedAt,
                ticks: this.tick,
                config: this.config,
            },
            standings: this.standings(),
            diagnostics: this.diagnostics,
            rawSamples: this.rawSamples,
        };
    }

    /* Flat per-rider-per-tick CSV for spreadsheet analysis of intersection behavior. The `reading`
     * column is the game's raw per-rider value this tick (gapDistance for leader-distance, RPM for
     * cadence); `score` is what that reading contributed to the average. */
    exportCSV() {
        const lines = ['tick,time,leaderId,offset,saturated,athleteId,reading,score,carried'];
        for (const row of this.rawSamples) {
            for (const r of row.riders) {
                lines.push([
                    row.tick, row.t, row.leaderId ?? '', row.offset,
                    row.saturated ? 1 : 0, r.id, r.reading, r.score, r.carried ? 1 : 0,
                ].join(','));
            }
        }
        return lines.join('\n');
    }
}


// ---- helpers ----

function nameOf(entry) {
    const a = entry && entry.athlete;
    if (!a) {
        return null;
    }
    return a.sanitizedFullname || a.fullname || [a.firstName, a.lastName].filter(Boolean).join(' ') || null;
}

function shortName(name) {
    return name || 'Rider';
}

// mm:ss, matching the control window's on-screen clock. Clamped at 0.
function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function round1(x) {
    return Math.round(x * 10) / 10;
}


/*
 * Split a free-form instructions blob into distinct messages on blank lines. Each returned block
 * is one logical message (the send pipeline then chunk-splits it to the configured max length and
 * paces the chunks with the send delay). Blank-line separation lets the leader control message
 * boundaries beyond the automatic length-based chunking. Returns [] for empty/whitespace input.
 */
export function instructionMessages(text) {
    return String(text == null ? '' : text)
        .split(/\r?\n\s*\r?\n/)
        .map(s => s.replace(/\s+$/g, '').replace(/^\s+/g, ''))
        .filter(Boolean);
}


/*
 * Split a message into chunks no longer than maxLen, on word boundaries, appending
 * " (i/n)" markers when more than one chunk is produced. Kept here so it's testable and
 * shared, though the throttled send queue itself lives in the control window.
 */
export function chunkMessage(text, maxLen) {
    text = String(text == null ? '' : text).trim();
    if (!text) {
        return [];
    }
    if (text.length <= maxLen) {
        return [text];
    }
    // Reserve room for a marker like " (9/9)". Assume <=99 parts.
    const markerReserve = 8;
    const budget = Math.max(8, maxLen - markerReserve);
    const words = text.split(/\s+/);
    const chunks = [];
    let cur = '';
    for (const w of words) {
        if (!cur.length) {
            cur = w;
        } else if ((cur.length + 1 + w.length) <= budget) {
            cur += ' ' + w;
        } else {
            chunks.push(cur);
            cur = w;
        }
        // A single word longer than the budget: hard-split it.
        while (cur.length > budget) {
            chunks.push(cur.slice(0, budget));
            cur = cur.slice(budget);
        }
    }
    if (cur.length) {
        chunks.push(cur);
    }
    if (chunks.length <= 1) {
        return chunks;
    }
    const n = chunks.length;
    return chunks.map((c, i) => `${c} (${i + 1}/${n})`);
}
