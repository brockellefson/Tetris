// Power-up: Whoops — banked one-shot rewind. Pressing W after
// the player picks this card undoes the most recently locked
// piece: the cells it placed are removed, any rows it cleared
// come back fully populated, the score (line bonus + soft/hard
// drop points + combo + B2B + perfect-clear) snaps back, lines
// and level revert, queue/hold revert, and the piece is respawned
// fresh at the top so the player gets a do-over.
//
// Flow:
//   1. apply()    — bumps `game.unlocks.whoopsCharges` (capped at
//                   MAX_WHOOPS_CHARGES = 1).
//   2. W keypress — input.js calls game.tryActivateWhoops(), which
//                   restores the snapshot captured at the top of
//                   lockCurrent() and respawns the piece.
//
// Why a single charge: this is a strong "take-back." Stacking it
// would let the player undo arbitrarily far, which trivializes
// mistakes. With a single charge, picking Whoops is a deliberate
// "save it for the moment that really hurts" decision.
//
// Available only while the player has zero charges banked, so the
// card vanishes from the menu the moment they own one.

import { MAX_WHOOPS_CHARGES } from '../constants.js';

export default {
  id: 'whoops',
  name: 'Whoops',
  description: 'Press W to undo your last piece. One charge.',
  available: (game) => game.unlocks.whoopsCharges < MAX_WHOOPS_CHARGES,
  apply: (game) => {
    game.unlocks.whoopsCharges = Math.min(
      MAX_WHOOPS_CHARGES,
      game.unlocks.whoopsCharges + 1,
    );
  },
};
