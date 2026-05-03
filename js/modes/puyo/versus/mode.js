// ============================================================
// PUYO_VERSUS_MODE — Puyo, but with a live opponent
// ============================================================
//
// Identical to PUYO_MODE in mechanics: same board, same pieces,
// same match policy, same gravity, same HUD vocabulary. The only
// thing that changes is the mode `id` — this lets the garbage
// plugin (`modes: ['puyo-versus']`) gate cleanly without firing
// in single-player Puyo.
//
// What versus mode adds, by virtue of activating its plugins:
//   • Outgoing nuisance: chains compute and send 'garbage' events
//     through the match controller (see versus/garbage-plugin.js).
//   • Incoming nuisance: 'garbage' events buffer and drop on the
//     player's next spawn, courtesy of the same plugin.
//   • Win condition: when game.gameOver flips, main.js's match
//     wiring sends 'i_lost' over the channel; the receiving tab
//     paints YOU WIN.
//
// What it does NOT add (yet):
//   • Opponent rendering. The OPPONENT's field isn't drawn on your
//     screen in Phase 2 — you only see your own field plus
//     incoming garbage drops. Phase 4+ adds a state_diff event +
//     a mini-board for the opponent's stack.
//   • Garbage offset. Real Puyo lets your outgoing chain "cancel"
//     incoming nuisance. Phase 2 just accumulates both directions
//     independently.
//
// Both omissions are tunable on top of this same bundle later —
// no architectural change needed.

import { PUYO_MODE } from '../mode.js';

export const PUYO_VERSUS_MODE = {
  ...PUYO_MODE,
  id: 'puyo-versus',
  // Versus inherits SP's card pool (when it exists) but turns OFF
  // bundled curses — the opponent's chains are the counterforce in
  // versus, layering an extra curse on every blessing pick would
  // dilute the back-and-forth. Empty pool today; replaced when
  // versus-only cards (Counter Strike, Shield, Garbage Redirect,
  // etc.) land alongside the SP pool.
  cards: {
    ...PUYO_MODE.cards,
    bundleCurses: false,
  },
};
