// Power-up: Flip — banked charge that horizontally mirrors the
// currently falling piece. Useful for un-stuck situations where
// the piece is the wrong handedness for the slot you've built
// (e.g. an L when you need a J, or an S when you need a Z).
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry. apply() just
//      bumps the charge counter; the spend logic is below.
//
//   2. Lifecycle plugin (interceptInput) — registered on the Game in
//      main.js. The F-key dispatch lives in input.js as
//      game._interceptInput('flip:activate').
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
// Activation gating mirrors the original tryActivateFlip: refuses
// while the game isn't running, while paused / over, while a modal
// plugin (Chisel / Fill / Gravity) freezes gameplay, while the
// choice menu is open, mid-line-clear, with no charges, no current
// piece, or when the mirrored shape would collide at the current
// position. A blocked flip costs no charge — the player can move /
// rotate and try again. A successful flip fires onPlayerAdjustment
// so Slick refreshes its lock-delay window for chained inputs.

import { MAX_FLIP_CHARGES } from '../constants.js';
import { tryFlip } from '../piece.js';

function activate(game) {
  if (!game.started) return false;
  if (game.paused || game.gameOver) return false;
  if (game.pendingChoices > 0) return false;
  if (game.isClearing()) return false;
  if (game._isFrozenByPlugin()) return false;
  if (game.unlocks.flipCharges <= 0) return false;
  if (!game.current) return false;
  const flipped = tryFlip(game.board, game.current);
  if (!flipped) return false;
  game.unlocks.flipCharges -= 1;
  game.current = flipped;
  // Step-reset Slick's lock-delay via the standard hook (cleaner than
  // poking game.lockDelayTimer directly — Slick is the only listener).
  game._notifyPlugins('onPlayerAdjustment', 'flip');
  game.onFlip?.();
  return true;
}

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

  // ---- lifecycle hooks ----

  interceptInput(game, action) {
    if (action !== 'flip:activate') return false;
    return activate(game);
  },
};
