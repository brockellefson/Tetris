// ============================================================
// debug.js — pause-only developer panel
// ============================================================
//
// Lets the player force any blessing or curse on demand and
// rewrite the level for testing. Reachable only via the Debug
// button on the pause overlay — never surfaces during active
// play, so nothing here can leak into a normal run.
//
// Lifecycle:
//   const debug = setupDebug(game);
//   // setupInput callbacks then call:
//   debug.showLauncher() / debug.hideLauncher() / debug.hideMenu()
//
// Each pill is a toggle. Clicking an inactive pill apply()s the
// effect; clicking an active (gold-highlighted) pill remove()s it.
// One-shot effects (Mercy / Tired / Gravity / Dispell / Rain)
// expose no remove() and always re-apply on click.
//
// Charge-based blessings (Chisel / Fill / Flip / Whoops) use a
// huge counter rather than calling the card's apply() — those
// clamp at MAX_*_CHARGES = 1, which makes them un-spammable from
// the menu. The huge value reads as effectively unlimited.
//
// Setting the level rewrites both `game.level` (used immediately
// for gravity speed) AND `game.lines = (level - 1) * 10` so the
// next call to completeClear() doesn't snap level back via its
// `floor(lines / 10) + 1` recompute.
//
// Keys:
//   • Esc closes the menu without unpausing (handy for peeking).
//   • The level input swallows every keydown so a stray "P" typed
//     into it doesn't trip the global pause toggle in input.js.
// ============================================================

import { COLS } from './constants.js';
import {
  wireMenuSounds,
  playCycleSound,
  playSelectSound,
  playMenuOpenSound,
  playMenuHoverSound,
} from './sound.js';
// One-shot blessings whose apply() IS their entire behavior; we
// defer to the card's own apply() rather than re-implementing it.
import mercyPlugin   from './powerups/mercy.js';
import tiredPlugin   from './powerups/tired.js';
import gravityPlugin from './powerups/gravity.js';
import dispellPlugin from './powerups/dispell.js';
// Curse plugins — same pattern. apply() runs the curse's full
// effect (drop junk rows, stack hyped, set the cruel level cap,
// rain blocks, widen the board).
import junkCurse   from './curses/junk.js';
import hypedCurse  from './curses/hyped.js';
import cruelCurse  from './curses/cruel.js';
import rainCurse   from './curses/rain.js';
import growthCurse from './curses/growth.js';

// Counter value used for the "unlimited charge" blessings. Any
// large number works; this one's far above what a player would
// realistically spend in a single test session.
const DEBUG_UNLIMITED = 9999;

