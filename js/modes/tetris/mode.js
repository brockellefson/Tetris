// ============================================================
// TETRIS_MODE — bundles every Tetris-specific policy together
// ============================================================
//
// One bundle per supported game mode. Game.start(mode) takes one
// of these and uses `mode.layout` to size the board, `mode.pieces`
// to drive piece spawn/move/rotate, and `mode.match` to detect
// and score clears. Plugins, render, sound, leaderboard, and the
// rest of the engine stay mode-agnostic.
//
// Adding a new mode is a matter of writing a parallel bundle (a
// `js/modes/<id>/mode.js` exporting `<ID>_MODE`) — Puyo Puyo will
// follow exactly this shape with its own piece-policy and
// match-policy implementations.

import { DEFAULT_LAYOUT } from '../../layout.js';
import { GRAVITY } from '../../constants.js';
import { TETRIS_PIECES } from './piece-policy.js';
import { TETRIS_MATCH }  from './match-policy.js';
import { pickChoices }      from '../../powerups/index.js';
import { pickCurseChoices } from '../../curses/index.js';

export const TETRIS_MODE = {
  id:     'tetris',
  // Board dimensions for a fresh Tetris run. Game.reset() seeds
  // `game.layout` from this so every dimension consumer (board
  // newBoard, render, growth-curse shrink-floor, click-to-cell
  // math) sees the right shape.
  layout: DEFAULT_LAYOUT,
  pieces: TETRIS_PIECES,
  match:  TETRIS_MATCH,
  // Drop interval in ms, indexed by (level - 1). The historic Tetris
  // curve — slow at level 1 (1000 ms / cell), exponential decay
  // toward 1 ms at level 20+. Game.tick reads this directly, with
  // the Hyped curse modifier adding +1 to the index per stack.
  gravityTable: GRAVITY,
  hud: {
    progressLabel: 'Lines',
  },
  // Roguelite card pool. The menu reads pickPowerups / pickCurses
  // off the active mode rather than importing them directly, so
  // adding a parallel pool for a different mode is one bundle
  // edit. milestoneInterval + chainThreshold tune when the menu
  // surfaces a card. bundleCurses true means each blessing pick
  // also delivers a random curse — Tetris's signature risk-reward
  // shape. (Puyo versus turns this off; the opponent IS the
  // counterforce in versus.)
  cards: {
    pickPowerups:      pickChoices,
    pickCurses:        pickCurseChoices,
    bundleCurses:      true,
    milestoneInterval: 5,    // every 5 lines → 1 card (historic)
    chainThreshold:    null, // Tetris has no chain concept
    // Modal pick — pauses the game, player deliberates over a
    // big card spread. Tetris's pacing rewards thoughtful picks;
    // hotkey draft would feel rushed in a mode where one Tetris
    // can earn 2 cards.
    menuStyle: 'modal',
  },
};
