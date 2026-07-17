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
 * s4z-streams.mjs — a drop-in Sauce-for-Zwift stream service (record + replay + live).
 * ============================================================================
 * COPY THIS FILE into your own mod. It is a zero-dependency polyfill/adapter.
 *
 * The intent is that Sauce (or a newer copy loaded by another mod) may one day provide this
 * service natively. So instead of being a plain library, this file:
 *
 *   1. Defines a small, frozen CONTRACT (see below) at a capability `level`.
 *   2. Prefers a NATIVE implementation if one is already present (`Common.streams`).
 *   3. Otherwise installs a single shared FALLBACK on `globalThis` (first-writer-wins), so
 *      that N mods embedding this file collapse to ONE shared service in the window.
 *
 * The day a native implementation ships, every mod carrying this file transparently starts
 * using it — no consumer code changes. Authors may then delete their copy at leisure.
 *
 * Consumer usage (never changes across the native migration):
 *
 *     import {getSauceStreams} from './s4z-streams.mjs';
 *     const streams = getSauceStreams(Common);
 *     const unsub = streams.subscribe('nearby', onNearby);   // live today, native tomorrow
 *     // dev-time replay of a recorded ride:
 *     streams.loadReplay(ndjsonText, {speed: 4, autoplay: true});
 *
 * Recording (used by the recorder mod; available to anyone):
 *
 *     const rec = streams.record({events: ['nearby'], raw: true});
 *     // ...later...
 *     rec.stop();
 *     const ndjson = rec.toNDJSON();
 *
 * ---------------------------------------------------------------------------
 * CONTRACT — append-only; never change/remove once shipped:
 *
 * level 1:
 *   service.level                       -> number   (capability level)
 *   service.source                      -> 'native' | 'polyfill'
 *   service.mode                        -> 'live' | 'replay'
 *   service.subscribe(event, cb, opts?) -> unsubscribe()   (raw Sauce payloads, unmodified)
 *   service.useLive()
 *   service.loadReplay(ndjsonOrRecords, {speed=1, autoplay=false}) -> {events, count, durationMs}
 *   service.play() / pause() / stop() / seek(ms) / setSpeed(x)
 *   service.getReplayState() -> {mode, playing, positionMs, durationMs, speed, index, total}
 *   service.on(evt, cb) / off(evt, cb)   evts: 'mode' | 'replay-progress' | 'replay-end'
 *   service.record({events, raw=true})  -> Recorder
 *   Recorder: .stop() .toNDJSON() .toRecords() .stats {count,bytes,byEvent,startedAt,durationMs} .recording
 *
 * level 2 (added):
 *   service.now() -> epoch ms clock. Use this instead of Date.now() for anything on the
 *                    replayed timeline. Live: real Date.now(). Replay (default): the recording
 *                    is *rebased to now* — the current replay position mapped onto the wall clock
 *                    at load, so recorded events read as happening ~now. Opt into the original
 *                    recorded wall-clock with loadReplay(..., {absoluteTime: true}).
 *   service.loadReplay(..., {absoluteTime=false})  — preserve original recorded timestamps in now().
 *   service.getReplayState() also returns {absoluteTime}.
 *
 * level 3 (added):
 *   Synchronous stepping drivers — advance the replay WITHOUT waiting for wall-clock time.
 *   Records are dispatched synchronously and now() advances with `index` (no timers), so consumers
 *   that read now() see the stream time jump forward. Each driver pauses the auto-player (play())
 *   first — manual stepping takes over. Intended for instant headless tests, "jump to next segment"
 *   replay UIs, and fast demos.
 *   service.step(n=1)            -> dispatch next n records now; returns getReplayState()
 *   service.advanceTo(ms)        -> dispatch records until replay position >= ms
 *   service.stepUntil(predicate) -> dispatch until predicate(nextRec, state) is true; the matching
 *                                   record is NOT dispatched (stop-before). Runs to end if never matched.
 *   service.runToEnd()           -> dispatch all remaining records now
 *   Recorder.mark(event, data?)  -> inject a custom record at the current moment (app-level
 *                                   annotations, e.g. an operator "start" instant) so it replays
 *                                   in place and dispatches to subscribers of `event`.
 *
 * FILE FORMAT (NDJSON): first line is a meta header, then one event per line:
 *   {"__s4zstream":1,"createdAt":<ms>,"events":[...],"raw":true,"note":"..."}
 *   {"t":<epochMs>,"e":"nearby","d":<payload>}
 * ---------------------------------------------------------------------------
 */

