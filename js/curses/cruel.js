// Curse: Cruel — no I-pieces (line pieces) for the current level.
//
// Implementation:
//   • Sets `cruelUntilLevel` to the current level. The Game's
//     `refillQueue()` checks `level > cruelUntilLevel` to decide
//     whether to allow I-pieces in the bag. Once the player levels
//     up, the curse expires naturally.
//
//   • Strips any I-pieces that are already queued so the next-piece
//     preview reflects the new state immediately. After filtering,
//     the queue is topped back up via the (now I-less) bag.
//
// Picking Cruel again on a future level just resets the marker
// to the new current level — never shortens an active cruel window.

export default {
  id: 'curse-cruel',
  name: 'Cruel',
  description: 'No line pieces for this level.',
  available: () => true,
  apply: (game) => {
    game.curses.cruelUntilLevel = Math.max(
      game.curses.cruelUntilLevel,
      game.level,
    );
    game.queue = game.queue.filter(t => t !== 'I');
    game.refillQueue();
  },
};
