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
// Indexed by cleared-line count; entry 0 is the "no clear" fallback.
// A normal player lock can clear at most 4 lines, but a CASCADE
// triggered by a special block (Bomb / Gravity / chained specials)
// can collapse 5+ rows at once when blocks fall into the void left
// by the trigger. `lineClearScore` below extends the table for those
// cases instead of returning `undefined` (which would multiply into
// NaN and silently corrupt the score for the rest of the run).
export const LINE_SCORES = [0, 100, 300, 500, 800];

// Per-extra-line bonus when more than 4 rows clear in one batch.
// Tuned so that 5 lines (1,100) pays a touch more than a Tetris (800),
// 6 lines (1,400), 7 lines (1,700), etc. Linear growth past Tetris is
// a deliberate choice — the cascade's per-clear scoring also stacks
// combo + B2B + perfect-clear on top, so the marginal payoff is
// already healthy without an exponential curve.
export const EXTRA_LINE_BONUS = 300;

// Look up the base line score for any number of cleared rows. Falls
// back to the Tetris value plus EXTRA_LINE_BONUS per row beyond 4
// when a cascade clears more than the static table covers.
export function lineClearScore(cleared) {
  if (cleared <= 0) return 0;
  if (cleared < LINE_SCORES.length) return LINE_SCORES[cleared];
  const tetris = LINE_SCORES[LINE_SCORES.length - 1];
  return tetris + (cleared - (LINE_SCORES.length - 1)) * EXTRA_LINE_BONUS;
}

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

// Per-cast cooldown for the modal-spend power-ups (Chisel, Fill,
// Whoops, Flip). All four are unlock-once abilities — picking the
// card grants a permanent unlock (no per-cast charge to refill);
// each cast then arms a cooldown of N line clears before the player
// can recast. Tuned to feel like "one big play per ~bag" — a Tetris
// drains it instantly, but the player can't chain multiple modal
// spends back-to-back. Each plugin stores its own remaining-line
// counter in `_pluginState.<id>.cooldown`; the onClear hook
// decrements all four in lock-step with line clears.
export const COOLDOWN_LINES = 5;

// Slick power-up — milliseconds a grounded piece can sit before locking,
// giving the player a window to make split-second adjustments. The timer
// resets on every successful move/rotate (step reset). Hard drops bypass
// this entirely.
export const LOCK_DELAY = 500;

// Maximum number of step-resets a single piece can spend before its
// lock-delay window stops refreshing. Without this cap, a player could
// rotate-spam forever on a grounded piece and never lock — the classic
// "lock-delay infinity" exploit. Once the budget is exhausted, the timer
// keeps running (so the piece WILL lock within LOCK_DELAY ms) even if
// the player keeps inputting moves/rotates.
//
// The budget is refreshed any time the piece reaches a new lowest row,
// so genuine downward progress (sliding into a deeper hole, gravity
// pulling the piece further down between adjustments) refills the
// reset count and the player still gets to make adjustments at the
// new resting depth. 15 is the modern guideline-Tetris standard.
export const LOCK_DELAY_MAX_RESETS = 15;

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
// Effective chance at level L (with `lucky` = `unlocks.lucky` stacks):
//   base    = SPECIAL_BLOCK_BASE_CHANCE       + lucky * LUCKY_BASE_PER_STACK
//   per_lvl = SPECIAL_BLOCK_PER_LEVEL_BONUS   + lucky * LUCKY_PER_LEVEL_PER_STACK
//   max     = SPECIAL_BLOCK_MAX_CHANCE        + lucky * LUCKY_MAX_PER_STACK
//   p       = min(max, base + (L - 1) * per_lvl)
//
// At Lucky 0 the curve is the historic 5% at L1, 10% at L6, 15% at L11,
// 20% at L16+. At Lucky 3 it becomes 20% at L1, 24% at L2, 32% at L4
// and clamped at 35% from L5 onward.
//
// The roll itself is gated upstream: with no special blessings unlocked
// (`unlocks.specials.bomb` and `.lightning` both at 0), the spawn picker
// finds no eligible specials and skips the roll regardless of the
// computed chance.
export const SPECIAL_BLOCK_BASE_CHANCE      = 0.05;
export const SPECIAL_BLOCK_PER_LEVEL_BONUS  = 0.01;
export const SPECIAL_BLOCK_MAX_CHANCE       = 0.20;

// Lucky blessing — each stack (caps at 3) bumps each of the three
// SPECIAL_BLOCK_* knobs by the corresponding amount. See the chance
// formula above. Tuned so Lucky stays "rolls feel a bit luckier"
// rather than "every piece is a bomb": at L1 with Lucky 3 the chance
// is 20% (same ceiling as the unlucky late-game cap), and even with
// Lucky 3 at high levels the cap clamps at 35% — the player still
// has to plant the special-bearing piece thoughtfully.
export const LUCKY_MAX_STACKS                 = 3;
export const LUCKY_BASE_PER_STACK             = 0.05;
export const LUCKY_PER_LEVEL_PER_STACK        = 0.01;
export const LUCKY_MAX_PER_STACK              = 0.05;

// Special block leveling — each special blessing (Bomb, Lightning) can
// be picked up to MAX_LEVEL times. Picking the matching card increments
// `game.unlocks.specials[id]` from 0 → 1 → 2 → 3 (capped). The trigger
// code reads the level from the unlocks slot — so an upgrade
// retroactively buffs every special-tagged block already on the board,
// not just future spawns. (Choosing this over "level stamped at spawn"
// makes upgrades feel rewarding the moment they're picked, and keeps
// the boardSpecials grid simple — it stores the kind string only.)
export const SPECIAL_MAX_LEVEL                = 3;

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

// Special-block settle pause — milliseconds the world freezes after a
// top-level special trigger finishes, BEFORE the power-up choice menu
// is allowed to surface. Gives the player a beat to read the bomb
// blast / gravity cascade / lightning column / etc. instead of
// immediately blowing it away with the level-up modal. Only enforced
// when `pendingChoices > 0` (i.e. a menu is actually about to open) —
// during normal play between specials, the settle is set but does
// nothing, so the player isn't input-locked between every bomb.
export const SPECIAL_SETTLE_MS = 800;

// Generic menu-settle pause — milliseconds the world waits between
// "a milestone was earned" and "the level-up choice menu opens" for
// a normal (non-special) line clear. Gives the player a moment to
// see the score pop / line counter tick / level number bump before
// the modal interrupts. When a special trigger fires on the same
// clear, the specials plugin REPLACES this timer with its own
// (longer) settle — see `runSpecialTrigger` in js/specials/index.js.
// The two pauses are intentionally NOT additive: a special clear
// uses only the special settle, never the sum.
export const MENU_SETTLE_MS = 100;

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
