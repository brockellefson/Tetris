// ============================================================
// Color Blind (Puyo versus blessing)
// ============================================================
//
// Effect: every locked block on the opponent's board renders as
// nuisance gray for the next 3 piece placements they make. They
// can still see WHERE blocks are (the shapes are intact), but
// they can't tell which colors match anymore — chain planning
// gets a lot harder for the duration.
//
// What stays visible to the opponent:
//   • Shape + position of every locked cell.
//   • The active piece they're holding (so they don't drop blind).
//   • The Next preview pairs (so they can still plan ahead).
//   • Their pivot dot (so rotation reads correctly).
//
// What grays out:
//   • Locked cells on the board.
//
// Why it's strong:
//   • Disrupts mid-chain planning — they're staring at a board
//     that looks half-cleared but they can't read it.
//   • Doesn't slow them down or take away cards; pure cognitive
//     pressure.
//
// Why it's not broken:
//   • Only 3 placements. The opponent can stall with throwaway
//     drops while waiting for it to expire if they want to play
//     defensively.
//   • Doesn't combo with itself meaningfully — a second Color
//     Blind during an active one just refreshes the timer.
//
// Implementation: two sides.
//
//   Sender — apply() broadcasts 'color_blind' { placements: 3 }.
//   No local effect.
//
//   Receiver — local-vs subscribes to 'color_blind' and writes
//   game._pluginState.colorBlind = { remaining }. This card's
//   onLock hook decrements that counter once per piece placed
//   (the lock is the canonical "I just placed a piece" event).
//   render.js's drawBoard reads the slot and substitutes the
//   nuisance gray when remaining > 0.

import { sendVersusMessage } from '../versus/garbage-plugin.js';

const PLACEMENTS_BLIND = 3;

export default {
  id: 'color-blind',
  name: 'Color Blind',
  description: "Gray out opponent's board for 3 placements.",

  modes: ['puyo-versus'],

  // ---- Card shape ----

  // Always available — pickable repeatedly. A second pick during
  // an active blind just refreshes the timer back to full
  // (overwrite via the receiver subscription in local-vs).
  available: () => true,

  apply(_game) {
    sendVersusMessage('color_blind', { placements: PLACEMENTS_BLIND });
  },

  // ---- Plugin lifecycle ----

  reset(game) {
    game._pluginState.colorBlind = { remaining: 0 };
  },

  // Decrement on every piece lock — that's the canonical
  // "I just placed a piece" beat. Fires once per piece even
  // through cascades (the cascade nulls game.current and
  // doesn't re-lock), so the count tracks placements, not
  // chain steps.
  onLock(game) {
    const s = game._pluginState.colorBlind;
    if (!s || s.remaining <= 0) return;
    s.remaining -= 1;
  },
};
