// ============================================================
// Renderer — draws the game state onto canvas elements
// ============================================================
//
// All rendering functions are pure: given a game state, they
// paint pixels. They never mutate game state. This separation
// means you can drop in a different renderer (WebGL, DOM-based,
// etc.) without touching game logic.
// ============================================================

import { COLS, ROWS, BLOCK, COLORS } from './constants.js';
import { PIECES, shapeOf } from './pieces.js';

// ---- color helpers ----
// Used by drawBlock to build a vertical light→dark gradient over
// the piece color, which is what gives blocks their 3D rounded feel.
function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}
function lighten(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r + (255 - r) * amount)},${Math.round(g + (255 - g) * amount)},${Math.round(b + (255 - b) * amount)})`;
}
function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`;
}
function withAlpha(hex, alpha) {
  if (hex.startsWith('rgb')) return hex;
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Draw a single rounded "gem" block with gloss + drop shadow.
// Works for any cell size — the board and the mini previews both use it.
//   px, py  pixel position of the cell's top-left corner
//   size    cell width/height in pixels
//   color   fill color (hex or rgb string)
//   ghost   if true, render the translucent ghost-piece variant
export function drawBlock(ctx, px, py, size, color, ghost = false) {
  // All sizes scale with the cell so this looks right in mini previews too.
  const inset  = Math.max(1, size * 0.04);
  const radius = Math.max(2, size * 0.18);
  const x = px + inset;
  const y = py + inset;
  const w = size - inset * 2;
  const h = size - inset * 2;

  if (ghost) {
    // Faintly glowing outline — same hue as the piece, no fill.
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(3, size * 0.25);
    ctx.fillStyle = withAlpha(color, 0.08);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = withAlpha(color, 0.45);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.stroke();
    return;
  }

  // ---- Tetris Effect look ----
  // Each block reads as a glowing piece of light: a colored bloom
  // around the cell, a luminescent radial body, and a bright core
  // spot near the top suggesting the light source is inside.

  // 1. Outer glow — colored bloom around the block.
  //    shadowColor inherits the piece hue so the halo matches.
  ctx.save();
  ctx.shadowColor   = color;
  ctx.shadowBlur    = Math.max(4, size * 0.45);
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.restore();

  // 2. Radial body gradient — bright core, fading to the base color
  //    at the rim. This is the "light coming from inside" effect.
  const cx = x + w * 0.5;
  const cy = y + h * 0.45;
  const radial = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
  radial.addColorStop(0,   lighten(color, 0.35));
  radial.addColorStop(0.5, lighten(color, 0.08));
  radial.addColorStop(1,   color);
  ctx.fillStyle = radial;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();

  // 3. Soft white sheen across the upper half (the "wet" gloss).
  const glossGrad = ctx.createLinearGradient(x, y, x, y + h * 0.55);
  glossGrad.addColorStop(0, 'rgba(255,255,255,0.16)');
  glossGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glossGrad;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();

  // 4. Bright core spot near the top — the "lit from within" highlight.
  //    Clipped to the cell so the soft fall-off respects the rounded shape.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.clip();
  const spot = ctx.createRadialGradient(
    cx, y + h * 0.28, 0,
    cx, y + h * 0.28, w * 0.45
  );
  spot.addColorStop(0,   'rgba(255,255,255,0.42)');
  spot.addColorStop(0.4, 'rgba(255,255,255,0.10)');
  spot.addColorStop(1,   'rgba(255,255,255,0)');
  ctx.fillStyle = spot;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// Backwards-compatible board-cell wrapper (cell coords → pixels at BLOCK size).
export function drawCell(ctx, x, y, color, ghost = false) {
  drawBlock(ctx, x * BLOCK, y * BLOCK, BLOCK, color, ghost);
}

// Paint the main playfield: background, grid lines, locked blocks,
// ghost outline, and active piece.
export function drawBoard(ctx, canvas, game) {
  // Read width from the board so the renderer follows runtime growth
  // (Growth Spurt power-up adds columns).
  const cols = game.board[0]?.length ?? COLS;

  ctx.fillStyle = COLORS.BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // grid lines
  ctx.strokeStyle = COLORS.GRID;
  ctx.lineWidth = 1;
  for (let x = 1; x < cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * BLOCK + 0.5, 0);
    ctx.lineTo(x * BLOCK + 0.5, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * BLOCK + 0.5);
    ctx.lineTo(cols * BLOCK, y * BLOCK + 0.5);
    ctx.stroke();
  }

  // locked blocks
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (game.board[r][c]) drawCell(ctx, c, r, COLORS[game.board[r][c]]);
    }
  }

  // Line-clear animation overlay (drawn on top of the locked blocks)
  if (game.isClearing && game.isClearing()) {
    const p = game.clearProgress();
    for (const row of game.clearingRows) {
      drawClearOverlay(ctx, row, p, cols);
    }
  }

  // Chisel destruction animation (drawn on top of the locked blocks)
  if (game.chisel?.target) {
    drawChiselShatter(ctx, game.chisel.target, game.chiselProgress());
  }

  if (!game.current || game.gameOver) {
    // Still paint the chisel cursor highlight even when there's no
    // active piece (e.g. between spawns). Late-return path.
    if (game.chisel?.active && game.chisel.cursor) {
      const onBlock = !!game.board[game.chisel.cursor.y]?.[game.chisel.cursor.x];
      drawChiselCursor(ctx, game.chisel.cursor, onBlock);
    }
    return;
  }

  const s = shapeOf(game.current);
  const gy = game.ghostY();

  // ghost piece — only if the player has unlocked the Predictor power-up
  if (game.unlocks?.ghost) {
    for (let r = 0; r < s.length; r++) {
      for (let c = 0; c < s[r].length; c++) {
        if (!s[r][c]) continue;
        const x = game.current.x + c;
        const y = gy + r;
        if (y >= 0) drawCell(ctx, x, y, COLORS[game.current.type], true);
      }
    }
  }

  // current (active) piece
  for (let r = 0; r < s.length; r++) {
    for (let c = 0; c < s[r].length; c++) {
      if (!s[r][c]) continue;
      const x = game.current.x + c;
      const y = game.current.y + r;
      if (y >= 0) drawCell(ctx, x, y, COLORS[game.current.type]);
    }
  }

  // Chisel keyboard-cursor highlight — drawn LAST so it sits on top
  // of every piece and overlay. Only painted while awaiting a pick.
  if (game.chisel?.active && game.chisel.cursor) {
    const onBlock = !!game.board[game.chisel.cursor.y]?.[game.chisel.cursor.x];
    drawChiselCursor(ctx, game.chisel.cursor, onBlock);
  }
}

