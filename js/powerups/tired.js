// Power-up: Tired — removes a single stack of the Hyped curse, making
// pieces fall one level slower. Inverse of the Hyped curse.
//
// Implementation: decrement `game.curses.hyped` by 1. The same offset
// is consumed by Game.tick() when looking up GRAVITY, so the speed
// reduction takes effect on the very next gravity tick.
//
// Only offered when there's at least one Hyped stack to peel off —
// otherwise the player would burn a milestone choice on a no-op. This
// is a one-shot consumable: each pick removes exactly one stack, so
// recovering from a tall Hyped tower means picking Tired multiple times.

export default {
  id: 'tired',
  name: 'Tired',
  description: 'Pieces fall one level slower — removes a stack of Hyped.',
  available: (game) => game.curses.hyped > 0,
  apply: (game) => { game.curses.hyped = Math.max(0, game.curses.hyped - 1); },
};
