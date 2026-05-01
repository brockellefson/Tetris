// Curse: Rain — every 5 piece placements while active, scatter a
// random number of junk blocks across the top row of the board.
//
// Implementation:
//   • Sets `curses.rain = true` and resets `placementCount` so the
//     first rain event lands exactly 5 placements after the pick.
//   • The trigger itself lives in Game.lockCurrent() — when the
//     counter rolls over 5 the game calls Game.addRainBlocks(),
//     which mutates the top row and may end the game if the spawn
//     area gets blocked. Players are warned in the description.
//
// The "drop a few blocks at once" event also runs immediately on
// pick so the curse feels active right away.

export default {
  id: 'curse-rain',
  name: 'Rain',
  description: 'Every 5 piece placements, junk blocks rain into the top row.',
  available: () => true,
  apply: (game) => {
    game.curses.rain = true;
    game.placementCount = 0;
    const placed = game.addRainBlocks();
    if (placed > 0) game.onRain?.(placed);
  },
};
