// Power-up: Chisel — grants a banked charge that lets the player
// remove a single 1×1 block of their choice from the board.
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry. Picking the
//      card just bumps `game.unlocks.chiselCharges`; the heavy
//      interaction lives in the lifecycle hooks below.
//
//   2. Lifecycle plugin (freezesGameplay, tick, interceptInput) —
//      registered on the Game in main.js. The chisel state slot
//      (`game.chisel = { active, target, cursor }`) still lives on
//      Game so the renderer / chisel-hint UI can read it directly,
//      but every mutation flows through this file.
//
// Interaction phases (driven by `game.chisel`):
//   active = true                  — waiting for the player to pick a
//                                    cell. freezesGameplay is true.
//                                    Click or Enter on a filled cell
//                                    transitions to the target phase.
//   target = { x, y, type, timer } — destruction animation playing.
//                                    freezesGameplay is true. Block is
//                                    already removed from the board;
//                                    timer drives the visual only.
//                                    When the timer expires, target
//                                    clears and the menu queue resumes.
//
// Input contract — interceptInput consumes:
//   'chisel:activate'             A key (or any "spend a charge" path)
//   'cursor:left' / 'right' /
//     'up'   / 'down'             Arrow / WASD, only when chisel.active
//   'cursor:confirm'              Enter / Space, only when chisel.active
//   'cursor:cancel'               Esc, only when chisel.active —
//                                 refunds the charge and resumes the
//                                 menu queue
//   'boardClick' (col, row)       Mouse / tap, only when chisel.active
//
// Activation gating mirrors the original tryActivateChisel: refuses
// while the game isn't running, while paused / over, while another
// modal is up (powerup menu, line-clear animation, fill modal,
// gravity cascade), with no charges, or on a fully empty board.

import { CHISEL_DURATION, MAX_CHISEL_CHARGES } from '../constants.js';

function clampCursor(game, x, y) {
  const cols = game.board[0]?.length ?? 10;
  const rows = game.board.length;
  return {
    x: Math.max(0, Math.min(cols - 1, x)),
    y: Math.max(0, Math.min(rows - 1, y)),
  };
}

// Seed the cursor on the topmost-leftmost filled cell so the highlight
// starts on a meaningful block. Falls back to (0, 0) only if the board
// is somehow empty (the activation guard rules this out in practice).
function initCursor(game) {
  const cols = game.board[0]?.length ?? 10;
  for (let r = 0; r < game.board.length; r++) {
    for (let c = 0; c < cols; c++) {
      if (game.board[r][c]) {
        game.chisel.cursor = { x: c, y: r };
        return;
      }
    }
  }
  game.chisel.cursor = { x: 0, y: 0 };
}

function moveCursor(game, dx, dy) {
  if (!game.chisel.active || !game.chisel.cursor) return;
  const cur = game.chisel.cursor;
  const next = clampCursor(game, cur.x + dx, cur.y + dy);
  // Suppress the cursor-move sound when clamping at the edge makes
  // the keypress a no-op.
  const moved = next.x !== cur.x || next.y !== cur.y;
  game.chisel.cursor = next;
  if (moved) game.onCursorMove?.();
}

// Player picked a block to chisel out. Returns true if the click hit
// a filled cell; false (and no state change) otherwise so the UI can
// ignore the click. The block is removed immediately — the timer on
// chisel.target only drives the visual shatter effect.
function selectCell(game, x, y) {
  if (!game.chisel.active) return false;
  if (x < 0 || x >= game.board[0].length || y < 0 || y >= game.board.length) return false;
  const type = game.board[y][x];
  if (!type) return false;                  // empty cell — let the player try again
  game.board[y][x] = null;
  game.chisel.active = false;
  game.chisel.cursor = null;
  game.chisel.target = { x, y, type, timer: 0 };
  // Notify single-cell removal via the plugin bus. Specials listens
  // on this hook and fires the cell's onTrigger if it carried one
  // — letting a chisel'd Gravity special kick off a cascade while
  // the chisel-shatter animation is still playing on top.
  game._notifyPlugins('onCellRemoved', x, y, 'chisel');
  game.onChiselHit?.();
  return true;
}

function activate(game) {
  if (!game.started) return false;
  if (game.paused || game.gameOver) return false;
  if (game.pendingChoices > 0) return false;
  if (game.isClearing()) return false;
  if (game.chisel.active || game.chisel.target) return false;
  if (game._isFrozenByPlugin()) return false; // fill modal, gravity cascade, etc.
  if (game.unlocks.chiselCharges <= 0) return false;
  // No locked block on the board → activating would just hang the
  // game waiting on a confirm that can't succeed. Refuse.
  const hasBlock = game.board.some(row => row.some(cell => cell !== null));
  if (!hasBlock) return false;
  game.unlocks.chiselCharges -= 1;
  game.chisel.active = true;
  initCursor(game);
  return true;
}

export default {
  id: 'chisel',
  name: 'Chisel',
  description: 'Press A to remove any 1×1 block. One charge.',
  available: (game) => game.unlocks.chiselCharges < MAX_CHISEL_CHARGES,
  apply: (game) => {
    game.unlocks.chiselCharges = Math.min(
      MAX_CHISEL_CHARGES,
      game.unlocks.chiselCharges + 1,
    );
  },

  // ---- lifecycle hooks ----

  freezesGameplay: (game) => game.chisel.active || !!game.chisel.target,

  // While the destruction animation plays we still freeze gameplay,
  // but the timer must keep advancing or the animation never ends.
  // The active phase has nothing to tick (waiting on player input).
  tick: (game, dt) => {
    if (!game.chisel.target) return;
    game.chisel.target.timer += dt;
    if (game.chisel.target.timer >= CHISEL_DURATION) {
      game.chisel.target = null;
      // Tells main.js to resume the menu queue (a chisel pick can
      // be earned mid-clear which queues a power-up choice).
      game.onChiselComplete?.();
    }
  },

  interceptInput(game, action, ...args) {
    switch (action) {
      case 'chisel:activate':
        return activate(game);
      // Cursor actions are claimed only while we're in the active
      // (waiting-for-pick) phase. The animation phase swallows input
      // upstream via the freezesGameplay gate in input.js.
      case 'cursor:left':
        if (!game.chisel.active) return false;
        moveCursor(game, -1, 0); return true;
      case 'cursor:right':
        if (!game.chisel.active) return false;
        moveCursor(game, 1, 0); return true;
      case 'cursor:up':
        if (!game.chisel.active) return false;
        moveCursor(game, 0, -1); return true;
      case 'cursor:down':
        if (!game.chisel.active) return false;
        moveCursor(game, 0, 1); return true;
      case 'cursor:confirm':
        if (!game.chisel.active || !game.chisel.cursor) return false;
        return selectCell(game, game.chisel.cursor.x, game.chisel.cursor.y);
      case 'cursor:cancel':
        // Bail out of an active pick. Symmetric with activate(): we
        // refund the charge that activate() decremented, drop the
        // active/cursor state, and notify main.js that the menu
        // queue can resume (a chisel earned mid-clear may have a
        // power-up choice waiting behind it).
        if (!game.chisel.active) return false;
        game.unlocks.chiselCharges += 1;
        game.chisel.active = false;
        game.chisel.cursor = null;
        game.onChiselComplete?.();
        return true;
      case 'boardClick': {
        if (!game.chisel.active) return false;
        const [col, row] = args;
        return selectCell(game, col, row);
      }
    }
    return false;
  },
};
