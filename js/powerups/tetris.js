// Power-up: Tetris — guarantees the next piece in the queue is the
// I-piece (a "line piece"). Useful for setting up Tetris clears.
//
// Implementation: unshift 'I' onto the queue. The next call to
// spawnNext() will shift it off and spawn it as usual. This means
// the I-piece appears at queue position 0 immediately, so the
// "Next" preview reflects it the moment the choice is applied.
//
// This is a one-shot consumable — `available` always returns true,
// so the player can pick it again on later milestones.

export default {
  id: 'tetris',
  name: 'Tetris',
  description: 'Your next piece will be a line piece.',
  available: () => true,
  apply: (game) => { game.queue.unshift('I'); },
};
