// ============================================================
// Color Lock (Puyo versus blessing)
// ============================================================
//
// Effect: when picked, a random color is chosen and your
// opponent's next 5 spawned pairs cannot contain that color.
// Picks STACK across colors — the second pick locks a different
// random color for its own fresh 5-drop window, the third locks
// a third, and so on. Each per-color lock runs an independent
// timer; when one expires the others keep counting down.
//
// If a stack of picks ever locks ALL five PUYO_COLORS at once,
// the opponent has no legal color to spawn. Instead of crashing
// (or silently picking from an empty pool) we hand them a JUNK
// pair: pivot and satellite both 'N', the same nuisance gray
// the versus garbage queue uses. The pair rotates and locks like
// any other piece, but the cells don't form chains — the only
// way to clear them is splash damage from an adjacent matched
// group, exactly like incoming garbage. While the all-locked
// state holds, per-color timers FREEZE; the punishment persists
// until something outside this card lifts a lock.
//
// Why it's strong:
//   • Disrupts setups. A 4-chain plan that needed Red can collapse
//     when Red stops spawning.
//   • Doesn't affect your side at all — you keep playing while
//     the opponent's options narrow.
//   • Multi-pick pressure compounds: each fresh pick removes
//     another color, narrowing their pool until eventually only
//     gray cells fall.
//
// Why it's not broken:
//   • Random color. You can't target the color the opponent's
//     setup needs.
//   • Each lock is only 5 drops, then it expires.
//   • Reaching all-five-locked requires careful pick selection
//     (5 distinct rolls) and the opponent has 5 spawns per fresh
//     pick to chain into the colors that are still legal.
//
// Implementation: two sides.
//
//   Sender (the picker's tab) — apply() rolls a random hint
//   color and broadcasts a 'color_lock' event over the match
//   channel. Doesn't touch local state — Color Lock has zero
//   effect on the player who picks it.
//
//   Receiver (the opponent's tab) — local-vs subscribes to the
//   'color_lock' event and folds the new lock into
//   game._pluginState.colorLock.locks. Prefers the sender's hint
//   if it's not already locked; otherwise picks any unlocked
//   color; otherwise refreshes one of the existing locks. This
//   card's decoratePiece hook reads the locks map, rerolls any
//   spawned-pair cells whose color is currently locked, and
//   decrements every active lock once per pair. After 5 drops
//   each color's lock lapses independently.
//
// The card's plugin-state slot lives on EVERY tab even though
// only the receiver writes meaningful values into it — the slot
// just sits at { locks: {} } on the sender's tab. Cleanest
// implementation; avoids special-casing who owns the slot.

import { PUYO_COLORS } from '../pieces.js';
import { sendVersusMessage } from '../versus/garbage-plugin.js';

const DROPS_LOCKED = 5;

export default {
  id: 'color-lock',
  // Display name is "Lock" — short, readable in the narrow card
  // strip. Internal id stays 'color-lock' so plugin-state slots
  // and wire events keep their current names.
  name: 'Lock',
  description: "Block a color from opponent's next 5 pairs. Stacks — lock all 5 and they spawn junk.",

  modes: ['puyo-versus'],

  // ---- Card shape ----

  // Always available — every pick rolls a fresh color and
  // stacks against any locks already in flight.
  available: () => true,

  apply(_game) {
    // The hint is advisory. The receiver makes the final call
    // about which color gets locked, because only the receiver
    // knows what's already in their locks map. Sending the hint
    // anyway keeps the wire payload stable and lets the receiver
    // honor a "this color is preferred" suggestion when possible.
    const color = PUYO_COLORS[Math.floor(Math.random() * PUYO_COLORS.length)];
    sendVersusMessage('color_lock', { color, drops: DROPS_LOCKED });
  },

  // ---- Plugin lifecycle ----

  reset(game) {
    // Locks map: { [color]: remainingDrops }. Empty by default;
    // the receiver-side handler in local-vs.js writes into it on
    // every 'color_lock' event. A color with remaining <= 0 is
    // pruned from the map by decoratePiece, so checking
    // Object.keys(locks).length is a reliable "is anything
    // locked?" test.
    game._pluginState.colorLock = { locks: {} };
  },

  // Receiver-side mutation. We deliberately use Math.random for
  // any reroll instead of the seeded puyo RNG — the seeded RNG
  // is shared between the two tabs for fair piece sequences, and
  // consuming a tick of it here would desync the other player's
  // pairs from ours. Math.random() is local-only and harmless.
  //
  // Decrement policy: each active lock ticks down once per pair
  // (not just pairs that would have rolled the locked color), so
  // every lock window is a flat 5 spawns of disruption. The
  // EXCEPTION is the all-locked state — when every PUYO_COLOR is
  // in the locks map, the spawn becomes a junk pair and we
  // FREEZE the timers so the punishment persists. Once an
  // outside lift drops the count below 5, the remaining locks
  // resume ticking on the next pair.
  decoratePiece(game, piece) {
    const s = game._pluginState.colorLock;
    if (!s || !s.locks) return piece;
    if (piece?.kind !== 'pair') return piece;

    const lockedColors = Object.keys(s.locks).filter(c => s.locks[c] > 0);
    if (lockedColors.length === 0) return piece;

    if (lockedColors.length >= PUYO_COLORS.length) {
      // All colors locked → junk pair. The renderer reads
      // piece.pivot / piece.satellite directly through COLORS,
      // and 'N' is already wired to the nuisance gray, so no
      // renderer change is needed. The board's match policy
      // excludes 'N' from chain matching, matching the behavior
      // of incoming versus garbage exactly.
      piece.pivot     = 'N';
      piece.satellite = 'N';
      return piece;
    }

    // Partial lock — reroll any cells currently in the locked
    // set, then tick each active lock down by 1.
    const lockedSet = new Set(lockedColors);
    const safe      = PUYO_COLORS.filter(c => !lockedSet.has(c));
    if (lockedSet.has(piece.pivot)) {
      piece.pivot = safe[Math.floor(Math.random() * safe.length)];
    }
    if (lockedSet.has(piece.satellite)) {
      piece.satellite = safe[Math.floor(Math.random() * safe.length)];
    }

    for (const color of lockedColors) {
      s.locks[color] -= 1;
      if (s.locks[color] <= 0) delete s.locks[color];
    }
    return piece;
  },
};
