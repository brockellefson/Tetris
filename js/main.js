// ============================================================
// main.js — entry point
// ============================================================
//
// Wires the engine, renderer, input, HUD, menus, and plugins
// together. Owns the requestAnimationFrame loop and the lifecycle
// callbacks (start / pause / resume). Most concrete UI logic lives
// in dedicated modules — main.js is a wiring file.
//
// Module map:
//   game.js              engine & state machine
//   render.js            canvas drawing (board + minis)
//   input.js             keyboard → game actions
//   sound.js             Web-Audio SFX + UI-sound helper
//   hud.js               score panel, blessing/curse tags, overlays,
//                        notifications, chisel-hint banner
//   menus/powerup.js     power-up + bundled-curse choice modal
//   debug.js             pause-only developer panel
//   powerups/, curses/   the actual blessings & debuffs
// ============================================================

import { Game } from './game.js';
import { TETRIS_MODE, PUYO_MODE } from './modes/index.js';
import { drawBoard, drawMini } from './render.js';
import { setupInput } from './input.js';
import {
  playLockSound, playClearSound, playCycleSound, playMenuHoverSound,
  playMenuStartSound, playSelectSound,
  playChiselSound, playFillSound, playFlipSound,
  playSpecialTriggerSound, playSpecialSpawnSound,
  playBombSound, playLightningSound,
  playBombSpawnSound, playLightningSpawnSound,
} from './sound.js';
import { BLOCK } from './constants.js';
import { setupHUD } from './hud.js';
import { setupPowerupMenu } from './menus/powerup.js';
import { setupDebug } from './debug.js';
import { setupLeaderboard } from './leaderboard.js';
import { setupMusic } from './music.js';
import { wireArrowNav } from './menus/keynav.js';
// Lifecycle plugins — power-ups and curses that ship hooks (tick /
// onSpawn / shouldDeferLock / freezesGameplay / interceptInput /
// modifier hooks). Cards without hooks (Hold, Ghost, Psychic,
// Mercy, Tired, Dispell, Junk, Rain) don't need to register here —
// they only mutate state in apply() and the engine reads the result
// directly.
import slickPlugin   from './powerups/slick.js';
import whoopsPlugin  from './powerups/whoops.js';
import chiselPlugin  from './powerups/chisel.js';
import fillPlugin    from './powerups/fill.js';
import flipPlugin    from './powerups/flip.js';
import growthCurse   from './curses/growth.js';
import hypedCurse    from './curses/hyped.js';
import cruelCurse    from './curses/cruel.js';
// Gravity used to be a power-up; it's now a special block. The
// cascade engine still needs lifecycle hooks (freezesGameplay, tick)
// to drive its per-frame logic, so it's registered as an "effect"
// plugin here. The specials plugin sits beside it and handles the
// spawn-tag / line-clear-trigger pipeline that actually fires the
// cascade.
import gravityCascadePlugin from './effects/gravity-cascade.js';
import specialsPlugin       from './specials/index.js';
// Versus-only plugins — gated to mode 'puyo-versus' so they stay
// inert in Tetris and SP Puyo. local-vs attaches the match
// controller right before kicking off a versus run; state-sync
// then streams snapshots, garbage handles the chain protocol.
import garbagePlugin        from './modes/puyo/versus/garbage-plugin.js';
import stateSyncPlugin      from './modes/puyo/versus/state-sync-plugin.js';
import { setupLocalVersus } from './modes/puyo/versus/local-vs.js';
import { setupMatchEndMenu } from './modes/puyo/versus/match-end-menu.js';

