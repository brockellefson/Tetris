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
import { pickCurseChoices } from './curses/index.js';
import { COLS, ROWS, BLOCK } from './constants.js';

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
const curseSection$ = document.getElementById('curse-section');
const curseList$    = document.getElementById('curse-list');

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

// -------- Choice menu (power-up + bundled curse) --------
// Each card pairs a power-up with a random curse. Picking the card
// applies both — there is no separate curse menu anymore. The Game
// freezes while pendingChoices > 0 (see Game.tick). After a card is
// picked the menu hides and we ask the dispatcher whether another
// power-up is queued (a tetris on first clear awards 2 picks).
//
// Chisel / Polish interrupts this flow: while chisel.active or
// chisel.target is set we never open the modal, because the modal
// would block the click the power-up is waiting for. The dispatcher
// gets called again via game.onChiselComplete / onPolishComplete
// once the relevant animation finishes.

function buildChoiceMenu({ choices, onPick }) {
  powerupCards$.innerHTML = '';
  let selected = 0;
  const cardEls = [];
  choices.forEach((pair, i) => {
    const { powerup, curse } = pair;
    const card = document.createElement('button');
    card.className = 'powerup-card';
    card.innerHTML = `
      <div class="powerup-card-buff">
        <div class="powerup-card-name">${powerup.name}</div>
        <div class="powerup-card-desc">${powerup.description}</div>
      </div>
      <div class="powerup-card-curse">
        <div class="powerup-card-curse-name">${curse.name}</div>
        <div class="powerup-card-curse-desc">${curse.description}</div>
      </div>
      <div class="powerup-card-key"><kbd>${i + 1}</kbd></div>
    `;
    card.addEventListener('click', () => pick(pair));
    card.addEventListener('mouseenter', () => setSelected(i));
    powerupCards$.appendChild(card);
    cardEls.push(card);
  });

  function setSelected(i) {
    selected = ((i % choices.length) + choices.length) % choices.length;
    cardEls.forEach((el, idx) => {
      el.classList.toggle('selected', idx === selected);
    });
  }

  // Highlight the first card by default so the player has a visible cursor.
  setSelected(0);

  function onKey(e) {
    // We use stopImmediatePropagation so the keydown does NOT reach the
    // gameplay handler in input.js. That matters for Enter/Space when
    // picking the Chisel power-up: without this, the same Enter that
    // confirms the menu would immediately fall through to chiselConfirm
    // in input.js (both listeners are on `document`) and chisel the
    // seeded cursor block before the player has a chance to navigate.
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

    // Number-key shortcuts still work as a direct pick.
    const numIdx = ['1', '2', '3'].indexOf(e.key);
    if (numIdx !== -1 && numIdx < choices.length) {
      stop();
      pick(choices[numIdx]);
      return;
    }

    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'a': case 'A':
        stop();
        setSelected(selected - 1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'd': case 'D':
        stop();
        setSelected(selected + 1);
        break;
      case 'Enter':
      case ' ':
        stop();
        pick(choices[selected]);
        break;
    }
  }
  document.addEventListener('keydown', onKey, { capture: true });

  function pick(pair) {
    document.removeEventListener('keydown', onKey, { capture: true });
    powerupMenu$.classList.add('hidden');
    // Defer the actual apply by one frame. Belt-and-suspenders alongside
    // stopImmediatePropagation: even if a browser quirk lets the keystroke
    // bypass that, by the time chisel/polish.active flips on, the Enter
    // event that picked the card has long since finished propagating.
    // Otherwise input.js's chisel/polish handler can see the same Enter
    // and immediately confirm a placement before the player can navigate.
    requestAnimationFrame(() => {
      onPick(pair);
      showNextChoice();
    });
  }

  powerupMenu$.classList.remove('hidden');
}

function showPowerUpMenu() {
  // showNextChoice may schedule us more than once per frame. Bail if
  // the menu is already showing — the first scheduled call wins.
  if (!powerupMenu$.classList.contains('hidden')) return;
  const powerups = pickChoices(game, 3);
  // Defensive: if no power-ups are eligible (player already unlocked
  // all), drop the pending count and resume play. Curses don't show
  // up on their own anymore — they only ride along with power-ups.
  if (powerups.length === 0) {
    game.pendingChoices = 0;
    return;
  }
  // Pair each power-up with a random distinct curse. pickCurseChoices
  // already shuffles, so zipping the two arrays yields a fresh random
  // (powerup, curse) pairing every time the menu opens.
  const curses = pickCurseChoices(game, powerups.length);
  const choices = powerups.map((powerup, i) => ({
    powerup,
    // Fall back gracefully if somehow there are fewer eligible curses
    // than power-ups (curses are all always-available today, so this
    // is purely defensive). A null curse means picking the card just
    // applies the power-up cleanly with no debuff.
    curse: curses[i % Math.max(curses.length, 1)] ?? null,
  }));
  buildChoiceMenu({
    choices,
    onPick: ({ powerup, curse }) => {
      game.applyPowerUp(powerup);
      if (curse) game.applyCurse(curse);
    },
  });
}

