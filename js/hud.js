// ============================================================
// hud.js — passive UI surfaces around the board
// ============================================================
//
// Read-only mirror of the game state. Everything in this module
// follows the same contract as render.js: it consumes a `Game`
// instance, writes to the DOM, and never mutates game state. The
// frame loop in main.js calls `hud.sync(game)` once per tick.
//
// Surfaces owned here:
//   • Score / Level / Lines stat panel (the three big numbers)
//   • Hold panel + Next-piece preview panel visibility (gated on
//     unlocks.hold and unlocks.nextCount respectively)
//   • Chisel / Fill hint banner — overlay that appears while a
//     cell-pick interaction is waiting on the player
//   • Active-blessing tag list  (HOLD / GHOST / SLICK / PSYCHIC ×N
//     / CHISEL ×N / FILL ×N / FLIP ×N / WHOOPS)
//   • Active-curse tag list     (JUNK / HYPED ×N / CRUEL / GROWTH ×N)
//   • Center overlay text       (PAUSED / GAME OVER / etc.)
//   • Floating notifications    (COMBO / TETRIS / PERFECT / B2B /
//                                 JUNK / RAIN)
//
// Diff caches live as module-level state so each frame's writes
// only land when a value has actually changed — every .style.*
// or .innerHTML write would otherwise invalidate layout.
//
// `setupHUD()` is called once at boot from main.js. It does the
// DOM lookups, creates the chisel-hint banner, and returns a small
// control object the rest of the app calls into:
//
//   const hud = setupHUD();
//   hud.sync(game)              — one call per frame
//   hud.notify(text, type, ms)  — float a notification
//   hud.showOverlay(text, sub)  — center "PAUSED" / "GAME OVER" text
//   hud.hideOverlay()           — clear the center overlay
// ============================================================

