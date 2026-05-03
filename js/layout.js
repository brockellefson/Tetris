// ============================================================
// Layout — board dimensions for the current run
// ============================================================
//
// A Layout is a tiny `{ cols, rows }` record describing the
// playfield's shape. One instance lives at `game.layout`, seeded
// in Game.reset() from DEFAULT_LAYOUT (the historic 10×20 Tetris
// board). It exists so different game modes can swap the board
// shape without touching the engine — Puyo Puyo's 6×12 board is
// the immediate motivating use case, but it also gives the Growth
// curse a single source of truth for "what's the natural width"
// without re-importing COLS everywhere.
//
// Why a record instead of a class:
//   - The shape is deliberately tiny (two integers today; a spawn
//     hint tomorrow when we extract PiecePolicy) and pure data, so
//     `{...}` is the right tool. Hot paths read `game.layout.cols`
//     directly; no method dispatch overhead.
//   - Easy to deep-clone for snapshots (Whoops's serialize/restore
//     pair) and trivially comparable in tests.
//
// What this file does NOT own:
//   - The live board width is read from `game.board[0].length`,
//     not from the layout, because the Growth curse mutates board
//     width in place at runtime. The layout records the *natural*
//     width — what newBoard() would produce on a reset — and Growth
//     reads it to know how far it can shrink.
//   - Spawn position. Today the piece spawn x/y is hardcoded in
//     `js/piece.js#spawn()` against the 10-wide board (x = 3 for
//     most pieces, 4 for O). When PiecePolicy is extracted in the
//     next puyo-prep step, the policy will compute spawn from the
//     layout. For now, leaving spawn out keeps this commit a pure
//     refactor.
// ============================================================

import { COLS, ROWS } from './constants.js';

// Build a layout. Either field can be omitted to inherit from the
// default — useful for tests and for future modes that only differ
// from Tetris on one dimension.
export function makeLayout({ cols = COLS, rows = ROWS } = {}) {
  return { cols, rows };
}

// The Tetris default. Re-exported so call sites can either grab
// this directly (Game.reset) or build a custom layout via
// makeLayout (future Puyo / sprint / debug modes).
export const DEFAULT_LAYOUT = makeLayout();
