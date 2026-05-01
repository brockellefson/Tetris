// Power-up: Fill — grants a banked charge that lets the player
// fill a single empty cell with a 1×1 block. Inverse of Chisel.
//
// Internally still wired through `game.fill.*` and the
// `fillSelect` / `fillComplete` flow — this file only renames
// the player-visible card. If you want to rename the internals
// too, sweep js/game.js, js/input.js, js/main.js, js/render.js,
// and js/constants.js for `fill` / `Fill` / `FILL`.
//
// The interaction is split across four layers (mirrors chisel.js):
//
//   1. apply()           — bumps `game.unlocks.fillCharges` (capped at
//                          MAX_FILL_CHARGES). Picking the card no
//                          longer freezes the game; the charge sits in
//                          inventory until the player decides to spend it.
//
//   2. S keypress        — input.js calls game.tryActivateFill(),
//                          which spends one charge and sets
//                          `game.fill.active = true`. The Game's
//                          tick() then freezes gameplay until the
//                          player picks a cell.
//
//   3. main.js click /
//      keyboard cursor   — translates the click or Enter into a
//                          (col, row) and calls game.fillSelect.
//                          An empty cell places a FILL block and
//                          starts the materialize animation
//                          (`game.fill.target`).
//
//   4. render.js         — paints a "click an empty cell" prompt while
//                          `fill.active`, the highlight cursor, and
//                          the materialize sparkle effect while
//                          `fill.target` exists. After the animation,
//                          Game.fillComplete() checks for full rows
//                          and triggers the standard line-clear flow.
//
// Available until the player has banked the maximum number of charges.
// The at-least-one-empty-cell check lives on tryActivateFill().

import { MAX_FILL_CHARGES } from '../constants.js';

export default {
  id: 'fill',
  name: 'Fill',
  description: 'Press S to fill any empty cell. Stacks up to 3.',
  available: (game) => game.unlocks.fillCharges < MAX_FILL_CHARGES,
  apply: (game) => {
    game.unlocks.fillCharges = Math.min(
      MAX_FILL_CHARGES,
      game.unlocks.fillCharges + 1,
    );
  },
};