// -------- DOM lookups owned by main --------
// Everything else lives inside its module. We keep here only what the
// frame loop or the splash-screen / board-click wiring directly uses.
//
// alpha:false on the canvases tells the browser the backing buffer
// has no transparent pixels — every cell either fills BG or a piece
// color, so per-pixel alpha compositing is wasted work. ~10–15% paint
// savings on the main board.
const board$       = document.getElementById('board');
const ctx          = board$.getContext('2d', { alpha: false });
const hold$        = document.getElementById('hold');
const holdCtx      = hold$.getContext('2d', { alpha: false });
const nextCanvases = [...document.querySelectorAll('.next')];
const nextCtxs     = nextCanvases.map(c => c.getContext('2d', { alpha: false }));
const menuScreen$  = document.getElementById('menu-screen');
const playBtn$     = document.getElementById('play-btn');
const playPuyoBtn$ = document.getElementById('play-puyo-btn');
const leaderboardBtn$ = document.getElementById('leaderboard-btn');
const mainMenuBtn$ = document.getElementById('main-menu-btn');
const debugBtn$    = document.getElementById('debug-btn');
const menuMusic$   = document.getElementById('menu-music');
const themeMusic$  = document.getElementById('theme-music');
const themeMusic2$ = document.getElementById('theme-music-2');

// -------- Boot --------
const game = new Game();
const hud = setupHUD();
const powerupMenu = setupPowerupMenu(game);
const debug = setupDebug(game);
const leaderboard = setupLeaderboard(game);

// Register lifecycle plugins. Order matters in one place: the
// specials plugin must register BEFORE the gravity cascade so its
// `reset` hook initializes `_pluginState.specials.boardGrid` before any other
// hook reads it. (Game.reset() also seeds boardSpecials defensively
// in case main.js wires plugins in a different order someday.)
game.registerPlugin(specialsPlugin);
game.registerPlugin(gravityCascadePlugin);
game.registerPlugin(slickPlugin);
game.registerPlugin(whoopsPlugin);
game.registerPlugin(chiselPlugin);
game.registerPlugin(fillPlugin);
game.registerPlugin(flipPlugin);
game.registerPlugin(growthCurse);
game.registerPlugin(hypedCurse);
game.registerPlugin(cruelCurse);
game.registerPlugin(garbagePlugin);
game.registerPlugin(stateSyncPlugin);

// Engine → HUD/sound hooks. The engine fires these from gameplay
// events; we route each to its appropriate side-effect.
game.onLock         = playLockSound;
game.onLineClear    = playClearSound;
// Reuse the menu cycle blip for chisel/fill cursor movement —
// same UI-tick semantics, same sound.
game.onCursorMove   = playCycleSound;
// Confirm sounds for the actual chisel/fill placement — fire in
// chiselSelect / fillSelect right after the board mutates.
game.onChiselHit    = playChiselSound;
game.onFillHit      = playFillSound;
// Flip fires only on a successful mirror — blocked attempts stay silent.
game.onFlip         = playFlipSound;
// onCombo and onChain are deliberately separate hooks — Tetris
// combos (consecutive line clears across pieces) and Puyo chains
// (consecutive matches within one piece's settle) read as the same
// "you got a streak!" feedback to the player but represent
// different game concepts. Each match policy fires only its own
// event, so both wirings sit here permanently and stay dormant in
// the mode they don't apply to.
game.onCombo        = (n)   => hud.notify(`COMBO × ${n}`, 'combo');
game.onChain        = (n)   => hud.notify(`${n}-CHAIN!`, 'combo');
game.onTetris       = (b2b) => hud.notify(b2b ? 'BACK-TO-BACK TETRIS' : 'TETRIS', b2b ? 'b2b' : 'tetris', 1900);
game.onPerfectClear = ()    => hud.notify('PERFECT CLEAR', 'perfect', 2100);
// Power-up choice menu surfacing. Two callbacks feed showNext:
//   onPowerUpChoice — fired when a milestone earns a new pick.
//   onPluginIdle    — fired by Game when "any plugin freezing OR
//                     mid-clear" transitions to "everything settled."
//                     This single hook covers what used to be three
//                     named completion callbacks (onChiselComplete /
//                     onFillComplete / onGravityComplete) — adding a
//                     new modal plugin gets menu-resume for free.
game.onPowerUpChoice = () => powerupMenu.showNext();
game.onPluginIdle    = () => powerupMenu.showNext();
// Curse FX notifications — the row drop / rain spray would feel
// silent without a blip, so we surface a small notification.
game.onJunk = (n) => hud.notify(n > 1 ? `JUNK +${n}` : 'JUNK', 'b2b', 1400);
game.onRain = (n) => hud.notify(n > 1 ? `RAIN +${n}` : 'RAIN', 'b2b', 1300);

