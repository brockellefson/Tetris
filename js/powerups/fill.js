// Power-up: Fill — grants a banked charge that lets the player place
// a single 1×1 block on any empty cell. Inverse of Chisel.
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry. Picking the
//      card just bumps `game.unlocks.fillCharges`; the heavy
//      interaction lives in the lifecycle hooks below.
//
//   2. Lifecycle plugin (freezesGameplay, tick, interceptInput) —
//      registered on the Game in main.js. The fill state slot
//      (`game.fill = { active, target, cursor, savedPiece }`) still
//      lives on Game so the renderer / chisel-hint UI can read it
//      directly, but every mutation flows through this file.
//
// Interaction phases (driven by `game.fill`):
//   active = true                  — waiting for the player to pick a
//                                    cell. freezesGameplay is true.
//                                    Click or Enter on an empty cell
//                                    transitions to the target phase.
//   target = { x, y, timer }       — materialize animation playing.
//                                    freezesGameplay is true. Block
//                                    is already written to the board;
//                                    timer drives the visual only.
//                                    When the timer expires the
//                                    plugin calls completeFill, which
//                                    checks for full rows and either
//                                    hands off to the line-clear flow
//                                    (with savedPiece preserving the
//                                    active piece) or notifies main.js
//                                    that the menu queue can resume.
//
// Input contract — interceptInput consumes:
//   'fill:activate'               S key (or any "spend a charge" path)
//   'cursor:left' / 'right' /
//     'up'   / 'down'             Arrow / WASD, only when fill.active
//   'cursor:confirm'              Enter / Space, only when fill.active
//   'cursor:cancel'               Esc, only when fill.active —
//                                 refunds the charge and resumes the
//                                 menu queue
//   'boardClick' (col, row)       Mouse / tap, only when fill.active

import { FILL_DURATION, MAX_FILL_CHARGES } from '../constants.js';
import { findFullRows } from '../board.js';

function clampCursor(game, x, y) {
  const cols = game.board[0]?.length ?? 10;
  const rows = game.board.length;
  return {
    x: Math.max(0, Math.min(cols - 1, x)),
    y: Math.max(0, Math.min(rows - 1, y)),
  };
}

// Seed the fill cursor on the bottom-leftmost empty cell — most fill
// targets will be near the bottom of the stack (filling in gaps to
// complete a line), so starting low minimizes travel. Falls back to
// the spawn area if the board is somehow completely full.
function initCursor(game) {
  const cols = game.board[0]?.length ?? 10;
  for (let r = game.board.length - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      if (!game.board[r][c]) {
        game.fill.cursor = { x: c, y: r };
        return;
      }
    }
  }
  game.fill.cursor = { x: 0, y: 0 };
}

function moveCursor(game, dx, dy) {
  if (!game.fill.active || !game.fill.cursor) return;
  const cur = game.fill.cursor;
  const next = clampCursor(game, cur.x + dx, cur.y + dy);
  const moved = next.x !== cur.x || next.y !== cur.y;
  game.fill.cursor = next;
  if (moved) game.onCursorMove?.();
}

// Player picked an empty cell to fill. Returns true on success
// (refused cells leave state unchanged so the UI can ignore the
// click). The block is written to the board immediately as type
// 'FILL'; the timer on fill.target only drives the materialize visual.
function selectCell(game, x, y) {
  if (!game.fill.active) return false;
  if (x < 0 || x >= game.board[0].length || y < 0 || y >= game.board.length) return false;
  if (game.board[y][x]) return false;                 // already filled
  if (game.isCellUnderActivePiece(x, y)) return false; // would trap the active piece
  game.board[y][x] = 'FILL';
  game.fill.active = false;
  game.fill.cursor = null;
  game.fill.target = { x, y, timer: 0 };
  game.onFillHit?.();
  return true;
}

// Called when the materialize animation completes. Either kicks off
// the standard line-clear flow (preserving the active piece via
// fill.savedPiece) or signals the menu queue to resume.
function completeFill(game) {
  game.fill.target = null;
  const fullRows = findFullRows(game.board);
  if (fullRows.length === 0) {
    game.onFillComplete?.();
    return;
  }
  // Hand off to the standard clear flow. Hide the current piece so
  // completeClear()'s spawnNext() doesn't fire on an active piece;
  // we'll restore it from fill.savedPiece in completeClear().
  game.fill.savedPiece = game.current;
  game.current = null;
  game.clearingRows = fullRows;
  game.clearTimer = 0;
  game.onLineClear?.(fullRows.length);
}

function activate(game) {
  if (!game.started) return false;
  if (game.paused || game.gameOver) return false;
  if (game.pendingChoices > 0) return false;
  if (game.isClearing()) return false;
  if (game.fill.active || game.fill.target) return false;
  if (game._isFrozenByPlugin()) return false;
  if (game.unlocks.fillCharges <= 0) return false;
  const hasEmpty = game.board.some(row => row.some(cell => cell === null));
  if (!hasEmpty) return false;
  game.unlocks.fillCharges -= 1;
  game.fill.active = true;
  initCursor(game);
  return true;
}

export default {
  id: 'fill',
  name: 'Fill',
  description: 'Press S to fill any empty cell. One charge.',
  available: (game) => game.unlocks.fillCharges < MAX_FILL_CHARGES,
  apply: (game) => {
    game.unlocks.fillCharges = Math.min(
      MAX_FILL_CHARGES,
      game.unlocks.fillCharges + 1,
    );
  },

  // ---- lifecycle hooks ----

  freezesGameplay: (game) => game.fill.active || !!game.fill.target,

  tick: (game, dt) => {
    if (!game.fill.target) return;
    game.fill.target.timer += dt;
    if (game.fill.target.timer >= FILL_DURATION) {
      completeFill(game);
    }
  },

  interceptInput(game, action, ...args) {
    switch (action) {
      case 'fill:activate':
        return activate(game);
      case 'cursor:left':
        if (!game.fill.active) return false;
        moveCursor(game, -1, 0); return true;
      case 'cursor:right':
        if (!game.fill.active) return false;
        moveCursor(game, 1, 0); return true;
      case 'cursor:up':
        if (!game.fill.active) return false;
        moveCursor(game, 0, -1); return true;
      case 'cursor:down':
        if (!game.fill.active) return false;
        moveCursor(game, 0, 1); return true;
      case 'cursor:confirm':
        if (!game.fill.active || !game.fill.cursor) return false;
        return selectCell(game, game.fill.cursor.x, game.fill.cursor.y);
      case 'cursor:cancel':
        // Bail out of an active pick. Symmetric with activate(): we
        // refund the charge that activate() decremented, drop the
        // active/cursor state, and notify main.js that the menu
        // queue can resume (a fill earned mid-clear may have a
        // power-up choice waiting behind it).
        if (!game.fill.active) return false;
        game.unlocks.fillCharges += 1;
        game.fill.active = false;
        game.fill.cursor = null;
        game.onFillComplete?.();
        return true;
      case 'boardClick': {
        if (!game.fill.active) return false;
        const [col, row] = args;
        return selectCell(game, col, row);
      }
    }
    return false;
  },
};
