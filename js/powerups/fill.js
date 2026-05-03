// Power-up: Fill — unlock-once modal ability. Once picked, the
// player can press S to place a single 1×1 block on any empty cell.
// Inverse of Chisel; same gating model — the unlock is permanent and
// each cast arms a per-cast cooldown.
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry. Picking the
//      card flips `game.unlocks.fill` to true and never appears
//      again in the menu (`available` returns false thereafter).
//      The heavy interaction lives in the lifecycle hooks below.
//
//   2. Lifecycle plugin (freezesGameplay, tick, interceptInput,
//      reset) — registered on the Game in main.js. The fill state
//      slot lives in the generic plugin-state bag at
//      `game._pluginState.fill = { active, target, cursor, savedPiece }`,
//      seeded by this plugin's reset hook. Renderer/UI read it from
//      the bag; every mutation flows through this file. completeClear
//      reaches into savedPiece via the bag to restore the active
//      piece across a fill-triggered clear.
//
// Interaction phases (driven by `game._pluginState.fill`):
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

import { COOLDOWN_LINES, FILL_DURATION } from '../constants.js';
import { findFullRows } from '../board.js';

// Convenience accessor — slot is initialized in reset() so it's
// always present once the game has started.
const fs = (game) => game._pluginState.fill;

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
  const s = fs(game);
  const cols = game.board[0]?.length ?? 10;
  for (let r = game.board.length - 1; r >= 0; r--) {
    for (let c = 0; c < cols; c++) {
      if (!game.board[r][c]) {
        s.cursor = { x: c, y: r };
        return;
      }
    }
  }
  s.cursor = { x: 0, y: 0 };
}

function moveCursor(game, dx, dy) {
  const s = fs(game);
  if (!s.active || !s.cursor) return;
  const cur = s.cursor;
  const next = clampCursor(game, cur.x + dx, cur.y + dy);
  const moved = next.x !== cur.x || next.y !== cur.y;
  s.cursor = next;
  if (moved) game.onCursorMove?.();
}

// Player picked an empty cell to fill. Returns true on success
// (refused cells leave state unchanged so the UI can ignore the
// click). The block is written to the board immediately as type
// 'FILL'; the timer on the target only drives the materialize visual.
function selectCell(game, x, y) {
  const s = fs(game);
  if (!s.active) return false;
  if (x < 0 || x >= game.board[0].length || y < 0 || y >= game.board.length) return false;
  if (game.board[y][x]) return false;                 // already filled
  if (game.isCellUnderActivePiece(x, y)) return false; // would trap the active piece
  game.board[y][x] = 'FILL';
  s.active = false;
  s.cursor = null;
  s.target = { x, y, timer: 0 };
  game.onFillHit?.();
  return true;
}

// Called when the materialize animation completes. Either kicks off
// the standard line-clear flow (preserving the active piece via
// savedPiece) or signals the menu queue to resume.
function completeFill(game) {
  const s = fs(game);
  s.target = null;
  const fullRows = findFullRows(game.board);
  if (fullRows.length === 0) {
    // No clear → fill is fully done. game.onPluginIdle fires on the
    // next tick when freezesGameplay sees s.target === null.
    return;
  }
  // Hand off to the standard clear flow. Hide the current piece so
  // completeClear()'s spawnNext() doesn't fire on an active piece;
  // we'll restore it from savedPiece in completeClear().
  s.savedPiece = game.current;
  game.current = null;
  game.clearingRows = fullRows;
  game.clearTimer = 0;
  game.onLineClear?.(fullRows.length);
}

function activate(game) {
  const s = fs(game);
  if (!game.started) return false;
  if (game.paused || game.gameOver) return false;
  if (game.pendingChoices > 0) return false;
  if (game.isClearing()) return false;
  if (s.active || s.target) return false;
  if (game._isFrozenByPlugin()) return false;
  if (!game.unlocks.fill) return false;
  // Per-cast cooldown — once the player has cast Fill, the next
  // cast is locked behind COOLDOWN_LINES line clears. The HUD
  // surfaces this with a gray tag and a left-to-right progress fill.
  if (s.cooldown > 0) return false;
  const hasEmpty = game.board.some(row => row.some(cell => cell === null));
  if (!hasEmpty) return false;
  s.active = true;
  s.cooldown = COOLDOWN_LINES;
  initCursor(game);
  return true;
}

export default {
  id: 'fill',
  name: 'Fill',
  description: 'Press S to fill any empty cell. 5-line cooldown.',
  // Tetris-only — Fill detects post-cast row clears via findFullRows
  // and routes through Tetris's clear pipeline. Puyo's analog would
  // be "drop a colored puyo," which is a different plugin entirely.
  modes: ['tetris'],
  available: (game) => !game.unlocks.fill,
  apply: (game) => {
    game.unlocks.fill = true;
  },

  // ---- lifecycle hooks ----

  reset(game) {
    game._pluginState.fill = { active: false, target: null, cursor: null, savedPiece: null, cooldown: 0 };
  },

  // Tick the per-cast cooldown down once per cleared line. As with
  // chisel, no serialize/restore — Whoops shouldn't refund the
  // cooldown of a fill the rewind erases. Note that if the fill
  // itself triggered the clear (player filled the gap to complete a
  // row), this same hook decrements the cooldown by the line count
  // — i.e., the fill-triggered clear DOES count toward the cooldown,
  // matching the natural reading of "break 5 lines after the cast."
  onClear(game, cleared) {
    const s = fs(game);
    if (!s) return;
    if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - cleared);
  },

  freezesGameplay: (game) => {
    const s = fs(game);
    return !!s && (s.active || !!s.target);
  },

  tick: (game, dt) => {
    const s = fs(game);
    if (!s?.target) return;
    s.target.timer += dt;
    if (s.target.timer >= FILL_DURATION) {
      completeFill(game);
    }
  },

  interceptInput(game, action, ...args) {
    const s = fs(game);
    switch (action) {
      case 'fill:activate':
        return activate(game);
      case 'cursor:left':
        if (!s?.active) return false;
        moveCursor(game, -1, 0); return true;
      case 'cursor:right':
        if (!s?.active) return false;
        moveCursor(game, 1, 0); return true;
      case 'cursor:up':
        if (!s?.active) return false;
        moveCursor(game, 0, -1); return true;
      case 'cursor:down':
        if (!s?.active) return false;
        moveCursor(game, 0, 1); return true;
      case 'cursor:confirm':
        if (!s?.active || !s.cursor) return false;
        return selectCell(game, s.cursor.x, s.cursor.y);
      case 'cursor:cancel':
        // Bail out of an active pick. The cast never resolved, so we
        // wipe the cooldown that activate() armed; drop the active/
        // cursor state and notify main.js that the menu queue can
        // resume (a fill pick that started mid-clear may have a
        // power-up choice waiting behind it).
        if (!s?.active) return false;
        s.cooldown = 0;
        s.active = false;
        s.cursor = null;
        // No explicit completion callback — game.onPluginIdle fires
        // on the next tick when freezesGameplay sees this plugin
        // settle (active=false, target=null).
        return true;
      case 'boardClick': {
        if (!s?.active) return false;
        const [col, row] = args;
        return selectCell(game, col, row);
      }
    }
    return false;
  },
};
