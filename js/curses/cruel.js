// Curse: Cruel — no I-pieces (line pieces) for the current level.
//
// State + behavior both live here now. Picking the curse:
//   • Sets `game.curses.cruelUntilLevel` to the current level. The
//     allowsBagPiece hook below refuses I-pieces while
//     game.level <= cruelUntilLevel; once the player levels up the
//     filter naturally lets I-pieces back in.
//   • Strips any I-pieces already queued so the next-piece preview
//     reflects the new state immediately. After filtering, the queue
//     is topped back up via refillQueue() (which now consults the
//     plugin filter and won't re-add I-pieces).
//
// Picking Cruel again on a future level just resets the marker to the
// new current level — never shortens an active cruel window.

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

  // ---- lifecycle hooks ----

  // Refuse I-pieces in the bag while the cruel window is active.
  // Other types pass through; returning anything other than `false`
  // is treated as "allow" by the veto-poll dispatch.
  allowsBagPiece: (game, type) => {
    if (type !== 'I') return true;
    return game.level > game.curses.cruelUntilLevel;
  },
};
