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
import { wireArrowNav } from './menus/keynav.js';
// One-shot blessings whose apply() IS their entire behavior; we
// defer to the card's own apply() rather than re-implementing it.
import mercyPlugin   from './powerups/mercy.js';
import tiredPlugin   from './powerups/tired.js';
import dispellPlugin from './powerups/dispell.js';
// Gravity is no longer a power-up — it's a special block. The debug
// "Gravity" pill calls the cascade engine directly so testers can
// trigger the effect without needing to spawn-and-clear a tagged piece.
import { startGravityCascade } from './effects/gravity-cascade.js';
// Specials registry — used to build the "force special on next spawn"
// pill grid so testers can stage any special on demand.
import { ALL_SPECIALS } from './specials/index.js';
// Curse plugins — same pattern. apply() runs the curse's full
// effect (drop junk rows, stack hyped, set the cruel level cap,
// rain blocks, widen the board).
import junkCurse   from './curses/junk.js';
import hypedCurse  from './curses/hyped.js';
import cruelCurse  from './curses/cruel.js';
import rainCurse   from './curses/rain.js';
import growthCurse from './curses/growth.js';

// "Seed Board" — paint the bottom half of the playfield with random
// tetromino-colored rubble so the tester can jump straight to a
// mid-game position without manually stacking pieces. Tuning knobs:
//   SEED_HEIGHT_FRAC  — fraction of the board height to fill from
//                       the bottom (0.5 = bottom half).
//   SEED_FILL_TOP     — per-cell fill probability on the topmost
//                       seeded row (lots of holes — ragged "fresh
//                       stack" look).
//   SEED_FILL_BOTTOM  — per-cell fill probability on the very bottom
//                       row (mostly filled — the kind of dense rubble
//                       you accumulate after a few minutes of play).
// Probability ramps linearly between the two, so the seeded region
// reads as bottom-heavy rather than uniform fog. Every row is also
// guaranteed at least one hole so seeding never produces an instant
// line clear when the next piece lands.
const SEED_HEIGHT_FRAC = 0.5;
const SEED_FILL_TOP    = 0.55;
const SEED_FILL_BOTTOM = 0.92;
// The standard tetromino types. Skips JUNK / FILL because those are
// reserved for the curse / power-up that places them — using them in
// a player-initiated seed would muddle the visual vocabulary.
const SEED_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