// Special-block audio. Two engine callbacks, both routed through
// per-kind maps with a generic fallback:
//
//   onSpecialSpawn(kind)            — fires at the moment a piece
//                                     carrying a special appears.
//                                     Generic fallback: an electric
//                                     "shock jolt" — read as ALERT.
//
//   onSpecialTrigger(kind, source)  — fires right before the special's
//                                     onTrigger runs (line clear or
//                                     chisel today). Generic fallback:
//                                     a bright "shimmer-pop." Gravity
//                                     gets its own suction cue.
//
// Adding sound for a new special is one entry per map plus the synth
// voice in sound.js — no engine or specials-plugin changes needed.
// Specials don't import sound; sound doesn't know about specials;
// main.js wires the two together.
const SPECIAL_SPAWN_SOUNDS = {
  // Each special's spawn cue is themed to evoke what it does:
  //   bomb      — fuse-lit tick + sizzle (something dangerous arrived)
  //   lightning — static crackle + rising tesla-coil charge (electrified)
  //
  // Anything not listed here falls back to playSpecialSpawnSound (the
  // generic electric jolt) — keeps newly-added specials immediately
  // audible while the sound design lands.
  bomb:      playBombSpawnSound,
  lightning: playLightningSpawnSound,
};
const SPECIAL_TRIGGER_SOUNDS = {
  bomb:      playBombSound,
  lightning: playLightningSound,
};
game.onSpecialSpawn = (kind) => {
  (SPECIAL_SPAWN_SOUNDS[kind] || playSpecialSpawnSound)();
};
game.onSpecialTrigger = (kind /*, source */) => {
  (SPECIAL_TRIGGER_SOUNDS[kind] || playSpecialTriggerSound)();
};
// Floating "+N" notification when a special's trigger destroys cells.
// `cells` is the total destroyed across the whole top-level trigger
// (including chained specials), `points` is the score awarded for it
// (already added to game.score by the specials plugin). Suppressed
// for triggers that don't destroy anything (e.g., Gravity itself —
// the cascade scores via the standard line-clear path).
game.onSpecialDestroy = (_kind, cells, points) => {
  hud.notify(`+${points.toLocaleString()}  (${cells} cells)`, 'special', 1500);
};

// End-of-run leaderboard prompt. Game.tick() edge-fires onGameOver
// the frame after `gameOver` flips, regardless of which site set
// the flag (spawn collision, hold-swap collision, fill-restore
// collision, junk/rain curse application, gravity cascade). The
// leaderboard module gates internally on isEnabled() — when no
// Supabase credentials are configured the call is a no-op, so the
// game-over overlay continues to behave exactly as it did before
// the leaderboard existed.
game.onGameOver = () => leaderboard.showSubmit();

// -------- Background music --------
// Three tracks, all crossfading: menu.mp3 on the splash screen,
// theme.mp3 / theme2.mp3 alternating during gameplay. The music
// module owns the volume ramps, the random "first track" pick on
// the menu→game transition, the `ended`-driven alternation, and
// the autoplay-policy retry. main.js just calls playGame() / pause()
// / resume() at the relevant lifecycle moments.
//
// kick() attempts an immediate menu fade-in and registers a one-
// shot fallback for the first user interaction in case the browser
// blocked the initial autoplay attempt. After that, the splash
// just hums until the player commits to a button.
const music = setupMusic({
  menuEl:   menuMusic$,
  themeEls: [themeMusic$, themeMusic2$],
});
music.kick();

// Hide the splash screen the first time the game starts, and on
// every restart afterwards (the menu is only meant for initial
// boot; subsequent R-restarts simply keep it hidden).
function hideMenuScreen() { menuScreen$.classList.add('hidden'); }

