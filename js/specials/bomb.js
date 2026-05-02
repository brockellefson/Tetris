// Special block: Bomb — when broken (line clear or chisel), wipes
// every cell in a square area centered on its position. The size of
// that square scales with the player's BOMB blessing level:
//
//   Level 1 → 3×3   (radius 1)
//   Level 2 → 4×4   (radius "1.5" — see square() below)
//   Level 3 → 5×5   (radius 2)
//
// The level is read from `game.unlocks.specials.bomb` at trigger
// time, so picking the Bomb blessing card a second/third time
// retroactively buffs every Bomb-tagged cell already on the board.
// If the slot is 0 (which only happens via the debug "Force Bomb"
// pill before the blessing has been picked), the bomb falls back to
// level 1 so the test pill always produces a visible detonation.
//
// Each blast cell that had a block fires onCellRemoved, so chained
// specials inside the blast zone detonate too: a bomb beside another
// Bomb-tagged cell chains outward; a bomb beside a Lightning tag
// strikes its column. The recursion always terminates because the
// special grid cell gets nulled inside fireSpecialAt before the
// trigger runs, so the re-entry guard there blocks loops.
//
// AFTER the carve, the gravity cascade is kicked off so any blocks
// left floating above the blast crater fall down to fill the void.
// Without this the bomb leaves an awkward suspended ledge hanging
// over a hole, which reads as buggy. startGravityCascade is
// idempotent — a chained bomb (or a Bomb-tagged cell living inside
// the blast zone) that re-enters it during an already-running
// cascade is a harmless no-op.
//
// Visuals: hot red → orange → white pulse, big halo. The cycle is
// fast enough to read as "ticking" against the cooler hues used by
// other specials, so the player can recognize the bomb at a glance.
//
// Trigger order between line-clear bombs and the line clear itself:
// the row containing the bomb is removed by removeRows BEFORE the
// trigger runs (specials' onClear hook fires last in completeClear).
// So the carve centered at the post-clear (x, y) ends up taking out
// the cells that were directly above the bomb at lock time. For
// chisel triggers there's no preceding row removal, so the carve is
// the literal area around the cell.

import { SHAKE_HARDDROP } from '../constants.js';
import { startGravityCascade } from '../effects/gravity-cascade.js';

// Resolve the (lower, upper) cell-offset bounds for an N×N square
// centered on a cell. Odd sizes (3, 5) are symmetric. Even sizes (4)
// are intentionally biased one cell down/right — there's no perfect
// "centered" 4×4 around a single cell, and a fixed bias keeps the
// blast deterministic across runs (vs. a coin-flip bias that would
// change the blast layout every detonation). The asymmetry is one
// cell, well within "expected splash damage" tolerance for the
// player's mental model.
function squareBounds(size) {
  const lower = -Math.floor((size - 1) / 2);
  const upper = lower + size - 1;
  return { lower, upper };
}

// Map blessing level → blast square size. Centralized so the debug
// menu / HUD readouts can call the same function and stay in sync.
export function bombSizeForLevel(level) {
  if (level >= 3) return 5;
  if (level === 2) return 4;
  return 3;            // level 0 (debug force) and level 1 both use 3×3
}

function detonate(game, cx, cy /*, source */) {
  const rows  = game.board.length;
  const cols  = game.board[0]?.length ?? 0;
  const level = game.unlocks?.specials?.bomb ?? 0;
  const size  = bombSizeForLevel(level);
  const { lower, upper } = squareBounds(size);
  for (let dy = lower; dy <= upper; dy++) {
    for (let dx = lower; dx <= upper; dx++) {
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
  // satisfying boom rather than stacking shake on shake. Larger
  // bombs get a slightly heavier shake so the player feels the
  // upgrade, but cap before it becomes seasick.
  game.triggerShake?.(SHAKE_HARDDROP + 2 + (size - 3) * 0.6);
  // Drop everything above the crater. The cascade engine runs the
  // standard fall → settle → maybe-clear pipeline, so any rows
  // completed by the falling debris score and trigger their own
  // specials normally. Idempotent across chained bombs: only the
  // first call into the cascade per detonation actually starts one.
  startGravityCascade(game);
}

export default {
  id: 'bomb',
  name: 'Bomb',
  // The description is shown on the BOARD-side debug pill / future HUD
  // detail surface, NOT the blessing card (that lives in the powerup
  // file with per-level wording). Kept generic so it's still accurate
  // at any unlocked level.
  description:
    'When this block breaks, every cell in the surrounding square is destroyed.',
  rarity: 'common',
  // Hot ember palette — saturated red into ember orange into bright
  // white. Reads as "danger / ticking" against the cooler neon hues
  // used by Lightning (cyan).
  palette: ['#ff1f3a', '#ff7a1a', '#ffe066'],
  animation: {
    speed: 2.4,       // faster cycle than other specials — feels live/ticking
    glowBoost: 0.7,
  },
  available: () => true,
  onTrigger: (game, x, y, source) => detonate(game, x, y, source),
};
