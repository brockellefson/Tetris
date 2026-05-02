// Power-ups: special-block blessings — Bomb I-III, Lightning I-III,
// and Welder I-III.
//
// Each special block is gated behind picking the matching blessing card.
// Picking the card the FIRST time unlocks that special at level 1 — it
// starts spawning on the board (subject to the standard chance roll
// in js/specials/index.js). Picking it again upgrades to level 2,
// then level 3 (capped at SPECIAL_MAX_LEVEL). The trigger code in
// js/specials/<id>.js reads the level from `game.unlocks.specials[id]`
// at fire time, so an upgrade retroactively buffs every cell already
// on the board — picking Bomb III mid-run instantly turns every
// suspended Bomb-tag into a 5×5 detonation.
//
// Each tier follows the Psychic-card pattern: a separate card object,
// `available()` gated on "the previous tier has been picked." That
// keeps the menu's three-card pick from showing a player Bomb III
// when they don't yet have Bomb I — would look like a free upgrade
// the first time.
//
// Per-level wording is hand-written (rather than templated from the
// special's own `description`) so each card spells out exactly what
// the upgrade buys: 3×3 vs. 4×4 vs. 5×5, "above" vs. "full column"
// vs. "full column + row." The card description is the player's only
// information surface for the math, so it has to be specific.

import { SPECIAL_MAX_LEVEL } from '../constants.js';

// Read-helper that survives a brand-new game (`unlocks.specials` may
// not be populated until the first reset() runs through). The
// available() callbacks in the choice menu fire at pick time, so the
// fallback only matters for the very first menu open of a fresh game.
function specialLevel(game, id) {
  return game.unlocks?.specials?.[id] ?? 0;
}

// ---- Bomb tiers --------------------------------------------------

const BOMB_DESCRIPTIONS = {
  1: 'Bomb blocks start spawning. Detonations carve a 3×3 square.',
  2: 'Bomb detonations grow to a 4×4 square.',
  3: 'Bomb detonations grow to a 5×5 square.',
};
function makeBombTier(n) {
  return {
    id: `bomb-${n}`,
    name: n === 1 ? 'Bomb' : `Bomb ${'I'.repeat(n)}`,
    description: BOMB_DESCRIPTIONS[n],
    // Available only when the previous tier is already in hand.
    // Tier 1 gates on level === 0 (not yet picked); higher tiers gate
    // on the matching prior level so the player upgrades in lock-step.
    available: (game) => specialLevel(game, 'bomb') === n - 1,
    apply: (game) => {
      game.unlocks.specials.bomb = Math.min(SPECIAL_MAX_LEVEL, n);
    },
  };
}
export const bomb1 = makeBombTier(1);
export const bomb2 = makeBombTier(2);
export const bomb3 = makeBombTier(3);

// ---- Lightning tiers ---------------------------------------------

const LIGHTNING_DESCRIPTIONS = {
  1: 'Lightning blocks start spawning. Strikes destroy every block above them in the column.',
  2: 'Lightning strikes now destroy the entire column (above and below).',
  3: 'Lightning strikes now destroy the entire column AND the entire row.',
};
function makeLightningTier(n) {
  return {
    id: `lightning-${n}`,
    name: n === 1 ? 'Lightning' : `Lightning ${'I'.repeat(n)}`,
    description: LIGHTNING_DESCRIPTIONS[n],
    available: (game) => specialLevel(game, 'lightning') === n - 1,
    apply: (game) => {
      game.unlocks.specials.lightning = Math.min(SPECIAL_MAX_LEVEL, n);
    },
  };
}
export const lightning1 = makeLightningTier(1);
export const lightning2 = makeLightningTier(2);
export const lightning3 = makeLightningTier(3);

// ---- Welder tiers ------------------------------------------------
//
// Defensive special — fills holes rather than destroying blocks.
// Tier 3 ("The Patch") is a sweeping welds-everything-3-sides-covered
// effect. The wording explicitly names "the deepest" hole at L1 so
// the player knows which buried hole they're paying for; the actual
// "deepest" tiebreak in welder.js is by depth then by lower y.

const WELDER_DESCRIPTIONS = {
  1: 'Welder blocks start spawning. Patches fill the deepest hole on the board.',
  2: 'Welder patches now fill the 3 deepest holes on the board.',
  3: 'Welder fills every hole with at least 3 sides covered.',
};
function makeWelderTier(n) {
  return {
    id: `welder-${n}`,
    name: n === 1 ? 'Welder' : `Welder ${'I'.repeat(n)}`,
    description: WELDER_DESCRIPTIONS[n],
    available: (game) => specialLevel(game, 'welder') === n - 1,
    apply: (game) => {
      game.unlocks.specials.welder = Math.min(SPECIAL_MAX_LEVEL, n);
    },
  };
}
export const welder1 = makeWelderTier(1);
export const welder2 = makeWelderTier(2);
export const welder3 = makeWelderTier(3);
