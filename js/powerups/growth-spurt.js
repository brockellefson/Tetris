// Power-ups: Growth Spurt I-V — each tier widens the board by one
// column (added on the right edge). Tiers unlock sequentially the same
// way Foresight does, so the player must pick I before II, II before
// III, etc., capping at +5 columns.
//
// The actual board mutation lives in Game.addColumn(); this file is
// just the unlock-gating registry entries so the menu can offer the
// right next tier and surface a sensible description.

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

function makeTier(n) {
  return {
    id: `growth-spurt-${n}`,
    name: `Growth Spurt ${ROMAN[n - 1]}`,
    description: n === 1
      ? 'Widen the playfield by one column.'
      : `Widen the playfield by another column (+${n} total).`,
    // Linear progression — only offered once the previous tier is taken.
    available: (game) => game.unlocks.extraCols === n - 1,
    apply: (game) => {
      game.unlocks.extraCols = n;
      game.addColumn();
    },
  };
}

export const growth1 = makeTier(1);
export const growth2 = makeTier(2);
export const growth3 = makeTier(3);
export const growth4 = makeTier(4);
export const growth5 = makeTier(5);
