// Special block: Bomb — when broken (line clear or chisel), wipes
// every cell in the 3×3 area centered on its position. Each blast
// cell that had a block fires onCellRemoved, so chained specials
// inside the blast zone detonate too: a bomb beside a Gravity tag
// kicks off the cascade; a bomb beside another bomb chains
// outward; a bomb beside a Lightning tag clears its column. The
// recursion always terminates because the special grid cell gets
// nulled inside fireSpecialAt before the trigger runs, so the
// re-entry guard there blocks loops.
//
// Visuals: hot red → orange → white pulse, big halo. The cycle is
// fast enough to read as "ticking" against the cooler hues used by
// other specials, so the player can recognize the bomb at a glance.
//
// Trigger order between line-clear bombs and the line clear itself:
// the row containing the bomb is removed by removeRows BEFORE the
// trigger runs (specials' onClear hook fires last in completeClear).
// So the 3×3 centered at the post-clear (x, y) ends up carving out
// the cells that were directly above the bomb at lock time. For
// chisel triggers there's no preceding row removal, so the 3×3 is
// the literal 3×3 around the cell.

import { SHAKE_HARDDROP } from '../constants.js';

function detonate(game, cx, cy, source) {
  const rows = game.board.length;
  const cols = game.board[0]?.length ?? 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (y < 0 || y >= rows || x < 0 || x >= cols) continue;
      // Skip empty cells — onCellRemoved is "this filled cell just
      // got removed," and firing it for a cell that was already
      // empty would muddy the contract for any future listener.
      if (!game.board[y][x]) continue;
      game.board[y][x] = null;
      // Chain: any special living in a blast cell detonates next.
      // The fan-out goes through the standard onCellRemoved hook
      // so chisel + cascade + future single-cell removers all share
      // one chokepoint.
      game._notifyPlugins('onCellRemoved', x, y, 'bomb');
    }
  }
  // Punchy shake — same scale as a hard drop so the bomb reads as
  // an event of comparable weight. triggerShake overwrites prior
  // shake intensities, so a chained bomb cluster produces one
  // satisfying boom rather than stacking shake on shake.
  game.triggerShake?.(SHAKE_HARDDROP + 2);
}

export default {
  id: 'bomb',
  name: 'Bomb',
  description:
    'When this block breaks, every cell in the 3×3 around it is destroyed.',
  rarity: 'common',
  // Hot ember palette — saturated red into ember orange into bright
  // white. Reads as "danger / ticking" against the cooler neon hues
  // used by Gravity (gold) and Lightning (cyan).
  palette: ['#ff1f3a', '#ff7a1a', '#ffe066'],
  animation: {
    speed: 2.4,       // faster cycle than Gravity — feels live/ticking
    glowBoost: 0.7,
  },
  available: () => true,
  onTrigger: (game, x, y, source) => detonate(game, x, y, source),
};
