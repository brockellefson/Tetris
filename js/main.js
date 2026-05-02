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
import { drawBoard, drawMini } from './render.js';
import { setupInput } from './input.js';
import {
  playLockSound, playClearSound, playCycleSound, playMenuHoverSound,
  playMenuStartSound, playChiselSound, playFillSound, playFlipSound,
  playSpecialTriggerSound, playGravitySuckSound, playSpecialSpawnSound,
} from './sound.js';
import { COLS, ROWS, BLOCK } from './constants.js';
import { setupHUD } from './hud.js';
import { setupPowerupMenu } from './menus/powerup.js';
import { setupDebug } from './debug.js';
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
const themeMusic$  = document.getElementById('theme-music');

// -------- Boot --------
const game = new Game();
const hud = setupHUD();
const powerupMenu = setupPowerupMenu(game);
const debug = setupDebug(game);

// Register lifecycle plugins. Order matters in one place: the
// specials plugin must register BEFORE the gravity cascade so its
// `reset` hook initializes `game.boardSpecials` before any other
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
game.onCombo        = (n)   => hud.notify(`COMBO × ${n}`, 'combo');
game.onTetris       = (b2b) => hud.notify(b2b ? 'BACK-TO-BACK TETRIS' : 'TETRIS', b2b ? 'b2b' : 'tetris', 1900);
game.onPerfectClear = ()    => hud.notify('PERFECT CLEAR', 'perfect', 2100);
// Power-up choice menu surfacing. Chisel / Fill / Gravity defer the
// menu until their animation completes, so each fires its own
// "okay, queue is clear" hook and we re-check via showNext().
game.onPowerUpChoice    = () => powerupMenu.showNext();
game.onChiselComplete   = () => powerupMenu.showNext();
game.onFillComplete     = () => powerupMenu.showNext();
game.onGravityComplete  = () => powerupMenu.showNext();
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
  // Gravity uses the generic shock for spawn — its identity is in the
  // suction trigger sound, not the alert. Add per-kind overrides here
  // when a future special wants a distinct spawn cue.
};
const SPECIAL_TRIGGER_SOUNDS = {
  gravity: playGravitySuckSound,
};
game.onSpecialSpawn = (kind) => {
  (SPECIAL_SPAWN_SOUNDS[kind] || playSpecialSpawnSound)();
};
game.onSpecialTrigger = (kind /*, source */) => {
  (SPECIAL_TRIGGER_SOUNDS[kind] || playSpecialTriggerSound)();
};

// -------- Background theme music --------
// Plain <audio loop> handles the looping for us — we just drive
// play / pause from the lifecycle callbacks. Browsers require a
// user gesture before audio can start, so the first call happens
// in onStart (triggered by the player's first key press).
themeMusic$.volume = 0.5; // sit under SFX without drowning them
function playTheme() {
  // .play() returns a promise that rejects if the browser still
  // refuses (e.g. the gesture didn't propagate). Swallow the
  // rejection so it doesn't show up as an unhandled error.
  const p = themeMusic$.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}
function pauseTheme() { themeMusic$.pause(); }

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
    playTheme();
    // A fresh start hides any leftover debug surfaces (e.g. user
    // restarted with R while the menu was open).
    debug.hideMenu();
    debug.hideLauncher();
  },
  onPause: () => {
    hud.showOverlay('PAUSED', 'PRESS P OR ESC TO RESUME');
    pauseTheme();
    // Pause is the only state where the Debug button is reachable —
    // surfacing it elsewhere would let the player dump unlimited
    // charges into a live game.
    debug.showLauncher();
  },
  onResume: () => {
    hud.hideOverlay();
    playTheme();
    debug.hideLauncher();
    debug.hideMenu();
  },
});

// -------- Splash screen Play button --------
// Same start path as the first keypress in input.js. Wrapped in a
// guard so a stray double-click after the game has already begun
// is a harmless no-op. The hover chime gives the button some life,
// and the start chime fires alongside the theme music swelling in.
playBtn$.addEventListener('mouseenter', () => {
  // Only ping while the splash is actually on screen — once the
  // game has started, the button is hidden and any lingering hover
  // events shouldn't trigger sound.
  if (game.started) return;
  playMenuHoverSound();
});
playBtn$.addEventListener('click', () => {
  if (game.started) return;
  // Fire the start chime BEFORE game.start() so AudioContext unlock
  // latency doesn't push it noticeably behind the theme.
  playMenuStartSound();
  game.start();
  hud.hideOverlay();
  powerupMenu.clear();
  hideMenuScreen();
  playTheme();
});

// Keyboard parity with the click path — pressing Enter or Space
// while the splash is up should also play the start chime, then
// fall through to input.js's first-keypress handler which calls
// game.start(). Capture phase so we run before input.js (which is
// on document, bubble phase) — that way the chime is already
// scheduled even though both handlers act on the same key event.
document.addEventListener('keydown', (e) => {
  if (game.started) return;
  if (menuScreen$.classList.contains('hidden')) return;
  if (e.key === 'Enter' || e.key === ' ') {
    playMenuStartSound();
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
  // Read live width — Growth can grow the board mid-run.
  const cols = game.board[0]?.length ?? COLS;
  const col = Math.floor(px / (board$.width  / cols));
  const row = Math.floor(py / (board$.height / ROWS));
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

  // Keep the canvas pixel buffer in sync with the (possibly grown)
  // board width. Setting .width clears the canvas, so guard against
  // doing it every frame — only when the column count changes.
  const cols = game.board[0]?.length ?? COLS;
  const desiredWidth = cols * BLOCK;
  if (board$.width !== desiredWidth) board$.width = desiredWidth;

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
  // changes (a piece locks, the player holds, or the queue shifts).
  if (_lastHold !== game.hold) {
    drawMini(hold$, holdCtx, game.hold);
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
  if (game.gameOver && !prevGameOver) {
    hud.showOverlay('GAME OVER', 'PRESS R TO RESTART');
    prevGameOver = true;
  } else if (!game.gameOver && prevGameOver) {
    prevGameOver = false;
  }
}

requestAnimationFrame(frame);