// -------- Input lifecycle wiring --------
setupInput(game, {
  onStart: () => {
    hud.hideOverlay();
    powerupMenu.clear();
    hideMenuScreen();
    music.playGame();
    // A fresh start hides any leftover debug surfaces (e.g. user
    // restarted with R while the menu was open).
    debug.hideMenu();
    debug.hideLauncher();
    hideMainMenuBtn();
    // Reset the leaderboard surfaces too — leftover submit/browse
    // overlays from the previous run shouldn't persist into the
    // new one. Resets the "already submitted" guard so the next
    // game over re-opens the submit form cleanly.
    leaderboard.hide();
  },
  onPause: () => {
    hud.showOverlay('PAUSED', 'PRESS P OR ESC TO RESUME');
    music.pause();
    // Pause is the only state where the launcher buttons are
    // reachable — surfacing Debug elsewhere would let the player
    // dump unlimited charges into a live game, and Main Menu only
    // makes sense when there's a run to leave behind.
    debug.showLauncher();
    showMainMenuBtn();
  },
  onResume: () => {
    hud.hideOverlay();
    music.resume();
    debug.hideLauncher();
    debug.hideMenu();
    hideMainMenuBtn();
  },
});

// -------- Main-menu launcher (pause overlay) --------
// Pause-only button that abandons the current run and surfaces the
// splash screen. We don't confirm — pause is already a deliberate
// keypress, the player who hit it knows what they're doing, and
// re-entering a fresh run from the splash is one click away.
//
// Click flow mirrors the inverse of `onStart`:
//   - Stop the per-run audio loop and route music back to the menu
//   - Reset engine state (sets started=false / paused=false /
//     gameOver=false; clears the board so a glance at the splash
//     doesn't show the previous run's wreckage through any future
//     translucent UI)
//   - Hide every in-game UI surface that pause exposed
//   - Re-show the splash screen and re-seed splash keyboard focus
//     so the next arrow press lands on PLAY TETRIS rather than
//     wandering off into nothing
function showMainMenuBtn() { mainMenuBtn$.classList.remove('hidden'); }
function hideMainMenuBtn() { mainMenuBtn$.classList.add('hidden'); }

mainMenuBtn$.addEventListener('mouseenter', () => {
  if (mainMenuBtn$.classList.contains('hidden')) return;
  playMenuHoverSound();
});
// "Return to splash" teardown — extracted so the versus match-end
// menu's EXIT button can reuse the exact same flow without
// duplicating the cleanup steps. Tears down the run BEFORE showing
// the splash so the brief single-frame gap between hide-overlay and
// show-splash doesn't flash a stale board behind the menu screen.
function returnToSplash() {
  hud.hideOverlay();
  powerupMenu.clear();
  debug.hideMenu();
  debug.hideLauncher();
  hideMainMenuBtn();
  leaderboard.hide();
  game.reset();
  menuScreen$.classList.remove('hidden');
  music.playMenu();
  focusSplashButton(0, { silent: true });
}

mainMenuBtn$.addEventListener('click', () => {
  if (mainMenuBtn$.classList.contains('hidden')) return;
  playSelectSound();
  returnToSplash();
});

// Arrow-key navigation across the pause-overlay launcher buttons.
// Lives here (rather than in debug.js) because the button list now
// spans more than just Debug — main.js is the single owner of this
// surface's nav. The list is recomputed lazily on every keypress so
// it always reflects current visibility (e.g. just MAIN MENU + DEBUG
// while the launcher is up; an empty list while either is hidden,
// which the helper treats as a no-op).
//
// Skipped entirely while the debug menu modal is open — that modal
// owns its own nav, and double-binding would race two listeners on
// the same arrow-key event.
wireArrowNav({
  getButtons: () => {
    if (mainMenuBtn$.classList.contains('hidden')) return [];
    if (!debugBtn$.classList.contains('hidden')) {
      return [mainMenuBtn$, debugBtn$];
    }
    return [mainMenuBtn$];
  },
  isOpen: () => {
    if (mainMenuBtn$.classList.contains('hidden')) return false;
    // Defer to the debug menu's own nav while it's open.
    const dbg$ = document.getElementById('debug-menu');
    if (dbg$ && !dbg$.classList.contains('hidden')) return false;
    return true;
  },
  onMove: playCycleSound,
});

