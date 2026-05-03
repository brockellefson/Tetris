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
import { pickPuyoChoices } from './powerups/index.js';

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

// No-curses stub — Puyo doesn't have curses yet. The menu drops
// the curse-half of each card cleanly when the picker returns [].
const NO_CARDS = () => [];

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
  // Roguelite card pool — empty for now (the SP card list lands
  // in a follow-up). Hybrid milestone:
  //   • cumulative — every 3 chain steps survived earns a card
  //   • bonus — a chain that reaches length 4 earns one more
  // Bundled curses mirror Tetris's risk-reward shape — every
  // blessing pick also drops a random curse on you.
  cards: {
    pickPowerups:      pickPuyoChoices,
    pickCurses:        NO_CARDS,
    // bundleCurses true means the menu would attach a curse to
    // each blessing pick — but with NO_CARDS as the curse pool,
    // every pick lands as a pure positive anyway. Keeping the
    // flag true (matching Tetris's roguelite identity) gives a
    // single-line edit point when the puyo curse pool lands.
    bundleCurses:      true,
    milestoneInterval: 3,
    chainThreshold:    4,
    // Hotkey pick — three cards live in a HUD strip, player hits
    // 1/2/3 to claim one. No pause; the game keeps running. Fits
    // Puyo's faster rhythm AND works in versus where pausing is
    // impossible (the opponent's tab keeps playing regardless).
    menuStyle: 'hotkey',
  },
};