export const CONTRACT_LEVEL = 3;
export const STREAM_FILE_VERSION = 1;
const GLOBAL_KEY = '__s4zStreams';


export function getSauceStreams(Common) {
    // 1) Prefer a native (or otherwise newer) implementation.
    const native = Common && Common.streams;
    if (native && native.level >= CONTRACT_LEVEL) {
        return native;
    }
    // 2) Install / reuse a single shared fallback for this window.
    const g = globalThis;
    if (!g[GLOBAL_KEY] || g[GLOBAL_KEY].level < CONTRACT_LEVEL) {
        g[GLOBAL_KEY] = makeFallback(Common);
    }
    return g[GLOBAL_KEY];
}


function makeFallback(Common) {
    const listeners = new Map();     // event -> Set<cb>
    const liveForwarders = new Map();// event -> forwarder cb registered with Common
    const controlListeners = new Map(); // control evt -> Set<cb>

    let mode = 'live';
    let replay = null;               // {records, baseT, durationMs}
    let playing = false;
    let index = 0;
    let speed = 1;
    let timer = null;

    function emit(controlEvt, detail) {
        const set = controlListeners.get(controlEvt);
        if (set) {
            for (const cb of set) {
                try { cb(detail); } catch (e) { console.error('[s4z-streams] listener error', e); }
            }
        }
    }

    function dispatch(event, data) {
        const set = listeners.get(event);
        if (!set) {
            return;
        }
        for (const cb of set) {
            try { cb(data); } catch (e) { console.error('[s4z-streams] subscriber error', e); }
        }
    }

    function ensureLive(event, opts) {
        if (liveForwarders.has(event) || mode !== 'live') {
            return;
        }
        const fwd = data => dispatch(event, data);
        liveForwarders.set(event, {fwd, opts});
        Common.subscribe(event, fwd, opts || {});
    }

    function teardownLive(event) {
        const rec = liveForwarders.get(event);
        if (rec) {
            liveForwarders.delete(event);
            try { Common.unsubscribe(event, rec.fwd); } catch (e) { /* ignore */ }
        }
    }

    function teardownAllLive() {
        for (const event of [...liveForwarders.keys()]) {
            teardownLive(event);
        }
    }

    // Dispatch the record at `index` and advance (dispatch-then-increment, mirroring
    // scheduleNext so now() stays correct inside a subscriber callback). No timer/scheduling.
    // Emits 'replay-end' exactly once, on the step that advances past the last record.
    function stepOnce() {
        if (!replay) {
            return false;
        }
        const rec = replay.records[index];
        if (!rec) {
            return false;
        }
        dispatch(rec.e, rec.d);
        emit('replay-progress', {
            positionMs: rec.t - replay.baseT,
            durationMs: replay.durationMs,
            index, total: replay.records.length,
        });
        index++;
        if (index >= replay.records.length) {
            emit('replay-end', {index, total: replay.records.length});
        }
        return true;
    }

    function scheduleNext() {
        clearTimeout(timer);
        if (!playing || !replay) {
            return;
        }
        const rec = replay.records[index];
        if (!rec) {
            playing = false;
            emit('replay-end', {index, total: replay.records.length});
            return;
        }
        dispatch(rec.e, rec.d);
        emit('replay-progress', {
            positionMs: rec.t - replay.baseT,
            durationMs: replay.durationMs,
            index, total: replay.records.length,
        });
        index++;
        const next = replay.records[index];
        if (!next) {
            playing = false;
            emit('replay-end', {index, total: replay.records.length});
            return;
        }
        const delay = Math.max(0, (next.t - rec.t) / speed);
        timer = setTimeout(scheduleNext, delay);
    }

    const service = {
        level: CONTRACT_LEVEL,
        source: 'polyfill',

        get mode() { return mode; },

        // Canonical clock for the replayed timeline (epoch ms). See CONTRACT level 2.
        now() {
            if (mode !== 'replay' || !replay) {
                return Date.now();
            }
            const rec = replay.records[Math.min(index, replay.records.length - 1)];
            const positionMs = rec ? rec.t - replay.baseT : 0;
            return replay.originEpoch + positionMs;
        },

        subscribe(event, cb, opts) {
            let set = listeners.get(event);
            if (!set) {
                set = new Set();
                listeners.set(event, set);
            }
            set.add(cb);
            ensureLive(event, opts);
            return () => {
                const s = listeners.get(event);
                if (!s) {
                    return;
                }
                s.delete(cb);
                if (!s.size) {
                    listeners.delete(event);
                    teardownLive(event);
                }
            };
        },

        useLive() {
            if (mode === 'live') {
                return;
            }
            clearTimeout(timer);
            playing = false;
            replay = null;
            index = 0;
            mode = 'live';
            for (const event of listeners.keys()) {
                ensureLive(event);
            }
            emit('mode', {mode});
        },

        loadReplay(ndjsonOrRecords, {speed: sp = 1, autoplay = false, absoluteTime = false} = {}) {
            const records = parseRecording(ndjsonOrRecords);
            teardownAllLive();
            mode = 'replay';
            speed = sp > 0 ? sp : 1;
            index = 0;
            playing = false;
            const baseT = records.length ? records[0].t : 0;
            const durationMs = records.length ? records[records.length - 1].t - baseT : 0;
            // now() maps the current position (rec.t - baseT) onto originEpoch. Default rebases
            // the recording to "now" (originEpoch = load wall clock); absoluteTime keeps the
            // recording's own wall clock (originEpoch = baseT, so now() === rec.t).
            const originEpoch = absoluteTime ? baseT : Date.now();
            replay = {records, baseT, durationMs, originEpoch, absoluteTime};
            emit('mode', {mode});
            const events = [...new Set(records.map(r => r.e))];
            if (autoplay) {
                this.play();
            }
            return {events, count: records.length, durationMs};
        },

        play() {
            if (mode !== 'replay' || !replay || playing) {
                return;
            }
            playing = true;
            scheduleNext();
        },

        pause() {
            playing = false;
            clearTimeout(timer);
        },

        stop() {
            playing = false;
            clearTimeout(timer);
            index = 0;
        },

        seek(ms) {
            if (!replay) {
                return;
            }
            const target = replay.baseT + Math.max(0, ms);
            let i = replay.records.findIndex(r => r.t >= target);
            index = i === -1 ? replay.records.length : i;
        },

        setSpeed(x) {
            speed = x > 0 ? x : 1;
        },

        // --- CONTRACT level 3: synchronous stepping drivers ---------------------------------
        // Advance the replay without waiting for wall-clock time. Records dispatch synchronously
        // and now() jumps forward with the stream. All pause the auto-player first.
        step(n = 1) {
            if (mode !== 'replay' || !replay) {
                return this.getReplayState();
            }
            clearTimeout(timer);
            playing = false;
            for (let i = 0; i < n; i++) {
                if (!stepOnce()) {
                    break;
                }
            }
            return this.getReplayState();
        },

        advanceTo(ms) {
            if (mode !== 'replay' || !replay) {
                return this.getReplayState();
            }
            clearTimeout(timer);
            playing = false;
            const target = replay.baseT + Math.max(0, ms);
            while (replay.records[index] && replay.records[index].t <= target) {
                if (!stepOnce()) {
                    break;
                }
            }
            return this.getReplayState();
        },

        stepUntil(predicate) {
            if (mode !== 'replay' || !replay) {
                return this.getReplayState();
            }
            clearTimeout(timer);
            playing = false;
            while (replay.records[index]) {
                if (predicate(replay.records[index], this.getReplayState())) {
                    break;  // stop-before: matching record not dispatched
                }
                if (!stepOnce()) {
                    break;
                }
            }
            return this.getReplayState();
        },

        runToEnd() {
            if (mode !== 'replay' || !replay) {
                return this.getReplayState();
            }
            clearTimeout(timer);
            playing = false;
            while (stepOnce()) { /* dispatch all remaining */ }
            return this.getReplayState();
        },

        getReplayState() {
            const rec = replay && replay.records[Math.min(index, replay.records.length - 1)];
            return {
                mode, playing, speed,
                positionMs: rec && replay ? rec.t - replay.baseT : 0,
                durationMs: replay ? replay.durationMs : 0,
                absoluteTime: replay ? !!replay.absoluteTime : false,
                index, total: replay ? replay.records.length : 0,
            };
        },

        on(evt, cb) {
            let set = controlListeners.get(evt);
            if (!set) {
                set = new Set();
                controlListeners.set(evt, set);
            }
            set.add(cb);
        },

        off(evt, cb) {
            const set = controlListeners.get(evt);
            if (set) {
                set.delete(cb);
            }
        },

        record(opts) {
            return new Recorder(Common, opts);
        },
    };

    return service;
}


