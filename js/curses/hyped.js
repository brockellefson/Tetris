// Curse: Hyped — pieces fall one level faster (permanent, stackable).
//
// Implemented as an integer offset added to (level - 1) when the game
// looks up GRAVITY. Picking Hyped twice = +2 levels of speed, etc.
//
// The offset is clamped against the GRAVITY table inside Game.tick(),
// so even at high stacks the lookup stays valid.

export default {
  id: 'curse-hyped',
  name: 'Hyped',
  description: 'Pieces fall one level faster — permanent and stackable.',
  available: () => true,
  apply: (game) => { game.curses.hyped += 1; },
};
