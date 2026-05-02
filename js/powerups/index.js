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
// Special-block blessings — Bomb / Lightning each have three tiers
// (Psychic-style: each tier `available()` gates on the prior level
// already being in hand). Picking the tier-1 card unlocks the
// matching special at level 1 so it starts spawning; tiers 2 and 3
// upgrade the on-trigger effect. See js/powerups/specials.js for the
// per-level wording and js/specials/<id>.js for the trigger math.
import {
  bomb1, bomb2, bomb3,
  // Lightning tiers are temporarily withheld from the pool — column
  // clears tax the player (carve a well they have to refill) instead
  // of rewarding them, so Lightning is sitting out until the trigger
  // is reworked. The lightning.js special + debug "Force Lightning"
  // pill still work; only the blessing path is gated off.
  // lightning1, lightning2, lightning3,
  welder1, welder2, welder3,
} from './specials.js';
// Lucky — multiplies the spawn rate of any unlocked specials. Three
// stacks max. `available()` requires at least one special blessing
// unlocked, so the card never appears in a fresh-run menu before
// specials are spawning.
import { lucky1, lucky2, lucky3 } from './lucky.js';

// NOTE: Gravity used to live here (and later as a special block).
// It's been retired from the player-pickable card pool entirely.
// The cascade engine itself still lives in js/effects/gravity-cascade.js
// — Bomb detonations call into it to drop floating debris into the
// crater. Future trigger sources (a curse, a chained special) can
// keep calling startGravityCascade without rewiring anything.

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
  bomb1, bomb2, bomb3,
  // lightning1, lightning2, lightning3,  // see import comment above
  welder1, welder2, welder3,
  lucky1, lucky2, lucky3,
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
