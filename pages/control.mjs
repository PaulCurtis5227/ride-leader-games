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
 * Ride Leader Games — Control window.
 * Owns the game engine, the leaderboard, all chat sending, and diagnostics.
 */
import * as Common from '/pages/src/common.mjs';
import {RideLeaderGame, SEND_MODES, STATES, chunkMessage, instructionMessages} from './engine.mjs';
import {GAMES, getGame, DEFAULT_GAME_KEY} from './games.mjs';
import {EventTracker, METRICS, getMetric, DEFAULT_METRIC_KEY, formatRideTotals} from './event-tracker.mjs';
import {EventRoster} from './event-roster.mjs';
import {announcementDefaults, announcementMessages, manualAnnouncementMessage,
    riderNameVars} from './announcements.mjs';
import {RiderHistory, keyForEvent, parseMilestones, MILESTONES} from './rider-history.mjs';
import {getSauceStreams} from './s4z-streams.mjs';
import {JokeDeck} from './jokedeck.mjs';
import {JOKES} from './jokes-data.mjs';

// Data source: live Sauce today, transparently native later. Also gives us dev-time replay.
const streams = getSauceStreams(Common);
let replayMode = false;

/*
 * Game-timeline clock. Delegates to the stream service so the game timeline is correct in both
 * live and replay. In replay the service rebases the recording to "now" by default (see
 * s4z-streams.mjs CONTRACT level 2), so this is just epoch ms either way — no special-casing.
 */
function clockNow() {
    return streams.now();
}

const settings = Common.settingsStore;
const SETTING_DEFAULTS = {
    gameKey: DEFAULT_GAME_KEY,
    duration: 20,
    sendMode: SEND_MODES.SILENT,
    chatPrefix: '\u{1F3C1}',
    maxMessageLength: 90,
    messageDelay: 4,
    minSamples: 5,
    anomalyThresholdM: 150,
    leaderId: null,
    sendInstructions: true,
    // instructions default is per-game (see activeInstructions()); an unset value falls back to the
    // selected game's defaultInstructions rather than a single static blob.
    startDelay: 15,          // seconds to wait after instructions before the start message/timer
    announceStart: true,
    announcePeriodic: false,
    announceIntervalSec: 120,
    announceWinner: true,
    resultsCount: 5,         // how many finishers to announce at the end
    showDiagnostics: true,
    fontScale: 1,            // UI font scale multiplier (see applyFontScale)
    answerDelay: 8,          // seconds between a joke's setup and its punchline
    jokePrefix: '\u{1F602}', // 😂 prepended to joke messages (empty to disable)
    eventMetric: DEFAULT_METRIC_KEY,   // which metric the "since event start" viewer shows
    eventRidersOnly: true,     // in an event, ignore riders who are not in it (see event-roster.mjs)
    // ---- rider history (see rider-history.mjs) ----
    milestoneLadder: MILESTONES.join(', '),
    presenceMinutes: 5,        // how long a rider must be with us to count as having ridden
    maxNamesPerMessage: 8,     // names in one bucket message before "…and N others"
    rideSeriesLabel: '',       // manual series name, used when no Zwift event is detected
    // "Who's ridden with us before" is meaningless for a solo/free ride, so history stays off
    // outside a recognised Zwift event unless explicitly enabled (e.g. to debug the feature).
    trackFreeRides: false,
    // One on/off flag + one message template per rider-event announcement, straight from the
    // registry — adding an announcement never needs an edit here (see announcements.mjs).
    ...announcementDefaults(),
};

let game;
let tracker;   // event-long metric/stats accumulator (independent of game rounds)
let history;   // persistent, ride-over-ride rider ledger (welcome + milestones)
let roster;    // who is actually on this ride (drops non-event riders — see event-roster.mjs)
let els;
let lastState = STATES.IDLE;
let lastPeriodicAnnounce = 0;

// ---- pre-roll (Start clicked -> instructions -> delay -> start message + timer) ----
let starting = false;       // in the pre-roll phase (before the game timer runs)
let startGen = 0;           // bumped by Stop/Reset to cancel an in-flight pre-roll
let startPhase = '';        // '' | 'instructions' | 'countdown' (drives the clock display)
let preRollGoAt = 0;        // clockNow() ms when the start message fires (countdown target)
let lastNearbyCount = 0;    // riders on the ride (after the event filter) in the last tick
let lastRawNearbyCount = 0; // …and how many `nearby` actually listed
let lastEntries = [];       // most recent (filtered) nearby snapshot, for refreshing UI on config changes
let wsConnected = false;   // connected to Sauce's web server (the data pipe)
let lastDataTs = 0;        // wall-clock ms of the last nearby tick (ground truth for "receiving data")
let gameLink = false;      // Zwift game connection (command channel) — only needed to SEND chat
let gameConnState = '';    // raw status.state: '' | 'disabled' | 'init' | 'waiting' | 'connected' | 'disconnected' | 'error'

// ---- send pipeline (chunk -> throttled queue -> send-mode gate) ----
const sendQueue = [];
let draining = false;
const outbox = [];          // {t, text, status}
const reviewItems = [];     // {id, text}
let reviewSeq = 0;

/*
 * ---- rider history / event identity ----
 * The ledger is keyed to the EVENT, not the leader: a rider is a regular *of a ride*, and a leader
 * may run two different rides a week. Resolving which event we are in costs a couple of RPCs, so it
 * is done at most every EVENT_RESOLVE_MS and cached. `seriesPrompt` is set when the resolved key has
 * no history — the panel then asks whether this is a renamed existing ride rather than silently
 * starting a fresh series and zeroing everyone's count (see the banner in renderRiders).
 */
const EVENT_RESOLVE_MS = 60_000;
const EVENT_RETRY_MS = 10_000;      // while still unidentified, look again sooner
/*
 * How long to keep trying before deciding this really is a free ride and falling back to the manual
 * series label. Comfortably shorter than the presence threshold (5 min), so a slow or briefly failing
 * event lookup can't credit anyone under the fallback key and leave a junk series behind.
 */
const FREE_RIDE_GRACE_MS = 90_000;
let lastEventResolve = 0;
let firstResolveAt = 0;
let resolvingEvent = false;
let eventInfo = null;         // {name, seriesId, lateJoinInMinutes} of the ride we are in, if any
let seriesPrompt = null;      // {rawKey, label} while an unrecognised series is unconfirmed
// Last markup written for the panel's two live regions. The panel re-renders every second, so these
// keep the DOM (and the merge dropdown's selection) untouched unless something really changed.
let lastBucketsHtml = null;
let lastBannerKey = null;

// ---- jokes (independent of the game; sends setup now, punchline after answerDelay) ----
let jokeDeck;
let jokeSending = false;     // true between the setup send and the punchline send
let jokeSendGen = 0;        // bumped by Skip / re-send to cancel an in-flight punchline
let punchlineAt = 0;        // Date.now() ms when the punchline fires (0 = nothing pending)


function get(key) {
    const v = settings.get(key);
    return v === undefined ? SETTING_DEFAULTS[key] : v;
}

// The selected game definition (scoring/formatting/messages/instructions).
function activeGame() {
    return getGame(get('gameKey'));
}

// Instructions to send at Start: the user's saved blob if they've customized it, otherwise the
// selected game's default. (get('instructions') is intentionally not used — the default is dynamic.)
// The Instructions editor itself lives in the settings window (settings.mjs); this only reads it.
function activeInstructions() {
    const v = settings.get('instructions');
    return v === undefined ? activeGame().defaultInstructions : v;
}

