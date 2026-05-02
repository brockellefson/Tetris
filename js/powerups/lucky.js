// Power-up: Lucky I-III — boosts the spawn chance of special blocks.
//
// Stacks up to LUCKY_MAX_STACKS times; each stack adds a flat amount
// to the three SPECIAL_BLOCK_* knobs (base, per-level, max), see the
// formula in constants.js. Lucky is a "force multiplier" rather than
// a standalone effect: it does nothing if the player has no specials
// unlocked. The card's `available()` enforces that — Lucky only ever
// surfaces in the menu after the player has picked at least one
// Bomb/Lightning blessing, so a brand-new run can't waste a slot on
// Lucky before specials are even spawning.
//
// Same Psychic-card tier pattern as the Bomb/Lightning blessings.
// Tier 1 gates on `unlocks.lucky === 0`; tier 2 on `=== 1`; tier 3 on
// `=== 2`. Each pick increments the counter; the special-spawn picker
// reads it via `game.unlocks.lucky` and feeds it to
// `specialChanceForLevel(level, lucky)` in js/specials/index.js.

import { LUCKY_MAX_STACKS } from '../constants.js';

function anySpecialUnlocked(game) {
  const slots = game.unlocks?.specials ?? {};
  for (const k in slots) if (slots[k] > 0) return true;
  return false;
}

const LUCKY_DESCRIPTIONS = {
  1: 'Special blocks spawn more often.',
  2: 'Special blocks spawn even more often.',
  3: 'Special blocks spawn way more often.',
};
function makeLuckyTier(n) {
  return {
    id: `lucky-${n}`,
    name: n === 1 ? 'Lucky' : `Lucky ${'I'.repeat(n)}`,
    description: LUCKY_DESCRIPTIONS[n],
    // Two gates: the player must have at least one special unlocked
    // (Lucky is a multiplier on something — it shouldn't surface as
    // the very first pick), AND the previous Lucky tier must be in
    // hand so upgrades go 1 → 2 → 3 in order.
    available: (game) =>
      anySpecialUnlocked(game) &&
      (game.unlocks?.lucky ?? 0) === n - 1,
    apply: (game) => {
      game.unlocks.lucky = Math.min(LUCKY_MAX_STACKS, n);
    },
  };
}
export const lucky1 = makeLuckyTier(1);
export const lucky2 = makeLuckyTier(2);
export const lucky3 = makeLuckyTier(3);
