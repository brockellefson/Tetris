// Curse: Rain — one-time event. The instant the curse is picked,
// 5-10 junk blocks rain down onto the board. Each block lands on
// top of whatever is already stacked in its column (as if it were
// hard-dropped), so the rubble accumulates from the bottom up
// rather than spawning at the ceiling. Multiple drops can stack
// on the same column.
//
// State + logic both live here now: the board mutation is a private
// function in this module since Rain is the only caller. There is
// no persistent flag — the curse is purely event-driven, hence no
// HUD tag and nothing for Dispell to remove.

import { collides } from '../board.js';

// Drop 5-10 blocks into random columns, one at a time. Each drop
// independently picks any column with headroom right now, so the
// same column can stack up under multiple raindrops. Avoids landing
// inside the active piece to prevent unfair instant overlaps.
function dropBlocks(game) {
  const ROWS = game.board.length;
  const COLS = game.board[0]?.length ?? 10;
  const want = 5 + Math.floor(Math.random() * 6); // 5-10
  let placed = 0;
  for (let i = 0; i < want; i++) {
    const candidates = [];
    for (let c = 0; c < COLS; c++) {
      if (!game.board[0][c]) candidates.push(c);
    }
    if (candidates.length === 0) break;
    const c = candidates[Math.floor(Math.random() * candidates.length)];
    // Find the topmost filled cell in this column; the junk lands
    // one row above it. Empty column → land on the floor.
    let landingRow = ROWS - 1;
    for (let r = 0; r < ROWS; r++) {
      if (game.board[r][c]) { landingRow = r - 1; break; }
    }
    if (landingRow < 0) continue;                       // packed full
    if (game.isCellUnderActivePiece(c, landingRow)) continue;
    game.board[landingRow][c] = 'JUNK';
    placed += 1;
  }
  // Defensive — landing on top of the stack shouldn't intersect the
  // active piece, but if a placement *did* land under one (e.g. the
  // piece is mid-soft-drop above an empty column), end the run.
  if (game.current && collides(game.board, game.current)) {
    game.gameOver = true;
  }
  return placed;
}

export default {
  id: 'curse-rain',
  name: 'Rain',
  description: '5-10 junk blocks rain down and stack on top of the pile.',
  available: () => true,
  apply: (game) => {
    const placed = dropBlocks(game);
    if (placed > 0) game.onRain?.(placed);
  },
};
