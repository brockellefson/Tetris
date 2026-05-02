// Power-up: Flip — unlock-once ability that horizontally mirrors
// the currently falling piece. Useful for un-stuck situations
// where the piece is the wrong handedness for the slot you've
// built (e.g. an L when you need a J, or an S when you need a Z).
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry. Picking the
//      card flips `game.unlocks.flip` to true; the card stops
//      surfacing in the menu. The spend logic lives below.
//
//   2. Lifecycle plugin (reset, onClear, interceptInput) —
//      registered on the Game in main.js. The F-key dispatch lives
//      in input.js as game._interceptInput('flip:activate'). Each
//      cast arms a per-cast cooldown stored at
//      `_pluginState.flip.cooldown`; the HUD reads it to render the
//      gray progress-fill tag while the timer drains.
//
// Unlike Chisel/Fill, there's no cell-pick step — the flip is
// instant. Once unlocked the player can keep recasting, gated only
// by the COOLDOWN_LINES line clears between casts.
//
// Mirroring caveats:
//   • I, O are symmetric — flipping is visually a no-op but still
//     arms the cooldown if it succeeds, since gating doesn't peek
//     into the shape's symmetry.
//   • S↔Z, L↔J effectively swap the piece type's appearance.
//   • T's three-piece-bottom orientation flips left/right depending
//     on rotation.
//
// Activation gating mirrors the original tryActivateFlip: refuses
// while the game isn't running, while paused / over, while a modal
// plugin (Chisel / Fill / Gravity) freezes gameplay, while the
// choice menu is open, mid-line-clear, while the unlock is off,
// while the cooldown is non-zero, with no current piece, or when
// the mirrored shape would collide at the current position. A
// blocked flip costs no cooldown — the player can move / rotate
// and try again. A successful flip fires onPlayerAdjustment so
// Slick refreshes its lock-delay window for chained inputs.

import { COOLDOWN_LINES } from '../constants.js';
import { tryFlip } from '../piece.js';

const fls = (game) => game._pluginState.flip;

function activate(game) {
  if (!game.started) return false;
  if (game.paused || game.gameOver) return false;
  if (game.pendingChoices > 0) return false;
  if (game.isClearing()) return false;
  if (game._isFrozenByPlugin()) return false;
  if (!game.unlocks.flip) return false;
  // Per-cast cooldown — once the player has cast Flip, the next
  // cast is locked behind COOLDOWN_LINES line clears. The HUD
  // surfaces this with a gray tag and a left-to-right progress fill.
  const s = fls(game);
  if (s && s.cooldown > 0) return false;
  if (!game.current) return false;
  const flipped = tryFlip(game.board, game.current);
  if (!flipped) return false;
  game.current = flipped;
  if (s) s.cooldown = COOLDOWN_LINES;
  // Step-reset Slick's lock-delay via the standard hook (cleaner than
  // poking game.lockDelayTimer directly — Slick is the only listener).
  game._notifyPlugins('onPlayerAdjustment', 'flip');
  game.onFlip?.();
  return true;
}

export default {
  id: 'flip',
  name: 'Flip',
  description: 'Press F to mirror the active piece. 5-line cooldown.',
  available: (game) => !game.unlocks.flip,
  apply: (game) => {
    game.unlocks.flip = true;
  },

  // ---- lifecycle hooks ----

  // Seed the flip slot in the plugin-state bag on every Game.reset()
  // so a restart doesn't carry a stale cooldown across runs.
  reset(game) {
    game._pluginState.flip = { cooldown: 0 };
  },

  // Tick the per-cast cooldown down once per cleared line.
  onClear(game, cleared) {
    const s = fls(game);
    if (!s) return;
    if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - cleared);
  },

  interceptInput(game, action) {
    if (action !== 'flip:activate') return false;
    return activate(game);
  },
};
