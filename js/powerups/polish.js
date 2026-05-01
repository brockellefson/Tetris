// Power-up: Polish — fill an empty cell with a 1×1 block of the
// player's choice. The inverse of Chisel; same UI surface area.
//
// The interaction is split across three layers (mirrors chisel.js):
//
//   1. apply()           — sets `game.polish.active = true`. The Game's
//                          tick() checks this flag and freezes gameplay
//                          (no gravity, no input) until a cell is picked.
//
//   2. main.js click     — translates a canvas click into a (col, row)
//                          and calls game.polishSelect(col, row). If the
//                          cell is empty, that places a POLISH block and
//                          starts the materialize animation
//                          (game.polish.target).
//
//   3. render.js         — paints a "click an empty cell" prompt while
//                          `polish.active`, the highlight cursor, and
//                          the materialize sparkle effect while
//                          `polish.target` exists. After the animation,
//                          Game.polishComplete() checks for full rows
//                          and triggers the standard line-clear flow.
//
// Always available — there's effectively always at least one empty cell
// while the game is in play (a fully-filled board would already be over).

export default {
  id: 'polish',
  name: 'Polish',
  description: 'Fill a single empty cell with a 1×1 block. Completed lines clear.',
  available: (game) =>
    game.board && game.board.some(row => row.some(cell => cell === null)),
  apply: (game) => {
    game.polish.active = true;
    // Seed the keyboard cursor on a sensible empty cell so arrow-key
    // navigation and the on-board highlight start somewhere useful.
    game.polishInitCursor();
  },
};
