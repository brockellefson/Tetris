// Curse: Flexible — no I-pieces (line pieces) for the current level.
//
// Implementation:
//   • Sets `flexibleUntilLevel` to the current level. The Game's
//     `refillQueue()` checks `level > flexibleUntilLevel` to decide
//     whether to allow I-pieces in the bag. Once the player levels
//     up, the curse expires naturally.
//
//   • Strips any I-pieces that are already queued so the next-piece
//     preview reflects the new state immediately. After filtering,
//     the queue is topped back up via the (now I-less) bag.
//
// Picking Flexible again on a future level just resets the marker
// to the new current level — never shortens an active flexible window.

export default {
  id: 'curse-flexible',
  name: 'Flexible',
  description: 'No line pieces for this level. Existing I-pieces leave the queue.',
  available: () => true,
  apply: (game) => {
    game.curses.flexibleUntilLevel = Math.max(
      game.curses.flexibleUntilLevel,
      game.level,
    );
    game.queue = game.queue.filter(t => t !== 'I');
    game.refillQueue();
  },
};
