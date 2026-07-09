/*
 * Ride Leader Games — read-only leaderboard overlay.
 * Consumes the snapshot the Control window publishes to same-origin localStorage.
 * No engine, no sending — a single source of truth prevents double-sends.
 */
import * as Common from '/pages/src/common.mjs';

const STATE_SNAPSHOT_KEY = 'rlg:state';
let els;

function fmtClock(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function readSnapshot() {
    try {
        const raw = localStorage.getItem(STATE_SNAPSHOT_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

function render(snap) {
    if (!snap || snap.state === 'idle' || !snap.standings || !snap.standings.length) {
        els.empty.style.display = '';
        els.board.innerHTML = '';
        els.clock.textContent = snap && snap.state === 'running' ? fmtClock(snap.remainingMs) : '--:--';
        return;
    }
    els.empty.style.display = 'none';
    els.clock.textContent = snap.state === 'finished' ? 'done' : fmtClock(snap.remainingMs);
    document.documentElement.classList.toggle('finished', snap.state === 'finished');
    els.board.innerHTML = snap.standings.map((r, i) => `
        <li class="${r.qualified ? '' : 'unqualified'}">
            <span class="rank">${i + 1}</span>
            <span class="name">${Common.sanitize(r.name)}</span>
            <span class="avg">${Math.round(r.avg)}m</span>
        </li>`).join('');
}

export function main() {
    els = {
        clock: document.querySelector('#clock'),
        board: document.querySelector('#board'),
        empty: document.querySelector('#empty'),
    };
    render(readSnapshot());
    // Update when the control window writes a new snapshot (fires in other windows only)…
    window.addEventListener('storage', ev => {
        if (ev.key === STATE_SNAPSHOT_KEY) {
            render(readSnapshot());
        }
    });
    // …plus a slow poll as a safety net for the running clock.
    setInterval(() => render(readSnapshot()), 1000);
}
