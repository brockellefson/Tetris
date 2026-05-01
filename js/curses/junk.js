// Curse: Junk — drops 1-3 junk rows onto the board as soon as it's
// picked, then keeps doing it on every subsequent level-up. Each junk
// row has one random gap so the row is theoretically clearable.
// Anything pushed off the top of the board is lost.
//
// Each curse object follows the same shape as a power-up:
//   id, name, description, available, apply

export default {
  id: 'curse-junk',
  name: 'Junk',
  description: 'Adds 1-3 junk rows now, and another batch on every level-up.',
  available: () => true,
  apply: (game) => {
    game.curses.junk = true;
    const placed = game.addJunkBatch();
    if (placed > 0) game.onJunk?.(placed);
  },
};
