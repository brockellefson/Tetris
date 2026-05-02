// ============================================================
// Power-up registry
// ============================================================
//
// Single source of truth for which power-ups exist. To add a new
// one: create the file, import it here, add it to ALL_POWERUPS.
// Nothing else in the project needs to know about it.
//
// pickChoices(game, n) returns up to `n` random power-ups that
// are currently `available()` — the menu uses this to populate
// the choice cards.
// ============================================================

import hold     from './hold.js';
import ghost    from './ghost.js';
import { next1, next2, next3, next4, next5 } from './psychic.js';
import mercy     from './mercy.js';
import chisel    from './chisel.js';
import fill      from './fill.js';
import flip      from './flip.js';
import tired     from './tired.js';
import slick     from './slick.js';
import whoops    from './whoops.js';
import dispell   from './dispell.js';

// NOTE: Gravity used to live here as a one-shot blessing. It moved
// to a special block (see js/specials/gravity.js) — the player now
// earns the cascade by clearing (or chiseling) a Gravity-tagged
// mino, rather than picking it from a menu. The cascade engine
// itself lives in js/effects/gravity-cascade.js so any future
// trigger source (curse, key combo, chained special) can call it.

export const ALL_POWERUPS = [
  hold,
  ghost,
  next1,
  next2,
  next3,
  next4,
  next5,
  mercy,
  chisel,
  fill,
  flip,
  tired,
  slick,
  whoops,
  dispell,
];

// Pick up to `count` random eligible power-ups for the choice menu.
// Returns fewer than `count` if not enough are currently available.
export function pickChoices(game, count = 3) {
  const eligible = ALL_POWERUPS.filter(p => p.available(game));
  // Fisher-Yates shuffle a copy, then take the first `count`.
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
