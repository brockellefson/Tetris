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

import { COOLDOWN_LINES } from './constants.js';

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
  //
  // Three modal-spend power-ups (Chisel, Fill, Whoops) carry a
  // per-cast cooldown — N more lines must clear before another cast
  // is allowed. When a cooldown is active, this surface emits a
  // dedicated "<NAME> CD k/5" tag with a progress fill instead of
  // (or alongside) the standard blessing tag, so the player can
  // watch the timer drain while they keep playing.
  //
  // Tags are encoded as {key, html} pairs so the diff cache (which
  // compares the joined keys) skips repaints when only the per-tag
  // text is unchanged. The progress-fill width is part of the key,
  // so a cooldown ticking from 4/5 → 3/5 still rerenders.
  //
  // Visual treatment for a cooldown: plain name (no "CD k/5"), gray
  // border/text, with a horizontal fill that grows 20% per cleared
  // line from left to right. At cooldown = 0 (after the 5th clear)
  // the cooldown tag is dropped entirely and the standard cyan
  // blessing tag takes over (or no tag at all if charges are also
  // 0). The fill width tracks progress, NOT remaining, so the bar
  // visually pushes toward "ready."
  function cooldownTag(name, remaining) {
    const done = COOLDOWN_LINES - remaining;
    const pct = Math.max(0, Math.min(100, Math.round((done / COOLDOWN_LINES) * 100)));
    const key = `${name}CD${remaining}`;
    const html = (
      `<span class="blessing-tag cooldown" title="${name} cooling down — ${remaining} more line${remaining === 1 ? '' : 's'} until ready">` +
        `<span class="cd-fill" style="width:${pct}%"></span>` +
        `<span class="cd-label">${name}</span>` +
      `</span>`
    );
    return { key, html };
  }
  function plainTag(text) {
    return { key: text, html: `<span class="blessing-tag">${text}</span>` };
  }

  function syncBlessings(game) {
    const tags = [];
    if (game.unlocks.hold)  tags.push(plainTag('HOLD'));
    if (game.unlocks.ghost) tags.push(plainTag('GHOST'));
    if (game.unlocks.slick) tags.push(plainTag('SLICK'));
    if (game.unlocks.nextCount > 0) {
      tags.push(plainTag(game.unlocks.nextCount > 1
        ? `PSYCHIC ×${game.unlocks.nextCount}`
        : 'PSYCHIC'));
    }
    // Chisel / Fill / Flip / Whoops are unlock-once abilities: once
    // picked, the unlock flag stays true for the rest of the run
    // and the tag is always shown — either as a normal cyan "ready"
    // tag, or as the gray cooldown variant with a left-to-right
    // progress fill while the per-cast cooldown drains.
    if (game.unlocks.chisel) {
      const cd = game._pluginState.chisel?.cooldown ?? 0;
      tags.push(cd > 0 ? cooldownTag('CHISEL', cd) : plainTag('CHISEL'));
    }
    if (game.unlocks.fill) {
      const cd = game._pluginState.fill?.cooldown ?? 0;
      tags.push(cd > 0 ? cooldownTag('FILL', cd) : plainTag('FILL'));
    }
    if (game.unlocks.flip) {
      const cd = game._pluginState.flip?.cooldown ?? 0;
      tags.push(cd > 0 ? cooldownTag('FLIP', cd) : plainTag('FLIP'));
    }
    if (game.unlocks.whoops) {
      const cd = game._pluginState.whoops?.cooldown ?? 0;
      tags.push(cd > 0 ? cooldownTag('WHOOPS', cd) : plainTag('WHOOPS'));
    }

    blessingSection$.classList.toggle('hidden', tags.length === 0);
    const next = tags.map(t => t.key).join(',');
    if (blessingList$.dataset.tags !== next) {
      blessingList$.dataset.tags = next;
      blessingList$.innerHTML = tags.map(t => t.html).join('');
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