// -------- Splash screen mode-picker buttons --------
// Two primary actions on the splash now — PLAY TETRIS and PLAY PUYO
// — wired through one shared starter so the chime / overlay /
// music / menu-hide ceremony lives in exactly one place. Each
// button just supplies its mode bundle. The hover chime gives the
// buttons some life, and the start chime fires alongside the theme
// music swelling in (via music.playGame's crossfade).
function startRunInMode(mode) {
  if (game.started) return;
  // Fire the start chime BEFORE game.start() so AudioContext unlock
  // latency doesn't push it noticeably behind the theme.
  playMenuStartSound();
  game.start(mode);
  hud.hideOverlay();
  powerupMenu.clear();
  hideMenuScreen();
  music.playGame();
}
function pingHover() {
  // Only ping while the splash is actually on screen — once the
  // game has started, the buttons are hidden and any lingering
  // hover events shouldn't trigger sound.
  if (game.started) return;
  playMenuHoverSound();
}

playBtn$.addEventListener('mouseenter', pingHover);
playBtn$.addEventListener('click', () => startRunInMode(TETRIS_MODE));

playPuyoBtn$.addEventListener('mouseenter', pingHover);
playPuyoBtn$.addEventListener('click', () => startRunInMode(PUYO_MODE));

// VS LOCAL — Phase 2 fake-versus over BroadcastChannel. Wires its
// own click handler internally; we just hand it the engine-side
// dependencies (game, hud, music, splash hide), the match-end
// menu so it can show YOU WIN / YOU LOSE with REMATCH/EXIT
// buttons, and returnToSplash so EXIT can tear down the run via
// the same path the in-game MAIN MENU button uses.
const matchEndMenu = setupMatchEndMenu();
setupLocalVersus({
  game,
  hud,
  music,
  hideMenuScreen,
  playMenuStartSound,
  playMenuHoverSound,
  matchEndMenu,
  returnToSplash,
});

// Splash-menu LEADERBOARD button. The button itself is hidden by
// default in index.html and un-hidden by leaderboard.js only when
// Supabase credentials are configured — so a fresh clone of the
// repo with no config never surfaces a button that would just
// say "Leaderboard not configured." Hover/click sounds match the
// secondary-button audio palette established by the debug launcher.
if (leaderboardBtn$) {
  leaderboardBtn$.addEventListener('mouseenter', () => {
    if (leaderboardBtn$.classList.contains('hidden')) return;
    playMenuHoverSound();
  });
  leaderboardBtn$.addEventListener('click', () => {
    if (leaderboardBtn$.classList.contains('hidden')) return;
    leaderboard.showBrowse();
  });
}

// -------- Splash menu keyboard navigation --------
// Arrow keys (and WASD) cycle between the visible splash buttons,
// Enter/Space activates the focused one, and 1/2 jump to Play /
// Leaderboard directly the way the power-up modal's number keys
// work. Everything else is suppressed while the splash is up so
// input.js's "any key starts the game" fallback can't bypass the
// menu choice — the player has to commit to either Play or
// Leaderboard.
//
// Runs in capture phase so we win the race against input.js's
// document-level bubble handler.

// Build the list of focusable splash buttons in display order.
// Recomputed on every keydown because the Leaderboard button's
// .hidden class is toggled by leaderboard.js at boot — and could
// in principle change later if the config gets re-evaluated.
function splashButtons() {
  const list = [playBtn$, playPuyoBtn$];
  if (leaderboardBtn$ && !leaderboardBtn$.classList.contains('hidden')) {
    list.push(leaderboardBtn$);
  }
  return list;
}

// Tracked selection index. Survives blur events (clicking off the
// page) so the next arrow press refocuses the same button.
let splashSelected = 0;

function focusSplashButton(idx, { silent = false } = {}) {
  const buttons = splashButtons();
  if (buttons.length === 0) return;
  // Wrap so left-from-first lands on last and vice-versa, matching
  // the powerup-menu's looping behavior.
  const next = ((idx % buttons.length) + buttons.length) % buttons.length;
  if (!silent && next !== splashSelected) playCycleSound();
  splashSelected = next;
  buttons[splashSelected].focus();
}

