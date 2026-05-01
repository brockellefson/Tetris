// Power-up: Chisel — remove a single 1×1 block of the player's choice.
//
// The interaction is split across three layers:
//
//   1. apply()           — sets `game.chisel.active = true`. The Game's
//                          tick() checks this flag and freezes gameplay
//                          (no gravity, no input) until a block is picked.
//
//   2. main.js click     — translates a canvas click into a (col, row)
//                          and calls game.chiselSelect(col, row). If the
//                          cell holds a locked block, that starts the
//                          destruction animation (game.chisel.target).
//
//   3. render.js         — paints a "click a block" prompt while
//                          `chisel.active`, and the shatter animation
//                          while `chisel.target` exists.
//
// Only available when there's at least one block on the board; otherwise
// the player would be stuck with nothing to chisel.

export default {
  id: 'chisel',
  name: 'Chisel',
  description: 'Remove a single 1×1 block of your choice from the board.',
  available: (game) =>
    game.board && game.board.some(row => row.some(cell => cell !== null)),
  apply: (game) => { game.chisel.active = true; },
};
