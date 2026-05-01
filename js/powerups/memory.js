// Power-up: Memory — reveals the Hold slot.
//
// Each power-up is a plain object with this shape:
//   id          unique identifier
//   name        short display name (shown on the choice card)
//   description longer text explaining the effect
//   available   (game) => boolean — should this be offered now?
//   apply       (game) => void    — mutate game state to activate it
//
// The Game class never imports power-ups. They mutate the
// `game.unlocks` object, which the renderer / UI / input handler
// then read from. To add a new power-up, just create a new file
// in this directory and register it in index.js.

export default {
  id: 'unlock-hold',
  name: 'Memory',
  description: 'Reveal the Hold slot. Press C or Shift to stash a piece for later.',
  available: (game) => !game.unlocks.hold,
  apply:     (game) => { game.unlocks.hold = true; },
};
