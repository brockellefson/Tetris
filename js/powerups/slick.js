// Power-up: Slick — pieces lock in place slightly later, giving the
// player a short window to make split-second adjustments after a piece
// touches down.
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry.
//
//   2. Lifecycle plugin (tick, shouldDeferLock, onSpawn,
//      onPlayerAdjustment) — consumed by Game's plugin runtime so the
//      lock-delay logic lives next to the card definition instead of
//      bleeding into game.js's tick() and softDrop(). main.js
//      registers it via game.registerPlugin() at boot.
//
// Behavior summary:
//   • shouldDeferLock returns true while Slick is unlocked, which
//     tells Game.softDrop() to skip its immediate lock-on-collision.
//   • tick() advances `game.lockDelayTimer` while the piece is
//     grounded, and calls game.lockCurrent() once the timer crosses
//     LOCK_DELAY. The instant the piece is no longer grounded
//     (player slid it off a ledge), the timer resets to 0.
//   • onSpawn / onPlayerAdjustment reset the timer so each fresh
//     piece (and each successful in-place adjustment) gets a full
//     LOCK_DELAY window — the "step-reset" rule.
//
// State (`game.lockDelayTimer`) lives on the Game so other plugins
// (Whoops, Gravity, Flip) can reset it directly when they're rewinding
// or freezing the active piece. Renderer / HUD don't read it.

import { LOCK_DELAY } from '../constants.js';
import { tryMove } from '../piece.js';

export default {
  id: 'slick',
  name: 'Slick',
  description: 'Pieces lock slightly later',
  available: (game) => !game.unlocks.slick,
  apply:     (game) => { game.unlocks.slick = true; },

  // ---- lifecycle hooks ----

  // Defer softDrop's immediate lock when Slick is unlocked. Without this,
  // a soft-drop that lands the piece would lock instantly and bypass
  // the delay window — the whole point of the power-up.
  shouldDeferLock: (game) => game.unlocks.slick,

  // Step-reset on spawn — a brand-new piece always gets a full window.
  onSpawn: (game) => { game.lockDelayTimer = 0; },

  // Step-reset on any successful in-place adjustment (move / rotate /
  // flip) so the player can chain inputs into a tight slot. Game.move
  // and Game.rotate fire this hook directly; Flip fires it from its
  // own tryActivate path.
  onPlayerAdjustment: (game) => { game.lockDelayTimer = 0; },

  // The actual lock-delay timing loop. Runs every frame, but no-ops
  // when Slick isn't unlocked, when the game is frozen / clearing,
  // or when there's no current piece.
  tick: (game, dt) => {
    if (!game.unlocks.slick)   return;
    if (!game.current)         return;
    if (game.isClearing())     return;
    // While any plugin freezes gameplay (Chisel cell-pick, Fill
    // cell-pick, Gravity cascade), the active piece doesn't really
    // exist for the player — pause the timer.
    if (game._isFrozenByPlugin()) return;
    const grounded = !tryMove(game.board, game.current, 0, 1);
    if (grounded) {
      game.lockDelayTimer += dt;
      if (game.lockDelayTimer >= LOCK_DELAY) {
        game.lockDelayTimer = 0;
        game.lockCurrent();
      }
    } else {
      game.lockDelayTimer = 0;
    }
  },
};
