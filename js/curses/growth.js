// Curse: Growth — widens the playfield by one column on the right
// edge. Stacks (each pick adds another column), capped at +5 so the
// board stays playable on standard screen widths.
//
// Same shape as the other curses: id, name, description, available,
// apply. The actual board mutation lives in Game.addColumn(); this
// file is just the registry entry plus the cap on `available`.
//
// A wider board sounds like a buff at first glance, but in practice
// the I-piece can no longer span the whole row, multi-line clears
// get harder to set up, and the bag's frequency stays the same so
// the player gets the same number of pieces to fill more space —
// which is why this lives under curses, not power-ups.

const MAX_EXTRA_COLS = 5;

export default {
  id: 'curse-growth',
  name: 'Growth',
  description: 'Widens the playfield by one column. Stacks up to +5.',
  // Hide once we've maxed out — picking a 6th time would offer no
  // visible effect and the menu should surface a different curse.
  available: (game) => game.curses.extraCols < MAX_EXTRA_COLS,
  apply: (game) => {
    game.curses.extraCols += 1;
    game.addColumn();
  },
};