/*
 * Recorder — captures live Sauce events into an in-memory NDJSON buffer.
 * Independent of replay/live mode; always records the real (live) stream.
 */
export class Recorder {

    constructor(Common, {events = ['nearby'], raw = true, note = ''} = {}) {
        this._Common = Common;
        this._events = [...events];
        this._raw = raw;
        this._note = note;
        this._lines = [];
        this._byEvent = {};
        this._bytes = 0;
        this._subs = [];
        this.recording = true;
        this.startedAt = Date.now();

        for (const event of this._events) {
            this._byEvent[event] = 0;
            const cb = data => this._onEvent(event, data);
            // nearby/groups default source; game-connection events would pass their own opts upstream.
            Common.subscribe(event, cb);
            this._subs.push({event, cb});
        }
    }

    _onEvent(event, data) {
        if (!this.recording) {
            return;
        }
        this._append(event, data);
    }

    /*
     * mark(event, data) — inject a custom (non-stream) record into the recording at the current
     * moment. Use it to persist app-level annotations that must replay in the right place, e.g. the
     * instant an operator "started" a run. On replay these dispatch to subscribers of `event` just
     * like stream events, at their recorded position, so consumers can restore that state exactly.
     */
    mark(event, data = {}) {
        if (!this.recording) {
            return;
        }
        this._append(event, data);
    }

