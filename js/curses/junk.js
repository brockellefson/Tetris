// Curse: Junk — drops 3 junk rows onto the board the moment it's
// picked. One-shot only: nothing further happens on later level-ups.
// Each junk row has one random gap so the row is theoretically
// clearable. Anything pushed off the top of the board is lost.
//
// Each curse object follows the same shape as a power-up:
//   id, name, description, available, apply

export default {
  id: 'curse-junk',
  name: 'Junk',
  description: 'Drops 3 junk rows onto the board immediately.',
  available: () => true,
  apply: (game) => {
    game.curses.junk = true;
    const placed = game.addJunkBatch();
    if (placed > 0) game.onJunk?.(placed);
  },
};
