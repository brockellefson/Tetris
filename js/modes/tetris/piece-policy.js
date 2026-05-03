// ============================================================
// TetrisPiecePolicy — the piece-side of the Tetris game mode
// ============================================================
//
// Bundles every operation Game.js needs to drive Tetris pieces:
// spawn, move, rotate, ghost-projection, queue refill. Each method
// is a thin wrapper over the existing pure helpers in `js/piece.js`
// and `js/pieces.js` — this file changes the *shape* of how Game
// reaches them (one policy object instead of seven scattered
// imports), not the underlying behavior.
//
// Why a policy instead of direct imports:
//   - Game.js no longer hardcodes "tetrominoes." It calls
//     `this.mode.pieces.spawn(...)`, and the mode bundle decides
//     which set of pieces actually spawns. Puyo Puyo's PuyoPiecePolicy
//     plugs in the same way without Game knowing.
//   - The interface is the contract. Future modes implement the
//     same five methods; if a new mode needs richer behavior (a
//     "next-3 lookahead" preview, drag-rotation), it lives inside
//     the policy without leaking through Game.
//
// What this file does NOT own:
//   - `shapeOf(piece)`. Piece shapes are properties of the piece
//     itself; the renderer and collision tester reach for the shape
//     via the piece's own type. Routing every shapeOf call through
//     the policy would be invasive without payoff. shapeOf stays in
//     `pieces.js` and grows new piece types as new modes register
//     them (Puyo's R/G/B/Y/P will land in `js/modes/puyo/pieces.js`
//     and re-export through `pieces.js`).
//   - The Flip power-up's tryFlip — Flip is a Tetris-only blessing
//     and stays in its own plugin file. The policy is the seam for
//     core piece motion only.

import {
  spawn  as _spawn,
  tryMove as _tryMove,
  tryRotate as _tryRotate,
  ghostPosition as _ghostPosition,
} from '../../piece.js';
import { bagShuffle } from '../../pieces.js';

// Spawn a fresh piece. The layout is accepted (and ignored today)
// so the interface stays mode-uniform — Puyo's PuyoPiecePolicy.spawn
// will compute its center column from `layout.cols`. Tetris's spawn
// position is hardcoded against the historic 10-wide board (x=3, or
// x=4 for O-pieces) for SRS-correct kick behavior; switching to a
// layout-driven center would shift every kick test, which we punt on
// until step 4 (the actual Puyo work).
function spawn(type, _layout) {
  return _spawn(type);
}

// Refill the queue in place. The bag-randomizer shuffles all 7 piece
// types into a chunk; we keep appending chunks until the queue holds
// at least 7 pieces (so the player always sees the full lookahead).
//
// `allowsType` is a plugin-veto predicate threaded by Game — Cruel
// uses it to forbid I-pieces while the curse is active. The bag is
// re-evaluated every refill, so once the player levels past Cruel's
// window the I-piece returns naturally.
function refillQueue(queue, allowsType) {
  while (queue.length < 7) {
    queue.push(...bagShuffle(allowsType));
  }
}

export const TETRIS_PIECES = {
  spawn,
  tryMove:       _tryMove,
  tryRotate:     _tryRotate,
  ghostPosition: _ghostPosition,
  refillQueue,
};
