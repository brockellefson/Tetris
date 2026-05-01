// Curse: Rain — one-time event. The instant the curse is picked,
// 5-10 junk blocks rain down onto the board. Each block lands on
// top of whatever is already stacked in its column (as if it were
// hard-dropped), so the rubble accumulates from the bottom up
// rather than spawning at the ceiling. Multiple drops can stack
// on the same column.
//
// Implementation:
//   • Calls Game.addRainBlocks() once and reports the count to the
//     onRain UI hook. There is no ongoing flag and no per-placement
//     trigger — once the rubble lands the curse's job is done.

export default {
  id: 'curse-rain',
  name: 'Rain',
  description: '5-10 junk blocks rain down and stack on top of the pile.',
  available: () => true,
  apply: (game) => {
    const placed = game.addRainBlocks();
    if (placed > 0) game.onRain?.(placed);
  },
};
