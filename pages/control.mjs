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
import {DEFAULT_INSTRUCTIONS} from './messages.mjs';
import {getSauceStreams} from './s4z-streams.mjs';

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
    duration: 20,
    sendMode: SEND_MODES.SILENT,
    chatPrefix: '\u{1F3C1}',
    maxMessageLength: 90,
    messageDelay: 4,
    minSamples: 5,
    anomalyThresholdM: 150,
    leaderId: null,
    sendInstructions: true,
    instructions: DEFAULT_INSTRUCTIONS,
    startDelay: 15,          // seconds to wait after instructions before the start message/timer
    announceStart: true,
    announcePeriodic: false,
    announceIntervalSec: 120,
    announceWinner: true,
    resultsCount: 5,         // how many finishers to announce at the end
    showDiagnostics: true,
};

let game;
let els;
let lastState = STATES.IDLE;
let lastPeriodicAnnounce = 0;

// ---- pre-roll (Start clicked -> instructions -> delay -> start message + timer) ----
let starting = false;       // in the pre-roll phase (before the game timer runs)
let startGen = 0;           // bumped by Stop/Reset to cancel an in-flight pre-roll
let startPhase = '';        // '' | 'instructions' | 'countdown' (drives the clock display)
let preRollGoAt = 0;        // clockNow() ms when the start message fires (countdown target)
let lastNearbyCount = 0;
let wsConnected = false;   // connected to Sauce's web server (the data pipe)
let lastDataTs = 0;        // wall-clock ms of the last nearby tick (ground truth for "receiving data")
let gameLink = false;      // Zwift game connection (command channel) — only needed to SEND chat

// ---- send pipeline (chunk -> throttled queue -> send-mode gate) ----
const sendQueue = [];
let draining = false;
const outbox = [];          // {t, text, status}
const reviewItems = [];     // {id, text}
let reviewSeq = 0;


function get(key) {
    const v = settings.get(key);
    return v === undefined ? SETTING_DEFAULTS[key] : v;
}

function readConfigIntoEngine() {
    game.setConfig({
        durationMin: Number(get('duration')) || 20,
        minSamples: Number(get('minSamples')) || 1,
        anomalyThresholdM: Number(get('anomalyThresholdM')) || 150,
        chatPrefix: get('chatPrefix') ?? '',
        leaderId: get('leaderId') != null ? Number(get('leaderId')) : null,
    });
}


// ---------------------------------------------------------------- rendering

function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
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
    els.boardNote.textContent = rows.length ? `${rows.length} riders` : '';
    els.leaderboard.innerHTML = rows.map((r, i) => `
        <li class="${r.qualified ? '' : 'unqualified'}">
            <span class="rank">${i + 1}</span>
            <span class="name">${Common.sanitize(r.name)}</span>
            <span class="avg">${Math.round(r.avg)}m</span>
            <span class="samples" title="scoring samples${r.carriedTicks ? ` · ${r.carriedTicks} carried` : ''}">${r.samples}${r.carriedTicks ? '*' : ''}</span>
        </li>`).join('');
}

