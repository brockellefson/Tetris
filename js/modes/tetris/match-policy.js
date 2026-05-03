// ============================================================
// TetrisMatchPolicy — clear detection + scoring for Tetris
// ============================================================
//
// Owns the Tetris-specific answers to three questions Game asks
// after every lock and every cascade fall-step:
//
//   1. "Did anything clear?"          findClears(board)
//   2. "How do I remove what cleared?" removeClears(board, result)
//   3. "How does that affect score,
//       lines, level, milestones,
//       visual hooks, plugins?"        applyClearEffects(game, result)
//
// `applyClearEffects` consolidates the scoring ceremony that used
// to be duplicated between Game.completeClear and the gravity
// cascade's completeCascadeClear — line score, B2B, combo, perfect
// clear, line/level progression, milestone tracking, visual hooks
// (onPerfectClear / onTetris / onCombo), the universal menu-settle
// arm, and the onClear/onPowerUpChoice notifications. Both call
// sites now hand off to this one function and only do their own
// site-specific tail (Game spawns the next piece, the cascade
// transitions back to its 'fall' phase).
//
// What stays on Game (and is only READ here):
//   - score, lines, level, combo, lastClearWasTetris,
//     firstClearAwarded, pendingChoices, _menuSettleTimer.
//   These are state slots multiple subsystems already touch (HUD,
//   leaderboard, debug). The match policy mutates them as needed
//   but doesn't redefine ownership; future modes (Puyo) will read
//   the same slots and reinterpret them (lastClearWasTetris will
//   be irrelevant; combo will be a chain step counter).
//
// ClearResult shape:
//   { rows: number[] }   — row indices about to be removed
//
// We deliberately keep the `rows` shape rather than generalizing
// to `cells` here. That's a step-4 generalization once we know
// what shape Puyo's policy actually wants — premature abstraction
// before the second implementation lands tends to fit one mode
// awkwardly. The beforeClear hook still passes `rows` to plugins
// (specials, in particular) so the existing plugin contract holds.

import {
  lineClearScore,
  B2B_MULTIPLIER,
  COMBO_BONUS,
  PERFECT_CLEAR_BONUS,
  MENU_SETTLE_MS,
} from '../../constants.js';
import { findFullRows, removeRows } from '../../board.js';

// "Did anything clear on this board?"
//
// Returns a result object with the row indices, or null when
// nothing cleared. Returning null (rather than `{ rows: [] }`)
// lets the caller short-circuit with a `if (!result) ...` check
// — the most common path on a non-clearing lock.
function findClears(board) {
  const rows = findFullRows(board);
  if (rows.length === 0) return null;
  return { rows };
}

// Called by Game.lockCurrent right after the piece's cells are
// written to the board. Two outcomes:
//
//   • Lines cleared → set up the clear animation. The renderer
//     paints the flash + wipe; tick() will call completeClear()
//     when CLEAR_DURATION elapses, which delegates to
//     applyClearEffects below.
//   • Nothing cleared → reset the combo (only a clear keeps it
//     alive) and pull the next piece from the queue. B2B is
//     preserved across non-clearing locks.
//
// Puyo's afterLock looks completely different — it kicks the
// gravity-cascade engine, which handles settle + chain + spawn
// itself. That's why this branch belongs on the policy and not
// in Game.
function afterLock(game) {
  const result = findClears(game.board);
  if (result) {
    game.clearingResult = result;
    game.clearingRows   = result.rows;
    game.clearTimer     = 0;
    game.current        = null;
    game.onLineClear?.(result.rows.length);
  } else {
    game.combo = 0;
    game.spawnNext();
  }
}

// Mutate the board to drop the cleared rows. Mirrors removeRows
// from board.js — kept as a method so future modes (Puyo) can
// substitute their own removal pattern (null cells in place,
// defer gravity to the cascade engine).
function removeClears(board, result) {
  removeRows(board, result.rows);
}

