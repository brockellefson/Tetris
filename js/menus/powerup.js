// ============================================================
// menus/powerup.js — power-up + bundled-curse choice modal
// ============================================================
//
// Owns the modal that pops every time `game.pendingChoices > 0`
// (every 5 lines, plus a bonus on the very first line clear).
// Each card pairs a power-up with a random curse so picking is
// always a buy-and-pay decision.
//
// Game state interaction (read/write):
//   • Reads game.pendingChoices, game.gameOver, game.chisel/fill/gravity
//     to decide whether the menu can open right now.
//   • Calls game.applyPowerUp / game.applyCurse on the player's pick.
//   • Doesn't touch any other game state directly.
//
// Lifecycle:
//   const menu = setupPowerupMenu(game);
//   game.onPowerUpChoice = () => menu.showNext();   // milestone earned
//   game.onPluginIdle    = () => menu.showNext();   // freezing modal ended
//   menu.clear();   // call on restart so a new run starts clean
//
// The menu is fully keyboard-navigable (arrows / WASD / 1-2-3 /
// Enter / Space). Hover sounds, cycle blips between cards, and
// the open / select chimes follow the audio convention documented
// in CLAUDE.md → "UI conventions".
// ============================================================

import { pickChoices } from '../powerups/index.js';
import { pickCurseChoices } from '../curses/index.js';
import { playCycleSound, playSelectSound, playMenuOpenSound } from '../sound.js';

// Power-up / curse pairings that exactly cancel each other when
// picked together. We swap the offending curse into another slot
// before rendering so the player can never make a "free" trade
// (eat the debuff for a buff the debuff just undid).
//
//   Tired + Hyped — Tired removes a Hyped stack, Hyped adds one.
//   Mercy + Cruel — Mercy unshifts an I-piece, Cruel filters them
//                   all back out before the player ever sees one.
//
// Each listed power-up is unique in the pool, so swapping the
// curse can never accidentally land it on a second copy of the
// conflicting power-up.
const CANCELING_PAIRS = [
  { powerup: 'tired', curse: 'curse-hyped' },
  { powerup: 'mercy', curse: 'curse-cruel' },
];

