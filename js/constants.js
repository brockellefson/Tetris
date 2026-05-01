// ============================================================
// Game constants — board dimensions, colors, and timing
// ============================================================

export const COLS = 10;
export const ROWS = 20;
export const BLOCK = 30;        // pixel size of one cell

export const COLORS = {
  I: '#00f0f0',
  O: '#f0f000',
  T: '#a000f0',
  S: '#00f000',
  Z: '#f00000',
  J: '#0040f0',
  L: '#f0a000',
  // JUNK is the desaturated slate used for blocks dropped by the
  // "Junk" curse. Picked to read as inert rubble next to the saturated
  // tetromino palette without clashing with the cyan/red UI accents.
  JUNK:  '#6b7080',
  GHOST: 'rgba(255,255,255,0.15)',
  GRID:  '#1a1d28',
  BG:    '#0e1018',
};

// Gravity — milliseconds per cell drop, indexed by (level - 1).
// Levels above the table length clamp to the last entry.
export const GRAVITY = [
  1000, 793, 618, 473, 355, 262, 190, 135, 94, 64,
  43, 28, 18, 12, 8, 6, 4, 3, 2, 1, 1,
];

// Input timing (milliseconds)
export const DAS  = 130;   // delayed auto-shift — wait before key-repeat starts
export const ARR  = 35;    // auto-repeat rate — interval between repeats
export const SOFT = 30;    // soft-drop fall interval

// Score table for line clears (1, 2, 3, 4 lines), multiplied by level.
export const LINE_SCORES = [0, 100, 300, 500, 800];

// Bonus scoring rules.
//   B2B_MULTIPLIER     — Tetris-after-Tetris pays 1.5× the base line score.
//   COMBO_BONUS        — per cumulative line in the current clear streak,
//                        awarded as COMBO_BONUS × totalLinesInStreak × level.
//                        E.g. a double clear → combo 2 → +100 × level.
//                        A Tetris then a single → combo 5 → +250 × level.
//   PERFECT_CLEAR_BONUS — flat bonus when the board is empty after a clear.
export const B2B_MULTIPLIER     = 1.5;
export const COMBO_BONUS        = 50;
export const PERFECT_CLEAR_BONUS = 3500;

// Duration of the line-clear animation in milliseconds.
// During this window, gameplay pauses and the cleared rows
// flash + wipe outward from the center.
export const CLEAR_DURATION = 280;

// Duration of the Chisel power-up's block-shatter animation
// (milliseconds). Game stays frozen for this whole window so the
// player can see the block break apart before play resumes.
export const CHISEL_DURATION = 420;

// Board-shake on piece lock — pixels of max displacement & duration.
// SHAKE_LOCK is for natural / soft-drop locks; hard drops scale up
// with the drop distance (see Game.hardDrop).
export const SHAKE_DURATION = 220;
export const SHAKE_LOCK     = 2;
export const SHAKE_HARDDROP = 4;
