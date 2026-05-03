// ============================================================
// PUYO_MODE — bundles every Puyo-specific policy together
// ============================================================
//
// Mirror of TETRIS_MODE: a single record with the layout, piece
// policy, match policy, gravity curve, and HUD vocabulary that
// Game.start(mode) and the surrounding UI consume.
//
// Layout: 6 columns × 12 rows is the standard arcade Puyo field.
// Narrower than Tetris (10 wide) so chains build up quickly, but
// shorter (12 vs 20) so a tall stack threatens game-over before
// the player can dig out forever.

import { makeLayout } from '../../layout.js';
import { PUYO_PIECES } from './piece-policy.js';
import { PUYO_MATCH }  from './match-policy.js';

// Drop interval in ms, indexed by (level - 1). Puyo's curve starts
// faster than Tetris (700 ms / cell at level 1 vs 1000 ms) and
// flattens out a touch slower at the bottom — pairs are smaller
// than tetrominoes, so a 1 ms / cell drop would be unreadable.
// Tuned by feel: level 1 is "comfortable, brisk", level 5 is "you're
// engaging," level 10+ is "this is a real game now."
const PUYO_GRAVITY = [
  700, 580, 470, 380, 305, 245, 195, 155, 120, 95,
   75,  60,  48,  38,  30,  24,  20,  16,  13,  10, 8,
];

export const PUYO_MODE = {
  id:     'puyo',
  layout: makeLayout({ cols: 6, rows: 12 }),
  pieces: PUYO_PIECES,
  match:  PUYO_MATCH,
  gravityTable: PUYO_GRAVITY,
  hud: {
    progressLabel: 'Chains',
    // Puyo gives the player the drop preview by default. Tetris
    // gates the equivalent (Predictor) behind a blessing — that's
    // a roguelite progression hook for that mode. Puyo's roguelite
    // pool will eventually layer effects on top of an already-
    // legible base game, so the ghost stays on at all times here.
    alwaysShowGhost: true,
  },
};
