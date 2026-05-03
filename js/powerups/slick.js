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
//   • Step-resets are budgeted (LOCK_DELAY_MAX_RESETS per piece) to
//     prevent the classic rotate-spam infinity. The budget refills
//     whenever the piece reaches a new lowest row, so honest
//     downward progress (gravity pulling the piece deeper, sliding
//     into a hole) keeps adjustments available — only stalling in
//     place at the same depth burns it down.
//
// State (`game.lockDelayTimer`) lives on the Game so other plugins
// (Whoops, Gravity, Flip) can reset it directly when they're rewinding
// or freezing the active piece. The reset-budget counter and lowest-y
// tracker live in the plugin-state bag at `_pluginState.slick`.
// Renderer / HUD don't read either.

import { LOCK_DELAY, LOCK_DELAY_MAX_RESETS } from '../constants.js';
import { tryMove } from '../piece.js';

export default {
  id: 'slick',
  name: 'Slick',
  description: 'Pieces lock slightly later',
  // Tetris-only — the lock-delay window doesn't carry meaning in
  // Puyo (pairs lock immediately on collision, no soft-drop dance).
  modes: ['tetris'],
  available: (game) => !game.unlocks.slick,
  apply:     (game) => { game.unlocks.slick = true; },

  // ---- lifecycle hooks ----

  // Claim the plugin-state slot. resetsRemaining gates further
  // step-resets after the per-piece budget is spent; lowestY tracks
  // the deepest row the active piece has ever reached so we can
  // refill the budget when the piece falls further.
  reset: (game) => {
    game._pluginState.slick = { resetsRemaining: LOCK_DELAY_MAX_RESETS, lowestY: -Infinity };
  },

  // Defer softDrop's immediate lock when Slick is unlocked. Without this,
  // a soft-drop that lands the piece would lock instantly and bypass
  // the delay window — the whole point of the power-up.
  shouldDeferLock: (game) => game.unlocks.slick,

  // Step-reset on spawn — a brand-new piece always gets a full window
  // AND a fresh reset budget. lowestY seeds to the spawn row so the
  // first time gravity pulls the piece down counts as new progress.
  onSpawn: (game) => {
    game.lockDelayTimer = 0;
    const slickState = game._pluginState.slick;
    if (slickState) {
      slickState.resetsRemaining = LOCK_DELAY_MAX_RESETS;
      slickState.lowestY = game.current ? game.current.y : -Infinity;
    }
  },

  // Step-reset on any successful in-place adjustment (move / rotate /
  // flip) so the player can chain inputs into a tight slot — but only
  // while the per-piece budget has resets left. Once exhausted, the
  // timer keeps running and the piece will lock within LOCK_DELAY ms
  // even if the player keeps spamming inputs. The budget is replenished
  // by the tick() hook whenever the piece reaches a new lowest row.
  onPlayerAdjustment: (game) => {
    const slickState = game._pluginState.slick;
    if (!slickState) { game.lockDelayTimer = 0; return; }
    if (slickState.resetsRemaining > 0) {
      game.lockDelayTimer = 0;
      slickState.resetsRemaining -= 1;
    }
  },

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

    // Refill the step-reset budget whenever the piece reaches a row
    // it hasn't seen before. Catches gravity drops, soft drops, and
    // sideways-into-a-hole all in one place — anything that lowers
    // the piece's y counts as "made progress, you've earned more
    // adjustments at this new depth."
    const slickState = game._pluginState.slick;
    if (slickState && game.current.y > slickState.lowestY) {
      slickState.lowestY = game.current.y;
      slickState.resetsRemaining = LOCK_DELAY_MAX_RESETS;
    }

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
