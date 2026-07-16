/*
 * Ride Leader Games — default message text (framework-agnostic, no DOM).
 *
 * Single source of truth for the default text of every message the mod sends. Kept as plain
 * strings + template functions (no locale/ResourceBundle machinery), mirroring the sibling
 * Velodrome mod's messages module.
 *
 * Two kinds live here:
 *  - DEFAULT_INSTRUCTIONS — the default value for the *configurable* instructions blob. The leader
 *    can override it in the control window; this is just the out-of-the-box starting text.
 *  - MESSAGES — templates for the auto-generated (non-configurable) messages the engine emits.
 *    Numeric formatting and the chat prefix stay in the engine, so these receive already-formatted
 *    strings and hold nothing but wording.
 */

/*
 * Default instructions, sent at game start (one message per blank-line-separated block — see
 * instructionMessages() in engine.mjs). Editable per game in the control window.
 */
export const DEFAULT_INSTRUCTIONS =
    "Ride Leader Game! The goal is simple: stay as close to the ride leader as you can. " +
    "Your score each moment is how far you are from the leader.\n\n" +
    "The winner is the rider with the lowest AVERAGE distance from the leader over the whole game. " +
    "Hold the wheel, don't half-wheel, and don't get gapped!\n\n" +
    "Heads up: only about 100 riders can be scored at once, and results can get a little noisy " +
    "around intersections and road-segment transitions. Have fun and ride safe.";

/*
 * Auto-generated message templates. `avgM` params are pre-formatted distance strings (e.g. "42m");
 * the chat prefix is prepended by the engine, not here.
 */
export const MESSAGES = {
    start: durationMin =>
        `Ride Leader Game ON! Closest average distance to the leader over ` +
        `${durationMin} min wins. Hold the wheel!`,

    // One ranking entry, shared by the standings list and the winner runner-ups.
    rankEntry: (rank, name, avgM) => `${rank}) ${name} ${avgM}`,

    standings: (seconds, parts) => `${seconds} to go. Standings: ${parts.join('  ')}`,

    winner: (name, avgM, restParts) => {
        let msg = `Winner: ${name} — avg ${avgM} from the leader!`;
        if (restParts && restParts.length) {
            msg += ` Then ${restParts.join('  ')}`;
        }
        return msg;
    },

    noQualifiers: minSamples => `Game over — no winner winners needed ${minSamples}+ samples.`,
};