function seedBoard(game) {
  const cols = game.board[0]?.length ?? COLS;
  const rows = game.board.length;
  // Wipe the playfield (and the parallel specials grid) so the seed
  // is the only thing on the board. Without clearing specials we'd
  // get phantom triggers attached to seeded cells from whatever was
  // there before the seed.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) game.board[r][c] = null;
  }
  const sb = game._pluginState.specials;
  if (sb?.boardGrid) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) sb.boardGrid[r][c] = null;
    }
  }
  // Paint the bottom region. Rows iterate top-of-seed → floor; depth
  // 0 = topmost seeded row (sparse), depth 1 = floor (dense).
  const seedHeight = Math.max(1, Math.floor(rows * SEED_HEIGHT_FRAC));
  const startRow = rows - seedHeight;
  for (let r = startRow; r < rows; r++) {
    const t = seedHeight === 1 ? 1 : (r - startRow) / (seedHeight - 1);
    const fillProb = SEED_FILL_TOP + (SEED_FILL_BOTTOM - SEED_FILL_TOP) * t;
    for (let c = 0; c < cols; c++) {
      if (Math.random() < fillProb) {
        game.board[r][c] = SEED_TYPES[Math.floor(Math.random() * SEED_TYPES.length)];
      }
    }
    // Force at least one hole so the seed never lines up a Tetris on
    // the next lock — would be confusing to seed mid-game and have it
    // immediately collapse.
    if (game.board[r].every(cell => cell)) {
      game.board[r][Math.floor(Math.random() * cols)] = null;
    }
  }
  // Reset state tied to the active piece — the seed invalidates any
  // in-flight lock-delay window, drop accumulator, combo, or B2B
  // streak (they describe the world we just overwrote). Then spawn a
  // fresh piece at the top so the player isn't staring at rubble
  // with no piece in play. Seed height tops out at half the board so
  // the spawn at row 0 can't collide with the seeded region.
  game.current = null;
  game.lockDelayTimer = 0;
  game.dropTimer = 0;
  game.combo = 0;
  game.lastClearWasTetris = false;
  game.clearingRows = [];
  game.clearTimer = 0;
  game.spawnNext();
}

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
  // Unlock-once — Chisel / Fill / Flip / Whoops are toggled directly.
  // Each cast still arms the per-cast cooldown via the plugin's
  // activate path, so the debug pill just lets the tester gate the
  // unlock itself. Toggling off also clears any in-flight cooldown
  // so a tester re-enabling the pill doesn't have to wait for it
  // to drain.
  { id: 'chisel', name: 'Chisel',
    apply:    (g) => { g.unlocks.chisel = true; },
    remove:   (g) => { g.unlocks.chisel = false;
                       if (g._pluginState.chisel) g._pluginState.chisel.cooldown = 0; },
    isActive: (g) =>   g.unlocks.chisel },
  { id: 'fill',   name: 'Fill',
    apply:    (g) => { g.unlocks.fill = true; },
    remove:   (g) => { g.unlocks.fill = false;
                       if (g._pluginState.fill) g._pluginState.fill.cooldown = 0; },
    isActive: (g) =>   g.unlocks.fill },
  { id: 'flip',   name: 'Flip',
    apply:    (g) => { g.unlocks.flip = true; },
    remove:   (g) => { g.unlocks.flip = false;
                       if (g._pluginState.flip) g._pluginState.flip.cooldown = 0; },
    isActive: (g) =>   g.unlocks.flip },
  { id: 'whoops', name: 'Whoops',
    apply:    (g) => { g.unlocks.whoops = true; },
    remove:   (g) => { g.unlocks.whoops = false;
                       if (g._pluginState.whoops) g._pluginState.whoops.cooldown = 0; },
    isActive: (g) =>   g.unlocks.whoops },
  // One-shot effects — defer to the card's own apply so any side
  // effects (queue mutation, gravity cascade kickoff, dispell roll)
  // mirror the real pick path. No persistent "active" state.
  { id: 'mercy',   name: 'Mercy',   apply: (g) => mercyPlugin.apply(g),   isActive: () => false },
  { id: 'tired',   name: 'Tired',   apply: (g) => tiredPlugin.apply(g),   isActive: () => false },
  // Gravity isn't a card anymore — the pill kicks the cascade engine
  // directly so testers can still trigger the effect on demand. The
  // engine refuses if a cascade is already running, matching the
  // production trigger path (Bomb detonations and any future cascade-
  // triggering special). State lives in the plugin-state bag at
  // `_pluginState.gravity.active`.
  { id: 'gravity', name: 'Gravity Cascade',
    apply: (g) => startGravityCascade(g),
    isActive: (g) => g._pluginState?.gravity?.active === true },
  { id: 'dispell', name: 'Dispell', apply: (g) => dispellPlugin.apply(g), isActive: () => false },
  // Special-block blessing tiers — Psychic-pattern toggles. Each tier
  // pill apply()s by elevating the level to >= N; remove()s by
  // demoting one tier (so clicking off Bomb III with level=3 leaves
  // the player at Bomb II). Click order: I → II → III to climb;
  // III → II → I to step back down.
  { id: 'bomb1', name: 'Bomb I',
    apply:    (g) => { g.unlocks.specials.bomb = Math.max(1, g.unlocks.specials.bomb); },
    remove:   (g) => { g.unlocks.specials.bomb = 0; },
    isActive: (g) =>   (g.unlocks.specials?.bomb ?? 0) >= 1 },
  { id: 'bomb2', name: 'Bomb II',
    apply:    (g) => { g.unlocks.specials.bomb = Math.max(2, g.unlocks.specials.bomb); },
    remove:   (g) => { g.unlocks.specials.bomb = Math.min(g.unlocks.specials.bomb, 1); },
    isActive: (g) =>   (g.unlocks.specials?.bomb ?? 0) >= 2 },
  { id: 'bomb3', name: 'Bomb III',
    apply:    (g) => { g.unlocks.specials.bomb = Math.max(3, g.unlocks.specials.bomb); },
    remove:   (g) => { g.unlocks.specials.bomb = Math.min(g.unlocks.specials.bomb, 2); },
    isActive: (g) =>   (g.unlocks.specials?.bomb ?? 0) >= 3 },
  { id: 'lightning1', name: 'Lightning I',
    apply:    (g) => { g.unlocks.specials.lightning = Math.max(1, g.unlocks.specials.lightning); },
    remove:   (g) => { g.unlocks.specials.lightning = 0; },
    isActive: (g) =>   (g.unlocks.specials?.lightning ?? 0) >= 1 },
  { id: 'lightning2', name: 'Lightning II',
    apply:    (g) => { g.unlocks.specials.lightning = Math.max(2, g.unlocks.specials.lightning); },
    remove:   (g) => { g.unlocks.specials.lightning = Math.min(g.unlocks.specials.lightning, 1); },
    isActive: (g) =>   (g.unlocks.specials?.lightning ?? 0) >= 2 },
  { id: 'lightning3', name: 'Lightning III',
    apply:    (g) => { g.unlocks.specials.lightning = Math.max(3, g.unlocks.specials.lightning); },
    remove:   (g) => { g.unlocks.specials.lightning = Math.min(g.unlocks.specials.lightning, 2); },
    isActive: (g) =>   (g.unlocks.specials?.lightning ?? 0) >= 3 },
  // Welder tiers — same Psychic step pattern as Bomb / Lightning.
  { id: 'welder1', name: 'Welder I',
    apply:    (g) => { g.unlocks.specials.welder = Math.max(1, g.unlocks.specials.welder); },
    remove:   (g) => { g.unlocks.specials.welder = 0; },
    isActive: (g) =>   (g.unlocks.specials?.welder ?? 0) >= 1 },
  { id: 'welder2', name: 'Welder II',
    apply:    (g) => { g.unlocks.specials.welder = Math.max(2, g.unlocks.specials.welder); },
    remove:   (g) => { g.unlocks.specials.welder = Math.min(g.unlocks.specials.welder, 1); },
    isActive: (g) =>   (g.unlocks.specials?.welder ?? 0) >= 2 },
  { id: 'welder3', name: 'Welder III',
    apply:    (g) => { g.unlocks.specials.welder = Math.max(3, g.unlocks.specials.welder); },
    remove:   (g) => { g.unlocks.specials.welder = Math.min(g.unlocks.specials.welder, 2); },
    isActive: (g) =>   (g.unlocks.specials?.welder ?? 0) >= 3 },
  // Lucky stacks — same Psychic-pattern step-down on remove. Clicking
  // an unlocked Lucky tier when the requisite specials aren't unlocked
  // is harmless (the spawn picker still gates on `unlocks.specials`),
  // but the chance bump is dead weight without specials to spawn.
  { id: 'lucky1', name: 'Lucky I',
    apply:    (g) => { g.unlocks.lucky = Math.max(1, g.unlocks.lucky); },
    remove:   (g) => { g.unlocks.lucky = 0; },
    isActive: (g) =>   (g.unlocks.lucky ?? 0) >= 1 },
  { id: 'lucky2', name: 'Lucky II',
    apply:    (g) => { g.unlocks.lucky = Math.max(2, g.unlocks.lucky); },
    remove:   (g) => { g.unlocks.lucky = Math.min(g.unlocks.lucky, 1); },
    isActive: (g) =>   (g.unlocks.lucky ?? 0) >= 2 },
  { id: 'lucky3', name: 'Lucky III',
    apply:    (g) => { g.unlocks.lucky = Math.max(3, g.unlocks.lucky); },
    remove:   (g) => { g.unlocks.lucky = Math.min(g.unlocks.lucky, 2); },
    isActive: (g) =>   (g.unlocks.lucky ?? 0) >= 3 },
];

