// ============================================================
// PuyoPiecePolicy — piece-side of the Puyo Puyo mode
// ============================================================
//
// Implements the same five-method interface as TetrisPiecePolicy
// so Game.spawnNext / move / rotate / softDrop / hardDrop / ghostY
// dispatch into the right kind of motion without knowing which
// game it's running.
//
// Differences from Tetris:
//   • spawn — produces a `kind: 'pair'` piece with two colors.
//     The pair lives in a fixed 3×3 bounding box (PAIR_SHAPES in
//     pieces.js) with the pivot at (1,1) and the satellite
//     orbiting around it; piece.x / piece.y address the top-left
//     of that 3×3 box.
//   • tryRotate — no SRS table. A 90° rotate either fits or it
//     doesn't; we try the natural slot first, then a 1-cell kick
//     left/right (keeps rotation feeling responsive when the pair
//     hugs a wall). Floor kicks are intentionally omitted — the
//     player should rotate before the pair lands.
//   • refillQueue — independent random pairs. There's no 7-bag
//     analog; classic Puyo just uses uniform RNG.
//
// tryMove and ghostPosition are mode-agnostic (they only care
// whether shapeOf collides with the board) so we re-export the
// existing helpers from `js/piece.js`.

import { collides } from '../../board.js';
import {
  tryMove as _tryMove,
  ghostPosition as _ghostPosition,
} from '../../piece.js';
import { randomPair } from './pieces.js';

// How many lookahead pairs to keep queued. Tetris keeps ≥ 7 (a
// full bag); Puyo doesn't have a bag and 4 is plenty for the next-
// piece preview without flooding the player with too much info.
const PUYO_QUEUE_LOOKAHEAD = 4;

// Build a fresh pair piece at the spawn slot. `type` is a pair
// record — { pivot, satellite } — pulled off the queue.
//
// Spawn x: centered-ish on the layout. For the standard 6-wide
// Puyo board this puts the pivot at column 3 (the right of the
// two center columns), matching arcade Puyo. piece.y = 0 lets
// rot-0's satellite (at row 0 of the shape) and pivot (at row 1)
// both spawn on-board, so the player sees both colors immediately
// rather than the satellite peeking in from above.
function spawn(type, layout) {
  return {
    kind: 'pair',
    pivot: type.pivot,
    satellite: type.satellite,
    rot: 0,
    x: Math.floor(layout.cols / 2) - 1,
    y: 0,
  };
}

// Rotate the pair 90° around the pivot. If the natural rotation
// collides with a wall or stack, try a 1-cell horizontal kick
// (away from the wall on each side). Returns the new piece or
// null if every test position collides.
//
// Puyo's rotation feels different from Tetris's: there are only
// 4 states, the pivot doesn't move, and players RELY on side
// kicks against walls to swap which side the satellite is on.
// Without the kicks the rotation breaks against the right wall
// (pair starts at the rightmost column) the moment the player
// first tries to flip the satellite leftward.
function tryRotate(board, piece, dir) {
  const rotDelta = dir > 0 ? 1 : 3;
  const rotated  = { ...piece, rot: (piece.rot + rotDelta) % 4 };
  // 0 first (the natural slot); +1 / -1 for 1-cell wall kicks.
  for (const dx of [0, -1, 1]) {
    const test = { ...rotated, x: rotated.x + dx };
    if (!collides(board, test)) return test;
  }
  return null;
}

// Top up the queue to PUYO_QUEUE_LOOKAHEAD pairs. allowsType is
// accepted for interface symmetry with Tetris (where Cruel uses it
// to filter out I-pieces) and currently ignored — no Puyo plugin
// vetoes pair colors yet, and even if one did, "type" for puyo is
// a {pivot, satellite} record rather than a single letter.
function refillQueue(queue, _allowsType) {
  while (queue.length < PUYO_QUEUE_LOOKAHEAD) {
    queue.push(randomPair());
  }
}

export const PUYO_PIECES = {
  spawn,
  tryMove:       _tryMove,
  tryRotate,
  ghostPosition: _ghostPosition,
  refillQueue,
};
