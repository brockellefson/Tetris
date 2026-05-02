// Special block: Lightning — when broken (line clear or chisel),
// clears every cell in the same column. Each cleared cell with a
// special detonates via onCellRemoved, so chained bombs / gravity
// tags / future specials inside the column fire too.
//
// Synergy: a Lightning-tagged piece placed adjacent to a Gravity-
// tagged piece on the same row produces a beautiful combo. The line
// clears, both specials trigger, the cascade runs, and the column-
// shaped void Lightning carved is filled by falling blocks above it
// — often completing more lines and triggering more specials in
// turn. The architecture handles this for free: the cascade engine's
// completeCascadeClear runs the same beforeClear → onClear pipeline
// as a player-driven clear, so any specials it surfaces dispatch
// through the same code path.
//
// Visuals: cyan → white → blue cycle, fast pulse (electric flicker
// rather than the slower color shift Gravity uses). The brief shake
// on trigger reads as the thunder following the strike.

import { SHAKE_HARDDROP } from '../constants.js';

function strike(game, cx /*, cy, source */) {
  const rows = game.board.length;
  const cols = game.board[0]?.length ?? 0;
  if (cx < 0 || cx >= cols) return;
  // Walk top-to-bottom so a debug observer sees a natural strike
  // direction. The board mutation is synchronous so the order has
  // no gameplay effect — only matters if a future listener cares
  // about the sequence (e.g., a per-cell sparkle particle render).
  for (let y = 0; y < rows; y++) {
    if (!game.board[y][cx]) continue;
    game.board[y][cx] = null;
    game._notifyPlugins('onCellRemoved', cx, y, 'lightning');
  }
  // Slightly less shake than a bomb — Lightning is sharp and
  // surgical, not a wide blast. Bomb's intensity reads as concussive,
  // Lightning's as a precise crack.
  game.triggerShake?.(SHAKE_HARDDROP);
}

export default {
  id: 'lightning',
  name: 'Lightning',
  description:
    'When this block breaks, the entire column it sits in is destroyed.',
  rarity: 'uncommon',
  // Electric-ice palette — cyan-white-blue. Distinct from Gravity's
  // warm gold and Bomb's hot red, so a glance at the board tells the
  // player what's loaded where.
  palette: ['#00f0ff', '#ffffff', '#3a6dff'],
  animation: {
    speed: 3.2,       // fastest cycle of the three — reads as electric flicker
    glowBoost: 0.6,
  },
  available: () => true,
  onTrigger: (game, x, y, source) => strike(game, x, y, source),
};
