// ============================================================
// Curse registry
// ============================================================
//
// Curses are debuffs the player MUST pick every 10 lines (one
// per level transition). Same shape as power-ups — they mutate
// `game.curses` and the rest of the codebase reads from it.
//
// Add a new curse: drop a file in this directory, import it,
// add it to ALL_CURSES.
// ============================================================

import junk     from './junk.js';
import hyped    from './hyped.js';
import cruel from './cruel.js';
import rain     from './rain.js';
import growth   from './growth.js';

export const ALL_CURSES = [junk, hyped, cruel, rain, growth];

// Pick up to `count` random eligible curses for the choice menu.
// All current curses are always available, but `available()` is
// supported for symmetry with the power-up system.
export function pickCurseChoices(game, count = 3) {
  const eligible = ALL_CURSES.filter(c => c.available(game));
  const shuffled = [...eligible];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
