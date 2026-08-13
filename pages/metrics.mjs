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
 * Ride Leader Games — shared per-rider metric readers (framework-agnostic, no DOM).
 *
 * One home for reading raw numbers off a Sauce `nearby` entry, so the game registry (games.mjs) and
 * the event-long tracker (event-tracker.mjs) share exactly the same readings — in particular a single
 * torque formula. Each reader takes a `nearby` entry and returns a finite Number, or null to skip the
 * rider this tick (missing sensor / not applicable). Fields verified against sauce4zwift/src/zwift.mjs
 * `processPlayerStateMessage`: state.power (W), state.cadence (rpm, 0 when coasting), state.speed,
 * state.distance (cumulative m), state.kj (cumulative kJ of work), rideons (cumulative count).
 *
 * One reader (readLevel) comes off the ATHLETE half of the entry rather than the state stream — see
 * its comment. Note there is no drops reader: Zwift drops are not exposed by Sauce at all (the only
 * mention in the host source is curRideStreakDrops/maxRideStreakDrops in zwift.proto, ride-streak
 * profile stats Sauce never decodes), so nothing here can score or total them.
 */

// Crank-arm length in metres. Torque itself does NOT depend on crank length; this is kept so the
// torque games can be switched to *pedal force* (N = torque / CRANK_ARM_M) if that's ever wanted.
export const CRANK_ARM_M = 0.1725;

// Work→energy: Zwift reports kJ of mechanical work. The widely-used approximation (human drivetrain
// efficiency ≈ 24%, and 1 kcal ≈ 4.184 kJ, which very nearly cancel) is 1 kJ work ≈ 1 kcal burned.
export const KJ_PER_KCAL = 1;

function state(entry) {
    return entry && entry.state;
}

function num(v) {
    return Number.isFinite(v) ? v : null;
}

export function readPower(entry) {
    const s = state(entry);
    return s ? num(s.power) : null;
}

// Cadence in rpm. 0 (coasting) is a valid reading and is returned as-is; callers decide whether to
// include it (the average-cadence game does; torque skips it to avoid divide-by-zero).
export function readCadence(entry) {
    const s = state(entry);
    return s ? num(s.cadence) : null;
}

export function readSpeed(entry) {
    const s = state(entry);
    return s ? num(s.speed) : null;
}

export function readDistance(entry) {
    const s = state(entry);
    return s ? num(s.distance) : null;
}

export function readKj(entry) {
    const s = state(entry);
    return s ? num(s.kj) : null;
}

// Cumulative ride-ons received (top 8 bits of the state flags in zwift.mjs decodePlayerStateFlags1).
export function readRideons(entry) {
    const s = state(entry);
    return s ? num(s.rideons) : null;
}

/*
 * Zwift level (whole levels). Unlike every other reader here this comes from the rider's PROFILE,
 * not the per-tick state stream: sauce4zwift/src/stats.mjs `_profileToAthlete` sets
 * `level = floor(achievementLevel / 100)` on the athlete record carried by each nearby entry. It
 * therefore only changes when Sauce refreshes that profile, so a level-up is observed some time
 * after it actually happens in game, and is `undefined` until the profile has been fetched at all.
 */
export function readLevel(entry) {
    const a = entry && entry.athlete;
    return a ? num(a.level) : null;
}

/*
 * Average crank torque in newton-metres: torque = power · 60 / (2π · cadence). Requires a real
 * cadence (> 0) — coasting or a missing cadence yields null (torque is undefined at 0 rpm). Note the
 * crank-arm length is intentionally not used: torque is force × radius integrated over the stroke,
 * and power/ω already gives it directly. CRANK_ARM_M is only needed to convert this to pedal force.
 */
export function readTorque(entry) {
    const p = readPower(entry);
    const c = readCadence(entry);
    if (p == null || c == null || c <= 0) {
        return null;
    }
    return (p * 60) / (2 * Math.PI * c);
}
