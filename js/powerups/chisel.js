// Power-up: Chisel — grants a banked charge that lets the player
// remove a single 1×1 block of their choice from the board.
//
// The interaction is split across four layers now:
//
//   1. apply()           — bumps `game.unlocks.chiselCharges` (capped at
//                          MAX_CHISEL_CHARGES). Picking the card no
//                          longer freezes the game; the charge sits in
//                          inventory until the player decides to spend it.
//
//   2. A keypress        — input.js calls game.tryActivateChisel(),
//                          which spends one charge and sets
//                          `game.chisel.active = true`. The Game's
//                          tick() then freezes gameplay until the
//                          player picks a block.
//
//   3. main.js click /
//      keyboard cursor   — translates the click or Enter into a
//                          (col, row) and calls game.chiselSelect.
//                          A real block starts the destruction
//                          animation (`game.chisel.target`).
//
//   4. render.js         — paints a "click a block" prompt while
//                          `chisel.active`, and the shatter animation
//                          while `chisel.target` exists.
//
// Available until the player has banked the maximum number of charges.
// We don't gate on board contents at pick time (charges persist across
// many pieces, the board state at activation is what matters), so the
// at-least-one-block check lives on tryActivateChisel() instead.

import { MAX_CHISEL_CHARGES } from '../constants.js';

export default {
  id: 'chisel',
  name: 'Chisel',
  description: 'Press A to remove any 1×1 block. Stacks up to 3.',
  available: (game) => game.unlocks.chiselCharges < MAX_CHISEL_CHARGES,
  apply: (game) => {
    game.unlocks.chiselCharges = Math.min(
      MAX_CHISEL_CHARGES,
      game.unlocks.chiselCharges + 1,
    );
  },
};
