// ============================================================
// Renderer — draws the game state onto canvas elements
// ============================================================
//
// All rendering functions are pure: given a game state, they
// paint pixels. They never mutate game state. This separation
// means you can drop in a different renderer (WebGL, DOM-based,
// etc.) without touching game logic.
//
// Performance notes:
//   - Each block has an expensive look (radial gradient body,
//     linear gloss, inner spot, outer shadow blur). Painting it
//     fresh on every cell every frame was the main bottleneck.
//   - We now pre-render every (color, size, ghost) variant we'll
//     ever use into an offscreen canvas exactly once, and just
//     drawImage that sprite per cell. ~5–10× speedup on render.
//   - The board background + grid is also pre-baked into an
//     offscreen canvas keyed by column count.
// ============================================================

import { COLS, ROWS, BLOCK, COLORS } from './constants.js';
import { PIECES, shapeOf } from './pieces.js';
import { SPECIALS_BY_ID, specialAtPieceCell } from './specials/index.js';

// ---- Rarity → visual treatment ----
// Each rarity tier scales how much extra "weight" the special has
// over its base color cycle. `glowMul` multiplies the special's own
// `animation.glowBoost`, so the special file controls the baseline
// and rarity controls the amplification. `pulse` adds a soft
// breathing scale on top of the cycle (0 = static, 0.06 = +6%
// peak-to-peak) — rarer = more dramatic.
const RARITY_VFX = {
  common:    { glowMul: 1.0, pulse: 0.00 },
  uncommon:  { glowMul: 1.2, pulse: 0.02 },
  rare:      { glowMul: 1.5, pulse: 0.04 },
  legendary: { glowMul: 2.0, pulse: 0.06 },
};

// ---- color helpers ----
// Used by drawBlock to build a vertical light→dark gradient over
// the piece color, which is what gives blocks their 3D rounded feel.
//
// Accepts either "#rrggbb" or "rgb(r,g,b)" / "rgba(r,g,b,a)". The
// rgb() form exists because the special-block renderer interpolates
// between palette colors per frame — without this branch the rgb()
// string would be sliced as if it were hex, parsed to NaN, and
// blow up addColorStop downstream (taking the whole frame with it).
const _rgbCache = new Map();
function hexToRgb(color) {
  let v = _rgbCache.get(color);
  if (v) return v;
  if (color[0] === '#') {
    v = [
      parseInt(color.slice(1, 3), 16),
      parseInt(color.slice(3, 5), 16),
      parseInt(color.slice(5, 7), 16),
    ];
  } else {
    // rgb(...) / rgba(...) — pull the first three integers.
    const m = color.match(/\d+/g);
    v = m && m.length >= 3
      ? [parseInt(m[0], 10), parseInt(m[1], 10), parseInt(m[2], 10)]
      : [0, 0, 0];
  }
  _rgbCache.set(color, v);
  return v;
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

// ============================================================
// Sprite cache
// ============================================================
//
// Block sprites are keyed by (color | size | ghost). On first
// request we render the full gem look once into an offscreen
// canvas and reuse it forever. The cache is bounded in practice:
// we only ever draw at BLOCK (board) and at the mini-preview
// cell sizes (rounded to ints), times ~10 colors, times {normal,
// ghost} — at most a few dozen sprites total.
// ============================================================

const _spriteCache = new Map();

// Pre-render one block at the given size into an offscreen canvas.
// We add a `pad` margin around the cell so the outer shadowBlur
// glow has room to bleed without being clipped. Blits will offset
// by `-pad` to land the cell at the requested position.
function buildSprite(color, size, ghost) {
  // Glow can extend ~size*0.45 outside the cell on each side.
  // Round up generously so nothing gets clipped on retina.
  const pad = Math.ceil(size * 0.6) + 4;
  const dim = size + pad * 2;
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(dim, dim)
    : Object.assign(document.createElement('canvas'), { width: dim, height: dim });
  if (canvas instanceof HTMLCanvasElement) {
    canvas.width = dim;
    canvas.height = dim;
  }
  const sctx = canvas.getContext('2d');
  // Render exactly the same look as the slow-path drawBlock, but
  // offset by `pad` so the cell sits at (pad, pad) inside the sprite.
  drawBlockRaw(sctx, pad, pad, size, color, ghost);
  return { canvas, pad };
}

// Returns { canvas, pad } for a block of (color, size, ghost).
function getSprite(color, size, ghost) {
  // Round to int for stable cache hits across mini-canvas math.
  const s = Math.max(1, Math.round(size));
  const key = `${color}|${s}|${ghost ? 'g' : 'n'}`;
  let v = _spriteCache.get(key);
  if (!v) {
    v = buildSprite(color, s, ghost);
    _spriteCache.set(key, v);
  }
  return v;
}

// Blit a cached block sprite at pixel (px, py).
function blitSprite(ctx, sprite, px, py) {
  ctx.drawImage(sprite.canvas, px - sprite.pad, py - sprite.pad);
}

// ============================================================
// Background sprite — solid fill + grid lines
// ============================================================
//
// The board redraws bg + 28 grid-line strokes per frame. Bake
// it once per (cols, rows) and blit. Rebuilds when the Growth
// curse changes column count.
// ============================================================

let _bgSprite = null;
let _bgKey = '';

function getBgSprite(cols, rows) {
  const key = `${cols}|${rows}`;
  if (_bgKey === key && _bgSprite) return _bgSprite;
  const w = cols * BLOCK;
  const h = rows * BLOCK;
  const canvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  if (canvas instanceof HTMLCanvasElement) { canvas.width = w; canvas.height = h; }
  const c = canvas.getContext('2d');
  c.fillStyle = COLORS.BG;
  c.fillRect(0, 0, w, h);
  c.strokeStyle = COLORS.GRID;
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 1; x < cols; x++) {
    c.moveTo(x * BLOCK + 0.5, 0);
    c.lineTo(x * BLOCK + 0.5, h);
  }
  for (let y = 1; y < rows; y++) {
    c.moveTo(0, y * BLOCK + 0.5);
    c.lineTo(w, y * BLOCK + 0.5);
  }
  c.stroke();
  _bgSprite = canvas;
  _bgKey = key;
  return _bgSprite;
}

