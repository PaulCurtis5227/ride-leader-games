/*
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
 * FILE FORMAT (NDJSON): first line is a meta header, then one event per line:
 *   {"__s4zstream":1,"createdAt":<ms>,"events":[...],"raw":true,"note":"..."}
 *   {"t":<epochMs>,"e":"nearby","d":<payload>}
 * ---------------------------------------------------------------------------
 */

export const CONTRACT_LEVEL = 2;
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
