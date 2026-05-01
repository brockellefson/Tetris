// Power-up: Ghost — reveals the ghost piece outline.
// Shows where the falling piece will land if dropped straight down.

export default {
  id: 'ghost',
  name: 'Ghost',
  description: 'See a ghost outline showing where your falling piece will land.',
  available: (game) => !game.unlocks.ghost,
  apply:     (game) => { game.unlocks.ghost = true; },
};