    _append(event, data) {
        const line = JSON.stringify({t: Date.now(), e: event, d: data});
        this._lines.push(line);
        this._bytes += line.length + 1;
        this._byEvent[event] = (this._byEvent[event] || 0) + 1;
    }

    stop() {
        if (!this.recording) {
            return;
        }
        this.recording = false;
        for (const {event, cb} of this._subs) {
            try { this._Common.unsubscribe(event, cb); } catch (e) { /* ignore */ }
        }
        this._subs = [];
    }

    get stats() {
        return {
            count: this._lines.length,
            bytes: this._bytes,
            byEvent: {...this._byEvent},
            startedAt: this.startedAt,
            durationMs: Date.now() - this.startedAt,
        };
    }

    _metaLine() {
        return JSON.stringify({
            __s4zstream: STREAM_FILE_VERSION,
            createdAt: this.startedAt,
            events: this._events,
            raw: this._raw,
            note: this._note,
        });
    }

    toNDJSON() {
        return [this._metaLine(), ...this._lines].join('\n') + '\n';
    }

    toRecords() {
        return this._lines.map(l => JSON.parse(l));
    }
}


/*
 * Parse a recording (NDJSON string, array of lines, or array of records) into event records.
 * Tolerates and skips the meta header line.
 */
export function parseRecording(input) {
    if (Array.isArray(input) && input.length && typeof input[0] === 'object') {
        return input.filter(r => r && r.e && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
    }
    const text = Array.isArray(input) ? input.join('\n') : String(input || '');
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        let obj;
        try {
            obj = JSON.parse(line);
        } catch (e) {
            continue;
        }
        if (obj.__s4zstream) {
            continue;  // meta header
        }
        if (obj.e && Number.isFinite(obj.t)) {
            out.push(obj);
        }
    }
    return out.sort((a, b) => a.t - b.t);
}
