// ============================================================
// main.js — entry point
// ============================================================
//
// Wires together the game, the renderer, and the input handler.
// Owns the requestAnimationFrame loop and the DOM references.
// ============================================================

import { Game } from './game.js';
import { drawBoard, drawMini } from './render.js';
import { setupInput } from './input.js';
import { playLockSound, playClearSound } from './sound.js';

// -------- DOM lookup --------
const board$        = document.getElementById('board');
const ctx           = board$.getContext('2d');
const hold$         = document.getElementById('hold');
const holdCtx       = hold$.getContext('2d');
const nextCanvases  = [...document.querySelectorAll('.next')];
const nextCtxs      = nextCanvases.map(c => c.getContext('2d'));
const overlay       = document.getElementById('overlay');
const notifs$       = document.getElementById('notifications');
const scoreEl       = document.getElementById('score');
const levelEl       = document.getElementById('level');
const linesEl       = document.getElementById('lines');

// -------- Floating notifications (combo / TETRIS / perfect clear) --------
// CSS owns the animation; JS just appends the element and removes it
// after the animation finishes. Multiple notifications stack vertically.
function notify(text, type, duration = 1700) {
  const el = document.createElement('div');
  el.className = 'notification ' + type;
  el.textContent = text;
  notifs$.appendChild(el);
  setTimeout(() => el.remove(), duration);
}

// -------- Overlay helpers --------
function showOverlay(text, sub = '') {
  overlay.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
  overlay.classList.remove('hidden');
}
function hideOverlay() {
  overlay.classList.add('hidden');
}

// -------- Boot --------
const game = new Game();
game.onLock         = playLockSound;
game.onLineClear    = playClearSound;
game.onCombo        = (n)   => notify(`COMBO × ${n}`, 'combo');
game.onTetris       = (b2b) => notify(b2b ? 'BACK-TO-BACK TETRIS' : 'TETRIS', b2b ? 'b2b' : 'tetris', 1900);
game.onPerfectClear = ()    => notify('PERFECT CLEAR', 'perfect', 2100);

setupInput(game, {
  onStart:  hideOverlay,
  onPause:  () => showOverlay('PAUSED', 'PRESS P TO RESUME'),
  onResume: hideOverlay,
});

let lastTime = 0;
let prevGameOver = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - (lastTime || now);
  lastTime = now;

  game.tick(dt);

  // Render
  drawBoard(ctx, board$, game);
  // Apply board shake as a CSS transform on the canvas. The wrap's
  // background is the same color as the canvas, so any sliver of
  // wrap revealed by the offset is invisible.
  const shake = game.shakeOffset();
  board$.style.transform = `translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px)`;
  drawMini(hold$, holdCtx, game.hold);
  for (let i = 0; i < nextCanvases.length; i++) {
    drawMini(nextCanvases[i], nextCtxs[i], game.queue[i]);
  }
  scoreEl.textContent = game.score.toLocaleString();
  levelEl.textContent = game.level;
  linesEl.textContent = game.lines;

  // Game-over overlay (edge-triggered so we don't repaint every frame)
  if (game.gameOver && !prevGameOver) {
    showOverlay('GAME OVER', 'PRESS R TO RESTART');
    prevGameOver = true;
  } else if (!game.gameOver && prevGameOver) {
    prevGameOver = false;
  }
}

requestAnimationFrame(frame);