// Paints the line-clear effect on a single row.
//   progress: 0..1 from start to end of the animation.
//
// Two phases:
//   0.0 → 0.55  flash the whole row bright white (intensity pulses)
//   0.55 → 1.0  wipe outward from the center, revealing background
function drawClearOverlay(ctx, row, progress, cols = COLS) {
  const py = row * BLOCK;

  if (progress < 0.55) {
    // Flash phase — pulse a white overlay over the row.
    const t = progress / 0.55;
    const alpha = 0.45 + 0.35 * Math.sin(t * Math.PI * 3);
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha)})`;
    ctx.fillRect(0, py, cols * BLOCK, BLOCK);
  } else {
    // Wipe phase — clear cells from the center outward.
    const wipe = (progress - 0.55) / 0.45;       // 0..1 within this phase
    const reach = wipe * (cols / 2 + 0.5);        // half-width of the gap
    const center = cols / 2;
    for (let c = 0; c < cols; c++) {
      const dist = Math.abs(c + 0.5 - center);
      if (dist < reach) {
        // Wiped — paint background.
        ctx.fillStyle = COLORS.BG;
        ctx.fillRect(c * BLOCK, py, BLOCK, BLOCK);
      } else {
        // Still visible — fading white tint on top of the cell.
        const tint = 0.8 * (1 - wipe);
        ctx.fillStyle = `rgba(255, 255, 255, ${tint})`;
        ctx.fillRect(c * BLOCK, py, BLOCK, BLOCK);
      }
    }
  }
}

// Chisel destruction effect — block flashes white, expands, fades out,
// and emits a ring of "shrapnel" particles flying outward.
//   target   { x, y, type, timer }  (type → color)
//   progress 0..1
function drawChiselShatter(ctx, target, progress) {
  const color = COLORS[target.type] || '#ffffff';
  const cx = target.x * BLOCK + BLOCK / 2;
  const cy = target.y * BLOCK + BLOCK / 2;

  // 1. White flash overlay on the cell — fades out fast.
  const flash = Math.max(0, 1 - progress * 1.6);
  if (flash > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.7 * flash})`;
    ctx.fillRect(target.x * BLOCK, target.y * BLOCK, BLOCK, BLOCK);
    ctx.restore();
  }

  // 2. The block itself, scaled up + faded out (uses drawBlock's gradient
  //    look so the disappearing block matches the rest of the board).
  const scale = 1 + progress * 0.6;
  const alpha = Math.max(0, 1 - progress);
  if (alpha > 0) {
    const size = BLOCK * scale;
    const px = cx - size / 2;
    const py = cy - size / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    drawBlock(ctx, px, py, size, color, false);
    ctx.restore();
  }

  // 3. Shrapnel — 8 small chips fly outward from center, gravity-pulled.
  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  const N = 8;
  const maxDist = BLOCK * 1.6;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + 0.2; // slight rotation so it doesn't look axis-aligned
    const dist  = progress * maxDist;
    const fx = cx + Math.cos(angle) * dist;
    // little gravity pull-down on the y axis
    const fy = cy + Math.sin(angle) * dist + progress * progress * BLOCK * 0.5;
    const r  = Math.max(0.5, BLOCK * 0.12 * (1 - progress));
    ctx.globalAlpha = Math.max(0, 1 - progress);
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Chisel keyboard-cursor highlight — a pulsing outlined square over
// the currently selected cell. Bright yellow when hovering a real
// block (Enter will chisel it), red when over an empty cell so the
// player can tell empty taps will be no-ops.
function drawChiselCursor(ctx, cursor, onBlock) {
  const px = cursor.x * BLOCK;
  const py = cursor.y * BLOCK;
  // Pulse based on time so the highlight reads as "live" cursor, not
  // a static overlay. Date.now() is fine here — cheap and frame-driven.
  const t = (Date.now() % 700) / 700;
  const pulse = 0.7 + 0.3 * Math.abs(Math.sin(t * Math.PI));
  const color = onBlock ? '#ffea00' : '#ff3030';

  ctx.save();
  // Soft tinted overlay over the cell so the highlight is unmistakable
  // even when the cursor is on a bright tile.
  ctx.fillStyle = onBlock ? 'rgba(255, 234, 0, 0.22)' : 'rgba(255, 48, 48, 0.18)';
  ctx.fillRect(px, py, BLOCK, BLOCK);

  // Outer glow ring.
  ctx.shadowColor = color;
  ctx.shadowBlur  = 22 * pulse;
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth   = 4;
  ctx.strokeRect(px + 2, py + 2, BLOCK - 4, BLOCK - 4);

  // Inner thinner ring for a "crosshair" look that reads on any color.
  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1;
  ctx.lineWidth   = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(px + 5, py + 5, BLOCK - 10, BLOCK - 10);
  ctx.restore();
}

