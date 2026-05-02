// Special block: Gravity — when this block is removed (line clear or
// chisel), every locked block on the board falls to fill any empty
// space below it, clearing any rows it forms. The cascade engine
// itself lives in js/effects/gravity-cascade.js — this file is the
// "card" half: visual identity + the trigger that kicks off the
// engine.
//
// Used to ship as a power-up; moved to a special so the player
// earns the cascade by *placing the right piece in the right spot*
// rather than picking it from a menu. Encourages reading the next-
// queue and planning around the gold-tinged mino.

import { startGravityCascade } from '../effects/gravity-cascade.js';

export default {
  id: 'gravity',
  name: 'Gravity',
  description:
    'When this block clears, every locked block falls to fill empty space below.',
  rarity: 'rare',
  // Hot gold → ember orange → magenta-pink. Reads as "valuable" against
  // the synthwave palette while being distinct from the I-piece cyan
  // and the Z-piece magenta.
  palette: ['#ffd700', '#ff8a1a', '#ff2e63'],
  animation: {
    speed: 1.6,       // palette cycles per second
    glowBoost: 0.5,   // extra shadowBlur factor
  },
  available: () => true,
  onTrigger: (game) => { startGravityCascade(game); },
};
