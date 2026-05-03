// ============================================================
// Modes registry — single import surface for all game modes
// ============================================================
//
// main.js and Game both import from here so adding a new mode is
// one re-export line, not a sprinkle of new imports across the
// engine. When PUYO_MODE lands in `js/modes/puyo/mode.js`, it
// joins the export list below and the mode-picker on the splash
// screen reads from this module directly.

export { TETRIS_MODE }       from './tetris/mode.js';
export { PUYO_MODE }         from './puyo/mode.js';
export { PUYO_VERSUS_MODE }  from './puyo/versus/mode.js';