// Each blessing carries an `isActive(g)` predicate so the menu can
// gold-highlight pills whose effect is currently live, AND a
// `remove(g)` for toggleables. Charge-based cards read as active
// while any charge is banked. Psychic N cards demote nextCount to
// N - 1 on remove so disabling Psychic III leaves Psychic I and
// II still highlighted. One-shots have no persistent state — they
// expose no remove and always report inactive.
const DEBUG_BLESSINGS = [
  { id: 'hold',    name: 'Hold',
    apply:    (g) => { g.unlocks.hold  = true;  },
    remove:   (g) => { g.unlocks.hold  = false; },
    isActive: (g) =>   g.unlocks.hold },
  { id: 'ghost',   name: 'Ghost',
    apply:    (g) => { g.unlocks.ghost = true;  },
    remove:   (g) => { g.unlocks.ghost = false; },
    isActive: (g) =>   g.unlocks.ghost },
  { id: 'slick',   name: 'Slick',
    apply:    (g) => { g.unlocks.slick = true;  },
    remove:   (g) => { g.unlocks.slick = false; g.lockDelayTimer = 0; },
    isActive: (g) =>   g.unlocks.slick },
  // Psychic N cards toggle the queue-preview count. Removing
  // demotes nextCount to N - 1 so lower-tier psychics remain
  // active — clicking off Psychic III with nextCount = 5 leaves
  // the player with Psychic II.
  { id: 'psy1', name: 'Psychic I',
    apply:    (g) => { g.unlocks.nextCount = Math.max(1, g.unlocks.nextCount); },
    remove:   (g) => { g.unlocks.nextCount = 0; },
    isActive: (g) =>   g.unlocks.nextCount >= 1 },
  { id: 'psy2', name: 'Psychic II',
    apply:    (g) => { g.unlocks.nextCount = Math.max(2, g.unlocks.nextCount); },
    remove:   (g) => { g.unlocks.nextCount = Math.min(g.unlocks.nextCount, 1); },
    isActive: (g) =>   g.unlocks.nextCount >= 2 },
  { id: 'psy3', name: 'Psychic III',
    apply:    (g) => { g.unlocks.nextCount = Math.max(3, g.unlocks.nextCount); },
    remove:   (g) => { g.unlocks.nextCount = Math.min(g.unlocks.nextCount, 2); },
    isActive: (g) =>   g.unlocks.nextCount >= 3 },
  { id: 'psy4', name: 'Psychic IV',
    apply:    (g) => { g.unlocks.nextCount = Math.max(4, g.unlocks.nextCount); },
    remove:   (g) => { g.unlocks.nextCount = Math.min(g.unlocks.nextCount, 3); },
    isActive: (g) =>   g.unlocks.nextCount >= 4 },
  { id: 'psy5', name: 'Psychic V',
    apply:    (g) => { g.unlocks.nextCount = Math.max(5, g.unlocks.nextCount); },
    remove:   (g) => { g.unlocks.nextCount = Math.min(g.unlocks.nextCount, 4); },
    isActive: (g) =>   g.unlocks.nextCount >= 5 },
  // Charge-based — bypass the per-card cap so the user can hammer
  // the key as much as they want during a test session.
  { id: 'chisel', name: 'Chisel',
    apply:    (g) => { g.unlocks.chiselCharges = DEBUG_UNLIMITED; },
    remove:   (g) => { g.unlocks.chiselCharges = 0; },
    isActive: (g) =>   g.unlocks.chiselCharges > 0 },
  { id: 'fill',   name: 'Fill',
    apply:    (g) => { g.unlocks.fillCharges = DEBUG_UNLIMITED; },
    remove:   (g) => { g.unlocks.fillCharges = 0; },
    isActive: (g) =>   g.unlocks.fillCharges > 0 },
  { id: 'flip',   name: 'Flip',
    apply:    (g) => { g.unlocks.flipCharges = DEBUG_UNLIMITED; },
    remove:   (g) => { g.unlocks.flipCharges = 0; },
    isActive: (g) =>   g.unlocks.flipCharges > 0 },
  { id: 'whoops', name: 'Whoops',
    apply:    (g) => { g.unlocks.whoopsCharges = DEBUG_UNLIMITED; },
    remove:   (g) => { g.unlocks.whoopsCharges = 0; },
    isActive: (g) =>   g.unlocks.whoopsCharges > 0 },
  // One-shot effects — defer to the card's own apply so any side
  // effects (queue mutation, gravity cascade kickoff, dispell roll)
  // mirror the real pick path. No persistent "active" state.
  { id: 'mercy',   name: 'Mercy',   apply: (g) => mercyPlugin.apply(g),   isActive: () => false },
  { id: 'tired',   name: 'Tired',   apply: (g) => tiredPlugin.apply(g),   isActive: () => false },
  { id: 'gravity', name: 'Gravity', apply: (g) => gravityPlugin.apply(g), isActive: () => false },
  { id: 'dispell', name: 'Dispell', apply: (g) => dispellPlugin.apply(g), isActive: () => false },
];

// remove() notes per curse:
//   • Junk    — clears the flag. Already-dropped junk rows stay on
//               the board (Dispell does the same — there's no clean
//               way to undo locked-in rubble).
//   • Hyped   — zeroes the entire stack so a multi-stacked Hyped
//               lifts in one click instead of needing N Tireds.
//   • Cruel   — drops the level cap so I-pieces pass the bag
//               filter again. Existing queue isn't reshuffled (the
//               next refill picks I-pieces up).
//   • Growth  — zeroes extraCols and asks the Growth plugin to
//               drop every added column via the service-bus
//               action. Each removeColumn refuses if the rightmost
//               column has any locked block or active-piece cell,
//               so the visible width may not shrink all the way;
//               the curse is retired regardless and columns fall
//               off as soon as the cells holding them clear.
const DEBUG_CURSES = [
  { id: 'junk',  name: 'Junk',
    apply:    (g) => junkCurse.apply(g),
    remove:   (g) => { g.curses.junk = false; },
    isActive: (g) =>   g.curses.junk },
  { id: 'hyped', name: 'Hyped',
    apply:    (g) => hypedCurse.apply(g),
    remove:   (g) => { g.curses.hyped = 0; },
    isActive: (g) =>   g.curses.hyped > 0 },
  { id: 'cruel', name: 'Cruel',
    apply:    (g) => cruelCurse.apply(g),
    remove:   (g) => { g.curses.cruelUntilLevel = 0; },
    isActive: (g) =>   g.level <= g.curses.cruelUntilLevel },
  // Rain is a one-shot — picking it sprays more rubble; there's
  // no persistent flag to flip off, so no remove is exposed.
  { id: 'rain',  name: 'Rain', apply: (g) => rainCurse.apply(g), isActive: () => false },
  { id: 'growth', name: 'Growth',
    apply:    (g) => growthCurse.apply(g),
    remove:   (g) => {
      g.curses.extraCols = 0;
      while (g.board[0] && g.board[0].length > COLS) {
        const before = g.board[0].length;
        g._interceptInput('growth:removeColumn');
        if (g.board[0].length === before) break;
      }
    },
    isActive: (g) =>   g.curses.extraCols > 0 },
];

