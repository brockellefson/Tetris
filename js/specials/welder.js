// Special block: Welder — when broken (line clear or chisel), fills
// holes on the board with patch blocks. Defensive special — counter-
// balances the destructive Bomb / Lightning by SOLIDIFYING the stack
// rather than tearing it up. Pairs especially well with a buried hole
// the player can't reach by chisel.
//
// Behavior scales with the player's WELDER blessing level:
//
//   Level 1 → fills the SINGLE deepest hole on the board.
//   Level 2 → fills the 3 deepest holes on the board.
//   Level 3 ("The Patch") → fills every empty cell with at least 3
//                           sides covered. Welds the surface into a
//                           solid foundation.
//
// "Hole" = an empty cell that has at least one filled cell above it
// in the same column. "Deepest" = the hole with the most filled cells
// stacked above it (the one buried hardest under the player's stack
// — the one most likely to ruin a future Tetris).
//
// "Sides covered" for level 3: each of the cell's four neighbors
// counts as covered if it's filled OR out-of-bounds in a direction
// that maps to a wall. The TOP of the board is open sky, so an
// out-of-bounds-up neighbor does NOT count. So a corner-of-the-floor
// empty cell already has bottom + left covered just from the walls,
// and only needs ONE filled neighbor (top or right) to qualify.
//
// Welded cells use the FILL piece type — same lavender-white the Fill
// power-up paints with. That keeps welds compatible with everything
// that already understands FILL (rendering, line clears, chisel) AND
// reads visually as "the player's wax/patch" rather than a stuck
// piece-colored block. Distinct from Bomb's red and Lightning's cyan
// so the welder's identity is constructive, not destructive.
//
// Trigger order: welder fires from the same beforeClear → onClear
// pipeline as Bomb / Lightning, so the row containing the welder has
// already been removed by the time onTrigger runs and `findHoles`
// sees post-clear board state. For chisel triggers there's no
// preceding row removal — `findHoles` operates on the live board with
// just the welder's own cell already nulled.

import { startGravityCascade } from '../effects/gravity-cascade.js';

// Find every "hole" on the board — empty cells with at least one
// filled cell above them in the same column. Each entry is annotated
// with its `depth` = the count of filled cells stacked directly above
// (the higher the depth, the more buried the hole is). Order is
// arbitrary; the caller sorts as needed.
function findHoles(board) {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  const holes = [];
  for (let c = 0; c < cols; c++) {
    // Walk down the column tracking how many filled cells we've seen.
    // The first empty cell after a filled cell starts the holes; from
    // that point on every subsequent empty cell in the column is a
    // hole, with `seen` as its depth.
    let seen = 0;
    for (let r = 0; r < rows; r++) {
      if (board[r][c]) { seen++; continue; }
      if (seen > 0) holes.push({ x: c, y: r, depth: seen });
    }
  }
  return holes;
}

// Count how many of the cell's four sides are "covered" — filled or
// out-of-bounds in the wall directions (left / right / bottom). The
// top of the board is open sky and does NOT count when y < 0.
function sidesCovered(board, x, y) {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  let count = 0;
  // Top: out-of-bounds (y - 1 < 0) is sky — not covered. Filled is.
  if (y - 1 >= 0 && board[y - 1][x]) count++;
  // Bottom: out-of-bounds (past the floor) IS covered.
  if (y + 1 >= rows || board[y + 1][x]) count++;
  // Left wall.
  if (x - 1 < 0 || board[y][x - 1]) count++;
  // Right wall.
  if (x + 1 >= cols || board[y][x + 1]) count++;
  return count;
}

// Compute the list of cells the welder should fill given the current
// level. Centralized so the debug surface and any future weld-preview
// HUD share one source of truth. Returns an array of { x, y } in the
// order they should be welded (no overlap by construction).
function targetCells(game, level) {
  const board = game.board;
  if (level >= 3) {
    // The Patch — every empty cell with 3+ sides covered. Walks the
    // whole grid; cheap on a 20×10 board, and avoids the
    // findHoles-then-filter detour (a corner empty cell at the floor
    // can hit 3 sides without any block above it in the column, so
    // it's NOT a "hole" in findHoles's sense — but it IS a candidate
    // for the patch).
    const out = [];
    const rows = board.length;
    const cols = board[0]?.length ?? 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c]) continue;
        if (sidesCovered(board, c, r) >= 3) out.push({ x: c, y: r });
      }
    }
    return out;
  }
  // Levels 1 and 2 — N deepest holes. Sort by depth desc (deepest
  // first), tiebreak by y desc (the lower hole wins) so the choice
  // is deterministic when multiple holes tie on depth — important
  // for any future replay tooling.
  const holes = findHoles(board);
  if (holes.length === 0) return [];
  holes.sort((a, b) => (b.depth - a.depth) || (b.y - a.y));
  const n = level >= 2 ? 3 : 1;
  return holes.slice(0, n);
}

function weld(game /*, cx, cy, source */) {
  // Default to level 1 if the slot is 0 — only happens via the debug
  // "Force Welder" pill before the blessing has been picked, and we
  // want the test pill to always produce a visible weld.
  const level = Math.max(1, game.unlocks?.specials?.welder ?? 0);
  const cells = targetCells(game, level);
  if (cells.length === 0) return;
  for (const { x, y } of cells) {
    // Defensive guard: targetCells doesn't return duplicates, but a
    // future caller might (e.g. a chained weld off another special's
    // trigger). Skip cells already filled so we never overwrite a
    // tagged block with FILL — would silently desync `boardSpecials`.
    if (game.board[y][x]) continue;
    game.board[y][x] = 'FILL';
  }
  // Run the standard fall → maybe-clear pipeline. Nothing's actually
  // floating after a weld — the fall step is a no-op — but if any
  // welds completed rows, the cascade picks them up and clears them
  // through the standard scoring path. Idempotent across chained
  // specials, so a weld inside an existing cascade no-ops cleanly.
  startGravityCascade(game);
}

export default {
  id: 'welder',
  name: 'Welder',
  description:
    'When this block breaks, fills the deepest hole(s) on the board with patches.',
  // Rare — Welder is a strong defensive utility that turns "this run
  // is ruined" into "let me weld that and keep going." The weight is
  // tuned to keep it a meaningful surprise rather than a constant
  // safety net.
  rarity: 'rare',
  // Lavender-cream → arc-weld gold → bright white peak. Distinct from
  // Bomb's hot red and Lightning's electric cyan — the eye should
  // read "constructive" rather than "destructive." The white peak
  // alludes to the flash of an arc weld.
  palette: ['#ead6ff', '#ffd96b', '#ffffff'],
  animation: {
    speed: 2.0,         // a steady pulse — neither tense (Bomb) nor frantic (Lightning)
    glowBoost: 0.55,
  },
  available: () => true,
  onTrigger: (game, x, y, source) => weld(game, x, y, source),
};
