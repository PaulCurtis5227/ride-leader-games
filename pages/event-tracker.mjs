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
 * Ride Leader Games — event-long tracker (framework-agnostic, no DOM).
 *
 * Separate from the game engine (which scores a timed *round*), this accumulates every rider's
 * metrics continuously from the start of the ride/event, independent of game Start/Stop. It powers
 * two things in the control window:
 *   - the "value since the start of the event" metric viewer (pick a metric, see its live standings)
 *   - the whole-ride aggregate totals (miles, pedal strokes, ride-ons, calories across all riders)
 *
 * It ingests the same `nearby` snapshots as the engine, every tick. `reset()` starts a fresh event
 * (e.g. when a new Zwift event begins). Metrics that need a moving reference rider (leader-distance,
 * the proximity games) are intentionally not offered here — they're round-scoped by nature — so the
 * viewer lists the self-contained metrics only.
 */

import {
    readPower, readCadence, readTorque, readRideons, readDistance, readKj, KJ_PER_KCAL,
} from './metrics.mjs';

const METERS_PER_MILE = 1609.344;

// A rider that vanished (intersection / list cap) leaves a stale lastTs; cap the integration step so
// their reappearance can't dump a huge chunk of pedal strokes in one tick.
const MAX_STEP_MS = 3000;

function nameOf(entry) {
    const a = entry && entry.athlete;
    return (a && (a.sanitizedFullname || a.fullname)) || `#${entry && entry.athleteId}`;
}

// avg helper: mean of the accumulated sum, or null when never sampled.
function mean(sum, count) {
    return count > 0 ? sum / count : null;
}

// max helper: the tracked peak, or null when never sampled.
function peak(max) {
    return max === -Infinity ? null : max;
}

// delta helper: last − first cumulative reading, or 0 when never sampled.
function delta(first, last) {
    return (first != null && last != null) ? last - first : 0;
}


/*
 * Selectable metrics for the event viewer. Each: {key, name, unit, higherIsBetter, value(rec),
 * format(v)}. `value` reads a per-rider record and returns a Number in display units (or null to
 * omit the rider). Adding a future metric is a single entry here — no structural change.
 */
export const METRICS = [
    {key: 'avg-power', name: 'Average power', unit: 'W', higherIsBetter: true,
        value: r => mean(r.powSum, r.powCount), format: v => `${v.toFixed(2)}W`},
    {key: 'max-power', name: 'Max power', unit: 'W', higherIsBetter: true,
        value: r => peak(r.powMax), format: v => `${v.toFixed(2)}W`},
    {key: 'avg-cadence', name: 'Average cadence', unit: 'rpm', higherIsBetter: true,
        value: r => mean(r.cadSum, r.cadCount), format: v => `${v.toFixed(2)}rpm`},
    {key: 'max-cadence', name: 'Max cadence', unit: 'rpm', higherIsBetter: true,
        value: r => peak(r.cadMax), format: v => `${v.toFixed(2)}rpm`},
    {key: 'avg-torque', name: 'Average torque', unit: 'N·m', higherIsBetter: true,
        value: r => mean(r.trqSum, r.trqCount), format: v => `${v.toFixed(2)}N·m`},
    {key: 'max-torque', name: 'Max torque', unit: 'N·m', higherIsBetter: true,
        value: r => peak(r.trqMax), format: v => `${v.toFixed(2)}N·m`},
    {key: 'rideons', name: 'Ride-ons received', unit: 'ride-ons', higherIsBetter: true,
        value: r => delta(r.rideonFirst, r.rideonLast), format: v => `${v.toFixed(2)} ride-ons`},
    {key: 'distance', name: 'Distance ridden', unit: 'mi', higherIsBetter: true,
        value: r => delta(r.distFirst, r.distLast) / METERS_PER_MILE, format: v => `${v.toFixed(2)}mi`},
    {key: 'strokes', name: 'Pedal strokes', unit: 'strokes', higherIsBetter: true,
        value: r => r.strokes, format: v => `${v.toFixed(2)} strokes`},
    {key: 'calories', name: 'Calories burnt', unit: 'kcal', higherIsBetter: true,
        value: r => delta(r.kjFirst, r.kjLast) / KJ_PER_KCAL, format: v => `${v.toFixed(2)}kcal`},
];