// Keep the internal pointer in sync with mouse hover so a hover-
// then-arrow flow continues from the hovered button rather than
// jumping back to wherever the keyboard last was.
playBtn$.addEventListener('mouseenter', () => {
  if (game.started) return;
  splashSelected = 0;
});
playPuyoBtn$.addEventListener('mouseenter', () => {
  if (game.started) return;
  splashSelected = splashButtons().indexOf(playPuyoBtn$);
});
if (leaderboardBtn$) {
  leaderboardBtn$.addEventListener('mouseenter', () => {
    if (game.started) return;
    if (leaderboardBtn$.classList.contains('hidden')) return;
    splashSelected = splashButtons().indexOf(leaderboardBtn$);
  });
}

// Initial focus — the splash is the first thing on screen, so the
// Play button should be ready to take an Enter the moment the page
// finishes loading.
focusSplashButton(0, { silent: true });

document.addEventListener('keydown', (e) => {
  if (game.started) return;
  if (menuScreen$.classList.contains('hidden')) return;
  // Don't intercept while the leaderboard browse overlay is open
  // over the splash — its own Esc handler owns keyboard input
  // until it closes.
  const browse$ = document.getElementById('leaderboard-browse');
  if (browse$ && !browse$.classList.contains('hidden')) return;

  // Pass-through for browser-reserved keys so Tab still moves
  // native focus, F5 reloads, F12 opens devtools, etc. These are
  // the same keys input.js's first-press fallback explicitly skips.
  if (e.key === 'F5' || e.key === 'F12' || e.key === 'Tab') return;

  const buttons = splashButtons();
  if (buttons.length === 0) return;

  // Number-key shortcuts — '1' = first button, '2' = second, etc.
  // Mirrors the powerup-menu's 1/2/3 jump-to-card pattern.
  const numIdx = ['1', '2', '3'].indexOf(e.key);
  if (numIdx !== -1 && numIdx < buttons.length) {
    e.preventDefault();
    e.stopImmediatePropagation();
    focusSplashButton(numIdx);
    buttons[numIdx].click();
    return;
  }

  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowLeft':
    case 'w': case 'W':
    case 'a': case 'A':
      e.preventDefault();
      e.stopImmediatePropagation();
      focusSplashButton(splashSelected - 1);
      return;
    case 'ArrowDown':
    case 'ArrowRight':
    case 's': case 'S':
    case 'd': case 'D':
      e.preventDefault();
      e.stopImmediatePropagation();
      focusSplashButton(splashSelected + 1);
      return;
    case 'Enter':
    case ' ':
      e.preventDefault();
      e.stopImmediatePropagation();
      // Activate via .click() so the existing button click handlers
      // (which already play the right sound and run the right
      // start/leaderboard path) own the actual work.
      buttons[splashSelected].click();
      return;
    default:
      // Suppress every other key so input.js's "any key starts
      // the game" fallback can't fire while the splash is up. The
      // player must commit to a button via Enter/Space (or a number
      // key, or a click).
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
  }
}, { capture: true });

// -------- Chisel / Fill power-ups — pick a cell on the board --------
// Translate a click on the board canvas into a (col, row) and let
// the Game decide whether the cell is a valid target for whichever
// power-up is currently active. We do nothing otherwise so normal
// canvas clicks stay no-ops.
function boardClickToCell(e) {
  const rect = board$.getBoundingClientRect();
  // The canvas internal resolution may differ from its CSS size if
  // the page is zoomed, so scale the click to the canvas coord space.
  const scaleX = board$.width  / rect.width;
  const scaleY = board$.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top)  * scaleY;
  // Read live dimensions from the board — Growth can grow it mid-run,
  // and a future mode swap can change the row count entirely.
  const cols = game.board[0]?.length ?? game.layout.cols;
  const rows = game.board.length;
  const col = Math.floor(px / (board$.width  / cols));
  const row = Math.floor(py / (board$.height / rows));
  return { col, row };
}
board$.addEventListener('click', (e) => {
  // Generic board-click dispatch — chisel/fill (and any future cell
  // picker) listen via interceptInput('boardClick', col, row) and
  // claim the click only when their own active state matches.
  const { col, row } = boardClickToCell(e);
  game._interceptInput('boardClick', col, row);
});

