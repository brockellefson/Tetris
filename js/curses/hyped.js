// Curse: Hyped — pieces fall one level faster (permanent, stackable).
//
// State + behavior both live here now. Picking the curse increments
// `game.curses.hyped` (kept on Game so the HUD reads it directly);
// the gravity-table lookup index is bumped via the modifyGravityIndex
// modifier hook, threaded through every plugin by Game.tick().
//
// The lookup is clamped against the GRAVITY table inside Game.tick(),
// so even at high stacks the index stays valid.

export default {
  id: 'curse-hyped',
  name: 'Hyped',
  description: 'Pieces fall one level faster.',
  available: () => true,
  apply: (game) => { game.curses.hyped += 1; },

  // ---- lifecycle hooks ----

  // Each Hyped stack adds 1 to the gravity-table lookup index, making
  // the next gravity tick fire at the speed of (level + stacks).
  modifyGravityIndex: (game, idx) => idx + game.curses.hyped,
};
