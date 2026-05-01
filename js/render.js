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

// Draw one cell with a beveled 3D look. Ghost cells are drawn flat & translucent.
export function drawCell(ctx, x, y, color, ghost = false) {
  const px = x * BLOCK;
  const py = y * BLOCK;
  ctx.fillStyle = ghost ? COLORS.GHOST : color;
  ctx.fillRect(px, py, BLOCK, BLOCK);
  if (ghost) return;
  // top + left highlight
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(px, py, BLOCK, 3);
  ctx.fillRect(px, py, 3, BLOCK);
  // bottom + right shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(px, py + BLOCK - 3, BLOCK, 3);
  ctx.fillRect(px + BLOCK - 3, py, 3, BLOCK);
}

// Paint the main playfield: background, grid lines, locked blocks,
// ghost outline, and active piece.
export function drawBoard(ctx, canvas, game) {
  ctx.fillStyle = COLORS.BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // grid lines
  ctx.strokeStyle = COLORS.GRID;
  ctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    ctx.beginPath();
    ctx.moveTo(x * BLOCK + 0.5, 0);
    ctx.lineTo(x * BLOCK + 0.5, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * BLOCK + 0.5);
    ctx.lineTo(COLS * BLOCK, y * BLOCK + 0.5);
    ctx.stroke();
  }

  // locked blocks
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (game.board[r][c]) drawCell(ctx, c, r, COLORS[game.board[r][c]]);
    }
  }

  // Line-clear animation overlay (drawn on top of the locked blocks)
  if (game.isClearing && game.isClearing()) {
    const p = game.clearProgress();
    for (const row of game.clearingRows) {
      drawClearOverlay(ctx, row, p);
    }
  }

  if (!game.current || game.gameOver) return;

  const s = shapeOf(game.current);
  const gy = game.ghostY();

  // ghost piece
  for (let r = 0; r < s.length; r++) {
    for (let c = 0; c < s[r].length; c++) {
      if (!s[r][c]) continue;
      const x = game.current.x + c;
      const y = gy + r;
      if (y >= 0) drawCell(ctx, x, y, COLORS[game.current.type], true);
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
}

// Paints the line-clear effect on a single row.
//   progress: 0..1 from start to end of the animation.
//
// Two phases:
//   0.0 → 0.55  flash the whole row bright white (intensity pulses)
//   0.55 → 1.0  wipe outward from the center, revealing background
function drawClearOverlay(ctx, row, progress) {
  const py = row * BLOCK;

  if (progress < 0.55) {
    // Flash phase — pulse a white overlay over the row.
    const t = progress / 0.55;
    const alpha = 0.45 + 0.35 * Math.sin(t * Math.PI * 3);
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, alpha)})`;
    ctx.fillRect(0, py, COLS * BLOCK, BLOCK);
  } else {
    // Wipe phase — clear cells from the center outward.
    const wipe = (progress - 0.55) / 0.45;       // 0..1 within this phase
    const reach = wipe * (COLS / 2 + 0.5);        // half-width of the gap
    const center = COLS / 2;
    for (let c = 0; c < COLS; c++) {
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
      ctx.fillStyle = COLORS[type];
      ctx.fillRect(x, y, cell, cell);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, cell, 2);
      ctx.fillRect(x, y, 2, cell);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(x, y + cell - 2, cell, 2);
      ctx.fillRect(x + cell - 2, y, 2, cell);
    }
  }
}