// -------- Frame loop --------
let lastTime = 0;
let prevGameOver = false;

// Per-frame diff caches for canvas redraws. The mini canvases
// (hold + next previews) only need a redraw when the displayed
// piece actually changes; the shake transform only needs a write
// when the offset is non-zero. Repainting these every frame is the
// second-biggest waste in a naive loop after per-cell gradients.
let _lastHold = undefined;
const _lastNext = new Array(nextCanvases.length).fill(undefined);
let _lastTransform = '';
let _shakeWasZero = true;

function frame(now) {
  requestAnimationFrame(frame);
  // Cap dt to avoid catch-up cascades after a tab stall or GC pause.
  // At level 20+ with the Hyped curse, gravityMs drops to 1ms, and
  // an unbounded dt of 200ms would fire 200 softDrops in one tick.
  let dt = lastTime ? now - lastTime : 0;
  if (dt > 50) dt = 50;
  lastTime = now;

  game.tick(dt);

  // Keep the canvas pixel buffer in sync with the live board shape.
  // Setting .width / .height clears the canvas, so guard against
  // doing it every frame — only when the dimensions actually change.
  // Width can shift mid-run (Growth curse adds columns); height only
  // changes on a mode switch (Puyo's 12-row board is shorter than
  // Tetris's 20-row).
  const cols = game.board[0]?.length ?? game.layout.cols;
  const rows = game.board.length;
  const desiredWidth  = cols * BLOCK;
  const desiredHeight = rows * BLOCK;
  if (board$.width  !== desiredWidth)  board$.width  = desiredWidth;
  if (board$.height !== desiredHeight) board$.height = desiredHeight;

  drawBoard(ctx, board$, game);

  // Apply board shake as a CSS transform on the canvas. The wrap's
  // background is the same color as the canvas, so any sliver of
  // wrap revealed by the offset is invisible. Skip the write when
  // the shake is zero (and stayed zero) — that's the common case.
  const shake = game.shakeOffset();
  const shakeIsZero = shake.x === 0 && shake.y === 0;
  if (!(shakeIsZero && _shakeWasZero)) {
    const t = `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px)`;
    if (t !== _lastTransform) {
      board$.style.transform = t;
      _lastTransform = t;
    }
  }
  _shakeWasZero = shakeIsZero;

  // Mini previews only need to repaint when the displayed piece
  // changes (a piece locks, the player holds, or the queue shifts) —
  // EXCEPT when the held piece carries a special, in which case the
  // cycling palette has to animate every frame just like the special
  // does on the board. The cache is bypassed by always-redrawing
  // when held specials are non-null; the type-change check still
  // covers the common no-special case.
  const heldSpecials = game._pluginState.specials?.holdSpecials ?? null;
  const holdHasSpecial = !!(heldSpecials && heldSpecials.length > 0);
  if (_lastHold !== game.hold || holdHasSpecial) {
    drawMini(hold$, holdCtx, game.hold, heldSpecials);
    _lastHold = game.hold;
  }
  for (let i = 0; i < nextCanvases.length; i++) {
    if (_lastNext[i] !== game.queue[i]) {
      drawMini(nextCanvases[i], nextCtxs[i], game.queue[i]);
      _lastNext[i] = game.queue[i];
    }
  }

  // Score / level / lines, blessing & curse tags, hold/next panel
  // visibility, chisel hint banner.
  hud.sync(game);

  // Game-over overlay (edge-triggered so we don't repaint every frame).
  // Suppressed in Puyo versus — local-vs surfaces the match-end
  // menu (REMATCH / EXIT) instead of the standard "PRESS R TO
  // RESTART" hint. Tetris and SP Puyo keep the legacy overlay.
  if (game.gameOver && !prevGameOver) {
    if (game.mode?.id !== 'puyo-versus') {
      hud.showOverlay('GAME OVER', 'PRESS R TO RESTART');
    }
    prevGameOver = true;
  } else if (!game.gameOver && prevGameOver) {
    prevGameOver = false;
  }
}

requestAnimationFrame(frame);
