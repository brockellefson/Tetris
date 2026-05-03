// ============================================================
// Puyo pieces — color set + random-pair generator
// ============================================================
//
// In Puyo Puyo, a "piece" is a pair of independently-colored
// puyos: a pivot and a satellite. The pivot is the piece's anchor
// (it's the cell that piece.x / piece.y address); the satellite
// orbits the pivot around its 4 rotation states.
//
// The actual SHAPE matrix for each rotation lives in `js/pieces.js`
// (PAIR_SHAPES, used by shapeOf when piece.kind === 'pair'). That's
// because shapeOf, lockPiece, and the renderer all read shapes
// through a single function and we wanted exactly one dispatch
// site, not parallel ones per mode. This file owns the COLOR
// vocabulary and the per-pair RNG that the queue refill consumes.
//
// 5 colors — the canonical balanced Puyo set. Four colors creates
// accidental matches frequently (puyos pile up and clear without
// the player setting anything up); five is the right balance
// between "approachable" and "intentional play feels distinct from
// luck." The fifth (purple) lives in COLORS as 'P'.

// Piece-color letters. Each must have a matching entry in
// js/constants.js#COLORS — that's how the renderer paints them
// and how findClears in the match policy decides which cells are
// "puyo cells" eligible to match.
export const PUYO_COLORS = ['R', 'G', 'B', 'Y', 'P'];

// True iff a board cell holds one of the four puyo colors. Used by
// the match policy's flood-fill to skip non-puyo cells (junk, fill,
// future debris) rather than accidentally chaining them. The Set
// gives O(1) lookup; the array above stays the canonical list so
// adding a fifth color is a one-line change.
const _PUYO_COLOR_SET = new Set(PUYO_COLORS);
export function isPuyoColor(value) {
  return _PUYO_COLOR_SET.has(value);
}

// Pull one random color. Uniform across PUYO_COLORS — no weighting
// (Puyo doesn't have a 7-bag analog; pairs are independently
// uniform).
export function randomColor() {
  return PUYO_COLORS[Math.floor(Math.random() * PUYO_COLORS.length)];
}

// Generate a random pair "type" — the opaque value the queue holds.
// PuyoPiecePolicy.spawn(type, layout) consumes this and produces a
// concrete piece object. Keeping the type as a small record (instead
// of a string code like 'RG') makes inspection in tests / debug
// readable without a parser.
export function randomPair() {
  return { pivot: randomColor(), satellite: randomColor() };
}
