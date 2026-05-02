// ============================================================
// Gravity cascade — pure board-compaction engine
// ============================================================
//
// A one-shot sequence that pauses the active piece, makes every
// locked block fall into any empty space below it, clears any rows
// completed by the cascade (with the standard line-clear animation,
// score, B2B / combo / perfect-clear bonuses), and loops until the
// board settles.
//
// This module used to be the Gravity power-up, then briefly a
// dedicated Gravity special block. It's now a plain "effect" with
// no card or special metadata: today's trigger sources are Bomb
// detonations (so falling debris fills the crater) and the debug
// menu's "Gravity Cascade" pill. Decoupling the engine from any
// specific card lets future triggers (a curse? a key combo? a
// chain reaction from another special?) call into the same cascade
// without touching this file.
//
// Public surface:
//   startGravityCascade(game)   kick off a cascade — idempotent (refuses
//                               if one is already running)
//   default export              plugin object — register from main.js
//                               so freezesGameplay / tick fire each frame
//
// The state slot lives in the generic plugin-state bag at
// `game._pluginState.gravity = { active, savedPiece, phase,
// stepTimer }`, seeded by this plugin's reset hook. The renderer
// reads it from the bag so it can hide `current` while a cascade is
// running (otherwise falling locked blocks would visually pass
// through the parked piece). All mutations flow through this file.
//
// Phases (driven by `game._pluginState.gravity.phase`):
//   'fall'      — accumulate dt; each GRAVITY_POWER_STEP ms run one
//                 step that drops every floating block by one row
//                 (bottom-up so the cascade has a visible "rain"
//                 cadence). When a step is a no-op, check for full
//                 rows; either kick off the standard clear animation
//                 (transition to 'clearing') or wrap up.
//   'clearing'  — advance clearTimer; when the standard clear
//                 duration elapses, run a gravity-flavored clear
//                 (standard scoring + milestone awards, but DON'T
//                 spawn a new piece — the cascade owns the active-
//                 piece slot until endCascade).

import {
  CLEAR_DURATION,
  GRAVITY_POWER_STEP,
  lineClearScore,
  B2B_MULTIPLIER,
  COMBO_BONUS,
  PERFECT_CLEAR_BONUS,
  MENU_SETTLE_MS,
} from '../constants.js';
import { collides, findFullRows, removeRows } from '../board.js';

// Convenience accessor — slot lives in the plugin-state bag, seeded
// by this plugin's reset hook.
const gs = (game) => game._pluginState.gravity;

// Begin the gravity cascade. Idempotent — refuses to re-enter if a
// sequence is already running. The active piece is moved into
// `savedPiece` and `current` is cleared so the renderer hides it for
// the duration (otherwise falling locked blocks would visually pass
// through the piece's silhouette).
export function startGravityCascade(game) {
  const s = gs(game);
  if (!s || s.active) return;
  s.active     = true;
  s.savedPiece = game.current;
  game.current = null;
  s.phase      = 'fall';
  s.stepTimer  = 0;
  // Cancel any in-flight Slick lock-delay window — there's no active
  // piece for it to apply to during the cascade.
  game.lockDelayTimer = 0;
  game.dropTimer      = 0;
}

// Perform one fall step over the locked-block grid. Every cell that
// has a block above an empty space gets shifted down by one row.
// Returns true if at least one block moved (caller uses this to
// decide whether the cascade has settled).
//
// Iteration is bottom-up (rows-2 → 0) so a stack of N floating blocks
// above a single gap doesn't collapse all N rows in one step — only
// the bottommost floating block falls per call. That gives the
// cascade its visible "rain" cadence; without it the board would
// resolve in a single frame.
//
// Critically, this also moves any matching cell in the specials
// boardGrid so special-tagged blocks fall in lock-step with their
// underlying cell — otherwise a falling block would shed its special
// on takeoff. The specials grid is owned by the specials plugin
// (in its plugin-state bag); we just read it here.
function fallStep(game) {
  const rows = game.board.length;
  const cols = game.board[0]?.length ?? 10;
  const specials = game._pluginState.specials?.boardGrid ?? null;
  let moved = false;
  for (let r = rows - 2; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      if (game.board[r][c] && !game.board[r + 1][c]) {
        game.board[r + 1][c] = game.board[r][c];
        game.board[r][c]     = null;
        if (specials) {
          specials[r + 1][c] = specials[r][c];
          specials[r][c]     = null;
        }
        moved = true;
      }
    }
  }
  return moved;
}

