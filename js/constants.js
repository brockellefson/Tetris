// ============================================================
// Game constants — board dimensions, colors, and timing
// ============================================================

export const COLS = 10;
export const ROWS = 20;
export const BLOCK = 30;        // pixel size of one cell

// ---- Synthwave palette ----
// The piece colors are tuned to read as neon — saturated and a touch
// shifted toward the pink/cyan/violet end of the spectrum so they
// pop against the deep-purple board and play nicely with the glow
// in render.js (drawBlockRaw uses each piece color as its own halo).
export const COLORS = {
  I: '#00f0ff',   // electric cyan
  O: '#fff700',   // neon yellow
  T: '#d04bff',   // ultraviolet
  S: '#39ff7a',   // acid mint
  Z: '#ff2e63',   // hot magenta-red
  J: '#3a6dff',   // synth blue
  L: '#ff8b2e',   // sunset orange
  // JUNK reads as a cool dusty mauve — inert and washed-out next to the
  // saturated neon tetrominoes, but still tinted enough to look at home
  // on the deep-purple board (a true gray would punch a flat hole in it).
  JUNK:  '#5e4a73',
  // FILL is a pearly lavender-white — light enough to read as
  // "something you the player added," but tinted toward magenta so it
  // sits inside the synthwave palette instead of looking like an
  // alien chrome chip on the board.
  FILL: '#ead6ff',
  GHOST: 'rgba(255,180,255,0.18)',
  // The grid and background lean deep magenta-purple — the iconic
  // "outrun horizon" look. The grid lines are a soft pink-violet so
  // they whisper rather than fight the neon blocks for attention.
  GRID:  '#3a1a55',
  BG:    '#170028',
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

// Duration of the Fill power-up's block-materialize animation.
// Mirrors CHISEL_DURATION but kept independently so the two effects
// can be tuned to feel like opposites (destruction vs. construction).
export const FILL_DURATION = 360;

// Board-shake on piece lock — pixels of max displacement & duration.
// SHAKE_LOCK is for natural / soft-drop locks; hard drops scale up
// with the drop distance (see Game.hardDrop).
export const SHAKE_DURATION = 220;
export const SHAKE_LOCK     = 2;
export const SHAKE_HARDDROP = 4;

// Chisel and Fill are banked consumables. Picking the power-up
// card grants a charge; the player spends a charge by pressing A
// (chisel) or S (fill). Each tops out at 1 charge — once the
// player has banked one, the corresponding card no longer surfaces
// in the choice menu (see `available` on those power-ups), so the
// pick is a deliberate "save it for the moment that needs it"
// decision rather than a stacked stockpile.
export const MAX_CHISEL_CHARGES = 1;
export const MAX_FILL_CHARGES = 1;

// Flip — banked consumable that horizontally mirrors the active
// piece. Pressing F spends one charge. Same single-charge cap as
// Chisel and Fill.
export const MAX_FLIP_CHARGES = 1;

// Whoops — banked consumable that rewinds the world to just before
// the active piece spawned. Pressing W spends the charge. Capped at
// 1 because it's a strong "take-back" effect: stacking would let the
// player undo arbitrarily far back, which trivializes mistakes. Once
// the player has a charge, the Whoops card no longer surfaces.
export const MAX_WHOOPS_CHARGES = 1;

// Slick power-up — milliseconds a grounded piece can sit before locking,
// giving the player a window to make split-second adjustments. The timer
// resets on every successful move/rotate (step reset), so chained inputs
// can extend the window indefinitely. Hard drops bypass this entirely.
export const LOCK_DELAY = 500;

// Gravity cascade — milliseconds between each "fall step" while a
// gravity-cascade is processing (today triggered only by the Gravity
// special block). Each step shifts every floating locked block down
// by one cell, so smaller values look snappier and larger values let
// the player follow the cascade. Tuned for a slow, dramatic "rain"
// cadence — the player should feel each block thud down rather than
// see the board snap into place.
export const GRAVITY_POWER_STEP = 120;

// Special blocks — odds that a freshly spawned piece carries a
// special-tagged mino. The base chance is what level 1 sees; every
// level adds PER_LEVEL_BONUS (capped at MAX_CHANCE) so a roguelite
// run feels increasingly chaotic as the player climbs. The roll
// happens once at spawn time in js/specials/index.js. Setting BASE
// to 0 with PER_LEVEL_BONUS = 0 disables specials entirely; setting
// MAX_CHANCE to 1 lets late-game pieces always carry one.
//
// Effective chance at level L:
//   min(MAX, BASE + (L - 1) * PER_LEVEL_BONUS)
//
// The current curve: 5% at L1, 10% at L6, 15% at L11, 20% at L16
// and beyond (clamped).
export const SPECIAL_BLOCK_BASE_CHANCE      = 0.05;
export const SPECIAL_BLOCK_PER_LEVEL_BONUS  = 0.01;
export const SPECIAL_BLOCK_MAX_CHANCE       = 0.20;

// Rarity tiers for special blocks. Each special declares one of these
// strings; the picker reads the weight, the renderer reads it again
// to scale the visual treatment (rarer = louder glow + a soft pulse
// on top of the palette cycle). Adding a new tier is a one-line
// edit here plus an entry in render.js's RARITY_VFX table.
export const SPECIAL_RARITY_WEIGHTS = {
  common:    8,
  uncommon:  4,
  rare:      2,
  legendary: 1,
};

// Points awarded per cell destroyed via the onCellRemoved hook
// (Bomb blast cells, Lightning column cells, Chisel hits, and any
// future single-cell remover). Multiplied by the current level so
// destruction stays meaningful at high levels without dwarfing line
// clears (a 9-cell Bomb at level 5 pays 9 × 25 × 5 = 1,125, vs. a
// Tetris at level 5 paying 800 × 5 = 4,000). Set to 0 to disable
// destruction scoring entirely.
//
// The score awarded is intentionally separate from combo / B2B —
// destruction isn't a row-clear, so threading it through those
// chains would make the bonuses ambiguous. Line clears still score
// normally on top of any destruction the trigger caused.
export const SPECIAL_DESTROY_POINTS = 25;