// Public wrapper: cached fast path for board cells. Falls back to
// the raw painter for non-integer or one-off sizes (chisel/fill
// scaling animations).
export function drawBlock(ctx, px, py, size, color, ghost = false) {
  // The chisel-shatter animation passes continuously varying
  // sizes (size = BLOCK * scale). Caching every float would blow
  // the cache, so for off-integer requests we fall through to
  // the raw painter below.
  if (Number.isInteger(size) && size === Math.round(size)) {
    const sprite = getSprite(color, size, ghost);
    blitSprite(ctx, sprite, px, py);
    return;
  }
  drawBlockRaw(ctx, px, py, size, color, ghost);
}

// Slow path — paints a block from scratch. Same gradients/shadows
// as before; preserved verbatim so the sprite look is identical
// to what the game already shipped, and so the chisel-shatter
// animation (which scales blocks) can still call this directly.
function drawBlockRaw(ctx, px, py, size, color, ghost = false) {
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

// ============================================================
// Special blocks
// ============================================================
//
// Specials are painted with a cycling color drawn from the special's
// palette (replacing the underlying piece color outright — the eye
// should immediately read "this block is different"), plus an
// amplified glow halo and an optional rarity-scaled pulse on the
// scale.
//
// Sprite cache is intentionally bypassed: the color changes every
// frame, so caching every variant would blow the cache and never
// hit. There are at most ~5 special cells on screen at any given
// time, so the slow path is fine.

// Linear interpolation between two #rrggbb colors → another #rrggbb.
// drawBlockRaw routes the result through lighten/darken/withAlpha,
// every one of which calls back into hexToRgb — returning hex keeps
// the gradient pipeline happy AND keeps the cache key short.
function lerpColor(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r  = Math.round(ar + (br - ar) * t);
  const g  = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return '#' +
    r.toString(16).padStart(2, '0') +
    g.toString(16).padStart(2, '0') +
    bl.toString(16).padStart(2, '0');
}

// Pick the "current color" from a palette given a phase 0..1 cycling
// at `speed` cycles per second. Wraps around so the cycle is seamless.
//
// `local` is quantized to PALETTE_LERP_STEPS so the per-frame color
// lookup hits a bounded set of hex strings. Without this, every
// frame produces a unique hex; the _rgbCache (and any consumer that
// keys on color) would grow without bound during a long session.
const PALETTE_LERP_STEPS = 24;
function paletteAt(palette, timeMs, speed) {
  if (palette.length === 1) return palette[0];
  const phase = ((timeMs / 1000) * speed) % 1;            // 0..1
  const idx   = Math.floor(phase * palette.length);
  const localRaw = (phase * palette.length) - idx;        // 0..1 within slot
  const local = Math.round(localRaw * PALETTE_LERP_STEPS) / PALETTE_LERP_STEPS;
  const a = palette[idx];
  const b = palette[(idx + 1) % palette.length];
  return lerpColor(a, b, local);
}

// Paint one special block at pixel (px, py) of the requested size.
// `def` is the special's full definition (palette, animation, rarity).
// `timeMs` is a wallclock-style time source (performance.now() works).
function drawSpecialBlock(ctx, px, py, size, def, timeMs) {
  const vfx = RARITY_VFX[def.rarity] ?? RARITY_VFX.common;
  const color = paletteAt(def.palette, timeMs, def.animation?.speed ?? 1);
  const glowBoost = (def.animation?.glowBoost ?? 0) * vfx.glowMul;

  // Optional pulse: scale the cell down a hair and re-center so the
  // halo has room to breathe. Goes through the slow path either way.
  const pulse = vfx.pulse > 0
    ? 1 - vfx.pulse * (0.5 + 0.5 * Math.sin((timeMs / 1000) * Math.PI * 2 * (def.animation?.speed ?? 1)))
    : 1;
  const drawSize = size * pulse;
  const drawPx = px + (size - drawSize) / 2;
  const drawPy = py + (size - drawSize) / 2;

  // Render the gem with the cycled color, then layer an extra halo
  // ring on top so the special reads as "louder" than a normal cell.
  drawBlockRaw(ctx, drawPx, drawPy, drawSize, color, false);
  if (glowBoost > 0) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur  = Math.max(4, drawSize * (0.45 + glowBoost));
    ctx.strokeStyle = withAlpha(color, 0.9);
    ctx.lineWidth   = Math.max(1, drawSize * 0.06);
    const inset  = Math.max(1, drawSize * 0.08);
    const radius = Math.max(2, drawSize * 0.18);
    ctx.beginPath();
    ctx.roundRect(drawPx + inset, drawPy + inset, drawSize - inset * 2, drawSize - inset * 2, radius);
    ctx.stroke();
    ctx.restore();
  }
}

