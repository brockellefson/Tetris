// Curse: Junk — drops 3 junk rows onto the board the moment it's
// picked. One-shot only: nothing further happens on later level-ups.
// Each junk row has one random gap so the row is theoretically
// clearable. Anything pushed off the top of the board is lost.
//
// State + logic both live here now: the board mutation is a private
// function in this module rather than a Game method, since Junk is
// the only caller. The `game.curses.junk` flag stays on Game so the
// curse-HUD reader and Dispell can see it.

import { collides } from '../board.js';

// Push one junk row onto the bottom of the board, shifting everything
// up. The row is filled with the dedicated 'JUNK' cell type (rendered
// in a muted slate gray) with one random gap. If shifting up causes
// the active piece to overlap a block, the game ends (mirrors the
// spawn-on-collision rule).
function addRow(game) {
  game.board.shift();
  // Live width — Growth can have widened the board past the layout's
  // natural cols, and a junk row needs to span every column to be
  // legible as a "row" rather than a partial smear.
  const cols = game.board[0]?.length ?? game.layout.cols;
  const gap = Math.floor(Math.random() * cols);
  const row = [];
  for (let c = 0; c < cols; c++) {
    row.push(c === gap ? null : 'JUNK');
  }
  game.board.push(row);
  if (game.current && collides(game.board, game.current)) {
    game.gameOver = true;
  }
}

// Drop a batch of 3 rows in one go. Stops early if the game ended
// mid-batch so we don't keep mutating after game over. Returns the
// count actually placed for the UI ticker.
function addBatch(game) {
  const count = 3;
  let placed = 0;
  for (let i = 0; i < count; i++) {
    if (game.gameOver) break;
    addRow(game);
    placed += 1;
  }
  return placed;
}

export default {
  id: 'curse-junk',
  name: 'Junk',
  description: 'Drops 3 junk rows onto the board immediately.',
  available: () => true,
  apply: (game) => {
    game.curses.junk = true;
    const placed = addBatch(game);
    if (placed > 0) game.onJunk?.(placed);
  },
};