// Run the full post-clear scoring + progression + notification
// pipeline. Mutates game state in place; does NOT spawn the next
// piece (the caller decides that, since cascades and standard
// clears handle spawning differently).
//
// Call sites:
//   Game.completeClear           after the line-clear animation
//   gravity-cascade completeCascadeClear  after each cascade-step clear
//
// Both pass `{ rows: game.clearingRows }` and rely on
// `game.clearingRows` having been set by lockCurrent / the cascade
// before the animation timer started.
function applyClearEffects(game, result) {
  const cleared = result.rows.length;

  // Plugin hook fires BEFORE removeRows so the specials plugin
  // can capture which special-tagged cells are about to vanish
  // and shift its parallel grid in lock-step.
  game._notifyPlugins('beforeClear', result.rows);
  removeClears(game.board, result);

  // ---- Scoring ----
  // B2B: a Tetris immediately following another Tetris pays 1.5×
  // the base. Capture before mutating lastClearWasTetris.
  const wasB2B = (cleared === 4 && game.lastClearWasTetris);

  // lineClearScore tolerates cleared > 4 — a cascade-driven clear
  // (Bomb fallout, chained specials) can collapse 5+ rows at once.
  // Without the helper, LINE_SCORES[5] would be undefined and the
  // multiply would silently corrupt the score for the rest of the run.
  let lineScore = lineClearScore(cleared) * game.level;
  if (wasB2B) lineScore = Math.floor(lineScore * B2B_MULTIPLIER);
  game.score += lineScore;

  // Combo accumulates the actual line count. A double clear sets
  // combo = 2; a Tetris then a single sets combo = 5. Multi-line
  // chains compound fast.
  game.combo += cleared;
  game.score += COMBO_BONUS * game.combo * game.level;

  // Only a Tetris keeps the B2B chain alive — singles/doubles/triples
  // break it.
  game.lastClearWasTetris = (cleared === 4);

  // Perfect Clear: flat bonus when the board is fully empty.
  const perfect = game.board.every(row => row.every(cell => cell === null));
  if (perfect) game.score += PERFECT_CLEAR_BONUS;

  // ---- Progression ----
  const linesBefore = game.lines;
  game.lines += cleared;
  game.level = Math.floor(game.lines / 10) + 1;

  // Roguelite milestone — every 5 lines earns a power-up choice.
  // A normal lock can produce at most 1 milestone per clear (max
  // 4 lines), but a cascade can collapse enough rows in one go to
  // cross multiple 5-line boundaries.
  let milestonesEarned =
    Math.floor(game.lines / 5) - Math.floor(linesBefore / 5);
  if (!game.firstClearAwarded && cleared > 0) {
    game.firstClearAwarded = true;
    milestonesEarned += 1;
  }
  game.pendingChoices += milestonesEarned;

  // Universal menu-settle pause — a brief beat between "milestone
  // earned" and "menu opens" so the player sees the score pop / line
  // counter tick / level number bump before the modal interrupts.
  // Held at full duration by Game.tick()'s gating until any
  // in-flight modal (cascade, chisel, special trigger) finishes.
  if (milestonesEarned > 0) {
    game._menuSettleTimer = MENU_SETTLE_MS;
  }

  // ---- Visual / FX hooks ----
  // Fired in importance order so the notification stack reads
  // top-to-bottom: PERFECT > TETRIS/B2B > COMBO.
  if (perfect)         game.onPerfectClear?.();
  if (cleared === 4)   game.onTetris?.(wasB2B);
  if (game.combo >= 2) game.onCombo?.(game.combo);

  // ---- Settle the clear-animation slot ----
  // Reset the canonical clearingResult AND the back-compat
  // clearingRows here as the "clear pipeline ended" point. The
  // cascade engine then transitions back to its 'fall' phase;
  // Game.completeClear pulls the next piece.
  game.clearingResult = null;
  game.clearingRows   = [];
  game.clearTimer     = 0;

  // ---- Plugin / menu callbacks ----
  // Plugin hook fires AFTER scoring is fully applied. Specials fires
  // its captured triggers here (e.g. a Bomb-tagged cell on a cleared
  // row detonates here, possibly kicking off a cascade). Triggers
  // fire BEFORE the power-up menu callback below so any freezing
  // plugin they start (cascade today) flips its `freezesGameplay`
  // gate true synchronously, and the menu defers cleanly.
  game._notifyPlugins('onClear', cleared);

  if (milestonesEarned > 0) {
    game.onPowerUpChoice?.(game.pendingChoices);
  }
}

export const TETRIS_MATCH = {
  findClears,
  removeClears,
  applyClearEffects,
  afterLock,
};