export const DEFAULT_METRIC_KEY = METRICS[0].key;

const METRIC_BY_KEY = new Map(METRICS.map(m => [m.key, m]));

export function getMetric(key) {
    return METRIC_BY_KEY.get(key) || METRICS[0];
}


export class EventTracker {

    constructor() {
        this.reset();
    }

    reset(nowMs = null) {
        this.athletes = new Map();   // athleteId -> per-rider accumulators
        this.startTime = nowMs;
        this.ticks = 0;
    }

    elapsedMs(nowMs) {
        return this.startTime == null ? 0 : Math.max(0, nowMs - this.startTime);
    }

    _record(entry) {
        let rec = this.athletes.get(entry.athleteId);
        if (!rec) {
            rec = {
                athleteId: entry.athleteId,
                name: nameOf(entry),
                powSum: 0, powCount: 0, powMax: -Infinity,
                cadSum: 0, cadCount: 0, cadMax: -Infinity,
                trqSum: 0, trqCount: 0, trqMax: -Infinity,
                distFirst: null, distLast: null,
                kjFirst: null, kjLast: null,
                rideonFirst: null, rideonLast: null,
                strokes: 0,
                lastTs: null,
            };
            this.athletes.set(entry.athleteId, rec);
        }
        return rec;
    }

    // Feed one `nearby` snapshot. Called every tick regardless of game state.
    ingest(entries, nowMs) {
        if (!Array.isArray(entries) || !entries.length) {
            return;
        }
        if (this.startTime == null) {
            this.startTime = nowMs;
        }
        this.ticks++;
        for (const e of entries) {
            if (e == null || e.athleteId == null) {
                continue;
            }
            const rec = this._record(e);
            rec.name = nameOf(e) || rec.name;

            const p = readPower(e);
            if (p != null) {
                rec.powSum += p;
                rec.powCount++;
                rec.powMax = Math.max(rec.powMax, p);
            }
            const c = readCadence(e);
            if (c != null) {
                rec.cadSum += c;
                rec.cadCount++;
                rec.cadMax = Math.max(rec.cadMax, c);
                // Pedal strokes = revolutions = cadence(rpm) × elapsed minutes since the last tick.
                if (rec.lastTs != null) {
                    const stepMs = Math.min(MAX_STEP_MS, Math.max(0, nowMs - rec.lastTs));
                    rec.strokes += c * (stepMs / 60000);
                }
            }
            const t = readTorque(e);
            if (t != null) {
                rec.trqSum += t;
                rec.trqCount++;
                rec.trqMax = Math.max(rec.trqMax, t);
            }
            const d = readDistance(e);
            if (d != null) {
                if (rec.distFirst == null) {
                    rec.distFirst = d;
                }
                rec.distLast = d;
            }
            const kj = readKj(e);
            if (kj != null) {
                if (rec.kjFirst == null) {
                    rec.kjFirst = kj;
                }
                rec.kjLast = kj;
            }
            const ro = readRideons(e);
            if (ro != null) {
                if (rec.rideonFirst == null) {
                    rec.rideonFirst = ro;
                }
                rec.rideonLast = ro;
            }
            rec.lastTs = nowMs;
        }
    }

    // Ranked standings for one metric since event start, best first.
    standings(metricKey) {
        const metric = getMetric(metricKey);
        const rows = [];
        for (const rec of this.athletes.values()) {
            const value = metric.value(rec);
            if (value == null || !Number.isFinite(value)) {
                continue;
            }
            rows.push({athleteId: rec.athleteId, name: rec.name, value});
        }
        rows.sort((a, b) => metric.higherIsBetter ? b.value - a.value : a.value - b.value);
        return rows;
    }

    // Whole-ride aggregate totals across every tracked rider.
    rideTotals() {
        let meters = 0, strokes = 0, rideOns = 0, kj = 0;
        for (const rec of this.athletes.values()) {
            meters += delta(rec.distFirst, rec.distLast);
            strokes += rec.strokes;
            rideOns += delta(rec.rideonFirst, rec.rideonLast);
            kj += delta(rec.kjFirst, rec.kjLast);
        }
        return {
            riders: this.athletes.size,
            miles: meters / METERS_PER_MILE,
            strokes,
            rideOns,
            calories: kj / KJ_PER_KCAL,
        };
    }
}