export function setupPowerupMenu(game) {
  const powerupMenu$  = document.getElementById('powerup-menu');
  const powerupCards$ = document.getElementById('powerup-cards');

  // Build the cards & wire keyboard navigation for one open of the
  // modal. Caller passes choices (already paired) and the onPick
  // callback; this function handles all the DOM and audio.
  function buildChoiceMenu({ choices, onPick }) {
    powerupCards$.innerHTML = '';
    let selected = 0;
    const cardEls = [];

    choices.forEach((pair, i) => {
      const { powerup, curse } = pair;
      const card = document.createElement('button');
      card.className = 'powerup-card';
      // No-curse blessings (e.g. Dispell) render with the buff half
      // only. Skip the curse template entirely — it interpolates
      // `${curse.name}` and would crash on null otherwise.
      const cursePart = curse
        ? `
        <div class="powerup-card-curse">
          <div class="powerup-card-curse-name">${curse.name}</div>
          <div class="powerup-card-curse-desc">${curse.description}</div>
        </div>`
        : '';
      card.innerHTML = `
        <div class="powerup-card-buff">
          <div class="powerup-card-name">${powerup.name}</div>
          <div class="powerup-card-desc">${powerup.description}</div>
        </div>${cursePart}
        <div class="powerup-card-key"><kbd>${i + 1}</kbd></div>
      `;
      card.addEventListener('click', () => pick(pair));
      card.addEventListener('mouseenter', () => setSelected(i));
      powerupCards$.appendChild(card);
      cardEls.push(card);
    });

    function setSelected(i, { silent = false } = {}) {
      const next = ((i % choices.length) + choices.length) % choices.length;
      // Only blip when the highlight actually moves. Suppresses the
      // initial setSelected(0) call and mouseenter events that
      // re-target the already-selected card.
      if (!silent && next !== selected) playCycleSound();
      selected = next;
      cardEls.forEach((el, idx) => {
        el.classList.toggle('selected', idx === selected);
      });
      // Move native focus to the selected card so the unified
      // :focus-visible white outline picks it up alongside the
      // existing .selected cyan glow. Native focus also makes
      // Enter/Space activation work as a fallback if anything
      // ever bypasses the menu's own keydown handler.
      cardEls[selected].focus();
    }
    setSelected(0, { silent: true }); // visible cursor on first card

    function onKey(e) {
      // stopImmediatePropagation prevents the keydown reaching the
      // gameplay handler in input.js. That matters for Enter/Space
      // when picking Chisel: without this, the same Enter that
      // confirms the menu would fall through to chiselConfirm and
      // chisel the seeded cursor block before the player can
      // navigate.
      const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };

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
          stop(); setSelected(selected - 1); break;
        case 'ArrowRight':
        case 'ArrowDown':
        case 'd': case 'D':
          stop(); setSelected(selected + 1); break;
        case 'Enter':
        case ' ':
          stop(); pick(choices[selected]); break;
      }
    }
    document.addEventListener('keydown', onKey, { capture: true });

    function pick(pair) {
      document.removeEventListener('keydown', onKey, { capture: true });
      playSelectSound();
      powerupMenu$.classList.add('hidden');
      // Defer the apply by one frame. Belt-and-suspenders alongside
      // stopImmediatePropagation: by the time chisel/fill.active flips
      // on, the Enter that picked the card has long since finished
      // propagating, so input.js's chisel/fill handler can't see the
      // same Enter and immediately confirm a placement.
      requestAnimationFrame(() => {
        onPick(pair);
        showNext();
      });
    }

    powerupMenu$.classList.remove('hidden');
    playMenuOpenSound(); // distinct from cycle/select cues
  }

  // Build the (powerup, curse) pairing for one menu open and hand
  // off to buildChoiceMenu. Bails early if no power-ups are eligible
  // (player has unlocked everything possible) — drops the pending
  // count so the freeze ends and play resumes.
  function showPowerUpMenu() {
    if (!powerupMenu$.classList.contains('hidden')) return;
    // Re-check the freeze gates at open time. showNext() rAF-queues
    // this function, and by the time the rAF fires a freezing plugin
    // (Gravity cascade triggered by a special on the just-cleared
    // row, etc.) may have flipped on. Defer back into showNext so
    // the standard "wait for everything to settle → onPluginIdle →
    // showNext" loop reopens us when the world has settled.
    if (game.gameOver) return;
    const chiselS = game._pluginState.chisel;
    const fillS   = game._pluginState.fill;
    const gravS   = game._pluginState.gravity;
    if (chiselS?.active || chiselS?.target) return;
    if (fillS?.active || fillS?.target) return;
    if (gravS?.active) return;
    const powerups = pickChoices(game, 3);
    if (powerups.length === 0) {
      game.pendingChoices = 0;
      return;
    }
    const curses = pickCurseChoices(game, powerups.length);

    // Apply the canceling-pair swap rules in place.
    for (const { powerup: pId, curse: cId } of CANCELING_PAIRS) {
      const pIdx = powerups.findIndex(p => p.id === pId);
      if (pIdx === -1 || curses[pIdx]?.id !== cId) continue;
      const swapIdx = curses.findIndex((c, i) => i !== pIdx && c?.id !== cId);
      if (swapIdx !== -1) {
        [curses[pIdx], curses[swapIdx]] = [curses[swapIdx], curses[pIdx]];
      }
    }

    const choices = powerups.map((powerup, i) => ({
      powerup,
      // Blessings flagged `noCurse` (e.g. Dispell) carry no bundled
      // curse — picking them is a pure positive. Otherwise fall back
      // gracefully if somehow there are fewer eligible curses than
      // power-ups (defensive — all curses are always-available today).
      curse: powerup.noCurse ? null : (curses[i % Math.max(curses.length, 1)] ?? null),
    }));
    buildChoiceMenu({
      choices,
      onPick: ({ powerup, curse }) => {
        game.applyPowerUp(powerup);
        if (curse) game.applyCurse(curse);
      },
    });
  }

  // Decide whether to surface the menu next. Called any time
  // pendingChoices changes: after picking a card, after a chisel /
  // fill / gravity animation finishes, and from the engine's
  // onPowerUpChoice hook.
  function showNext() {
    // Don't pop a modal post game-over (junk-curse can trigger game
    // over mid-completeClear, *before* the choice hook fires).
    if (game.gameOver) return;
    // Don't pop while chisel/fill is mid-interaction — the modal
    // would steal the click/keyboard focus the power-up needs.
    const chiselS = game._pluginState.chisel;
    const fillS   = game._pluginState.fill;
    const gravS   = game._pluginState.gravity;
    if (chiselS?.active || chiselS?.target) return;
    if (fillS?.active || fillS?.target) return;
    // Don't pop while the Gravity cascade is running.
    if (gravS?.active) return;
    // Don't open a second menu if one is already up.
    if (!powerupMenu$.classList.contains('hidden')) return;

    if (game.pendingChoices > 0) {
      requestAnimationFrame(showPowerUpMenu);
    }
  }

  // Restart should always come back to a clean menu state.
  function clear() {
    powerupMenu$.classList.add('hidden');
  }

  return { showNext, clear };
}
