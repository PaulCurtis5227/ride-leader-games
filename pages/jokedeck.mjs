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
 * Ride Leader Games — joke deck (framework-agnostic, no DOM).
 *
 * Serves jokes in a random order that plays fairly: a shuffled "bag" is dealt out one at a time,
 * and only reshuffled once every joke has been shown (so nothing repeats until the deck is
 * exhausted). When a bag is reshuffled, the first joke of the new bag is guaranteed not to be the
 * one that just played, so there's never a back-to-back repeat across the seam.
 *
 * The RNG is injectable so the shuffle is deterministic under test; the control window passes
 * Math.random in production.
 */
export class JokeDeck {

    constructor(jokes, {rng = Math.random} = {}) {
        this.jokes = Array.isArray(jokes) ? jokes.slice() : [];
        this.rng = rng;
        this._bag = [];        // indices remaining to deal in the current shuffle
        this._current = null;  // the joke currently on display (null until first next())
        this._lastIndex = -1;  // index of the joke last dealt (to avoid a seam repeat)
    }

    get size() {
        return this.jokes.length;
    }

    /* The joke currently on display, or null before the first draw. */
    get current() {
        return this._current;
    }

    /*
     * Advance to the next joke and return it (also stored as `current`). Returns null only when the
     * deck is empty. Reshuffles a fresh bag when the current one is exhausted, avoiding an immediate
     * repeat of the joke that just played.
     */
    next() {
        if (!this.jokes.length) {
            this._current = null;
            return null;
        }
        if (!this._bag.length) {
            this._refill();
        }
        const index = this._bag.pop();
        this._lastIndex = index;
        this._current = this.jokes[index];
        return this._current;
    }

    /* Build a freshly shuffled bag of all indices; keep the just-played joke off the top. */
    _refill() {
        const indices = this.jokes.map((_, i) => i);
        // Fisher–Yates using the injected RNG.
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(this.rng() * (i + 1));
            const t = indices[i];
            indices[i] = indices[j];
            indices[j] = t;
        }
        // next() pops from the end, so the last element is dealt first. If that would repeat the
        // joke we just showed (and there's more than one joke), swap it toward the front.
        if (this.jokes.length > 1 && indices[indices.length - 1] === this._lastIndex) {
            const t = indices[indices.length - 1];
            indices[indices.length - 1] = indices[0];
            indices[0] = t;
        }
        this._bag = indices;
    }
}
