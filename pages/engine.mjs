/*
 * Ride Leader Games — game engine (framework-agnostic, no DOM).
 *
 * Scoring: each rider's score is their road distance from the ride leader, derived from
 * Sauce's `nearby` gapDistance (which is relative to the *watched* rider) by subtracting the
 * leader's own gapDistance as an offset:
 *
 *     score_i = | gapDistance_i - gapDistance_leader |
 *
 * The winner is the rider with the lowest AVERAGE score over the game duration.
 */

import {MESSAGES} from './messages.mjs';

export const SEND_MODES = {SILENT: 'silent', REVIEW: 'review', AUTO: 'auto'};
export const STATES = {IDLE: 'idle', RUNNING: 'running', FINISHED: 'finished'};

export const DEFAULT_CONFIG = {
    durationMin: 20,          // game length in minutes
    leaderId: null,           // configured ride-leader athleteId, or null => use watched rider
    minSamples: 5,            // scoring samples required to qualify for the final ranking
    anomalyThresholdM: 150,   // per-tick |gapDistance| jump that flags a possible intersection anomaly
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
        this.athletes = new Map();   // athleteId -> {athleteId, name, sum, count, lastGapDistance, lastSeenTick, carriedTicks}
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

        this.saturated = entries.length >= this.config.maxRiders;
        if (this.saturated) {
            this._diag('list-saturated', {tick, riders: entries.length, cap: this.config.maxRiders});
        }

        // Resolve the scoring reference (offset). With a configured leader we must find them in
        // this tick's list; if absent, skip scoring this tick rather than corrupt averages.
        const leaderId = this.config.leaderId;
        let offset = 0;
        let effectiveLeaderId = null;
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
            // Reference = watched rider (gapDistance is already relative to them, so offset 0).
            const watched = entries.find(e => e.watching);
            effectiveLeaderId = watched ? watched.athleteId : null;
        }

        const present = new Set();
        const rawRow = {tick, t: nowMs, leaderId: effectiveLeaderId, offset, saturated: this.saturated, riders: []};

        // Score every rider present this tick (except the leader themselves).
        for (const e of entries) {
            if (!Number.isFinite(e.gapDistance) || e.athleteId === effectiveLeaderId) {
                continue;
            }
            present.add(e.athleteId);
            const score = Math.abs(e.gapDistance - offset);
            const rec = this._record(e.athleteId, e);

            if (rec.lastGapDistance != null) {
                const jump = Math.abs(e.gapDistance - rec.lastGapDistance);
                if (jump > this.config.anomalyThresholdM) {
                    this._diag('anomaly', {
                        tick, athleteId: e.athleteId, name: rec.name,
                        jumpM: Math.round(jump), fromM: Math.round(rec.lastGapDistance),
                        toM: Math.round(e.gapDistance),
                    });
                }
            }

            rec.name = nameOf(e) || rec.name;
            rec.lastGapDistance = e.gapDistance;
            rec.lastSeenTick = tick;
            rec.carriedTicks = 0;
            rec.sum += score;
            rec.count++;
            rawRow.riders.push({id: e.athleteId, gapDistance: round1(e.gapDistance), score: round1(score), carried: false});
        }

        // Carry-forward: riders we were tracking that dropped out of this tick's list keep
        // scoring against their last known gap (interim behavior around intersections/cap).
        for (const rec of this.athletes.values()) {
            if (present.has(rec.athleteId) || rec.athleteId === effectiveLeaderId || rec.lastGapDistance == null) {
                continue;
            }
            const score = Math.abs(rec.lastGapDistance - offset);
            rec.carriedTicks++;
            rec.sum += score;
            rec.count++;
            this._diag('carry-forward', {
                tick, athleteId: rec.athleteId, name: rec.name,
                carriedTicks: rec.carriedTicks, heldM: round1(rec.lastGapDistance),
            });
            rawRow.riders.push({id: rec.athleteId, gapDistance: round1(rec.lastGapDistance), score: round1(score), carried: true});
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
                sum: 0, count: 0,
                lastGapDistance: null, lastSeenTick: null, carriedTicks: 0,
            };
            this.athletes.set(athleteId, rec);
        }
        return rec;
    }

    /* Current ranking, ascending by average distance. */
    standings() {
        const rows = [];
        for (const rec of this.athletes.values()) {
            if (rec.count > 0) {
                rows.push({
                    athleteId: rec.athleteId,
                    name: rec.name,
                    avg: rec.sum / rec.count,
                    samples: rec.count,
                    carriedTicks: rec.carriedTicks,
                    qualified: rec.count >= this.config.minSamples,
                });
            }
        }
        rows.sort((a, b) => a.avg - b.avg);
        return rows;
    }

    qualifiedStandings() {
        return this.standings().filter(r => r.qualified);
    }

    // ---- message generation (pure strings; the send pipeline lives in the control window) ----

    startMessage() {
        return this._prefix() + MESSAGES.start(this.config.durationMin);
    }

    standingsMessage(nowMs, topN = 3) {
        const rows = this.qualifiedStandings().slice(0, topN);
        if (!rows.length) {
            return null;
        }
        const parts = rows.map((r, i) => MESSAGES.rankEntry(i + 1, shortName(r.name), fmtM(r.avg)));
        return this._prefix() + MESSAGES.standings(fmtClock(this.remainingMs(nowMs)), parts);
    }

    winnerMessage(topN = 5) {
        const rows = this.qualifiedStandings().slice(0, topN);
        if (!rows.length) {
            return this._prefix() + MESSAGES.noQualifiers(this.config.minSamples);
        }
        const win = rows[0];
        const rest = rows.slice(1).map((r, i) => MESSAGES.rankEntry(i + 2, shortName(r.name), fmtM(r.avg)));
        return this._prefix() + MESSAGES.winner(shortName(win.name), fmtM(win.avg), rest);
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

    /* Flat per-rider-per-tick CSV for spreadsheet analysis of intersection behavior. */
    exportCSV() {
        const lines = ['tick,time,leaderId,offset,saturated,athleteId,gapDistance,score,carried'];
        for (const row of this.rawSamples) {
            for (const r of row.riders) {
                lines.push([
                    row.tick, row.t, row.leaderId ?? '', row.offset,
                    row.saturated ? 1 : 0, r.id, r.gapDistance, r.score, r.carried ? 1 : 0,
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

function fmtM(meters) {
    return `${meters.toFixed(2)}m`;
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