// Decide whether to surface the menu next (or not). Called any time
// pendingChoices changes: after picking a card, after the chisel /
// polish animation finishes, and from the Game-side onPowerUpChoice
// hook.
function showNextChoice() {
  // Don't pop a modal post game-over (junk-curse can trigger game over
  // mid-completeClear, *before* the choice hook fires).
  if (game.gameOver) return;
  // Don't pop a modal while chisel or polish is mid-interaction —
  // the modal would steal the click/keyboard focus the power-up needs.
  if (game.chisel.active || game.chisel.target) return;
  if (game.polish.active || game.polish.target) return;
  // Don't open a second menu if one is already up.
  if (!powerupMenu$.classList.contains('hidden')) return;

  if (game.pendingChoices > 0) {
    requestAnimationFrame(showPowerUpMenu);
  }
}

// Restart should always come back to a clean menu state.
function clearMenus() {
  powerupMenu$.classList.add('hidden');
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

// -------- Chisel / Polish hint banner --------
// Shared banner — chisel and polish reuse the same overlay element
// since only one is ever active at a time. The text & styling tweak
// based on which power-up is currently asking for a pick.
const boardWrap$ = document.getElementById('board-wrap');
const chiselHint$ = document.createElement('div');
chiselHint$.id = 'chisel-hint';
chiselHint$.classList.add('hidden');
boardWrap$.appendChild(chiselHint$);

function syncChiselUI() {
  const chiselActive = game.chisel.active;
  const polishActive = game.polish.active;
  const active = chiselActive || polishActive;
  if (chiselActive) {
    chiselHint$.innerHTML = 'CLICK OR USE ARROW KEYS + ENTER TO CHISEL';
  } else if (polishActive) {
    chiselHint$.innerHTML = 'CLICK OR USE ARROW KEYS + ENTER TO POLISH';
  }
  chiselHint$.classList.toggle('hidden', !active);
  boardWrap$.classList.toggle('chiseling', active);
}

// -------- Active-curse indicator --------
// Renders a tag for each curse currently affecting gameplay, under
// the score panel. Cheap enough to recompute every frame.
function syncCursesUI() {
  const tags = [];
  if (game.curses.junk)  tags.push('JUNK');
  if (game.curses.hyped > 0) {
    tags.push(game.curses.hyped > 1 ? `HYPED ×${game.curses.hyped}` : 'HYPED');
  }
  if (game.level <= game.curses.flexibleUntilLevel) tags.push('FLEXIBLE');
  if (game.curses.rain)  tags.push('RAIN');

  curseSection$.classList.toggle('hidden', tags.length === 0);
  // Diff-friendly write — only touch the DOM if the set actually changed.
  const next = tags.join(',');
  if (curseList$.dataset.tags !== next) {
    curseList$.dataset.tags = next;
    curseList$.innerHTML = tags.map(t => `<span class="curse-tag">${t}</span>`).join('');
  }
}

// -------- Boot --------
const game = new Game();
game.onLock         = playLockSound;
game.onLineClear    = playClearSound;
game.onCombo        = (n)   => notify(`COMBO × ${n}`, 'combo');
game.onTetris       = (b2b) => notify(b2b ? 'BACK-TO-BACK TETRIS' : 'TETRIS', b2b ? 'b2b' : 'tetris', 1900);
game.onPerfectClear = ()    => notify('PERFECT CLEAR', 'perfect', 2100);
game.onPowerUpChoice  = ()  => showNextChoice();
// When the chisel animation finishes, dispatch any deferred menu.
game.onChiselComplete = ()  => showNextChoice();
// Polish runs through the same menu-deferral flow. It fires either at
// the end of the materialize animation (no line cleared) OR after a
// polish-triggered line-clear animation completes.
game.onPolishComplete = ()  => showNextChoice();
// Junk-curse FX: small notification so the row drop doesn't feel silent.
game.onJunk           = (n) => notify(n > 1 ? `JUNK +${n}` : 'JUNK', 'b2b', 1400);
game.onRain           = (n) => notify(n > 1 ? `RAIN +${n}` : 'RAIN', 'b2b', 1300);

setupInput(game, {
  onStart:  () => { hideOverlay(); clearMenus(); },
  onPause:  () => showOverlay('PAUSED', 'PRESS P TO RESUME'),
  onResume: hideOverlay,
});

// -------- Chisel / Polish power-ups — pick a cell on the board --------
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
  // Read live width — Growth Spurt power-up grows the board mid-run.
  const cols = game.board[0]?.length ?? COLS;
  const col = Math.floor(px / (board$.width  / cols));
  const row = Math.floor(py / (board$.height / ROWS));
  return { col, row };
}
board$.addEventListener('click', (e) => {
  if (game.chisel.active) {
    const { col, row } = boardClickToCell(e);
    game.chiselSelect(col, row);
    return;
  }
  if (game.polish.active) {
    const { col, row } = boardClickToCell(e);
    game.polishSelect(col, row);
    return;
  }
});

let lastTime = 0;
let prevGameOver = false;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - (lastTime || now);
  lastTime = now;

  game.tick(dt);

  // Keep the canvas pixel buffer in sync with the (possibly grown)
  // board width. Setting .width clears the canvas, so guard against
  // doing it every frame — only when the column count actually changes.
  const cols = game.board[0]?.length ?? COLS;
  const desiredWidth = cols * BLOCK;
  if (board$.width !== desiredWidth) board$.width = desiredWidth;

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
  syncCursesUI();

  // Game-over overlay (edge-triggered so we don't repaint every frame)
  if (game.gameOver && !prevGameOver) {
    showOverlay('GAME OVER', 'PRESS R TO RESTART');
    prevGameOver = true;
  } else if (!game.gameOver && prevGameOver) {
    prevGameOver = false;
  }
}

requestAnimationFrame(frame);