export function setupDebug(game) {
  const debugBtn$        = document.getElementById('debug-btn');
  const debugMenu$       = document.getElementById('debug-menu');
  const debugBlessings$  = document.getElementById('debug-blessings');
  const debugCurses$     = document.getElementById('debug-curses');
  const debugLevelInput$ = document.getElementById('debug-level-input');
  const debugLevelUp$    = document.getElementById('debug-level-up');
  const debugLevelDown$  = document.getElementById('debug-level-down');
  const debugLevelApply$ = document.getElementById('debug-level-apply');
  const debugCloseBtn$   = document.getElementById('debug-close-btn');

  // Track each pill alongside its card so refreshActive() can
  // re-paint the gold .active class without rebuilding the menu.
  const pills = []; // [{ card, el }]

  // Audio gate — only fire menu sounds while the modal is actually
  // visible. Without this, mouseenter pings can leak from stale
  // hover events the moment the menu hides.
  const menuVisible = () => !debugMenu$.classList.contains('hidden');
  const launcherVisible = () => !debugBtn$.classList.contains('hidden');

  function refreshActive() {
    for (const { card, el } of pills) {
      el.classList.toggle('active', !!card.isActive(game));
    }
  }

  function makePill(card, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'debug-pill' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = card.name;
    btn.addEventListener('click', () => {
      // Toggle: if active and removable, turn off; otherwise apply.
      // Cards without a remove() (one-shots) always re-apply.
      if (card.remove && card.isActive(game)) {
        card.remove(game);
      } else {
        card.apply(game);
      }
      // Re-paint highlights — a click can flip the pill we just
      // clicked AND/OR another pill's state (Dispell removing a
      // curse, Psychic-tier demotions cascading downward).
      refreshActive();
    });
    wireMenuSounds(btn, { shouldPlay: menuVisible });
    pills.push({ card, el: btn });
    return btn;
  }

  // ---- Build the pill grids ----
  for (const card of DEBUG_BLESSINGS) debugBlessings$.appendChild(makePill(card));
  for (const card of DEBUG_CURSES)    debugCurses$.appendChild(makePill(card, 'curse'));

  // ---- Level controls ----
  function setLevel(n) {
    const lvl = Math.max(1, Math.floor(Number(n) || 1));
    game.level = lvl;
    game.lines = (lvl - 1) * 10;
    debugLevelInput$.value = String(lvl);
  }
  debugLevelUp$.addEventListener('click', () => {
    debugLevelInput$.value = String(Math.max(1, (parseInt(debugLevelInput$.value, 10) || 1) + 1));
  });
  debugLevelDown$.addEventListener('click', () => {
    debugLevelInput$.value = String(Math.max(1, (parseInt(debugLevelInput$.value, 10) || 1) - 1));
  });
  debugLevelApply$.addEventListener('click', () => {
    setLevel(debugLevelInput$.value);
  });
  // +/- nudges are incremental; SET commits the value.
  wireMenuSounds(debugLevelUp$,    { hover: playCycleSound, click: playCycleSound,  shouldPlay: menuVisible });
  wireMenuSounds(debugLevelDown$,  { hover: playCycleSound, click: playCycleSound,  shouldPlay: menuVisible });
  wireMenuSounds(debugLevelApply$, { hover: playCycleSound, click: playSelectSound, shouldPlay: menuVisible });
  // Stop every key from bubbling to input.js so a stray "P" typed
  // into the level input doesn't trip the global pause toggle.
  // Enter commits as a SET click.
  debugLevelInput$.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      setLevel(debugLevelInput$.value);
      playSelectSound();
    }
  });

  // ---- Launcher (DEBUG button on the pause overlay) ----
  debugBtn$.addEventListener('mouseenter', () => {
    if (launcherVisible()) playMenuHoverSound();
  });
  debugBtn$.addEventListener('click', () => { showMenu(); });

  // ---- Close button ----
  // Play the chime BEFORE hideMenu() — once hidden, the visibility
  // gate would suppress any subsequent sound.
  debugCloseBtn$.addEventListener('mouseenter', () => {
    if (menuVisible()) playMenuHoverSound();
  });
  debugCloseBtn$.addEventListener('click', () => {
    if (menuVisible()) playSelectSound();
    hideMenu();
  });

  // Esc closes the menu without unpausing — peek-and-back-out.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuVisible()) {
      e.preventDefault();
      hideMenu();
    }
  }, { capture: true });

  function showMenu() {
    // Snap the input to the live level so opening mid-game doesn't
    // show a stale 1.
    debugLevelInput$.value = String(game.level);
    debugMenu$.classList.remove('hidden');
    // Re-evaluate active highlights — game state may have changed
    // since the menu was last open (line clears, level-ups, etc.).
    refreshActive();
    playMenuOpenSound();
  }
  function hideMenu() {
    debugMenu$.classList.add('hidden');
  }
  function showLauncher() { debugBtn$.classList.remove('hidden'); }
  function hideLauncher() { debugBtn$.classList.add('hidden'); }

  return { showLauncher, hideLauncher, hideMenu };
}
