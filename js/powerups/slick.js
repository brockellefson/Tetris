// Power-up: Slick — pieces lock in place slightly later, giving the
// player a short window to make split-second adjustments after a piece
// touches down.
//
// Implementation: flips `game.unlocks.slick`. The lock-delay logic
// itself lives in game.js — softDrop() defers locking when this flag
// is on, and tick() accumulates LOCK_DELAY ms while the piece is
// grounded (resetting on every successful move/rotate, so chained
// inputs can extend the window). Hard drops bypass the delay entirely
// so the player can still slam pieces home when they want to.
//
// Permanent unlock — only offered if the player doesn't already have
// it, mirroring Hold and Ghost.

export default {
  id: 'slick',
  name: 'Slick',
  description: 'Pieces lock slightly later — make split-second adjustments before they settle.',
  available: (game) => !game.unlocks.slick,
  apply:     (game) => { game.unlocks.slick = true; },
};