// Render a single piece centered inside a small canvas (hold / next preview).
export function drawMini(canvas, ctx, type) {
  ctx.fillStyle = COLORS.BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!type) return;

  const shape = PIECES[type][0];

  // find the bounding box of filled cells so we can center the piece
  let minR = 99, maxR = -1, minC = 99, maxC = -1;
  for (let r = 0; r < shape.length; r++) {
    for (let cc = 0; cc < shape[r].length; cc++) {
      if (!shape[r][cc]) continue;
      if (r  < minR) minR = r;
      if (r  > maxR) maxR = r;
      if (cc < minC) minC = cc;
      if (cc > maxC) maxC = cc;
    }
  }
  const w = maxC - minC + 1;
  const h = maxR - minR + 1;
  const cell = Math.min((canvas.width - 12) / w, (canvas.height - 12) / h, 22);
  const offX = (canvas.width  - w * cell) / 2;
  const offY = (canvas.height - h * cell) / 2;

  for (let r = minR; r <= maxR; r++) {
    for (let cc = minC; cc <= maxC; cc++) {
      if (!shape[r][cc]) continue;
      const x = offX + (cc - minC) * cell;
      const y = offY + (r  - minR) * cell;
      drawBlock(ctx, x, y, cell, COLORS[type]);
    }
  }
}
