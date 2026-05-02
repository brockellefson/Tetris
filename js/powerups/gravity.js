// Power-up: Gravity — one-shot board compaction. Picking the card
// pauses the active piece, then makes every locked block fall into
// any empty space below it. When the cascade settles, full rows are
// cleared (with the standard line-clear animation, score, and
// combo / B2B / perfect-clear bonuses). The fall-then-clear loop
// repeats until no more blocks can fall and no more lines complete,
// at which point the active piece is restored and play resumes.
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry. apply() kicks
//      off the cascade by calling startGravity (below) — the plugin
//      itself drives the per-frame logic from there.
//
//   2. Lifecycle plugin (freezesGameplay, tick) — registered on the
//      Game in main.js. The state slot (`game.gravity = { active,
//      savedPiece, phase, stepTimer }`) stays on Game for the
//      renderer's benefit (it hides `current` while active so locked
//      blocks don't visually pass through the parked piece), but
//      every mutation flows through this file.
//
// Phases (driven by `game.gravity.phase`):
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
//                 piece slot until endGravity).

import {
  CLEAR_DURATION,
  GRAVITY_POWER_STEP,
  LINE_SCORES,
  B2B_MULTIPLIER,
  COMBO_BONUS,
  PERFECT_CLEAR_BONUS,
} from '../constants.js';
import { collides, findFullRows, removeRows } from '../board.js';

// Begin the gravity cascade. Idempotent — refuses to re-enter if a
// sequence is already running. The active piece is moved into
// `gravity.savedPiece` and `current` is cleared so the renderer hides
// it for the duration (otherwise falling locked blocks would visually
// pass through the piece's silhouette).
function startCascade(game) {
  if (game.gravity.active) return;
  game.gravity.active     = true;
  game.gravity.savedPiece = game.current;
  game.current            = null;
  game.gravity.phase      = 'fall';
  game.gravity.stepTimer  = 0;
  // Cancel any in-flight Slick lock-delay window — there's no active
  // piece for it to apply to during the cascade.
  game.lockDelayTimer     = 0;
  game.dropTimer          = 0;
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
function fallStep(game) {
  const rows = game.board.length;
  const cols = game.board[0]?.length ?? 10;
  let moved = false;
  for (let r = rows - 2; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      if (game.board[r][c] && !game.board[r + 1][c]) {
        game.board[r + 1][c] = game.board[r][c];
        game.board[r][c]     = null;
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
function completeCascadeClear(game) {
  const cleared = game.clearingRows.length;
  removeRows(game.board, game.clearingRows);

  const wasB2B = (cleared === 4 && game.lastClearWasTetris);

  let lineScore = LINE_SCORES[cleared] * game.level;
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
  // onGravityComplete hook, so any picks earned mid-cascade queue up
  // cleanly behind the animation.
  let milestonesEarned =
    Math.floor(game.lines / 5) - Math.floor(linesBefore / 5);
  if (!game.firstClearAwarded && cleared > 0) {
    game.firstClearAwarded = true;
    milestonesEarned += 1;
  }
  if (milestonesEarned > 0) {
    game.pendingChoices += milestonesEarned;
    game.onPowerUpChoice?.(game.pendingChoices);
  }

  if (perfect)         game.onPerfectClear?.();
  if (cleared === 4)   game.onTetris?.(wasB2B);
  if (game.combo >= 2) game.onCombo?.(game.combo);

  game.clearingRows = [];
  game.clearTimer = 0;
  game.gravity.phase     = 'fall';
  game.gravity.stepTimer = 0;
}

// Wrap up the cascade and hand control back to the player. Restores
// the saved piece into `current`. If the (extremely unlikely)
// restoration overlaps a block — e.g. a clever Fill / Junk-row
// interaction shifted blocks under the parked piece — we end the
// run, mirroring the standard spawn-collision rule.
function endCascade(game) {
  game.gravity.active = false;
  if (game.gravity.savedPiece) {
    game.current = game.gravity.savedPiece;
    game.gravity.savedPiece = null;
    if (collides(game.board, game.current)) {
      game.gameOver = true;
    }
  }
  game.gravity.phase     = 'fall';
  game.gravity.stepTimer = 0;
  // Reset gravity-drop accumulator so the restored piece doesn't
  // immediately fall a row from leftover dt collected pre-cascade.
  game.dropTimer = 0;
  // Lets main.js re-open any choice menu deferred by the cascade.
  game.onGravityComplete?.();
}

export default {
  id: 'gravity',
  name: 'Gravity',
  description: 'All blocks fall to fill empty space below, clearing any lines they form.',
  available: () => true,
  apply: (game) => { startCascade(game); },

  // ---- lifecycle hooks ----

  freezesGameplay: (game) => game.gravity.active,

  tick: (game, dt) => {
    if (!game.gravity.active) return;
    if (game.gravity.phase === 'clearing') {
      game.clearTimer += dt;
      if (game.clearTimer >= CLEAR_DURATION) completeCascadeClear(game);
      return;
    }
    // 'fall' phase — accumulate dt and run a step each time the step
    // interval elapses. A single dt slice can span multiple steps (low
    // frame rate), so loop until we're back under it.
    game.gravity.stepTimer += dt;
    while (game.gravity.stepTimer >= GRAVITY_POWER_STEP) {
      game.gravity.stepTimer -= GRAVITY_POWER_STEP;
      const moved = fallStep(game);
      if (!moved) {
        // Cascade settled. Any full rows? If so kick off the standard
        // clear animation; completeCascadeClear() will resume the
        // fall loop after the animation finishes.
        const fullRows = findFullRows(game.board);
        if (fullRows.length > 0) {
          game.clearingRows  = fullRows;
          game.clearTimer    = 0;
          game.gravity.phase = 'clearing';
          game.onLineClear?.(fullRows.length);
        } else {
          endCascade(game);
        }
        break;
      }
    }
  },
};
