// ============================================================
// menus/keynav.js — generic arrow-key focus navigation for menus
// ============================================================
//
// Default UX for any menu of buttons: cycle focus with the arrow
// keys (and WASD), activate the focused button with Enter/Space.
// The browser's native focus model does the heavy lifting — we
// just decide which button receives `.focus()` next. The unified
// `:focus-visible` outline in styles.css then provides the visual
// cue automatically.
//
//   ArrowLeft  / A   = previous button in the same UI row, wrapping
//                      to the last button of the previous row at the
//                      row boundary.
//   ArrowRight / D   = next button in the same UI row, wrapping to
//                      the first button of the next row.
//   ArrowUp    / W   = the button in the previous UI row whose
//                      horizontal center is closest to the current
//                      one (so pressing Up always lands somewhere
//                      visually above the current button).
//   ArrowDown  / S   = same, but the next UI row.
//   Enter / Space    = native button activation.
//
// "UI row" here means actual visual layout, not array order — we
// read each button's getBoundingClientRect() and group buttons
// whose tops are within half a button-height of each other. That's
// what lets a CSS-grid wrapping at any column count Just Work, and
// what makes "from Slick, press Down → land on Psychic IV" line up
// with what the player sees on screen.
//
// Wraps at the ends. Inactive menus are skipped via the caller's
// `isOpen()` predicate, so the same listener can sit on document
// without firing while another modal owns the keyboard.
//
// If the active element is a text/number input, arrow keys are
// passed through so caret-move and number-step behavior still work
// inside the field. Tabbing or clicking out of the input puts the
// user back into arrow-nav mode.
//
// Usage:
//   const nav = wireArrowNav({
//     getButtons: () => [...container$.querySelectorAll('button')],
//     isOpen:     () => !container$.classList.contains('hidden'),
//     onMove:     playCycleSound,   // optional — fires on each move
//   });
//   nav.focusFirst();     // call when the menu shows
//
// `getButtons` is called lazily on every keypress so menus that
// rebuild their button list (swap pages, mount/unmount items)
// don't need to re-wire anything.
// ============================================================

// Group buttons into visual rows by their bounding-rect tops, then
// sort each row left-to-right. Buttons whose tops are within half a
// button-height of each other count as the same row — that survives
// minor sub-pixel variation while still splitting clearly different
// rows in a CSS-grid.
function geometry(buttons) {
  const items = buttons
    .map(el => ({ el, rect: el.getBoundingClientRect() }))
    // Skip detached / display:none entries — their rects are 0×0
    // and would all collapse onto the same "row" at top 0.
    .filter(it => it.rect.width > 0 && it.rect.height > 0);
  items.sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left);

  const rows = [];
  for (const it of items) {
    const last = rows[rows.length - 1];
    const tol = it.rect.height * 0.5;
    if (last && Math.abs(last[0].rect.top - it.rect.top) <= tol) {
      last.push(it);
    } else {
      rows.push([it]);
    }
  }
  for (const row of rows) row.sort((a, b) => a.rect.left - b.rect.left);
  return rows;
}

function findCurrent(rows, el) {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r].findIndex(it => it.el === el);
    if (c !== -1) return { r, c };
  }
  return null;
}

// Given a target row and the current button's horizontal center,
// pick the row entry whose center is closest. Used for Up/Down so
// pressing those keys always lands somewhere visually above or
// below the current button.
function closestByCenterX(row, centerX) {
  let best = row[0];
  let bestDist = Infinity;
  for (const it of row) {
    const x = it.rect.left + it.rect.width / 2;
    const d = Math.abs(x - centerX);
    if (d < bestDist) { bestDist = d; best = it; }
  }
  return best.el;
}

function neighbor(rows, current, key) {
  const pos = findCurrent(rows, current);
  if (!pos) return rows[0][0].el; // unknown current — seed first

  const { r, c } = pos;
  const row = rows[r];
  const curRect = current.getBoundingClientRect();
  const cx = curRect.left + curRect.width / 2;

  switch (key) {
    case 'ArrowLeft': case 'a': case 'A': {
      if (c > 0) return row[c - 1].el;
      // At the row's left edge — wrap to the last button of the
      // previous row (or the very last button of the menu).
      const prev = rows[(r - 1 + rows.length) % rows.length];
      return prev[prev.length - 1].el;
    }
    case 'ArrowRight': case 'd': case 'D': {
      if (c < row.length - 1) return row[c + 1].el;
      const next = rows[(r + 1) % rows.length];
      return next[0].el;
    }
    case 'ArrowUp': case 'w': case 'W': {
      const target = rows[(r - 1 + rows.length) % rows.length];
      return closestByCenterX(target, cx);
    }
    case 'ArrowDown': case 's': case 'S': {
      const target = rows[(r + 1) % rows.length];
      return closestByCenterX(target, cx);
    }
  }
  return null;
}

export function wireArrowNav({ getButtons, isOpen, onMove }) {
  function onKey(e) {
    if (!isOpen()) return;

    const a = document.activeElement;
    // Don't hijack arrow keys aimed at text/number/textarea fields —
    // ArrowLeft/Right move the caret, ArrowUp/Down nudge a number
    // value. The user can Tab out (or click out) to resume nav.
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;

    const NAV_KEYS = new Set([
      'ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
      'a','A','d','D','w','W','s','S',
    ]);
    if (!NAV_KEYS.has(e.key)) return;

    const buttons = getButtons();
    if (buttons.length === 0) return;

    e.preventDefault();
    e.stopPropagation();

    // No element in our list is focused yet — the very first arrow
    // press should land on the first button rather than navigate
    // off into nothing.
    if (!buttons.includes(a)) {
      buttons[0].focus();
      onMove?.();
      return;
    }

    const rows = geometry(buttons);
    if (rows.length === 0) return;

    const target = neighbor(rows, a, e.key);
    if (!target || target === a) return; // single-button menu, no-op

    target.focus();
    onMove?.();
  }
  document.addEventListener('keydown', onKey, { capture: true });

  function focusFirst() {
    const b = getButtons();
    if (b.length > 0) b[0].focus();
  }

  return { focusFirst };
}