// Cell-coords convenience for the board loop.
function drawSpecialCell(ctx, x, y, def, timeMs) {
  drawSpecialBlock(ctx, x * BLOCK, y * BLOCK, BLOCK, def, timeMs);
}

// Paint the main playfield: background, grid lines, locked blocks,
// ghost outline, and active piece.
export function drawBoard(ctx, canvas, game) {
  // Read width from the board so the renderer follows runtime growth
  // (the Growth curse adds columns).
  const cols = game.board[0]?.length ?? COLS;

  // Background + grid: one drawImage instead of a fillRect plus
  // (cols-1)+(ROWS-1) stroke calls every frame. The sprite is
  // rebuilt only when the column count changes.
  ctx.drawImage(getBgSprite(cols, ROWS), 0, 0);

  // Single time source for every animated overlay this frame so all
  // specials cycle in phase with each other (and with future
  // animation passes that want a stable per-frame clock).
  const tNow = (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // locked blocks — dispatch to the special painter when boardSpecials
  // tags the cell. Specials replace the underlying piece color; the
  // standard sprite-cached path stays the hot path for everything else.
  const specials = game.boardSpecials;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < cols; c++) {
      if (!game.board[r][c]) continue;
      const tag = specials?.[r]?.[c];
      if (tag) {
        const def = SPECIALS_BY_ID[tag];
        if (def) {
          drawSpecialCell(ctx, c, r, def, tNow);
          continue;
        }
      }
      drawCell(ctx, c, r, COLORS[game.board[r][c]]);
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

  // Fill materialize animation (the new FILL cell is already drawn
  // by the locked-blocks pass above; this just adds the FX overlay).
  if (game.fill?.target) {
    drawFillShimmer(ctx, game.fill.target, game.fillProgress());
  }

  if (!game.current || game.gameOver) {
    // Still paint the chisel/fill cursor highlight even when there's
    // no active piece (e.g. between spawns). Late-return path.
    if (game.chisel?.active && game.chisel.cursor) {
      const onBlock = !!game.board[game.chisel.cursor.y]?.[game.chisel.cursor.x];
      drawChiselCursor(ctx, game.chisel.cursor, onBlock);
    }
    if (game.fill?.active && game.fill.cursor) {
      const onEmpty = !game.board[game.fill.cursor.y]?.[game.fill.cursor.x];
      drawFillCursor(ctx, game.fill.cursor, onEmpty);
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

  // current (active) piece — same dispatch rule as the locked-block
  // pass: if the mino at (r, c) carries a special, paint the cycled
  // visual instead of the piece's base color. specialAtPieceCell does
  // the rot-0 → current-rotation transform so the highlighted mino
  // follows rotates and flips automatically.
  for (let r = 0; r < s.length; r++) {
    for (let c = 0; c < s[r].length; c++) {
      if (!s[r][c]) continue;
      const x = game.current.x + c;
      const y = game.current.y + r;
      if (y < 0) continue;
      const tag = specialAtPieceCell(game.current, r, c);
      if (tag) {
        const def = SPECIALS_BY_ID[tag];
        if (def) {
          drawSpecialCell(ctx, x, y, def, tNow);
          continue;
        }
      }
      drawCell(ctx, x, y, COLORS[game.current.type]);
    }
  }

  // Chisel keyboard-cursor highlight — drawn LAST so it sits on top
  // of every piece and overlay. Only painted while awaiting a pick.
  if (game.chisel?.active && game.chisel.cursor) {
    const onBlock = !!game.board[game.chisel.cursor.y]?.[game.chisel.cursor.x];
    drawChiselCursor(ctx, game.chisel.cursor, onBlock);
  }

  // Fill keyboard-cursor highlight — same drawn-last rule. Fill is
  // the inverse of chisel: green when the cursor is on an empty cell
  // (Enter will fill it), red when over a filled cell or a cell
  // currently occupied by the active piece.
  if (game.fill?.active && game.fill.cursor) {
    const cx = game.fill.cursor.x;
    const cy = game.fill.cursor.y;
    const onFilled = !!game.board[cy]?.[cx];
    const onPiece  = game.isCellUnderActivePiece?.(cx, cy) ?? false;
    drawFillCursor(ctx, game.fill.cursor, !onFilled && !onPiece);
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
    // Use the slow path directly: continuously varying scale
    // would cache-miss every frame, so paint fresh.
    drawBlockRaw(ctx, px, py, size, color, false);
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

// Fill materialize effect — the placed FILL cell is drawn normally
// by the locked-blocks pass; this overlays a fading white flash plus a
// ring of sparkle particles converging *inward* (the visual opposite
// of chisel's outward shrapnel) so the block reads as something
// snapping into existence.
//   target   { x, y, timer }
//   progress 0..1
function drawFillShimmer(ctx, target, progress) {
  const cx = target.x * BLOCK + BLOCK / 2;
  const cy = target.y * BLOCK + BLOCK / 2;

  // 1. White flash overlay on the cell — bright at the moment of
  //    placement, fades out as the block settles.
  const flash = Math.max(0, 1 - progress);
  if (flash > 0) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${0.65 * flash})`;
    ctx.fillRect(target.x * BLOCK, target.y * BLOCK, BLOCK, BLOCK);
    ctx.restore();
  }

  // 2. Sparkle particles — start far out, converge to center as the
  //    animation progresses, fading as they arrive.
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 10;
  const N = 8;
  const maxDist = BLOCK * 1.8;
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2 + 0.2;
    const dist  = (1 - progress) * maxDist;
    const fx = cx + Math.cos(angle) * dist;
    const fy = cy + Math.sin(angle) * dist;
    // Particle radius peaks mid-animation — looks like sparkles
    // streaking in and snuffing out at the cell.
    const r  = Math.max(0.5, BLOCK * 0.12 * (1 - Math.abs(progress * 2 - 1)));
    ctx.globalAlpha = Math.max(0, 1 - Math.pow(progress, 2));
    ctx.beginPath();
    ctx.arc(fx, fy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Fill keyboard-cursor highlight — mirror of drawChiselCursor but
// with valid-target colors flipped (green = empty cell, red = filled
// or under the active piece). The shape and pulse are intentionally
// identical so the two power-ups feel like one selection mode in two
// flavors.
function drawFillCursor(ctx, cursor, onEmpty) {
  const px = cursor.x * BLOCK;
  const py = cursor.y * BLOCK;
  const t = (Date.now() % 700) / 700;
  const pulse = 0.7 + 0.3 * Math.abs(Math.sin(t * Math.PI));
  const color = onEmpty ? '#33ff66' : '#ff3030';

  ctx.save();
  ctx.fillStyle = onEmpty
    ? 'rgba(51, 255, 102, 0.22)'
    : 'rgba(255, 48, 48, 0.18)';
  ctx.fillRect(px, py, BLOCK, BLOCK);

  ctx.shadowColor = color;
  ctx.shadowBlur  = 22 * pulse;
  ctx.strokeStyle = color;
  ctx.globalAlpha = pulse;
  ctx.lineWidth   = 4;
  ctx.strokeRect(px + 2, py + 2, BLOCK - 4, BLOCK - 4);

  ctx.shadowBlur  = 0;
  ctx.globalAlpha = 1;
  ctx.lineWidth   = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(px + 5, py + 5, BLOCK - 10, BLOCK - 10);
  ctx.restore();
}

// Render a single piece centered inside a small canvas (hold / next preview).
//
// `specials` is optional — a list of `{ rot0Row, rot0Col, kind }` in
// the rot-0 frame, matching the shape PIECES[type][0] this preview
// always renders. When supplied, tagged minos paint with the cycling
// special palette instead of the piece's flat color, so a held
// special-bearing piece reads in the preview the same way it reads
// on the board.
export function drawMini(canvas, ctx, type, specials = null) {
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

  // Single time source for any special-cycling cells in this preview.
  const tNow = specials && specials.length > 0
    ? (typeof performance !== 'undefined' ? performance.now() : Date.now())
    : 0;

  for (let r = minR; r <= maxR; r++) {
    for (let cc = minC; cc <= maxC; cc++) {
      if (!shape[r][cc]) continue;
      const x = offX + (cc - minC) * cell;
      const y = offY + (r  - minR) * cell;
      // Specials are stored in rot-0 frame; the preview always paints
      // rot 0, so the rot0Row/rot0Col coords match the iteration
      // indices directly — no transformLocalCoord needed here.
      const tag = specials && specials.find(s => s.rot0Row === r && s.rot0Col === cc)?.kind;
      if (tag) {
        const def = SPECIALS_BY_ID[tag];
        if (def) {
          drawSpecialBlock(ctx, x, y, cell, def, tNow);
          continue;
        }
      }
      drawBlock(ctx, x, y, cell, COLORS[type]);
    }
  }
}