/*
 * Scale the whole UI by setting the root font-size multiplier (control.css bases every rem on
 * `calc(16px * var(--rlg-font-scale))`). Clamped so a stray setting can't make the window unusable.
 */
function applyFontScale(scaleOverride) {
    const raw = scaleOverride != null ? scaleOverride : get('fontScale');
    const scale = Math.min(2, Math.max(0.6, Number(raw) || 1));
    document.documentElement.style.setProperty('--rlg-font-scale', String(scale));
    const out = document.querySelector('#fontScaleVal');
    if (out) {
        out.textContent = `${Math.round(scale * 100)}%`;
    }
}

// Keep the on-window duration field showing the stored value (it lives on the main window now, but
// the Settings window shares the same store, so reflect external changes too).
function syncDurationInput() {
    if (els.durationInput && document.activeElement !== els.durationInput) {
        els.durationInput.value = String(Number(get('duration')) || 20);
    }
}

function readConfigIntoEngine() {
    game.setConfig({
        game: activeGame(),
        durationMin: Number(get('duration')) || 20,
        minSamples: Number(get('minSamples')) || 1,
        anomalyThresholdM: Number(get('anomalyThresholdM')) || 150,
        chatPrefix: get('chatPrefix') ?? '',
        leaderId: get('leaderId') != null ? Number(get('leaderId')) : null,
    });
    // The tracker's only tunable: whether level-up detection waits for a new rider's profile to
    // settle (see the LEVEL SETTLING notes in event-tracker.mjs).
    tracker.setConfig({levelSettling: get('levelUpSettling') !== false});
    // Who counts: in an event, riders who are not in it are dropped before anything sees the tick.
    // `subgroupId` comes from the event resolution below, so this is null until that lands (and on a
    // free ride), which the roster reads as "filter nothing".
    roster.setConfig({
        enabled: get('eventRidersOnly') !== false,
        subgroupId: eventInfo ? eventInfo.subgroupId : null,
        leaderId: get('leaderId') != null ? Number(get('leaderId')) : null,
    });
    history.setConfig({
        milestones: parseMilestones(get('milestoneLadder')),
        presenceMs: Math.max(0, Number(get('presenceMinutes')) || 0) * 60_000,
    });
}


// ---------------------------------------------------------------- event identity

/*
 * Which Zwift event are we in? Walks the host's own chain: the athlete's own subgroup if they are
 * registered, else whichever subgroup most of the riders around us are in (a leader is not always
 * signed up to their own ride). Then subgroup -> event, because the stable EventSeries id lives on
 * the EVENT, not the subgroup. Every step is optional — a free ride simply yields null and the
 * ledger falls back to the manual series label.
 */
async function resolveEventInfo(entries) {
    let sgId = null;
    try {
        const ad = await Common.rpc.getAthleteData('self');
        sgId = ad && ad.eventSubgroup && ad.eventSubgroup.id;
    } catch(e) {
        /* not fatal — fall through to the vote */
    }
    if (!sgId) {
        sgId = modalEventSubgroupId(entries);
    }
    if (!sgId) {
        return null;
    }
    try {
        const sg = await Common.rpc.getEventSubgroup(sgId);
        if (!sg) {
            return null;
        }
        let ev = null;
        if (sg.eventId != null) {
            ev = await Common.rpc.getCachedEvent(sg.eventId);
            if (!ev) {
                ev = await Common.rpc.getEvent(sg.eventId);
            }
        }
        return {
            subgroupId: sgId,
            eventId: sg.eventId,
            name: (ev && ev.name) || sg.name || '',
            // Only official/club events configured as a series carry one; meetups never do.
            seriesId: ev && ev.eventSeries ? ev.eventSeries.id : null,
            lateJoinInMinutes: (ev && ev.lateJoinInMinutes) || sg.lateJoinInMinutes || null,
        };
    } catch(e) {
        console.warn('[rlg] event lookup failed:', e);
        return null;
    }
}

// The subgroup most riders around us are in — robust when the leader isn't registered themselves.
function modalEventSubgroupId(entries) {
    const counts = new Map();
    for (const e of entries || []) {
        const id = e && e.state && e.state.eventSubgroupId;
        if (id) {
            counts.set(id, (counts.get(id) || 0) + 1);
        }
    }
    let best = null, bestN = 0;
    for (const [id, n] of counts) {
        if (n > bestN) {
            best = id;
            bestN = n;
        }
    }
    return best;
}

/*
 * Point the ledger at the right series and start (or resume) this ride's session. Cheap to call on
 * every tick — the RPC work is throttled and the rest is a no-op once resolved.
 */
async function maintainSeries(entries) {
    const now = clockNow();
    const interval = eventInfo ? EVENT_RESOLVE_MS : EVENT_RETRY_MS;
    if (resolvingEvent || (lastEventResolve && (now - lastEventResolve) < interval)) {
        if (history.seriesKey && history.sessionIndex == null) {
            history.beginSession(now);
        }
        return;
    }
    resolvingEvent = true;
    try {
        if (!firstResolveAt) {
            firstResolveAt = now;
        }
        const info = await resolveEventInfo(entries);
        eventInfo = info;
        lastEventResolve = clockNow();
        if (!info) {
            // Outside a Zwift event, rider history doesn't mean anything (there's no "regulars" of a
            // free ride) — so unless the leader has turned it on for debugging, leave the ledger
            // exactly where it is rather than starting/continuing a free-ride series.
            if (!get('trackFreeRides')) {
                return;
            }
            // Not in an event (yet). Keep looking for a while before committing anyone to the
            // fallback "free ride" ledger — an event lookup that needs a few seconds is normal.
            if (!history.seriesKey && (clockNow() - firstResolveAt) < FREE_RIDE_GRACE_MS) {
                return;
            }
        }
        const rawKey = keyForEvent({
            seriesId: info && info.seriesId,
            eventName: info && info.name,
            label: get('rideSeriesLabel'),
        });
        const label = (info && info.name) || get('rideSeriesLabel') || 'My ride';
        if (history.seriesKey !== history.resolveKey(rawKey)) {
            const r = history.useSeries(rawKey, {label});
            // An unknown key is usually a renamed event. Ask before treating it as a brand new ride:
            // silently forking would zero every rider's count and streak. Only worth asking when
            // there is something to merge into.
            seriesPrompt = (r.isNew && history.listSeries().length > 1) ? {rawKey, label} : null;
            history.beginSession(clockNow());
        } else if (history.sessionIndex == null) {
            history.beginSession(clockNow());
        }
    } finally {
        resolvingEvent = false;
    }
}


// ---------------------------------------------------------------- rendering

