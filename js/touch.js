// ============================================================
// touch.js — touchscreen gestures for the playfield.
// ============================================================
//
// SKETCH — gesture mapping:
//
//   tap                       rotate CW
//   horizontal drag           move (one cell per cell-width crossed,
//                             tracked continuously for back-and-forth)
//   slow drag down            soft drop (continuous while held)
//   fast downward fling       hard drop (on release)
//
// During a Chisel / Fill cell-pick:
//   tap                       select that board cell (via the same
//                             boardClick intercept the mouse uses)
//   anything else             ignored — the piece is frozen anyway,
//                             and a stray drag shouldn't accidentally
//                             pick a cell next to the one tapped.
//
// Other actions (Hold, rotate-CCW, Chisel/Fill/Flip/Whoops, Pause)
// live on on-screen buttons in index.html that call their respective
// game methods or `game._interceptInput(...)` actions directly.
//
// Single-touch only: a second finger landing mid-gesture is ignored
// until the first finger lifts. This keeps two-finger pinch-zoom
// from compounding into a frantic move-spam, and matches what
// players expect from a 1-D-ish play surface.
//
// `setupTouch(game, canvas)` is wired in from main.js next to
// setupInput. It owns its own listeners on `canvas` (the playfield
// canvas — not the page) and never touches Game internals beyond
// the public action methods + the `_interceptInput` bus.
//
// ----------------------------------------------------------------
// TUNABLES — adjust to taste, then leave them alone. The defaults
// were picked for ~6" phone screens with a 30-px-cell board.

const TAP_MS         = 180;   // touchstart→end under this with no drag = tap
const TAP_PX         = 10;    // any movement past this exits tap territory
const SOFT_DROP_PX   = 24;    // start soft drop once finger is this far below start
const HARD_DROP_VEL  = 1.5;   // px/ms downward at release = upgrade to hard drop
const HARD_DROP_DIST = 80;    // …but only if total downward travel hit this minimum

import { COLS, ROWS } from './constants.js';

export function setupTouch(game, canvas) {
  // In-flight gesture state. Reset to null between gestures so
  // touchstart can detect the "no other finger down" case cheaply.
  let g = null;
  // Shape:
  //   {
  //     id:           Touch.identifier of the tracked finger
  //     startX,Y,T:   client coords + perf time at touchstart
  //     lastX,Y:      latest client coords (updated on every touchmove)
  //     cellPx:       canvas cell width in CSS pixels at gesture start
  //     cellsMoved:   signed integer — how many discrete moves we've
  //                   already fired (so re-crossings net out cleanly)
  //     softDropping: bool — have we already called startSoftDrop?
  //     mode:         null | 'horizontal' | 'vertical' — locked once
  //                   we cross TAP_PX, prevents direction wobble
  //   }

  // Compute cell pixel size on the fly (orientation changes, Growth
  // curse widening the board, etc. all change this between gestures).
  function cellPx() {
    const rect = canvas.getBoundingClientRect();
    const cols = game.board[0]?.length ?? COLS;
    return rect.width / cols;
  }

  // CSS-pixel coords → board (col, row). Mirrors main.js's
  // boardClickToCell so the mouse click and touch tap both land on
  // the same cell for chisel/fill picks.
  function pxToCell(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const cols = game.board[0]?.length ?? COLS;
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (clientX - rect.left) * scaleX;
    const py = (clientY - rect.top)  * scaleY;
    return {
      col: Math.floor(px / (canvas.width  / cols)),
      row: Math.floor(py / (canvas.height / ROWS)),
    };
  }

  canvas.addEventListener('touchstart', (e) => {
    if (g) return;                                   // already tracking a finger
    const t = e.changedTouches[0];
    g = {
      id:           t.identifier,
      startX:       t.clientX, startY: t.clientY,
      startT:       performance.now(),
      lastX:        t.clientX, lastY:  t.clientY,
      cellPx:       cellPx(),
      cellsMoved:   0,
      softDropping: false,
      mode:         null,
    };
    // Suppress browser scroll / zoom on the board itself. Buttons
    // outside the canvas still get their default touch behavior.
    e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (!g) return;
    const t = [...e.changedTouches].find(x => x.identifier === g.id);
    if (!t) return;
    e.preventDefault();
    g.lastX = t.clientX;
    g.lastY = t.clientY;

    // While a modal plugin (Chisel / Fill cell-pick, Gravity cascade)
    // freezes gameplay, don't translate drags into piece motion. Tap
    // routing in endGesture still handles the cell-pick case.
    if (game._isFrozenByPlugin()) return;

    const dx = g.lastX - g.startX;
    const dy = g.lastY - g.startY;
    const adx = Math.abs(dx), ady = Math.abs(dy);

    // Lock the gesture's axis the first time it moves past TAP_PX.
    // Without this, finishing a horizontal drag with a slight
    // downward drift would falsely engage soft drop.
    if (!g.mode && Math.max(adx, ady) > TAP_PX) {
      g.mode = adx > ady ? 'horizontal' : 'vertical';
    }

    if (g.mode === 'horizontal') {
      // Discrete per-cell moves. The signed `cellsMoved` counter lets
      // the player drag right two cells, then back left one, and have
      // exactly one net move(1) followed by one move(-1).
      const targetCells = Math.trunc(dx / g.cellPx);
      while (g.cellsMoved < targetCells) {
        game.move(1);
        g.cellsMoved += 1;
      }
      while (g.cellsMoved > targetCells) {
        game.move(-1);
        g.cellsMoved -= 1;
      }
    } else if (g.mode === 'vertical' && dy > SOFT_DROP_PX) {
      // Continuous soft drop while finger is held below the threshold.
      // startSoftDrop is idempotent (just sets `game.softDropping`).
      if (!g.softDropping) {
        game.startSoftDrop();
        g.softDropping = true;
      }
    }
  }, { passive: false });

  function endGesture() {
    if (!g) return;
    const dt = performance.now() - g.startT;
    const dx = g.lastX - g.startX;
    const dy = g.lastY - g.startY;
    const adx = Math.abs(dx), ady = Math.abs(dy);

    if (g.softDropping) game.stopSoftDrop();

    // Tap classification. A tap means "did barely anything during a
    // short window" — both axes under TAP_PX, total time under TAP_MS.
    const wasTap = dt < TAP_MS && Math.max(adx, ady) < TAP_PX;

    if (wasTap) {
      // Route tap to whichever cell-picker is active, falling back
      // to rotate-CW. boardClick is the same intercept the mouse
      // dispatches through main.js — chisel/fill plugins claim it
      // when their `active` flag is on, otherwise it's a no-op.
      if (game.chisel?.active || game.fill?.active) {
        const { col, row } = pxToCell(g.lastX, g.lastY);
        game._interceptInput('boardClick', col, row);
      } else {
        game.rotate(1);
      }
    } else if (g.mode === 'vertical' && dy > HARD_DROP_DIST) {
      // Fast downward fling on release upgrades to hard drop. The
      // continuous soft drop above already nudged the piece part way
      // down; hardDrop slams the rest.
      const downVel = dy / dt;
      if (downVel >= HARD_DROP_VEL) game.hardDrop();
    }

    g = null;
  }

  canvas.addEventListener('touchend',    endGesture, { passive: true });
  canvas.addEventListener('touchcancel', endGesture, { passive: true });
}
