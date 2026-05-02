// Power-up (blessing): Dispell — removes one random curse currently
// afflicting the player. The relief valve for runs that have stacked
// debuffs to a punishing degree.
//
// Special properties vs. the rest of the blessing pool:
//   • `noCurse: true` — picking this card does NOT bundle a curse along
//     with it. The choice-menu code in main.js reads this flag and
//     renders the card without the usual pink curse half.
//   • `available()` returns true as long as the player has at least
//     one active curse — there has to be something to remove or the
//     card would just be a wasted slot.
//
// "Active curses" mirrors what the curse HUD shows in syncCursesUI()
// (main.js): junk flag, hyped stacks, an in-effect Cruel level cap,
// and Growth column count. Each active curse contributes one entry to
// the pool; stackable curses (Hyped, Growth) lose a single stack per
// pick, while boolean / timed curses (Junk, Cruel) clear outright.
//
// Rain isn't represented — it's a one-shot drop with no persistent
// flag, so there's nothing left for Dispell to remove.

function activeCurseKeys(game) {
  const keys = [];
  if (game.curses.junk)                          keys.push('junk');
  if (game.curses.hyped > 0)                     keys.push('hyped');
  if (game.level <= game.curses.cruelUntilLevel) keys.push('cruel');
  if (game.curses.extraCols > 0)                 keys.push('growth');
  return keys;
}

export default {
  id: 'dispell',
  name: 'Dispell',
  description: 'Removes a random curse currently afflicting you. No cost.',
  noCurse: true,
  available: (game) => activeCurseKeys(game).length > 0,
  apply: (game) => {
    const keys = activeCurseKeys(game);
    if (keys.length === 0) return;
    const pick = keys[Math.floor(Math.random() * keys.length)];
    switch (pick) {
      case 'junk':
        // The dropped junk rows are part of the locked board state and
        // can't be cleanly undone. Clearing the flag at least retires
        // the HUD tag and lets future Junk picks re-trigger their hook.
        game.curses.junk = false;
        break;
      case 'hyped':
        // Stackable — peel one level of speed off so a multi-stacked
        // Hyped run can be partially defused over several Dispells.
        game.curses.hyped = Math.max(0, game.curses.hyped - 1);
        break;
      case 'cruel':
        // Cruel only lasts the current level anyway; clearing the cap
        // ends it the next time refillQueue() runs.
        game.curses.cruelUntilLevel = 0;
        break;
      case 'growth':
        // Stackable — drop one column's worth of curse. tryRemoveColumn
        // refuses if the rightmost column has any locked block or any
        // cell of the active piece in it; in that case we still
        // decrement the counter so the HUD reflects the lifted curse,
        // even though the visible width can't shrink right now.
        game.curses.extraCols = Math.max(0, game.curses.extraCols - 1);
        game.tryRemoveColumn?.();
        break;
    }
  },
};
