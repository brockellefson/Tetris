// Power-up: Predictor — reveals the ghost piece outline.
// Shows where the falling piece will land if dropped straight down.

export default {
  id: 'predictor',
  name: 'Predictor',
  description: 'See a ghost outline showing where your falling piece will land.',
  available: (game) => !game.unlocks.ghost,
  apply:     (game) => { game.unlocks.ghost = true; },
};
