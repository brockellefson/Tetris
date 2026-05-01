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
import { pickChoices } from './powerups/index.js';
import { COLS, ROWS } from './constants.js';

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
const holdPanel$    = document.getElementById('hold-panel');
const nextPanel$    = document.getElementById('next-panel');
const powerupMenu$  = document.getElementById('powerup-menu');
const powerupCards$ = document.getElementById('powerup-cards');

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

// -------- Power-up choice menu --------
// When the menu opens, the game is already frozen (Game.tick early-returns
// while pendingChoices > 0). We attach a temporary keyboard handler so 1/2/3
// pick a card; clicking a card also works. After a choice is applied, we
// re-show the menu if more choices are queued.
function showPowerUpMenu() {
  const choices = pickChoices(game, 3);
  // Defensive: if for some reason no power-ups are eligible, just consume
  // the pending choice and continue. (Happens once everything is unlocked.)
  if (choices.length === 0) {
    game.pendingChoices = 0;
    return;
  }

  powerupCards$.innerHTML = '';
  choices.forEach((p, i) => {
    const card = document.createElement('button');
    card.className = 'powerup-card';
    card.innerHTML = `
      <div class="powerup-card-name">${p.name}</div>
      <div class="powerup-card-desc">${p.description}</div>
      <div class="powerup-card-key"><kbd>${i + 1}</kbd></div>
    `;
    card.addEventListener('click', () => choose(p));
    powerupCards$.appendChild(card);
  });

  function onKey(e) {
    const idx = ['1', '2', '3'].indexOf(e.key);
    if (idx !== -1 && idx < choices.length) {
      e.preventDefault();
      e.stopPropagation();
      choose(choices[idx]);
    }
  }
  document.addEventListener('keydown', onKey, { capture: true });

  function choose(powerup) {
    document.removeEventListener('keydown', onKey, { capture: true });
    powerupMenu$.classList.add('hidden');
    game.applyPowerUp(powerup);
    // Multiple milestones earned at once → present the next menu, BUT
    // only once the chisel interaction (if any) is finished. Otherwise
    // the modal would block the click that the chisel needs.
    if (game.pendingChoices > 0 && !game.chisel.active && !game.chisel.target) {
      requestAnimationFrame(showPowerUpMenu);
    }
  }

  powerupMenu$.classList.remove('hidden');
}

// Apply lock-state visibility to gated UI panels. Called every frame —
// it's just a few style writes when the value actually changes.
function syncUnlocksUI() {
  holdPanel$.style.display = game.unlocks.hold ? '' : 'none';
  nextPanel$.style.display = game.unlocks.nextCount > 0 ? '' : 'none';
  for (let i = 0; i < nextCanvases.length; i++) {
    nextCanvases[i].style.display = i < game.unlocks.nextCount ? '' : 'none';
  }
}

// -------- Chisel hint banner --------
// Shown over the board while chisel.active is true. Created lazily
// so we don't have to clutter index.html with another element.
const boardWrap$ = document.getElementById('board-wrap');
const chiselHint$ = document.createElement('div');
chiselHint$.id = 'chisel-hint';
chiselHint$.innerHTML = 'CLICK A BLOCK TO CHISEL';
chiselHint$.classList.add('hidden');
boardWrap$.appendChild(chiselHint$);

function syncChiselUI() {
  const active = game.chisel.active;
  chiselHint$.classList.toggle('hidden', !active);
  boardWrap$.classList.toggle('chiseling', active);
}

// -------- Boot --------
const game = new Game();
game.onLock         = playLockSound;
game.onLineClear    = playClearSound;
game.onCombo        = (n)   => notify(`COMBO × ${n}`, 'combo');
game.onTetris       = (b2b) => notify(b2b ? 'BACK-TO-BACK TETRIS' : 'TETRIS', b2b ? 'b2b' : 'tetris', 1900);
game.onPerfectClear = ()    => notify('PERFECT CLEAR', 'perfect', 2100);
game.onPowerUpChoice = ()   => showPowerUpMenu();
// When the chisel animation finishes, surface any deferred power-up menu.
game.onChiselComplete = () => {
  if (game.pendingChoices > 0) requestAnimationFrame(showPowerUpMenu);
};

setupInput(game, {
  onStart:  hideOverlay,
  onPause:  () => showOverlay('PAUSED', 'PRESS P TO RESUME'),
  onResume: hideOverlay,
});

// -------- Chisel power-up — pick a block to remove --------
// Translate a click on the board canvas into a (col, row) and let
// the Game decide whether the cell is a valid target. We do nothing
// when chisel.active is false so normal canvas clicks (none today,
// but defensive) stay no-ops.
function boardClickToCell(e) {
  const rect = board$.getBoundingClientRect();
  // The canvas internal resolution may differ from its CSS size if
  // the page is zoomed, so scale the click to the canvas coord space.
  const scaleX = board$.width  / rect.width;
  const scaleY = board$.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top)  * scaleY;
  const col = Math.floor(px / (board$.width  / COLS));
  const row = Math.floor(py / (board$.height / ROWS));
  return { col, row };
}
board$.addEventListener('click', (e) => {
  if (!game.chisel.active) return;
  const { col, row } = boardClickToCell(e);
  game.chiselSelect(col, row);
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
  syncUnlocksUI();
  syncChiselUI();

  // Game-over overlay (edge-triggered so we don't repaint every frame)
  if (game.gameOver && !prevGameOver) {
    showOverlay('GAME OVER', 'PRESS R TO RESTART');
    prevGameOver = true;
  } else if (!game.gameOver && prevGameOver) {
    prevGameOver = false;
  }
}

requestAnimationFrame(frame);
