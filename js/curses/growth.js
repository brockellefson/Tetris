// Curse: Growth — widens the playfield by one column on the right
// edge. Stacks (each pick adds another column), capped at +5 so the
// board stays playable on standard screen widths.
//
// State + logic both live here now. The `game.curses.extraCols`
// counter stays on Game (the HUD reads it, the cap check uses it),
// but the actual board mutation — addColumn / tryRemoveColumn —
// lives in this file. Dispell asks for a removal via the service
// bus: game._interceptInput('growth:removeColumn').
//
// A wider board sounds like a buff at first glance, but in practice
// the I-piece can no longer span the whole row, multi-line clears
// get harder to set up, and the bag's frequency stays the same so
// the player gets the same number of pieces to fill more space —
// which is why this lives under curses, not power-ups.

const MAX_EXTRA_COLS = 5;

// Append one column to the right edge of the board. Existing block
// positions and the active piece are unaffected because the new
// column is null-filled and lives past the old rightmost index.
// The renderer and click-to-cell helpers read width from
// board[0].length so they pick the change up automatically.
function addColumn(game) {
  for (const row of game.board) row.push(null);
  return game.board[0].length;
}

// Inverse of addColumn — used by the Dispell blessing when undoing a
// Growth stack. Refuses (and returns false) if shrinking would clip
// either a locked block or any cell of the active piece, so it can
// never trap or game-over the player. Also clamps at the layout's
// natural width so we never go narrower than a stock board for the
// current mode (10 for Tetris; future modes seed their own value).
// Returns true iff the column was actually removed.
function tryRemoveColumn(game) {
  if (!game.board.length) return false;
  if (game.board[0].length <= game.layout.cols) return false;
  const lastCol = game.board[0].length - 1;
  if (game.board.some(row => row[lastCol] !== null)) return false;
  if (game.current) {
    for (let r = 0; r < game.board.length; r++) {
      if (game.isCellUnderActivePiece(lastCol, r)) return false;
    }
  }
  for (const row of game.board) row.pop();
  return true;
}

export default {
  id: 'curse-growth',
  name: 'Growth',
  description: 'Widens the playfield by one column. Stacks up to +5.',
  // Tetris-only — Puyo's 6-wide field is already narrow; widening
  // it would soften every match, the opposite of a curse. Puyo
  // would ship its own field-altering debuffs.
  modes: ['tetris'],
  // Hide once we've maxed out — picking a 6th time would offer no
  // visible effect and the menu should surface a different curse.
  available: (game) => game.curses.extraCols < MAX_EXTRA_COLS,
  apply: (game) => {
    game.curses.extraCols += 1;
    addColumn(game);
  },

  // ---- lifecycle hooks ----

  // Service-bus action so Dispell (and any future plugin that needs
  // to give back a column) can ask for a safe removal without
  // importing this module directly. Returns true iff a column was
  // actually removed; the caller (Dispell) doesn't currently care.
  interceptInput(game, action) {
    if (action !== 'growth:removeColumn') return false;
    tryRemoveColumn(game);
    return true;
  },
};
