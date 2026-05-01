// ============================================================
// Board state — the locked-block grid and operations on it
// ============================================================
//
// The board is a 2D array: board[row][col].
// Empty cells are null; filled cells hold a piece-type letter
// (e.g. 'T', 'I') used to look up the color when rendering.
// ============================================================

import { COLS, ROWS } from './constants.js';
import { shapeOf } from './pieces.js';

// Create an empty board.
export function newBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

// Returns true if the piece at its current (x, y, rot) overlaps
// a wall, the floor, or any locked cell.
export function collides(board, piece) {
  const s = shapeOf(piece);
  for (let r = 0; r < s.length; r++) {
    for (let c = 0; c < s[r].length; c++) {
      if (!s[r][c]) continue;
      const x = piece.x + c;
      const y = piece.y + r;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y >= 0 && board[y][x]) return true;
    }
  }
  return false;
}

// Mutates `board` in place — writes the piece's cells into the grid.
export function lockPiece(board, piece) {
  const s = shapeOf(piece);
  for (let r = 0; r < s.length; r++) {
    for (let c = 0; c < s[r].length; c++) {
      if (!s[r][c]) continue;
      const x = piece.x + c;
      const y = piece.y + r;
      if (y >= 0) board[y][x] = piece.type;
    }
  }
}

// Returns the indices of all fully-filled rows (top-to-bottom order).
// Does NOT mutate the board — used to mark rows for the clear animation.
export function findFullRows(board) {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    if (board[r].every(cell => cell)) rows.push(r);
  }
  return rows;
}

// Removes the specified rows from the board, shifting everything above
// down to fill the gap. Mutates `board`.
export function removeRows(board, rows) {
  // Sort descending so splicing doesn't shift the indices we still need.
  for (const r of [...rows].sort((a, b) => b - a)) {
    board.splice(r, 1);
    board.unshift(Array(COLS).fill(null));
  }
}

// Convenience: find + remove in one step. Returns the count cleared.
export function clearLines(board) {
  const rows = findFullRows(board);
  removeRows(board, rows);
  return rows.length;
}
