// ============================================================
// OpponentView — receive 'state' snapshots, paint the opponent
// ============================================================
//
// Subscribes to the match controller's 'state' event, stashes the
// latest snapshot, and paints it onto a canvas every frame. The
// snapshot shape mirrors what state-sync-plugin sends:
//   { board, piece, score, chain, gameOver }
//
// We DON'T paint inside the controller's onMessage callback —
// inbound messages can arrive faster than the renderer needs to
// repaint, and BroadcastChannel can fire mid-frame. Stashing +
// rAF-driven repaint lets the browser coalesce updates naturally
// and keeps the painted state consistent with whatever the
// player's main board is doing.
//
// setup* returns a teardown handle so network-vs can detach cleanly
// when a match ends.

import { drawCompactBoard } from '../../../render.js';

export function setupOpponentView(controller, canvas) {
  if (!canvas) return { teardown: () => {} };
  const ctx = canvas.getContext('2d', { alpha: false });

  // Latest snapshot we've received. Null until the opponent's
  // first send lands — until then we paint a "Waiting…" message
  // so the empty canvas doesn't read as a bug.
  let latest = null;
  let raf = 0;
  let stopped = false;

  controller.on('state', (snap) => {
    if (stopped) return;
    if (!snap) return;
    latest = snap;
  });

  function paint() {
    if (stopped) return;
    if (latest) {
      drawCompactBoard(canvas, ctx, latest.board, latest.piece);
      // Subtle game-over dim — the opponent's tab paints YOU LOSE
      // on its own field, but on OUR view of their field we just
      // wash it out so you can see what they ended on.
      if (latest.gameOver) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    } else {
      paintWaiting(ctx, canvas);
    }
    raf = requestAnimationFrame(paint);
  }
  raf = requestAnimationFrame(paint);

  return {
    teardown() {
      stopped = true;
      controller.off('state');
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

// Pre-snapshot placeholder: dimmed background plus a single
// "WAITING…" line. Reads as "this surface is wired up but the
// opponent hasn't sent anything yet" rather than as a broken
// blank canvas.
function paintWaiting(ctx, canvas) {
  ctx.fillStyle = '#170028';   // BG color, kept inline so this
                                // module doesn't reach into COLORS
                                // for one constant.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.font = 'bold 11px Orbitron, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('WAITING…', canvas.width / 2, canvas.height / 2);
}
