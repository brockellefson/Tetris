// ============================================================
// Hotkey-draft card strip (Puyo modes)
// ============================================================
//
// Sister to setupPowerupMenu, but for fast-paced modes (Puyo SP
// and Puyo Versus). Instead of a modal that pauses the game,
// three cards appear in a HUD strip below the score panel. The
// player presses 1, 2, or 3 to pick. No pause — gravity, garbage,
// the whole engine keeps running.
//
// Both this module and the modal share the same callback (game.
// onPowerUpChoice / game.onPluginIdle). Each gates internally on
// game.mode.cards.menuStyle, so the wrong UI never shows. The
// menu callbacks are multiplexed in main.js — both .showNext()s
// fire on every event, only one ever opens.
//
// Picks fire the card's apply() and decrement game.pendingChoices.
// If more picks are pending after the first lands, the strip
// refills automatically (showNext() is called from the same
// onPluginIdle that the modal uses). Empty pool → strip stays
// hidden.
//
// Card design assumption: a card object has at minimum
//   { id, name, description, apply(game), available(game) }.
// Same shape as the existing Tetris cards so future shared cards
// work in either UI without adaptation.

import {
  playCycleSound,
  playSelectSound,
  playMenuOpenSound,
} from '../sound.js';

export function setupHotkeyDraft(game) {
  const root$  = document.getElementById('hotkey-draft');
  const cards$ = document.getElementById('hotkey-draft-cards');
  if (!root$ || !cards$) {
    return { showNext: () => {}, clear: () => {}, isOpen: () => false };
  }

  // The three currently-shown cards. Held so the keyboard handler
  // can map "1" → cards[0], "2" → cards[1], "3" → cards[2]. Reset
  // on every showNext() open AND on clear().
  let activeCards = [];

  function isOpen() {
    return !root$.classList.contains('hidden');
  }

  function show() {
    root$.classList.remove('hidden');
  }

  function hide() {
    root$.classList.add('hidden');
    activeCards = [];
    cards$.innerHTML = '';
  }

  // Build a single card row. Returns the element so the caller can
  // attach to the container in one go. The number badge and name /
  // description come straight off the card object.
  function buildCardEl(card, index) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'hotkey-draft-card';
    el.dataset.index = String(index);
    // Tabindex 0 so keyboard nav can focus the card too — even
    // though hotkeys are the primary input, focus + Enter is the
    // accessible fallback.
    el.tabIndex = 0;
    el.innerHTML = `
      <span class="hotkey-draft-key">${index + 1}</span>
      <span class="hotkey-draft-body">
        <span class="hotkey-draft-name"></span>
        <span class="hotkey-draft-desc"></span>
      </span>
    `;
    el.querySelector('.hotkey-draft-name').textContent = card.name ?? '';
    el.querySelector('.hotkey-draft-desc').textContent = card.description ?? '';
    el.addEventListener('click', () => pick(index));
    return el;
  }

  // Pick the i-th card. Plays a flash animation, applies the
  // card, decrements pendingChoices, and either refills (more
  // pending) or hides the strip (none left).
  function pick(i) {
    if (!isOpen()) return;
    const card = activeCards[i];
    if (!card) return;

    playSelectSound();

    // Visual flash on the picked card before tearing down.
    const cardEls = cards$.querySelectorAll('.hotkey-draft-card');
    cardEls[i]?.classList.add('flash');

    // Apply the card. The card's own apply() owns whatever side
    // effects it triggers (set unlock flags, mutate state, etc.).
    game.applyPowerUp(card);

    // Tear down after a beat so the flash has a moment to play.
    // 180ms matches the menu-select cue's perceived length.
    setTimeout(() => {
      hide();
      // Refill if more picks are pending. showNext() will re-
      // open with a fresh draw from the pool.
      if (game.pendingChoices > 0) showNext();
    }, 180);
  }

  // Public entry point — called from main.js's onPowerUpChoice
  // and onPluginIdle multiplexer. Decides whether to open and
  // populates the strip with three random eligible cards.
  function showNext() {
    if (game.gameOver) return;
    if (game._isBusy()) return;
    const cards = game.mode?.cards;
    if (!cards) return;
    // Only open when the active mode opted into hotkey draft.
    // Tetris's modal handler runs on the same callback and
    // checks the same field for the inverse.
    if (cards.menuStyle !== 'hotkey') return;
    if (game.pendingChoices <= 0) return;
    if (isOpen()) return;

    const picks = cards.pickPowerups?.(game, 3) ?? [];
    if (picks.length === 0) {
      // Empty pool — drain so the engine doesn't sit waiting
      // forever for a pick that can't happen.
      game.pendingChoices = 0;
      return;
    }

    activeCards = picks;
    cards$.innerHTML = '';
    for (let i = 0; i < picks.length; i++) {
      cards$.appendChild(buildCardEl(picks[i], i));
    }
    show();
    playMenuOpenSound();
  }

  // Force-close the strip. Called on game.start (between matches)
  // and on splash returns so a stale draft doesn't survive into
  // a fresh run.
  function clear() {
    hide();
  }

  // Keyboard input — 1 / 2 / 3 pick by index. Capture phase so
  // the gameplay handler in input.js doesn't race us for the
  // number-row keys (which are otherwise unused, but defensive
  // against future bindings).
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    if (e.repeat) return;
    let idx = -1;
    if      (e.key === '1') idx = 0;
    else if (e.key === '2') idx = 1;
    else if (e.key === '3') idx = 2;
    else return;
    if (idx >= activeCards.length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    playCycleSound();
    pick(idx);
  }, true);

  return { showNext, clear, isOpen };
}
