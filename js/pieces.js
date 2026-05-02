// ============================================================
// Tetromino shape definitions and SRS rotation data
// ============================================================
//
// Each piece has 4 rotation states stored as 2D arrays.
// Coordinates: row 0 = top, column 0 = left.
//
// Pieces follow the Super Rotation System (SRS) — the modern
// Tetris standard for how pieces rotate and "kick" off walls.
// ============================================================

export const PIECES = {
  I: [
    [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    [[0,0,1,0],[0,0,1,0],[0,0,1,0],[0,0,1,0]],
    [[0,0,0,0],[0,0,0,0],[1,1,1,1],[0,0,0,0]],
    [[0,1,0,0],[0,1,0,0],[0,1,0,0],[0,1,0,0]],
  ],
  O: [
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
    [[1,1],[1,1]],
  ],
  T: [
    [[0,1,0],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,1],[0,1,0]],
    [[0,1,0],[1,1,0],[0,1,0]],
  ],
  S: [
    [[0,1,1],[1,1,0],[0,0,0]],
    [[0,1,0],[0,1,1],[0,0,1]],
    [[0,0,0],[0,1,1],[1,1,0]],
    [[1,0,0],[1,1,0],[0,1,0]],
  ],
  Z: [
    [[1,1,0],[0,1,1],[0,0,0]],
    [[0,0,1],[0,1,1],[0,1,0]],
    [[0,0,0],[1,1,0],[0,1,1]],
    [[0,1,0],[1,1,0],[1,0,0]],
  ],
  J: [
    [[1,0,0],[1,1,1],[0,0,0]],
    [[0,1,1],[0,1,0],[0,1,0]],
    [[0,0,0],[1,1,1],[0,0,1]],
    [[0,1,0],[0,1,0],[1,1,0]],
  ],
  L: [
    [[0,0,1],[1,1,1],[0,0,0]],
    [[0,1,0],[0,1,0],[0,1,1]],
    [[0,0,0],[1,1,1],[1,0,0]],
    [[1,1,0],[0,1,0],[0,1,0]],
  ],
};

// SRS wall-kick tables. Keys are "fromRotation>toRotation".
// Each entry is a list of (dx, dy) offsets to try in order.
// y is positive-down (flipped from the canonical SRS spec).
export const KICKS_JLSTZ = {
  '0>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '1>0': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '1>2': [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  '2>1': [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  '2>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  '3>2': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '3>0': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  '0>3': [[0,0],[1,0],[1,-1],[0,2],[1,2]],
};

export const KICKS_I = {
  '0>1': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  '1>0': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  '1>2': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  '2>1': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  '2>3': [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  '3>2': [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  '3>0': [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  '0>3': [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
};

// 7-bag randomizer: shuffles all 7 piece types, guaranteeing
// each appears once per cycle. Eliminates unfair piece droughts.
//
// The optional `allows` predicate lets the caller filter the bag —
// any type the predicate returns false for is dropped. Defaults to
// "allow everything" so callers without a filter (tests, future
// modes) get the standard 7-piece bag. Game.refillQueue threads a
// plugin-aware filter through here so curses like Cruel can forbid
// specific types (e.g. I-pieces) without bagShuffle needing to know
// about any specific curse.
export function bagShuffle(allows = () => true) {
  const bag = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'].filter(allows);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// Memoized horizontal mirror of every (type, rot) shape. Built lazily
// the first time the Flip power-up flips a piece of that orientation;
// subsequent collisions/renders read from the cache so we never reverse
// rows in a hot path.
const _mirrorCache = new Map();
function mirrorShape(type, rot) {
  const key = `${type}|${rot}`;
  let m = _mirrorCache.get(key);
  if (m) return m;
  // Reverse each row (left-right flip). The matrix dimensions are
  // unchanged, so the piece's bounding box stays the same — that
  // keeps the SRS rotation kicks valid even after a flip.
  m = PIECES[type][rot].map(row => row.slice().reverse());
  _mirrorCache.set(key, m);
  return m;
}

// Returns the 2D shape matrix for a piece's current rotation. If the
// piece carries a `flipped` flag (set by the Flip power-up), returns
// the horizontally-mirrored shape instead. Every consumer (collides,
// lockPiece, renderer) goes through this function, so flipping is
// transparent to the rest of the engine.
export function shapeOf(piece) {
  if (piece.flipped) return mirrorShape(piece.type, piece.rot);
  return PIECES[piece.type][piece.rot];
}

// Map a (row, col) coordinate from a piece's rot-0 frame to its
// current rotation + flip. Used by the special-blocks subsystem so a
// special "tagged" to a specific mino at spawn (in rot-0 coords)
// follows that mino through every rotate/flip without needing to
// remap state every frame.
//
// Math: SRS rotates each PIECES matrix 90° clockwise around the
// bounding-box center. For an n×n matrix that maps (r, c) → (c, n-1-r)
// per rotation step. Flipping is the horizontal mirror (c → n-1-c)
// applied AFTER rotation — which matches `shapeOf`'s order, where
// the flipped path returns `mirrorShape(type, rot)` (rotate first,
// then mirror the rows).
//
// Works uniformly for any piece since every PIECES matrix is square
// (I = 4×4, O = 2×2, JLSTZT = 3×3).
export function transformLocalCoord(piece, r0, c0) {
  const n = PIECES[piece.type][0].length;
  let r = r0, c = c0;
  for (let i = 0; i < (piece.rot | 0); i++) {
    const nr = c;
    const nc = n - 1 - r;
    r = nr;
    c = nc;
  }
  if (piece.flipped) c = n - 1 - c;
  return { r, c };
}
