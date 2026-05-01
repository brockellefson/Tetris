// ============================================================
// Piece operations — spawn, move, rotate, drop
// ============================================================
//
// Pieces are plain objects: { type, rot, x, y }
//   type — one of 'I','O','T','S','Z','J','L'
//   rot  — rotation index 0..3
//   x, y — board coordinates of the shape's top-left corner
//
// All "try" functions are pure — they return a NEW piece if the
// move is legal, or null if blocked. The Game state decides whether
// to accept the result.
// ============================================================

import { KICKS_JLSTZ, KICKS_I } from './pieces.js';
import { collides } from './board.js';

// Create a fresh piece at its standard spawn position.
export function spawn(type) {
  return {
    type,
    rot: 0,
    x: type === 'O' ? 4 : 3,   // O is 2 wide, others spawn at column 3
    y: type === 'I' ? -1 : 0,  // I spawns one row higher
  };
}

// Try to translate a piece by (dx, dy). Returns the new piece, or null.
export function tryMove(board, piece, dx, dy) {
  const test = { ...piece, x: piece.x + dx, y: piece.y + dy };
  return collides(board, test) ? null : test;
}

// Try to rotate a piece. dir is +1 (clockwise) or -1 (counter-clockwise).
// Walks the SRS kick table — first offset that fits wins. Returns null
// if every kick is blocked.
export function tryRotate(board, piece, dir) {
  if (piece.type === 'O') return piece; // O never needs rotation
  const from = piece.rot;
  const to = (from + (dir > 0 ? 1 : 3)) % 4;
  const key = `${from}>${to}`;
  const kicks = piece.type === 'I' ? KICKS_I[key] : KICKS_JLSTZ[key];
  for (const [dx, dy] of kicks) {
    const test = { ...piece, rot: to, x: piece.x + dx, y: piece.y + dy };
    if (!collides(board, test)) return test;
  }
  return null;
}

// Returns the y-coordinate where the piece would land if dropped straight down.
// Used to render the ghost piece outline.
export function ghostPosition(board, piece) {
  let y = piece.y;
  while (true) {
    const test = { ...piece, y: y + 1 };
    if (collides(board, test)) return y;
    y++;
  }
}
