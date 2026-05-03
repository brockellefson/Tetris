// ============================================================
// Puyo card pool registry
// ============================================================
//
// Single source of truth for the cards the Puyo modes can offer
// at milestones. Mirror of js/powerups/index.js (Tetris's
// registry) but its picker also gates by `card.modes` so versus-
// only cards (Shield, Thorns) don't surface in SP picks.
//
// To add a new card:
//   1. Drop the file in this directory.
//   2. Import + add to PUYO_POWERUPS below.
//   3. If it has lifecycle hooks, register it as a plugin in
//      main.js too (existing cards already do this).

import luckyDraw  from './lucky-draw.js';
import shield     from './shield.js';
import thorns     from './thorns.js';
import colorLock  from './color-lock.js';
import colorBlind from './color-blind.js';

export const PUYO_POWERUPS = [
  luckyDraw,
  shield,
  thorns,
  colorLock,
  colorBlind,
];

// Pick up to `count` random eligible cards for the current mode.
// Two filter passes:
//   • modes — drop cards whose modes array doesn't include the
//     active mode id (versus-only cards stay out of SP picks).
//   • available — drop cards whose own gate refuses them
//     (already-picked unique cards, prerequisite-not-met cards).
// Then Fisher-Yates shuffle and slice.
export function pickPuyoChoices(game, count = 3) {
  const modeId = game.mode?.id;
  const eligible = PUYO_POWERUPS.filter(card => {
    if (card.modes && !card.modes.includes(modeId)) return false;
    return card.available?.(game) !== false;
  });
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