// Mirrors the standard completeClear()'s scoring path (line score,
// B2B, combo, perfect-clear, lines/level, milestone power-up
// choices) but does NOT spawn a new piece — the saved piece is
// restored at the end of the whole cascade by endCascade(), not after
// every clear. After scoring, we loop back into the 'fall' phase to
// see if the cleared rows expose more floating blocks that can drop.
//
// The beforeClear → removeRows → onClear hook order matches Game's
// standard completeClear so the specials plugin (which captures
// triggers in beforeClear and fires them in onClear) sees a
// gravity-driven clear identically to a player-driven one. That's
// what gives chained-special detonations their natural recursion:
// a Gravity special clearing a row that contains another Gravity
// special re-enters this engine through the second special's
// onTrigger, and the new cascade picks up where this one left off.
function completeCascadeClear(game) {
  const cleared = game.clearingRows.length;
  game._notifyPlugins('beforeClear', game.clearingRows);
  removeRows(game.board, game.clearingRows);

  const wasB2B = (cleared === 4 && game.lastClearWasTetris);

  // lineClearScore tolerates cleared > 4 — the cascade can collapse
  // many rows simultaneously when a Bomb (or chained specials) leaves
  // a tall stack of full rows after the fall pass. Without the
  // helper, LINE_SCORES[5] would be undefined and `score += NaN`
  // would silently corrupt the score for the rest of the run.
  let lineScore = lineClearScore(cleared) * game.level;
  if (wasB2B) lineScore = Math.floor(lineScore * B2B_MULTIPLIER);
  game.score += lineScore;

  game.combo += cleared;
  game.score += COMBO_BONUS * game.combo * game.level;

  game.lastClearWasTetris = (cleared === 4);

  const perfect = game.board.every(row => row.every(cell => cell === null));
  if (perfect) game.score += PERFECT_CLEAR_BONUS;

  const linesBefore = game.lines;
  game.lines += cleared;
  game.level = Math.floor(game.lines / 10) + 1;

  // Roguelite power-up milestones — same rule as completeClear().
  // The choice menu won't surface until endCascade() fires the
  // onPluginIdle transition, so any picks earned mid-cascade queue up
  // cleanly behind the animation.
  let milestonesEarned =
    Math.floor(game.lines / 5) - Math.floor(linesBefore / 5);
  if (!game.firstClearAwarded && cleared > 0) {
    game.firstClearAwarded = true;
    milestonesEarned += 1;
  }
  game.pendingChoices += milestonesEarned;
  // Arm the same universal menu-settle pause that completeClear uses
  // when a milestone is earned. Held at full duration by Game.tick()
  // until the cascade finishes (the cascade plugin freezes gameplay,
  // and the timer's decrement gate refuses to count down while any
  // plugin freezes), so the menu still won't surface mid-cascade —
  // it just gets one extra beat after the cascade wraps up.
  if (milestonesEarned > 0) {
    game._menuSettleTimer = MENU_SETTLE_MS;
  }

  if (perfect)         game.onPerfectClear?.();
  if (cleared === 4)   game.onTetris?.(wasB2B);
  if (game.combo >= 2) game.onCombo?.(game.combo);

  game.clearingRows = [];
  game.clearTimer = 0;
  const s = gs(game);
  s.phase     = 'fall';
  s.stepTimer = 0;
  // Specials' onClear fires their triggers BEFORE the power-up menu
  // callback so any freezing plugin they start gets a chance to flip
  // its gate first — same ordering rule completeClear() uses. A
  // Gravity special on a row this cascade just cleared calls back
  // into startGravityCascade, which is idempotent (we're still
  // inside an active cascade so the call no-ops). Future special
  // kinds (bombs, etc.) can fire freely without recursing into this
  // engine.
  game._notifyPlugins('onClear', cleared);
  if (milestonesEarned > 0) {
    game.onPowerUpChoice?.(game.pendingChoices);
  }
}

