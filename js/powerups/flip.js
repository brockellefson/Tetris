// Power-up: Flip — banked charge that horizontally mirrors the
// currently falling piece. Useful for un-stuck situations where
// the piece is the wrong handedness for the slot you've built
// (e.g. an L when you need a J, or an S when you need a Z).
//
// Flow:
//   1. apply()          — bumps `game.unlocks.flipCharges` (capped
//                         at MAX_FLIP_CHARGES).
//   2. F keypress       — input.js calls game.tryActivateFlip(),
//                         which mirrors the active piece and spends
//                         one charge if (and only if) the flipped
//                         shape fits at the current position.
//
// Unlike Chisel/Fill, there's no cell-pick step — the flip is
// instant. The cap is one charge, so the pick is a deliberate
// "spend it on the right piece" decision rather than a stockpile.
//
// Mirroring caveats:
//   • I, O are symmetric — flipping is visually a no-op but still
//     spends a charge if there's space, since gating doesn't peek
//     into the shape's symmetry.
//   • S↔Z, L↔J effectively swap the piece type's appearance.
//   • T's three-piece-bottom orientation flips left/right depending
//     on rotation.
//
// Available until the player has banked the maximum number of
// charges. The "is the flip actually possible right now?" check
// lives on tryActivateFlip().

import { MAX_FLIP_CHARGES } from '../constants.js';

export default {
  id: 'flip',
  name: 'Flip',
  description: 'Press F to mirror the active piece. One charge.',
  available: (game) => game.unlocks.flipCharges < MAX_FLIP_CHARGES,
  apply: (game) => {
    game.unlocks.flipCharges = Math.min(
      MAX_FLIP_CHARGES,
      game.unlocks.flipCharges + 1,
    );
  },
};