// "Force a special on the next-spawned piece" pills. Reads ALL_SPECIALS
// so adding a new special automatically gets a debug pill — zero edits
// here. Setting `_pluginState.specials.forceNext = id` is consumed by
// the specials plugin's decoratePiece on the next spawnNext(), so the
// next piece always carries the chosen special. Clicking the pill
// again before the next spawn changes the queued kind; clicking the
// same pill twice (re-applying) re-arms it harmlessly.
const specialsBag = (g) => g._pluginState.specials;
const DEBUG_SPECIALS = ALL_SPECIALS.map(s => ({
  id: `force-${s.id}`,
  name: `Force ${s.name}`,
  apply:    (g) => { const sb = specialsBag(g); if (sb) sb.forceNext = s.id; },
  remove:   (g) => {
    const sb = specialsBag(g);
    if (sb && sb.forceNext === s.id) sb.forceNext = null;
  },
  isActive: (g) =>   specialsBag(g)?.forceNext === s.id,
}));

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
  const debugSpecials$   = document.getElementById('debug-specials');
  const debugLevelInput$ = document.getElementById('debug-level-input');
  const debugLevelUp$    = document.getElementById('debug-level-up');
  const debugLevelDown$  = document.getElementById('debug-level-down');
  const debugLevelApply$ = document.getElementById('debug-level-apply');
  const debugSeedBtn$    = document.getElementById('debug-seed-btn');
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
  // Specials grid only renders if the host markup has the section —
  // skip silently otherwise so the menu still works on older HTML.
  if (debugSpecials$) {
    for (const card of DEBUG_SPECIALS) debugSpecials$.appendChild(makePill(card));
  }

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

  // ---- Board seed control ----
  // SEED commits a new board state, so it earns the same select chime
  // as SET / a power-up pick.
  debugSeedBtn$.addEventListener('click', () => { seedBoard(game); });
  wireMenuSounds(debugSeedBtn$, { hover: playCycleSound, click: playSelectSound, shouldPlay: menuVisible });
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
  // The capture-phase listener fires before input.js's bubble-phase
  // keydown handler, and stopPropagation keeps the same key from
  // also tripping input.js's pause toggle (which now also binds Esc).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuVisible()) {
      e.preventDefault();
      e.stopPropagation();
      hideMenu();
    }
  }, { capture: true });

  // Arrow-key navigation across the whole panel — the +/- / SET row,
  // every blessing / curse / specials pill, and the close button. The
  // level <input> is intentionally absent: it owns ArrowUp/Down for
  // the native number stepper and ArrowLeft/Right for caret movement,
  // and the helper already passes those through whenever a text/number
  // input has focus. Tab still reaches it as usual.
  const nav = wireArrowNav({
    getButtons: () => [
      debugLevelDown$,
      debugLevelUp$,
      debugLevelApply$,
      debugSeedBtn$,
      ...pills.map(p => p.el),
      debugCloseBtn$,
    ],
    isOpen: menuVisible,
    onMove: playCycleSound,
  });

  // Arrow-key nav for the pause overlay itself — the Debug button is
  // the only interactive surface there, so the very first arrow press
  // while paused focuses it. Enter/Space then opens the menu (native
  // button activation), at which point the launcher hides under the
  // debug-menu modal and the nav above takes over. Active only while
  // the launcher is on screen AND the debug menu isn't yet open, so
  // it doesn't fight the panel-level nav.
  wireArrowNav({
    getButtons: () => (launcherVisible() && !menuVisible()) ? [debugBtn$] : [],
    isOpen:     ()  => launcherVisible() && !menuVisible(),
    onMove: playCycleSound,
  });

  function showMenu() {
    // Snap the input to the live level so opening mid-game doesn't
    // show a stale 1.
    debugLevelInput$.value = String(game.level);
    debugMenu$.classList.remove('hidden');
    // Re-evaluate active highlights — game state may have changed
    // since the menu was last open (line clears, level-ups, etc.).
    refreshActive();
    // Seed keyboard focus on the first button so arrow keys work
    // immediately without the user having to click first.
    nav.focusFirst();
    playMenuOpenSound();
  }
  function hideMenu() {
    debugMenu$.classList.add('hidden');
  }
  function showLauncher() { debugBtn$.classList.remove('hidden'); }
  function hideLauncher() { debugBtn$.classList.add('hidden'); }

  return { showLauncher, hideLauncher, hideMenu };
}
