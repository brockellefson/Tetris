// Special block: Lightning — when broken (line clear or chisel),
// destroys cells in a pattern that scales with the player's LIGHTNING
// blessing level:
//
//   Level 1 → every cell ABOVE this one in the same column.
//   Level 2 → the entire column (above AND below).
//   Level 3 → the entire column AND the entire row.
//
// The level is read from `game.unlocks.specials.lightning` at trigger
// time, so picking the Lightning blessing card a second/third time
// retroactively buffs every Lightning-tagged cell already on the board.
// If the slot is 0 (which only happens via the debug "Force Lightning"
// pill before the blessing has been picked), the strike falls back to
// level 1 so the test pill always produces a visible effect.
//
// Each cleared cell with a special detonates via onCellRemoved, so
// chained bombs / future specials inside the strike pattern fire too.
// A Bomb-tagged cell on a Lightning-cleared row chains satisfying
// damage; a Lightning-tagged cell hit by another Lightning re-strikes
// once and stops (the trigger nulls the cell before the recursion
// runs, so any second pass over the same cell is a no-op).
//
// Synergy with line clears: a Lightning-tagged piece placed adjacent
// to a Bomb-tagged piece on the same row produces a beautiful combo.
// The line clears, both specials trigger, the cascade runs, and the
// column-shaped void Lightning carved is filled by falling blocks
// above it — often completing more lines and triggering more specials
// in turn. The architecture handles this for free: the cascade engine's
// completeCascadeClear runs the same beforeClear → onClear pipeline
// as a player-driven clear, so any specials it surfaces dispatch
// through the same code path.
//
// Visuals: cyan → white → blue cycle, fast pulse (electric flicker
// rather than the slower color shift other specials use). The brief
// shake on trigger reads as the thunder following the strike.

import { SHAKE_HARDDROP } from '../constants.js';

// Remove a single cell at (x, y) if it's filled, fanning out the
// onCellRemoved hook so chained specials in the strike pattern fire.
// Centralized so the four pattern variants below all share one carve
// path — keeps destruction-scoring (which lives on onCellRemoved in
// specials/index.js) consistent regardless of which level fired the
// strike.
function carve(game, x, y) {
  const rows = game.board.length;
  const cols = game.board[0]?.length ?? 0;
  if (x < 0 || x >= cols || y < 0 || y >= rows) return;
  if (!game.board[y][x]) return;
  game.board[y][x] = null;
  game._notifyPlugins('onCellRemoved', x, y, 'lightning');
}

// Strike patterns — each takes (game, cx, cy) and walks every cell
// the level should remove, calling carve() per cell. Deliberately
// keep the cell at (cx, cy) inside the strike for ALL levels: the
// trigger pipeline has already nulled the lightning's own cell in
// `fireSpecialAt` before onTrigger runs, so the carve at (cx, cy) is
// just a harmless no-op (board cell is already null) — but having it
// inside the loop keeps the pattern math symmetric and easy to read.
function strikeAbove(game, cx, cy) {
  for (let y = 0; y <= cy; y++) carve(game, cx, y);
}
function strikeBelow(game, cx, cy) {
  const rows = game.board.length;
  for (let y = cy; y < rows; y++) carve(game, cx, y);
}
function strikeRow(game, cx, cy) {
  const cols = game.board[0]?.length ?? 0;
  for (let x = 0; x < cols; x++) carve(game, x, cy);
}

function strike(game, cx, cy /*, source */) {
  const cols = game.board[0]?.length ?? 0;
  if (cx < 0 || cx >= cols) return;
  const level = game.unlocks?.specials?.lightning ?? 0;
  // Level 1 → above only.
  // Level 2 → above + below (full column).
  // Level 3 → above + below + entire row.
  // The carves are additive: each upgrade is "level N - 1's pattern,
  // plus one more axis." Same cell hit twice is harmless (carve()
  // bails on already-null cells), so the row pass at L3 freely
  // overlaps the column pass.
  strikeAbove(game, cx, cy);
  if (level >= 2) strikeBelow(game, cx, cy);
  if (level >= 3) strikeRow(game, cx, cy);
  // Slightly less shake than a bomb — Lightning is sharp and
  // surgical, not a wide blast. Bomb's intensity reads as concussive,
  // Lightning's as a precise crack. Bump the intensity a hair at
  // higher levels so the player feels the upgrade.
  game.triggerShake?.(SHAKE_HARDDROP + (level - 1) * 0.6);
}

export default {
  id: 'lightning',
  name: 'Lightning',
  // Generic across levels — the per-level wording lives on the
  // blessing-card definition in js/powerups/specials.js.
  description:
    'When this block breaks, it sends a strike through the column (and at higher levels, the row).',
  rarity: 'uncommon',
  // Electric-ice palette — cyan-white-blue. Distinct from Bomb's hot
  // red, so a glance at the board tells the player what's loaded where.
  palette: ['#00f0ff', '#ffffff', '#3a6dff'],
  animation: {
    speed: 3.2,       // fast cycle — reads as electric flicker
    glowBoost: 0.6,
  },
  available: () => true,
  onTrigger: (game, x, y, source) => strike(game, x, y, source),
};