// Wrap up the cascade and hand control back to the player. Two
// resume paths:
//
//   savedPiece set       The cascade was triggered while a piece was
//                        in flight (chisel'd a Gravity special, or
//                        the debug menu kicked it). Restore the
//                        parked piece. A spawn-overlap from board
//                        shuffling counts as a legitimate game over.
//
//   savedPiece null      The cascade was triggered from a line clear
//                        (the piece had already been locked + nulled
//                        by lockCurrent). There's no parked piece to
//                        restore — pull the next one from the queue.
//                        completeClear deferred its own spawnNext to
//                        let us own the resume here.
function endCascade(game) {
  const s = gs(game);
  s.active = false;
  if (s.savedPiece) {
    game.current = s.savedPiece;
    s.savedPiece = null;
    if (collides(game.board, game.current)) {
      game.gameOver = true;
    }
  }
  s.phase     = 'fall';
  s.stepTimer = 0;
  // Reset gravity-drop accumulator so the restored piece doesn't
  // immediately fall a row from leftover dt collected pre-cascade.
  game.dropTimer = 0;
  // No parked piece to restore AND nothing currently active → the
  // cascade was triggered mid-clear. Pull the next piece from the
  // queue ourselves. spawnNext is the standard chokepoint, so all
  // the usual decoratePiece / onSpawn hooks fire on the new piece.
  if (!game.current && !game.gameOver) {
    game.spawnNext();
  }
  // No explicit completion callback — game.onPluginIdle fires on
  // the next tick when freezesGameplay sees this plugin settle
  // (active = false), letting main.js resume any deferred menu.
}

// The plugin object — wires the engine into Game's lifecycle bus.
// Identity is stable across hot-reloads / test resets so registering
// twice is a no-op (Game just appends, but the second registration
// would double-tick the cascade).
export default {
  // Seed the gravity slot in the plugin-state bag on every
  // Game.reset(). Owns the slot's lifetime; nothing else writes here.
  reset(game) {
    game._pluginState.gravity = {
      active: false,
      savedPiece: null,
      phase: 'fall',
      stepTimer: 0,
    };
  },

  freezesGameplay: (game) => !!gs(game)?.active,

  tick: (game, dt) => {
    const s = gs(game);
    if (!s?.active) return;
    if (s.phase === 'clearing') {
      game.clearTimer += dt;
      if (game.clearTimer >= CLEAR_DURATION) completeCascadeClear(game);
      return;
    }
    // 'fall' phase — accumulate dt and run a step each time the step
    // interval elapses. A single dt slice can span multiple steps (low
    // frame rate), so loop until we're back under it.
    s.stepTimer += dt;
    while (s.stepTimer >= GRAVITY_POWER_STEP) {
      s.stepTimer -= GRAVITY_POWER_STEP;
      const moved = fallStep(game);
      if (!moved) {
        // Cascade settled. Any full rows? If so kick off the standard
        // clear animation; completeCascadeClear() will resume the
        // fall loop after the animation finishes.
        const fullRows = findFullRows(game.board);
        if (fullRows.length > 0) {
          game.clearingRows = fullRows;
          game.clearTimer   = 0;
          s.phase           = 'clearing';
          game.onLineClear?.(fullRows.length);
        } else {
          endCascade(game);
        }
        break;
      }
    }
  },
};