export function setupHUD() {
  // ---- DOM lookups ----
  const overlay$       = document.getElementById('overlay');
  const notifs$        = document.getElementById('notifications');
  const scoreEl        = document.getElementById('score');
  const levelEl        = document.getElementById('level');
  const linesEl        = document.getElementById('lines');
  const holdPanel$     = document.getElementById('hold-panel');
  const nextPanel$     = document.getElementById('next-panel');
  const blessingSection$ = document.getElementById('blessing-section');
  const blessingList$    = document.getElementById('blessing-list');
  const curseSection$  = document.getElementById('curse-section');
  const curseList$     = document.getElementById('curse-list');
  const boardWrap$     = document.getElementById('board-wrap');
  const nextCanvases   = [...document.querySelectorAll('.next')];

  // The chisel/fill hint banner is created here rather than declared
  // in index.html — it's a transient overlay that only main.js's
  // chisel/fill state has any business knowing about, and creating it
  // in JS keeps the DOM markup clean.
  const chiselHint$ = document.createElement('div');
  chiselHint$.id = 'chisel-hint';
  chiselHint$.classList.add('hidden');
  boardWrap$.appendChild(chiselHint$);

  // ---- Diff caches ----
  // Per-frame writes invalidate layout, so guard each one against
  // its previous value and only flush when something actually moved.
  let _lastHoldDisplay = null;
  let _lastNextPanelDisplay = null;
  const _lastNextCanvasDisplay = new Array(nextCanvases.length).fill(null);
  let _lastScoreText = '';
  let _lastLevelText = '';
  let _lastLinesText = '';

  // ---- Floating notifications (combo / TETRIS / perfect clear) ----
  // CSS owns the animation; JS just appends the element and removes it
  // after the animation finishes. Multiple notifications stack vertically.
  function notify(text, type, duration = 1700) {
    const el = document.createElement('div');
    el.className = 'notification ' + type;
    el.textContent = text;
    notifs$.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  // ---- Center overlay (PAUSED / GAME OVER / etc.) ----
  function showOverlay(text, sub = '') {
    overlay$.innerHTML = text + (sub ? `<small>${sub}</small>` : '');
    overlay$.classList.remove('hidden');
  }
  function hideOverlay() {
    overlay$.classList.add('hidden');
  }

  // ---- Hold / Next panel visibility ----
  // Hide the entire panel when the player hasn't unlocked it yet.
  // Each Next-canvas slot also hides individually so a partial
  // Psychic unlock (say nextCount = 2) doesn't leave empty boxes.
  function syncUnlocks(game) {
    const holdD = game.unlocks.hold ? '' : 'none';
    if (holdD !== _lastHoldDisplay) {
      holdPanel$.style.display = holdD;
      _lastHoldDisplay = holdD;
    }
    const nextD = game.unlocks.nextCount > 0 ? '' : 'none';
    if (nextD !== _lastNextPanelDisplay) {
      nextPanel$.style.display = nextD;
      _lastNextPanelDisplay = nextD;
    }
    for (let i = 0; i < nextCanvases.length; i++) {
      const d = i < game.unlocks.nextCount ? '' : 'none';
      if (d !== _lastNextCanvasDisplay[i]) {
        nextCanvases[i].style.display = d;
        _lastNextCanvasDisplay[i] = d;
      }
    }
  }

  // ---- Chisel / Fill hint banner ----
  // Both power-ups share one banner since only one is ever active
  // at a time. The text changes based on which power-up is asking.
  function syncChiselHint(game) {
    const chiselActive = !!game._pluginState.chisel?.active;
    const fillActive = !!game._pluginState.fill?.active;
    const active = chiselActive || fillActive;
    if (chiselActive) {
      chiselHint$.innerHTML = 'CLICK OR USE ARROW KEYS + ENTER TO CHISEL';
    } else if (fillActive) {
      chiselHint$.innerHTML = 'CLICK OR USE ARROW KEYS + ENTER TO FILL';
    }
    chiselHint$.classList.toggle('hidden', !active);
    boardWrap$.classList.toggle('chiseling', active);
  }

  // ---- Active-blessing tags ----
  // Renders one tag per persistent blessing currently in effect.
  // Charge-based blessings show their charge count when > 1. One-shot
  // consumables (Mercy, Tired, Gravity, Dispell) are intentionally
  // omitted — they vanish on apply and there's nothing ongoing to tag.
  function syncBlessings(game) {
    const tags = [];
    if (game.unlocks.hold)  tags.push('HOLD');
    if (game.unlocks.ghost) tags.push('GHOST');
    if (game.unlocks.slick) tags.push('SLICK');
    if (game.unlocks.nextCount > 0) {
      tags.push(game.unlocks.nextCount > 1
        ? `PSYCHIC ×${game.unlocks.nextCount}`
        : 'PSYCHIC');
    }
    if (game.unlocks.chiselCharges > 0) {
      tags.push(game.unlocks.chiselCharges > 1
        ? `CHISEL ×${game.unlocks.chiselCharges}`
        : 'CHISEL');
    }
    if (game.unlocks.fillCharges > 0) {
      tags.push(game.unlocks.fillCharges > 1
        ? `FILL ×${game.unlocks.fillCharges}`
        : 'FILL');
    }
    if (game.unlocks.flipCharges > 0) {
      tags.push(game.unlocks.flipCharges > 1
        ? `FLIP ×${game.unlocks.flipCharges}`
        : 'FLIP');
    }
    if (game.unlocks.whoopsCharges > 0) tags.push('WHOOPS');

    blessingSection$.classList.toggle('hidden', tags.length === 0);
    const next = tags.join(',');
    if (blessingList$.dataset.tags !== next) {
      blessingList$.dataset.tags = next;
      blessingList$.innerHTML = tags.map(t => `<span class="blessing-tag">${t}</span>`).join('');
    }
  }

  // ---- Active-curse tags ----
  // Mirrors syncBlessings for the debuffs side. Rain has no
  // persistent flag (one-shot rubble drop) so it never tags here.
  function syncCurses(game) {
    const tags = [];
    if (game.curses.junk)  tags.push('JUNK');
    if (game.curses.hyped > 0) {
      tags.push(game.curses.hyped > 1 ? `HYPED ×${game.curses.hyped}` : 'HYPED');
    }
    if (game.level <= game.curses.cruelUntilLevel) tags.push('CRUEL');
    if (game.curses.extraCols > 0) {
      tags.push(game.curses.extraCols > 1
        ? `GROWTH ×${game.curses.extraCols}`
        : 'GROWTH');
    }

    curseSection$.classList.toggle('hidden', tags.length === 0);
    const next = tags.join(',');
    if (curseList$.dataset.tags !== next) {
      curseList$.dataset.tags = next;
      curseList$.innerHTML = tags.map(t => `<span class="curse-tag">${t}</span>`).join('');
    }
  }

  // ---- Score / Level / Lines stats ----
  // textContent writes still trigger a recalc of any ancestor with
  // intrinsic sizing, so skip when unchanged.
  function syncStats(game) {
    const scoreText = game.score.toLocaleString();
    if (scoreText !== _lastScoreText) {
      scoreEl.textContent = scoreText;
      _lastScoreText = scoreText;
    }
    const levelText = String(game.level);
    if (levelText !== _lastLevelText) {
      levelEl.textContent = levelText;
      _lastLevelText = levelText;
    }
    const linesText = String(game.lines);
    if (linesText !== _lastLinesText) {
      linesEl.textContent = linesText;
      _lastLinesText = linesText;
    }
  }

  // Single per-frame entry point — fans out to each surface.
  function sync(game) {
    syncStats(game);
    syncUnlocks(game);
    syncChiselHint(game);
    syncBlessings(game);
    syncCurses(game);
  }

  return { sync, notify, showOverlay, hideOverlay };
}
