// ============================================================
// Nuisance puyos — drop helper for the gray "garbage" mechanic
// ============================================================
//
// Pure board mutation. Knows nothing about score, plugins, the
// cascade engine, or the network. Two future call sites share
// this single helper:
//
//   • SP curse card — picks Nuisance from the Puyo curse pool,
//     calls dropNuisance(game, BATCH_SIZE).
//   • Versus garbage plugin — converts an opponent's chain payout
//     into a count, calls dropNuisance(game, count) when the
//     incoming queue drains on a lock.
//
// Nuisance cells use kind 'N' (see js/constants.js#COLORS.N).
// PUYO_COLORS deliberately excludes 'N', so the flood-fill in
// PuyoMatchPolicy never groups them. They DO get cleared via
// splash damage in removeClears when an adjacent matched cell
// pops — that's what lets the player dig out from under them.
//
// Distribution policy — arcade-canonical row-fill:
//
//   Sweep cols 0..N-1, drop one nuisance into each column on
//   each pass. After N nuisance, the bottom-most exposed row is
//   full and we move up to the next row. Repeat until all
//   `count` nuisance are placed.
//
// Pass `{ randomize: true }` to shuffle the column order on
// every pass. The row-fill cadence stays the same (one cell
// per column per pass), so cells still land roughly evenly
// across the row instead of clumping in one stack — only the
// LEFT-TO-RIGHT order is broken. Versus uses this so two
// chunks of garbage of the same size don't always land in the
// same spots; SP curse keeps the deterministic order so the
// player can plan around it.
//
// Why the SP path stays deterministic by default:
//   • Reads more clearly to the player — "they sent me 8
//     garbage" lands as 6 cells across the bottom-most exposed
//     row plus 2 in the next row up, predictable and plannable.
//   • Matches arcade Mean Bean Machine and Puyo's behavior
//     directly.
//   • A future seeded-replay system can still reproduce SP
//     boards from a (seed, input) pair.
//
// A column at the ceiling (no row 0 headroom) is skipped on its
// pass — the rest of the row's cells still land. After a full
// sweep we move up to the next row anyway, so no garbage gets
// lost unless the entire field is packed.
//
// Returns the count actually placed (≤ count). Useful for the
// caller to know how much fit vs. got discarded against a
// fully-packed field.

import { collides } from '../../board.js';

export function dropNuisance(game, count, options = {}) {
  if (count <= 0) return 0;
  const { randomize = false } = options;
  const rows = game.board.length;
  const cols = game.board[0]?.length ?? game.layout.cols;
  let placed = 0;

  // Per-column landing row — the next slot we'd drop into for
  // each column. Initialize to the topmost empty cell. Each
  // successful placement decrements its column's landing row.
  // Cells fully blocked off (landing row < 0) get skipped.
  const landing = new Array(cols);
  for (let c = 0; c < cols; c++) {
    let r = rows - 1;
    for (let rr = 0; rr < rows; rr++) {
      if (game.board[rr][c]) { r = rr - 1; break; }
    }
    landing[c] = r;
  }

  // Sequential column order; reused (and re-shuffled) per pass
  // when `randomize` is set. Using a Fisher–Yates in-place
  // shuffle keeps the allocation cost to one array for the
  // whole call.
  const order = new Array(cols);
  for (let i = 0; i < cols; i++) order[i] = i;

  // Sweep top-of-column-to-bottom — same arcade row-fill
  // behavior. Outer loop is "all garbage we still owe"; inner
  // is "one column-pass." When `randomize` is true the inner
  // pass walks columns in a freshly-shuffled order so the row
  // fills in unpredictable spots (versus opponents shouldn't
  // be able to count on garbage always biting from the left).
  let safety = count * cols + 1; // guard against infinite loop if
                                  // every column is at -1 already
  while (placed < count && safety-- > 0) {
    let movedAny = false;
    if (randomize) {
      // Fisher–Yates: shuffle the column order in place.
      for (let i = cols - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = order[i]; order[i] = order[j]; order[j] = tmp;
      }
    }
    for (let i = 0; i < cols && placed < count; i++) {
      const c = order[i];
      const r = landing[c];
      if (r < 0) continue;
      // Don't drop onto a cell currently occupied by the active
      // piece — placing under a falling pair would either clip
      // through it or game-over the player on the next collision
      // check. Skip; the column gets another shot on the next
      // pass when the piece has moved.
      if (game.isCellUnderActivePiece?.(c, r)) continue;
      game.board[r][c] = 'N';
      landing[c] = r - 1;
      placed += 1;
      movedAny = true;
    }
    if (!movedAny) break; // every column blocked — stop trying
  }

  // Defensive: if a placement landed under the active piece via
  // some weird timing, the piece's next collision check would
  // catch it. Mirror the junk curse's safety net.
  if (game.current && collides(game.board, game.current)) {
    game.gameOver = true;
  }

  return placed;
}
