// ============================================================
// Lucky Draw (Puyo blessing)
// ============================================================
//
// Effect: each pick adds one charge. The next charge-many pairs
// spawn as monochrome (pivot and satellite share a color), and a
// "LUCKY DRAW!" banner pops to celebrate. The color is rolled
// randomly per draw — it's not a player-chosen color, just a
// guaranteed-matching pair.
//
// Difference from the old "Lucky Pair" version: that one was a
// permanent toggle. This one is a stackable one-shot, which:
//   • lets the player save up powerful drops for big chain setups
//   • doesn't permanently dilute the puzzle (you still play with
//     normal mixed pairs the rest of the time)
//   • produces a clear visible event (the banner) every time it
//     fires, so the value of the card is felt
//
// Implementation: the card carries two methods on top of the
// usual { id, name, description, available, apply } shape — a
// reset hook to claim the plugin-state slot, and a decoratePiece
// hook that consumes one charge per spawned pair and forces the
// satellite color to match the (random) pivot color.

import { PUYO_COLORS } from '../pieces.js';

export default {
  id: 'lucky-draw',
  name: 'Lucky Draw',
  description: 'Next pair drops as a matching-color pair. Stacks.',

  modes: ['puyo', 'puyo-versus'],

  // ---- Card shape ----

  // Always available — stackable. Each pick adds a charge.
  available: () => true,

  apply(game) {
    if (!game._pluginState.luckyDraw) {
      game._pluginState.luckyDraw = { charges: 0 };
    }
    game._pluginState.luckyDraw.charges += 1;
  },

  // ---- Plugin lifecycle ----

  reset(game) {
    game._pluginState.luckyDraw = { charges: 0 };
  },

  // decoratePiece runs inside spawnNext between spawn(type) and
  // the assignment to game.current. We mutate in place AND return
  // the piece (the hook is value-threading, so subsequent
  // plugins layer on top of our mutation). When charges run out
  // we leave the piece untouched and the player gets normal
  // random pairs again.
  decoratePiece(game, piece) {
    const s = game._pluginState.luckyDraw;
    if (!s || s.charges <= 0) return piece;
    if (piece?.kind !== 'pair') return piece;
    // Reroll the pair's color so the lucky draw feels like a
    // fresh draw, not "your existing pair, but mono." Both halves
    // become the same uniformly-random color.
    const color = PUYO_COLORS[Math.floor(Math.random() * PUYO_COLORS.length)];
    piece.pivot     = color;
    piece.satellite = color;
    piece.luckyDraw = true; // marker for the renderer / hud
    s.charges -= 1;
    // Fire the celebratory banner. Wired in main.js to
    // hud.notify('LUCKY DRAW!', 'tetris') — reuses the existing
    // tetris-clear style (gold + glow) since it's the same
    // "rare big moment" feel.
    game.onLuckyDraw?.();
    return piece;
  },
};