function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Local time-of-day for message-log stamps. Messages happen whether or not a game is running (jokes,
// announcements, manual sends), so the log can't stamp them relative to a game clock.
function fmtTimeOfDay(ms) {
    const d = new Date(ms);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((v, i) => i ? String(v).padStart(2, '0') : String(v)).join(':');
}

function renderClock() {
    const now = clockNow();
    if (starting) {
        els.gameState.textContent = startPhase === 'instructions' ? 'Instructions…' : 'Starting…';
        els.gameState.dataset.state = 'starting';
        els.clock.textContent = startPhase === 'countdown' && preRollGoAt
            ? fmtClock(preRollGoAt - now) : '· · ·';
        return;
    }
    const running = game.state === STATES.RUNNING;
    els.clock.textContent = running ? fmtClock(game.remainingMs(now))
        : game.state === STATES.FINISHED ? 'done' : '--:--';
    els.gameState.textContent = {
        [STATES.IDLE]: 'Idle',
        [STATES.RUNNING]: 'Running',
        [STATES.FINISHED]: 'Finished',
    }[game.state];
    els.gameState.dataset.state = game.state;
}

function renderBoard() {
    const rows = game.standings();
    const fmt = activeGame().format;
    els.boardNote.textContent = rows.length ? `${rows.length} riders` : '';
    els.leaderboard.innerHTML = rows.map((r, i) => `
        <li class="${r.qualified ? '' : 'unqualified'}">
            <span class="rank">${i + 1}</span>
            <span class="name">${Common.sanitize(r.name)}</span>
            <span class="avg">${fmt(r.avg)}</span>
            <span class="samples" title="scoring samples${r.carriedTicks ? ` · ${r.carriedTicks} carried` : ''}">${r.samples}${r.carriedTicks ? '*' : ''}</span>
        </li>`).join('');
}

// ---- event viewer (metric standings + ride-wide totals, since event start) ----

// Populate the metric dropdown once from the registry and restore the saved selection.
function buildEventPicker() {
    els.eventMetric.innerHTML = METRICS
        .map(m => `<option value="${m.key}">${Common.sanitize(m.name)}</option>`)
        .join('');
    els.eventMetric.value = getMetric(get('eventMetric')).key;   // normalize unknown/missing
    els.eventMetric.addEventListener('change', () => {
        settings.set('eventMetric', els.eventMetric.value);
        renderEvent();
    });
}

function renderEvent() {
    if (!tracker) {
        return;
    }
    const metric = getMetric(get('eventMetric'));
    const rows = tracker.standings(metric.key);
    els.btnSendTotals.disabled = !rideTotalsMessage();   // nothing to report, or announcement muted
    els.eventElapsed.textContent = tracker.startTime != null
        ? `${fmtClock(tracker.elapsedMs(clockNow()))} · ${rows.length} riders` : '';
    els.eventBoard.innerHTML = rows.map((r, i) => `
        <li>
            <span class="rank">${i + 1}</span>
            <span class="name">${Common.sanitize(r.name)}</span>
            <span class="avg">${metric.format(r.value)}</span>
        </li>`).join('');

    // Formatted by event-tracker.mjs so the "Send summary" message reads exactly like these tiles.
    const t = formatRideTotals(tracker.rideTotals());
    els.rideTotals.innerHTML = [
        ['Total miles', t.miles],
        ['Pedal strokes', t.strokes],
        ['Ride-ons', t.rideons],
        ['Calories', t.calories],
        ['Levels gained', t.levels],
    ].map(([label, val]) => `
        <div class="ride-total">
            <span class="rt-val">${val}</span>
            <span class="rt-label">${label}</span>
        </div>`).join('');
}

function renderOutbox() {
    els.modeBadge.textContent = get('sendMode');
    els.queueDepth.textContent = sendQueue.length ? `· ${sendQueue.length} queued` : '';
    els.outbox.innerHTML = outbox.slice(-40).reverse().map(o => `
        <li class="status-${o.status}">
            <span class="ts">${fmtTimeOfDay(o.t)}</span>
            <span class="msg">${Common.sanitize(o.text)}</span>
            <span class="st">${o.status}</span>
        </li>`).join('');
    renderReview();
}

function renderReview() {
    els.reviewQueue.innerHTML = reviewItems.map(item => `
        <div class="review-item" data-id="${item.id}">
            <textarea class="review-text">${Common.sanitize(item.text)}</textarea>
            <div class="review-actions">
                <button class="rlg-btn small primary" data-act="send">Send</button>
                <button class="rlg-btn small" data-act="discard">Discard</button>
            </div>
        </div>`).join('');
}

function renderDiag() {
    const show = !!get('showDiagnostics');
    els.diagSection.style.display = show ? '' : 'none';
    if (!show) {
        return;
    }
    const diag = game.diagnostics;
    const counts = {};
    for (const d of diag) {
        counts[d.type] = (counts[d.type] || 0) + 1;
    }
    els.diagNote.textContent = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join('  ');
    els.diagLog.innerHTML = diag.slice(-80).reverse().map(d => {
        const {type, at, ...rest} = d;
        return `<li class="diag-${type}"><span class="t">#${at}</span>
            <span class="ty">${type}</span>
            <span class="dt">${Common.sanitize(summarizeDiag(type, rest))}</span></li>`;
    }).join('');
}

function summarizeDiag(type, d) {
    if (type === 'carry-forward') {
        return `${d.name || d.athleteId} held ${d.heldM}m (${d.carriedTicks} ticks)`;
    }
    if (type === 'anomaly') {
        return `${d.name || d.athleteId} jumped ${d.jumpM}m (${d.fromM}→${d.toM})`;
    }
    if (type === 'list-saturated') {
        return `${d.riders} riders (cap ${d.cap})`;
    }
    if (type === 'leader-not-visible') {
        return `leader ${d.leaderId} not in nearby`;
    }
    if (type === 'game') {
        return d.msg || '';
    }
    return JSON.stringify(d);
}

/*
 * The Riders panel: a live count of who is still owed a welcome, plus one row per thing the leader
 * could say right now. Each row is exactly one chat message — a bucket, not a rider — which is what
 * keeps a group who all started together from producing thirty near-identical messages in a week.
 */
function renderRiders() {
    if (!els.pendingBuckets) {
        return;
    }
    const now = clockNow();
    const p = history.pending(now);
    const late = eventInfo && eventInfo.lateJoinInMinutes;
    const elapsedMin = tracker.startTime != null ? Math.floor(tracker.elapsedMs(now) / 60_000) : 0;

    // Once resolution has had its grace period, a null eventInfo with history still off free-ride
    // tracking means we've concluded this is a free ride and are deliberately not tracking it.
    const freeRidePaused = !history.seriesKey && !eventInfo && !get('trackFreeRides') &&
        firstResolveAt && (now - firstResolveAt) >= FREE_RIDE_GRACE_MS;

    const bits = [];
    if (!history.seriesKey) {
        bits.push(freeRidePaused ? 'no event — history off (Settings)' : 'waiting for riders…');
    } else {
        bits.push(p.welcome.length ? `${p.welcome.length} to welcome` : 'nobody to welcome');
        if (p.milestones.length) {
            bits.push(`${p.milestones.length} milestone${p.milestones.length === 1 ? '' : 's'}`);
        }
        // Recognising new riders is a mid-ride thing, once the group has settled and late join has
        // closed. A hint rather than a lock — the leader picks the moment.
        if (late && elapsedMin < late) {
            bits.push(`late join closes ~${late - elapsedMin} min`);
        }
    }
    els.ridersHistNote.textContent = bits.join(' · ');

    renderSeriesBanner();

    const rows = [];
    if (p.welcome.length) {
        rows.push(bucketRow({
            kind: 'welcome',
            title: '👋 New riders',
            riders: p.welcome,
            action: 'Welcome',
        }));
    }
    for (const m of p.milestones) {
        rows.push(bucketRow({
            kind: 'milestone',
            value: m.value,
            title: `🎂 ${m.value} rides`,
            riders: m.riders,
            action: 'Announce',
        }));
    }
    const html = rows.length ? rows.join('') :
        `<div class="riders-empty">${history.seriesKey ?
            'Nothing pending — everyone here has been welcomed.' :
            freeRidePaused ? 'Not tracked outside a Zwift event — enable in Settings → Rider history.' :
            'No ride identified yet.'}</div>`;
    // This runs on the 1s ticker, so only touch the DOM when the buckets actually change: replacing
    // the markup under the leader's cursor can swallow a click that lands mid-rebuild, and it drops
    // keyboard focus.
    if (html !== lastBucketsHtml) {
        lastBucketsHtml = html;
        els.pendingBuckets.innerHTML = html;
    }
}

function bucketRow({kind, value, title, riders, action}) {
    const names = riders.map(r => Common.sanitize(r.name)).join(', ');
    const ids = riders.map(r => r.athleteId).join(',');
    return `
        <div class="pending-bucket ${kind}" data-kind="${kind}" data-value="${value == null ? '' : value}"
             data-ids="${Common.sanitize(ids)}">
            <div class="pb-head">
                <span class="pb-title">${title}</span>
                <span class="pb-count">${riders.length} rider${riders.length === 1 ? '' : 's'}</span>
            </div>
            <div class="pb-names">${names}</div>
            <div class="pb-actions">
                <button class="rlg-btn small primary" data-act="send">${action}</button>
                <button class="rlg-btn small" data-act="dismiss"
                    title="Mark as done without sending anything">Skip</button>
            </div>
        </div>`;
}

/*
 * Shown when the resolved series has no history — almost always a renamed event. Offering "this is
 * <existing ride>" (which aliases, so no counts are recomputed) is the whole point: without it a
 * rename silently starts a new ledger and every rider looks new again.
 */
function renderSeriesBanner() {
    const el = els.seriesBanner;
    if (!el) {
        return;
    }
    if (!seriesPrompt) {
        el.hidden = true;
        el.innerHTML = '';
        lastBannerKey = null;
        return;
    }
    // Rebuilding this every tick would reset the <select> under the leader while they are choosing.
    if (lastBannerKey === seriesPrompt.rawKey) {
        return;
    }
    lastBannerKey = seriesPrompt.rawKey;
    const others = history.listSeries().filter(s => s.key !== history.seriesKey);
    el.hidden = false;
    el.innerHTML = `
        <span class="sb-msg">New ride “${Common.sanitize(seriesPrompt.label)}” — no history yet.
            If this ride was renamed, point it at its old history.</span>
        <div class="sb-actions">
            <select id="seriesMergeInto">
                ${others.map(s => `<option value="${Common.sanitize(s.key)}">${
                    Common.sanitize(s.label)} (${s.sessions} rides, ${s.riders} riders)</option>`).join('')}
            </select>
            <button class="rlg-btn small primary" id="btnSeriesMerge">This is that ride</button>
            <button class="rlg-btn small" id="btnSeriesKeep">Keep separate</button>
        </div>`;
}

function renderAll() {
    renderClock();
    renderBoard();
    renderEvent();
    renderRiders();
    renderOutbox();
    renderDiag();
}


// ---------------------------------------------------------------- send pipeline

function enqueueMessage(text) {
    if (!text) {
        return;
    }
    const mode = get('sendMode');
    if (mode === SEND_MODES.REVIEW) {
        reviewItems.push({id: ++reviewSeq, text});
        renderOutbox();
        return;
    }
    const parts = chunkMessage(text, Number(get('maxMessageLength')) || 90);
    if (mode === SEND_MODES.SILENT) {
        for (const p of parts) {
            logOutbox(p, 'silent');
        }
        return;
    }
    // auto
    for (const p of parts) {
        sendQueue.push(p);
    }
    drainQueue();
}

function logOutbox(text, status) {
    outbox.push({t: clockNow(), text, status});
    if (outbox.length > 500) {
        outbox.splice(0, outbox.length - 500);
    }
    renderOutbox();
}

/*
 * Resolve once the send queue has fully drained. In Auto mode this waits for every queued chunk
 * to be sent (spaced by messageDelay); in Silent/Review the queue is never used for these messages
 * so it resolves ~immediately. Used by the pre-roll to wait until instructions have gone out before
 * starting the pre-start countdown.
 */
function whenQueueIdle() {
    return new Promise(resolve => {
        const check = () => {
            if (!sendQueue.length && !draining) {
                resolve();
            } else {
                setTimeout(check, 200);
            }
        };
        check();
    });
}

async function drainQueue() {
    if (draining) {
        return;
    }
    draining = true;
    try {
        while (sendQueue.length) {
            const part = sendQueue.shift();
            renderOutbox();
            await sendChat(part);
            if (sendQueue.length) {
                const delayMs = (Number(get('messageDelay')) || 0) * 1000;
                if (delayMs > 0) {
                    await Common.sleep(delayMs);
                }
            }
        }
    } finally {
        draining = false;
        renderOutbox();
    }
}

async function sendChat(text) {
    logOutbox(text, 'sending');
    const entry = outbox[outbox.length - 1];
    try {
        await Common.rpc.chatMessage(text);
        entry.status = 'sent';
    } catch (e) {
        entry.status = 'error';
        console.error('chatMessage failed:', e);
    }
    renderOutbox();
}


// ---------------------------------------------------------------- jokes

function jokePrefixStr() {
    const p = get('jokePrefix');
    return p ? p + ' ' : '';
}

// Render the current joke into the card. The leader always sees the full joke (both parts) so
// they can decide whether to send it; chat only reveals the punchline after the answer delay.
function renderJoke() {
    const j = jokeDeck.current;
    els.jokeNote.textContent = jokeDeck.size ? `${jokeDeck.size} in deck` : 'no jokes loaded';
    if (!j) {
        els.jokeSetup.textContent = 'No jokes available.';
        els.jokePunchline.textContent = '';
        return;
    }
    els.jokeSetup.textContent = j.setup;
    els.jokePunchline.textContent = j.punchline;
}

// Live countdown while a punchline is pending; driven by the 1s ticker. Leaves any prior status
// (e.g. "Sent") untouched when nothing is pending.
function renderJokeStatus() {
    if (!jokeSending || !punchlineAt) {
        return;
    }
    const remain = Math.max(0, Math.ceil((punchlineAt - Date.now()) / 1000));
    els.jokeStatus.textContent = remain > 0 ? `Punchline in ${remain}s…` : 'Sending punchline…';
    els.jokeStatus.classList.add('warn');
}

function syncJokeButtons() {
    els.btnSendJoke.disabled = jokeSending || !jokeDeck.current;
    els.btnSendJoke.textContent = jokeSending ? 'Sending…' : 'Send joke';
    els.btnSkipJoke.disabled = !jokeDeck.current;
}

// Advance to a fresh random joke (also cancels any in-flight punchline). Used by Skip and to auto-
// load the next joke after one is sent.
function nextJoke() {
    cancelPendingPunchline();
    jokeDeck.next();
    renderJoke();
    els.jokeStatus.textContent = '';
    els.jokeStatus.classList.remove('warn');
    syncJokeButtons();
}

function cancelPendingPunchline() {
    jokeSendGen++;      // invalidates any in-flight onSendJoke()
    jokeSending = false;
    punchlineAt = 0;
}

/*
 * Send the current joke: the setup goes out now, and the punchline after the configured answer
 * delay. Both go through the normal send pipeline (chunking + send-mode gate), so jokes respect
 * Silent/Review/Auto just like game messages. Skip or a re-send cancels a pending punchline via the
 * generation token. On success the next joke is auto-loaded so the leader is ready to go again.
 */
async function onSendJoke() {
    const j = jokeDeck.current;
    if (!j || jokeSending) {
        return;
    }
    const gen = ++jokeSendGen;
    jokeSending = true;
    const prefix = jokePrefixStr();
    enqueueMessage(prefix + j.setup);

    const delayMs = Math.max(0, (Number(get('answerDelay')) || 0) * 1000);
    punchlineAt = Date.now() + delayMs;
    syncJokeButtons();
    renderJokeStatus();
    if (delayMs > 0) {
        await Common.sleep(delayMs);
    }
    if (gen !== jokeSendGen) {       // skipped or re-sent during the delay
        return;
    }
    enqueueMessage(prefix + j.punchline);
    jokeSending = false;
    punchlineAt = 0;
    els.jokeStatus.textContent = 'Sent ✓ — next joke ready.';
    els.jokeStatus.classList.remove('warn');
    jokeDeck.next();                 // auto-load the next joke (keeps the "Sent" status visible)
    renderJoke();
    syncJokeButtons();
}


// ---------------------------------------------------------------- game control

/*
 * Start button. Runs the pre-roll: send instructions (before the timer), wait a configurable
 * delay, then send the start message and begin the game/timer. Stop or Reset during the pre-roll
 * cancels cleanly via the generation token (no start message, no game).
 */
async function onStart() {
    if (starting || game.state === STATES.RUNNING) {
        return;
    }
    readConfigIntoEngine();
    const gen = ++startGen;
    starting = true;

    // 1) Instructions — one message per blank-line-separated block (each auto-chunks + paces).
    startPhase = 'instructions';
    preRollGoAt = 0;
    syncButtons();
    renderClock();
    if (get('sendInstructions')) {
        for (const block of instructionMessages(activeInstructions())) {
            enqueueMessage(block);
        }
        await whenQueueIdle();          // let instructions actually go out (Auto); instant otherwise
        if (gen !== startGen) {         // cancelled by Stop/Reset
            return;
        }
    }

    // 2) Wait the configured delay, then start.
    startPhase = 'countdown';
    const delayMs = Math.max(0, (Number(get('startDelay')) || 0) * 1000);
    preRollGoAt = clockNow() + delayMs;
    renderClock();
    if (delayMs > 0) {
        await Common.sleep(delayMs);
    }
    if (gen !== startGen) {
        return;
    }
    beginGame();
}

/*
 * Begin the game immediately: timer + scoring start now, and the start message is sent. Called at
 * the end of the pre-roll, and directly by the replay controls (which skip instructions/delay).
 */
function beginGame() {
    starting = false;
    startPhase = '';
    preRollGoAt = 0;
    const now = clockNow();
    game.start(now);
    lastPeriodicAnnounce = now;
    if (get('announceStart')) {
        enqueueMessage(game.startMessage());
    }
    syncButtons();
    renderAll();
}

function cancelPreRoll() {
    startGen++;             // invalidates any in-flight onStart()
    starting = false;
    startPhase = '';
    preRollGoAt = 0;
}

function onStop() {
    if (starting) {         // cancel the pre-roll — the game never started, nothing to finish
        cancelPreRoll();
        syncButtons();
        renderAll();
        return;
    }
    game.stop(clockNow());
    onFinish();
}

function onReset() {
    cancelPreRoll();
    game.reset();
    sendQueue.length = 0;
    reviewItems.length = 0;
    lastState = STATES.IDLE;
    syncButtons();
    renderAll();
}

function onFinish() {
    if (get('announceWinner')) {
        enqueueMessage(game.winnerMessage(Number(get('resultsCount')) || 5));
    }
    syncButtons();
    renderAll();
}

function syncButtons() {
    const running = game.state === STATES.RUNNING;
    els.btnStart.disabled = running || starting;
    els.btnStop.disabled = !running && !starting;
    // Switching games mid-run would reinterpret already-accumulated samples; lock it until Reset.
    if (els.gamePicker) {
        els.gamePicker.disabled = running || starting;
    }
    // Duration can't change once the round is timing (it sets the end time at Start).
    if (els.durationInput) {
        els.durationInput.disabled = running || starting;
    }
}


// ---------------------------------------------------------------- live data

function onNearby(all) {
    lastRawNearbyCount = all.length;
    lastDataTs = Date.now();
    readConfigIntoEngine();      // before the filter: it feeds the roster its event + leader
    /*
     * `nearby` is everyone on the same road; in an event only the riders in it are on our ride, and
     * everyone else is dropped here, once, so the games, the metric viewer, the ride totals and the
     * ledger all see the same roster (see event-roster.mjs). Outside an event this is the raw list.
     */
    const entries = roster.filter(all);
    lastNearbyCount = entries.length;
    lastEntries = entries;
    // The picker deliberately lists EVERY rider nearby: a leader who isn't registered for their own
    // ride still has to be selectable, and the roster keeps whoever is picked.
    updateLeaderPicker(all);
    updateReference(entries);
    // The event tracker runs continuously (independent of game rounds) so the "since event start"
    // viewer and ride-wide totals accumulate whether or not a game is active. It also reports the
    // rider events it spotted this tick (level-ups today) for announcing.
    announceRiderEvents(tracker.ingest(entries, clockNow()));
    // Resolving the event takes a moment after the window opens, so the first ticks may have
    // accumulated riders who turn out not to be on the ride. Drop them once we know better.
    if (roster.active) {
        tracker.retain(id => roster.has(id));
    }
    // The persistent ledger: note everyone present, credit a ride once they've been with us long
    // enough, and persist only if something changed. `maintainSeries` is async and self-throttling;
    // it is deliberately not awaited so a slow RPC can never stall a tick. It gets the UNFILTERED
    // list — its subgroup vote is what tells the roster which event we are in.
    maintainSeries(all);
    const nowMs = clockNow();
    for (const e of entries) {
        if (e && e.athleteId != null) {
            history.observe(e.athleteId, nameOf(e), nowMs);
        }
    }
    // Same reason as the tracker above, and it matters more here: presence runs from a rider's FIRST
    // sighting, so a stranger seen once before we knew the event would be credited a ride five
    // minutes later — and offered up by name for a welcome.
    if (roster.active) {
        history.retain(id => roster.has(id));
    }
    history.commit(nowMs);
    history.flush();
    if (game.state === STATES.RUNNING) {
        game.ingest(entries, clockNow());
        if (game.state === STATES.FINISHED) {   // ingest auto-finished on time-up
            onFinish();
            renderEvent();
            renderRiders();
            return;
        }
    }
    renderBoard();
    renderEvent();
    renderRiders();
    renderDiag();
}

/*
 * Send one bucket. The text comes from the registry (so the leader's template and on/off switch
 * apply) and goes through the normal pipeline, so Silent/Review/Auto, chunking and pacing all behave
 * like any other message. The riders are marked as the message ENTERS the pipeline — discarding it
 * afterwards in Review mode still counts as done, which is a fair trade for not having to thread a
 * result back through the review queue.
 */
function sendBucket(kind, value, ids) {
    if (!ids.length) {
        return;
    }
    const p = history.pending(clockNow());
    const riders = kind === 'welcome' ? p.welcome :
        (p.milestones.find(m => m.value === value) || {riders: []}).riders;
    const picked = riders.filter(r => ids.includes(r.athleteId));
    if (!picked.length) {
        return;
    }
    const vars = riderNameVars(picked, Number(get('maxNamesPerMessage')) || 0);
    const text = kind === 'welcome' ?
        manualAnnouncementMessage('welcome', vars, get) :
        manualAnnouncementMessage('milestone', {...vars, rides: value}, get);
    markBucketDone(kind, value, ids);
    if (text) {
        enqueueMessage(text);
    }
    renderRiders();
}

// Mark a bucket handled without saying anything (the Skip button, and the tail of sendBucket).
function markBucketDone(kind, value, ids) {
    if (kind === 'welcome') {
        history.markWelcomed(ids, clockNow());
    } else {
        history.markMilestoneAnnounced(value, ids);
    }
    history.flush();
}

/*
 * The ride-summary message: the group's combined totals, worded by the registry and formatted by the
 * tracker (formatRideTotals) so the message can't drift from the tiles it is read off.
 *
 * Returns '' when there is nothing to report yet, or when the announcement is switched off / its
 * template blanked in Settings — renderEvent uses that same emptiness to grey the button out, so a
 * muted announcement shows as a disabled button instead of a press that silently does nothing.
 */
function rideTotalsMessage() {
    if (!tracker) {
        return '';
    }
    const totals = tracker.rideTotals();
    if (!totals.riders) {
        return '';
    }
    const elapsed = tracker.startTime != null ? fmtClock(tracker.elapsedMs(clockNow())) : '0:00';
    return manualAnnouncementMessage('ride-totals', {...formatRideTotals(totals), elapsed}, get);
}

/*
 * Announce the rider events the tracker just spotted (a level-up today; the registry is open-ended).
 * The registry decides which are enabled and how they read; these go through the normal send
 * pipeline, so they honour Silent/Review/Auto, chunking and pacing like every other message.
 */
function announceRiderEvents(events) {
    for (const text of announcementMessages(events, get)) {
        enqueueMessage(text);
    }
}

/*
 * Populate the game dropdown from the registry and wire selection. Switching games persists the
 * new key, re-reads config (so the engine scores with the new game), swaps the default instructions
 * (if uncustomized), and refreshes the board formatter + reference note. Disabled mid-game by
 * syncButtons() so accumulated samples aren't reinterpreted under a different game.
 */
function buildGamePicker() {
    const cur = get('gameKey');
    els.gamePicker.innerHTML = GAMES
        .map(g => `<option value="${g.key}">${Common.sanitize(g.name)}</option>`)
        .join('');
    els.gamePicker.value = getGame(cur).key;   // normalize an unknown/missing key to the default
    els.gameDesc.textContent = activeGame().description;

    els.gamePicker.addEventListener('change', () => {
        settings.set('gameKey', els.gamePicker.value);
        readConfigIntoEngine();
        els.gameDesc.textContent = activeGame().description;
        // The settings window reacts to this gameKey change (via the store's 'set' event) to
        // refresh the shown default instructions; nothing to update in the control window.
        updateReference(lastEntries);
        renderBoard();
    });
}

/*
 * How many riders we are actually scoring, and how many of the nearby list we threw away. The
 * saturation warning uses the RAW count — it's the host's ~100-rider cap that's biting, not ours.
 */
function ridersNoteText() {
    const sat = lastRawNearbyCount >= (game.config.maxRiders || 100) ? ' (list saturated)' : '';
    const ignored = lastRawNearbyCount - lastNearbyCount;
    return ignored > 0
        ? `${lastNearbyCount} on the ride · ${ignored} nearby ignored (not in the event)${sat}`
        : `${lastRawNearbyCount} riders nearby${sat}`;
}

function updateReference(entries) {
    els.ridersNote.title = roster.active
        ? 'Only riders in this Zwift event are counted (Settings ▸ Who counts)'
        : 'Not in a Zwift event — every rider nearby is counted';
    // Games that don't score relative to a leader (e.g. cadence) don't use the reference picker.
    if (!activeGame().needsReference) {
        els.leaderFlag.textContent = 'not used for this game';
        els.leaderFlag.className = 'ref-flag';
        els.ridersNote.textContent = ridersNoteText();
        return;
    }
    const leaderId = game.config.leaderId;
    if (leaderId == null) {
        const watched = entries.find(e => e.watching);
        els.leaderFlag.textContent = watched ? `watched: ${nameOf(watched)}` : 'no rider watched';
        els.leaderFlag.className = 'ref-flag';
    } else {
        const le = entries.find(e => e.athleteId === leaderId);
        if (le) {
            els.leaderFlag.textContent = `visible: ${nameOf(le)}`;
            els.leaderFlag.className = 'ref-flag ok';
        } else {
            els.leaderFlag.textContent = 'leader NOT visible';
            els.leaderFlag.className = 'ref-flag warn';
        }
    }
    els.ridersNote.textContent = ridersNoteText();
}

let leaderPickerSig = '';
function updateLeaderPicker(entries) {
    // Rebuild only when the roster changes, to avoid clobbering the user's open dropdown.
    const sig = entries.map(e => e.athleteId).join(',');
    if (sig === leaderPickerSig) {
        return;
    }
    leaderPickerSig = sig;
    const cur = game.config.leaderId != null ? String(game.config.leaderId) : '';
    const opts = ['<option value="">(watched rider)</option>'];
    for (const e of entries) {
        opts.push(`<option value="${e.athleteId}">${Common.sanitize(nameOf(e))}</option>`);
    }
    // Keep a configured-but-absent leader selectable so we don't silently lose the setting.
    if (cur && !entries.some(e => String(e.athleteId) === cur)) {
        opts.push(`<option value="${cur}">athlete ${cur} (not nearby)</option>`);
    }
    els.leaderPicker.innerHTML = opts.join('');
    els.leaderPicker.value = cur;
}

function nameOf(e) {
    const a = e && e.athlete;
    return (a && (a.sanitizedFullname || a.fullname)) || `#${e.athleteId}`;
}


// ---------------------------------------------------------------- version badge

/*
 * Show the running version in the header. Read it from Sauce's own mod registry
 * (getAvailableMods → manifest.version) so it always matches the installed manifest and
 * never needs hardcoding. Silently leaves the badge blank if the RPC is unavailable.
 */
async function showVersion() {
    if (!els.appVersion) {
        return;
    }
    try {
        const mods = await Common.rpc.getAvailableMods();
        const me = mods && mods.find(m => m.id === 'ride-leader-games');
        const v = me && me.manifest && me.manifest.version;
        if (v) {
            els.appVersion.textContent = `v${v}`;
        }
    } catch (e) {
        // Best-effort only; the version badge is cosmetic.
    }
}


// ---------------------------------------------------------------- connection status

/*
 * The header reflects the DATA connection to Sauce (are we receiving nearby?), which is what
 * the game needs. It is deliberately independent of the Zwift "game connection" command
 * channel — that only matters for SENDING chat, and is surfaced separately.
 */
function renderConn() {
    let connected, txt;
    if (replayMode) {
        connected = true;
        txt = 'replay mode';
    } else if (lastDataTs && Date.now() - lastDataTs < 5000) {
        connected = true;
        txt = 'receiving data';
    } else if (wsConnected) {
        connected = true;
        txt = 'connected · waiting for data';
    } else {
        connected = false;
        txt = 'not connected to Sauce';
    }
    els.conn.classList.toggle('connected', connected);
    // The header dot is compact; its full status lives in the hover tooltip.
    els.conn.title = txt;

    // Chat sending needs the game connection (independent of the data feed above).
    // Sending chat rides the same Zwift command channel as camera control, so it fails
    // unless the game has actually connected to Sauce (status.connected). The status.state
    // distinguishes *why* it's off so we can give an actionable hint:
    //   'disabled' → Game Connection isn't enabled in Sauce (Settings ▸ General; restart required).
    //   'waiting'  → enabled but the game never dialed back — almost always the Zwift Companion app
    //                holding the single companion slot (it was running before Sauce registered).
    // Note: when 'disabled' the gameConnection emitter never fires 'status'; we learn this state
    // from the initial getGameConnectionStatus() RPC at startup (see main()).
    if (els.sendReady) {
        const silent = get('sendMode') === SEND_MODES.SILENT;
        let txt, title = '';
        if (gameLink) {
            txt = 'chat link ✓';
        } else if (silent) {
            txt = 'chat off (Silent)';
        } else if (gameConnState === 'waiting') {
            txt = 'chat link waiting — close the Zwift Companion app to connect';
            title = 'Zwift allows only one companion connection. If the Companion app is open ' +
                'it holds that slot and the game never connects to Sauce. Just close the ' +
                'Companion app — the link connects on its own within a few seconds, no Sauce ' +
                'restart needed.';
        } else if (gameConnState === 'disabled') {
            txt = 'chat link off — enable Game Connection in Sauce Settings ▸ General (restart required)';
            title = 'Game Connection is turned off in Sauce, so chat cannot be sent.\n\n' +
                'To enable it:\n' +
                '1. Open the Sauce window and click the gear/Settings icon.\n' +
                '2. Under General, tick "Game Connection".\n' +
                '3. Restart Sauce (this setting requires a restart).\n\n' +
                'Note: Zwift allows only one companion connection, so if you use the Zwift ' +
                'Companion app’s Game mode, close it first.';
        } else if (gameConnState === 'error') {
            txt = 'chat link error — check Sauce Game Connection';
        } else {
            txt = 'chat link off — enable Game Connection to send';
        }
        els.sendReady.textContent = txt;
        els.sendReady.title = title;
        els.sendReady.classList.toggle('warn', !gameLink && !silent);
        els.sendReady.classList.toggle('ok', gameLink);
    }
}


// ---------------------------------------------------------------- export

function download(filename, text, type) {
    const blob = new Blob([text], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}


// ---------------------------------------------------------------- wiring

export async function main() {
    els = {
        conn: document.querySelector('#conn'),
        appVersion: document.querySelector('#appVersion'),
        sendReady: document.querySelector('#sendReady'),
        clock: document.querySelector('#clock'),
        gameState: document.querySelector('#gameState'),
        gamePicker: document.querySelector('#gamePicker'),
        gameDesc: document.querySelector('#gameDesc'),
        leaderPicker: document.querySelector('#leaderPicker'),
        leaderFlag: document.querySelector('#leaderFlag'),
        ridersNote: document.querySelector('#ridersNote'),
        durationInput: document.querySelector('#durationInput'),
        eventMetric: document.querySelector('#eventMetric'),
        eventBoard: document.querySelector('#eventBoard'),
        eventElapsed: document.querySelector('#eventElapsed'),
        rideTotals: document.querySelector('#rideTotals'),
        btnSendTotals: document.querySelector('#btnSendTotals'),
        btnResetEvent: document.querySelector('#btnResetEvent'),
        ridersHistNote: document.querySelector('#ridersHistNote'),
        seriesBanner: document.querySelector('#seriesBanner'),
        pendingBuckets: document.querySelector('#pendingBuckets'),
        btnSeedKnown: document.querySelector('#btnSeedKnown'),
        btnStart: document.querySelector('#btnStart'),
        btnStop: document.querySelector('#btnStop'),
        btnReset: document.querySelector('#btnReset'),
        boardNote: document.querySelector('#boardNote'),
        leaderboard: document.querySelector('#leaderboard'),
        modeBadge: document.querySelector('#modeBadge'),
        queueDepth: document.querySelector('#queueDepth'),
        reviewQueue: document.querySelector('#reviewQueue'),
        outbox: document.querySelector('#outbox'),
        jokeNote: document.querySelector('#jokeNote'),
        jokeSetup: document.querySelector('#jokeSetup'),
        jokePunchline: document.querySelector('#jokePunchline'),
        jokeStatus: document.querySelector('#jokeStatus'),
        btnSendJoke: document.querySelector('#btnSendJoke'),
        btnSkipJoke: document.querySelector('#btnSkipJoke'),
        diagSection: document.querySelector('#diagSection'),
        diagNote: document.querySelector('#diagNote'),
        diagLog: document.querySelector('#diagLog'),
    };

    game = new RideLeaderGame({
        config: {},
        onDiag: ev => { console.debug('[rlg diag]', ev); },
    });
    // The persistent ledger. localStorage rather than the settings store on purpose: a settingsStore
    // write fires the cross-window 'set' event, which this window answers by re-reading config and
    // re-rendering — a silly amount of work for a per-tick ledger update.
    history = new RiderHistory({storage: window.localStorage});
    history.load();
    // The tracker copies ride counts / streaks off the ledger so they can be viewed as metrics.
    tracker = new EventTracker({historyLookup: history.lookup()});
    // Who counts. Configured (event + leader + the on/off switch) by readConfigIntoEngine.
    roster = new EventRoster();
    readConfigIntoEngine();

    Common.initInteractionListeners();
    applyFontScale();
    buildGamePicker();
    buildEventPicker();
    syncDurationInput();

    // Config is edited in the settings window (settings.html, opened from the titlebar gear). Its
    // writes reach this window as the settings store's 'set' event (cross-window via the localStorage
    // `storage` event), so we just re-read config and re-render here — mode badge, prefix, font
    // scale, diagnostics visibility, and engine params all update live.
    settings.addEventListener('set', () => {
        readConfigIntoEngine();
        applyFontScale();
        syncDurationInput();
        renderOutbox();
        renderEvent();
        renderRiders();
        renderDiag();
    });

    // The ledger is written on the tick that changes it, but a mid-ride window close (or a crash)
    // could land between ticks — flush what's pending on the way out.
    window.addEventListener('beforeunload', () => history.flush());

    // Buttons
    els.btnStart.addEventListener('click', onStart);
    els.btnStop.addEventListener('click', onStop);
    els.btnReset.addEventListener('click', onReset);

    // Duration lives on the main window (persisted to the shared store; Settings reflects it too).
    els.durationInput.addEventListener('change', () => {
        const v = Math.min(240, Math.max(1, Math.round(Number(els.durationInput.value) || 20)));
        els.durationInput.value = String(v);
        settings.set('duration', v);
        readConfigIntoEngine();
    });

    /*
     * Send summary: the ride totals to chat, through the normal pipeline so Silent/Review/Auto,
     * chunking and pacing behave like any other message. Nothing is consumed or marked, so the
     * leader can send it again later in the ride.
     */
    els.btnSendTotals.addEventListener('click', () => {
        enqueueMessage(rideTotalsMessage());
        renderEvent();
    });

    // Reset event: start a fresh ride-long accumulation (zeros the metric viewer + totals).
    els.btnResetEvent.addEventListener('click', () => {
        tracker.reset(clockNow());
        renderEvent();
    });

    /*
     * Riders panel. One delegated handler for every bucket button, like the review queue: the rows
     * are re-rendered constantly, so per-button listeners would be re-attached on every tick.
     */
    els.pendingBuckets.addEventListener('click', ev => {
        const btn = ev.target.closest('button[data-act]');
        if (!btn) {
            return;
        }
        const row = btn.closest('.pending-bucket');
        const kind = row.dataset.kind;
        const value = row.dataset.value ? Number(row.dataset.value) : null;
        const ids = row.dataset.ids ? row.dataset.ids.split(',') : [];
        if (btn.dataset.act === 'send') {
            sendBucket(kind, value, ids);
        } else {
            markBucketDone(kind, value, ids);
            renderRiders();
        }
    });

    /*
     * Day one: everyone here has ridden with you for years but the ledger has never seen them. One
     * click marks them known so nobody gets a "welcome" they'd find odd. Their ride count still
     * starts from now — there is no way to recover real history (see rider-history.mjs).
     */
    els.btnSeedKnown.addEventListener('click', () => {
        if (!history.seriesKey) {
            return;
        }
        const n = history.seedKnown(null, clockNow());
        history.flush();
        renderRiders();
        console.info(`[rlg] marked ${n} rider(s) as already known`);
    });

    // Series banner: alias a renamed event onto its old history, or accept it as a new ride.
    els.seriesBanner.addEventListener('click', ev => {
        const btn = ev.target.closest('button');
        if (!btn) {
            return;
        }
        if (btn.id === 'btnSeriesMerge') {
            const sel = els.seriesBanner.querySelector('#seriesMergeInto');
            const target = sel && sel.value;
            if (target && seriesPrompt) {
                history.aliasSeries(seriesPrompt.rawKey, target);
                history.beginSession(clockNow());
                history.flush();
            }
        }
        seriesPrompt = null;          // both buttons dismiss it
        renderRiders();
    });

    // Jokes — deal the first joke immediately so Send/Skip are live on open.
    jokeDeck = new JokeDeck(JOKES);
    jokeDeck.next();
    renderJoke();
    syncJokeButtons();
    els.btnSendJoke.addEventListener('click', onSendJoke);
    els.btnSkipJoke.addEventListener('click', nextJoke);

    // Ride-leader picker (managed manually; persisted into the same settings store).
    els.leaderPicker.addEventListener('change', () => {
        const v = els.leaderPicker.value;
        settings.set('leaderId', v ? Number(v) : null);
        readConfigIntoEngine();
    });

    // Review queue actions
    els.reviewQueue.addEventListener('click', ev => {
        const btn = ev.target.closest('button[data-act]');
        if (!btn) {
            return;
        }
        const wrap = btn.closest('.review-item');
        const id = Number(wrap.dataset.id);
        const idx = reviewItems.findIndex(x => x.id === id);
        if (idx === -1) {
            return;
        }
        if (btn.dataset.act === 'discard') {
            reviewItems.splice(idx, 1);
            renderOutbox();
        } else {
            const edited = wrap.querySelector('.review-text').value;
            reviewItems.splice(idx, 1);
            renderOutbox();
            // Send the (possibly edited) text through the same chunk + throttle path.
            for (const p of chunkMessage(edited, Number(get('maxMessageLength')) || 90)) {
                sendQueue.push(p);
            }
            drainQueue();
        }
    });

    // Export / clear
    document.querySelector('#btnExportJSON').addEventListener('click', () => {
        download(`rlg-diagnostics-${stamp()}.json`, JSON.stringify(game.exportJSON(Date.now()), null, 2), 'application/json');
    });
    document.querySelector('#btnExportCSV').addEventListener('click', () => {
        download(`rlg-diagnostics-${stamp()}.csv`, game.exportCSV(), 'text/csv');
    });
    document.querySelector('#btnClearDiag').addEventListener('click', () => {
        game.diagnostics.length = 0;
        game.rawSamples.length = 0;
        renderDiag();
    });

    showVersion();

    // Live data through the stream service (live now, native later; replay for dev).
    streams.subscribe('nearby', onNearby);
    wireReplayControls();

    // Header = data/Sauce connection (WS status + data recency, updated each tick).
    document.addEventListener('sauce-ws-status', ({detail}) => {
        wsConnected = detail === 'connected';
        renderConn();
    });
    // Chat sending needs the separate Zwift game connection — track it independently.
    Common.subscribe('status', s => {
        gameLink = !!(s && s.connected);
        gameConnState = (s && s.state) || '';
        renderConn();
    }, {source: 'gameConnection', persistent: true});
    try {
        const gc = await Common.rpc.getGameConnectionStatus();
        wsConnected = true;                    // the RPC resolving means Sauce is reachable
        gameLink = !!(gc && gc.connected);
        gameConnState = (gc && gc.state) || '';
    } catch (e) {
        wsConnected = false;
    }
    renderConn();

    // 1s ticker drives the clock, time-up finish, and periodic standings even if nearby is quiet.
    setInterval(gameClock, 1000);

    syncButtons();
    renderAll();
}

function wireReplayControls() {
    const fileEl = document.querySelector('#replayFile');
    const speedEl = document.querySelector('#replaySpeed');
    const playBtn = document.querySelector('#btnReplayPlay');
    const liveBtn = document.querySelector('#btnGoLive');
    const info = document.querySelector('#replayInfo');
    const badge = document.querySelector('#replayBadge');

    function setBadge() {
        badge.textContent = replayMode ? 'REPLAY' : 'LIVE';
        badge.dataset.mode = replayMode ? 'replay' : 'live';
        liveBtn.disabled = !replayMode;
    }

    fileEl.addEventListener('change', async () => {
        const file = fileEl.files && fileEl.files[0];
        if (!file) {
            return;
        }
        const text = await file.text();
        const meta = streams.loadReplay(text, {speed: Number(speedEl.value) || 1});
        replayMode = true;
        onReset();   // clear any prior game state; clock is now replay-based
        setBadge();
        info.textContent = `Loaded ${meta.count.toLocaleString()} events · ${fmtClock(meta.durationMs)} · ${meta.events.join(', ')}`;
        playBtn.disabled = meta.count === 0;
        playBtn.textContent = '▶ Play';
    });

    speedEl.addEventListener('change', () => streams.setSpeed(Number(speedEl.value) || 1));

    playBtn.addEventListener('click', () => {
        if (streams.getReplayState().playing) {
            streams.pause();
            playBtn.textContent = '▶ Play';
        } else {
            if (game.state !== STATES.RUNNING) {
                beginGame();   // auto-start immediately (dev replay skips the pre-roll instructions/delay)
            }
            streams.play();
            playBtn.textContent = '⏸ Pause';
        }
    });

    liveBtn.addEventListener('click', () => {
        streams.useLive();
        replayMode = false;
        onReset();
        setBadge();
        info.textContent = '';
        playBtn.disabled = true;
        playBtn.textContent = '▶ Play';
    });

    streams.on('replay-progress', st => {
        info.textContent = `${fmtClock(st.positionMs)} / ${fmtClock(st.durationMs)}  (${st.index}/${st.total})`;
    });
    streams.on('replay-end', () => {
        playBtn.textContent = '▶ Play';
        if (game.state === STATES.RUNNING) {
            game.finish(clockNow());
            onFinish();
        }
    });

    setBadge();
}

function gameClock() {
    const now = clockNow();
    if (game.state === STATES.RUNNING) {
        if (now >= game.endTime) {
            game.finish(now);
            onFinish();
        } else if (get('announcePeriodic')) {
            const interval = (Number(get('announceIntervalSec')) || 120) * 1000;
            if (now - lastPeriodicAnnounce >= interval) {
                lastPeriodicAnnounce = now;
                const msg = game.standingsMessage(now);
                if (msg) {
                    enqueueMessage(msg);
                }
            }
        }
    }
    if (lastState !== game.state) {
        lastState = game.state;
        syncButtons();
    }
    renderClock();
    renderEvent();  // keep the "since event start" elapsed + totals ticking even when nearby is quiet
    // Riders cross the presence threshold on a timer, not on a data change, so the pending counts and
    // the late-join hint have to tick too.
    renderRiders();
    renderConn();   // refresh "receiving data" vs "waiting" as data recency changes
    renderJokeStatus();   // live "punchline in Ns…" countdown while a joke send is pending
}