function renderOutbox() {
    els.modeBadge.textContent = get('sendMode');
    els.queueDepth.textContent = sendQueue.length ? `· ${sendQueue.length} queued` : '';
    els.outbox.innerHTML = outbox.slice(-40).reverse().map(o => `
        <li class="status-${o.status}">
            <span class="ts">${fmtClock(o.t - (game.startTime || o.t))}</span>
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

function renderAll() {
    renderClock();
    renderBoard();
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
        for (const block of instructionMessages(get('instructions'))) {
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
}


// ---------------------------------------------------------------- live data

function onNearby(entries) {
    lastNearbyCount = entries.length;
    lastDataTs = Date.now();
    updateLeaderPicker(entries);
    updateReference(entries);
    readConfigIntoEngine();
    if (game.state === STATES.RUNNING) {
        game.ingest(entries, clockNow());
        if (game.state === STATES.FINISHED) {   // ingest auto-finished on time-up
            onFinish();
            return;
        }
    }
    renderBoard();
    renderDiag();
}

function updateReference(entries) {
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
    els.ridersNote.textContent = `${lastNearbyCount} riders nearby` +
        (lastNearbyCount >= (game.config.maxRiders || 100) ? ' (list saturated)' : '');
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
    els.conn.querySelector('.txt').textContent = txt;

    // Chat sending needs the game connection (independent of the data feed above).
    if (els.sendReady) {
        const silent = get('sendMode') === SEND_MODES.SILENT;
        els.sendReady.textContent = gameLink ? 'chat link ✓'
            : silent ? 'chat off (Silent)'
            : 'chat link off — enable Game Connection to send';
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
        sendReady: document.querySelector('#sendReady'),
        clock: document.querySelector('#clock'),
        gameState: document.querySelector('#gameState'),
        leaderPicker: document.querySelector('#leaderPicker'),
        leaderFlag: document.querySelector('#leaderFlag'),
        ridersNote: document.querySelector('#ridersNote'),
        btnStart: document.querySelector('#btnStart'),
        btnStop: document.querySelector('#btnStop'),
        btnReset: document.querySelector('#btnReset'),
        boardNote: document.querySelector('#boardNote'),
        leaderboard: document.querySelector('#leaderboard'),
        modeBadge: document.querySelector('#modeBadge'),
        queueDepth: document.querySelector('#queueDepth'),
        reviewQueue: document.querySelector('#reviewQueue'),
        outbox: document.querySelector('#outbox'),
        diagSection: document.querySelector('#diagSection'),
        diagNote: document.querySelector('#diagNote'),
        diagLog: document.querySelector('#diagLog'),
        instructionsNote: document.querySelector('#instructionsNote'),
    };

    game = new RideLeaderGame({
        config: {},
        onDiag: ev => { console.debug('[rlg diag]', ev); },
    });
    readConfigIntoEngine();

    Common.initInteractionListeners();
    await Common.initSettingsForm('#configForm')();

    // initSettingsForm only fills a field when the store holds a defined value, so an unsaved
    // instructions setting leaves the textarea blank. Show the source default (display only — no
    // store write) so the leader sees exactly what Start will send; get('instructions') already
    // falls back to the same default via SETTING_DEFAULTS.
    if (settings.get('instructions') === undefined) {
        const ta = document.querySelector('#configForm [name="instructions"]');
        if (ta) {
            ta.value = DEFAULT_INSTRUCTIONS;
        }
    }

    // React to config changes (mode badge, prefix, diagnostics visibility, engine params).
    settings.addEventListener('set', () => {
        readConfigIntoEngine();
        renderOutbox();
        renderDiag();
    });

    // Buttons
    els.btnStart.addEventListener('click', onStart);
    els.btnStop.addEventListener('click', onStop);
    els.btnReset.addEventListener('click', onReset);

    // Load instructions from a text/markdown file into the (persisted) instructions field.
    const instructionsFile = document.querySelector('#instructionsFile');
    document.querySelector('#btnLoadInstructions').addEventListener('click', () => instructionsFile.click());
    instructionsFile.addEventListener('change', async () => {
        const file = instructionsFile.files && instructionsFile.files[0];
        if (!file) {
            return;
        }
        const text = await file.text();
        settings.set('instructions', text);   // fires the 'set' listener -> re-reads config
        const ta = document.querySelector('#configForm [name="instructions"]');
        if (ta) {
            ta.value = text;                   // keep the visible textarea in sync (programmatic set)
        }
        els.instructionsNote.textContent = `loaded ${file.name} (${instructionMessages(text).length} msg)`;
        instructionsFile.value = '';           // allow re-loading the same file later
    });

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

    // Live data through the stream service (live now, native later; replay for dev).
    streams.subscribe('nearby', onNearby);
    wireReplayControls();

    // Header = data/Sauce connection (WS status + data recency, updated each tick).
    document.addEventListener('sauce-ws-status', ({detail}) => {
        wsConnected = detail === 'connected';
        renderConn();
    });
    // Chat sending needs the separate Zwift game connection — track it independently.
    Common.subscribe('status', s => { gameLink = !!(s && s.connected); renderConn(); },
        {source: 'gameConnection', persistent: true});
    try {
        const gc = await Common.rpc.getGameConnectionStatus();
        wsConnected = true;                    // the RPC resolving means Sauce is reachable
        gameLink = !!(gc && gc.connected);
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
    renderConn();   // refresh "receiving data" vs "waiting" as data recency changes
}
