// ============================================================
// Special-blocks subsystem — registry, picker, and plugin
// ============================================================
//
// A "special block" is metadata attached to a single mino of a
// piece. While the piece is falling, the special travels with the
// piece via piece-local rot-0 coordinates. When the piece locks,
// the special anchors to a board cell in `game.boardSpecials`. When
// that cell is removed (line clear, chisel, future cascade), its
// `onTrigger` fires — and the special itself decides what happens.
//
// Adding a new special is two steps:
//   1. Create js/specials/<id>.js exporting the standard object
//      (see the "Special definition" contract below).
//   2. Import and add to ALL_SPECIALS in this file.
//
// Nothing in game.js, render.js, board.js, or any power-up needs to
// know the names of any individual special. The renderer reads
// `palette` and `animation` generically; the clear pipeline calls
// `onTrigger` generically; the spawn pipeline rolls weighted random.
//
// Special definition contract:
//   id           string         — stable identifier ('gravity', 'bomb', …)
//   name         string         — display name for debug menus
//   description  string         — short flavor text
//   rarity       string         — one of SPECIAL_RARITY_WEIGHTS keys.
//                                 Drives spawn weight AND the renderer's
//                                 visual treatment (rarer = louder glow
//                                 + a soft pulse on top of the cycle).
//   palette      string[]       — colors to cycle through; the renderer
//                                 interpolates between adjacent colors at
//                                 `animation.speed` cycles per second.
//   animation    {speed, glowBoost}
//                                 speed in cycles/sec; glowBoost is added
//                                 to the base shadowBlur factor.
//   available    (game) → bool  — gating; returning false drops it from
//                                 the spawn picker.
//   onTrigger    (game, x, y, source) → void
//                                 fires when the cell at (x, y) holding
//                                 this special is removed. `source` is
//                                 'lineClear' or 'chisel'. Specials can
//                                 ignore source if they don't care.
//
// Hooks the specials plugin subscribes to:
//   decoratePiece   modifier — possibly attach a special to the new piece
//   beforeClear     captures triggers from rows about to be removed and
//                   shifts boardSpecials in lock-step with removeRows
//   onClear         fires the captured triggers (after the board mutation
//                   so triggers see the post-clear state)
//   onCellRemoved   fires when a non-clear path (chisel, future) removes
//                   a single cell — fires that cell's special if any
//   reset           clears boardSpecials on every Game.reset()

import {
  COLS,
  ROWS,
  SPECIAL_BLOCK_BASE_CHANCE,
  SPECIAL_BLOCK_PER_LEVEL_BONUS,
  SPECIAL_BLOCK_MAX_CHANCE,
  SPECIAL_RARITY_WEIGHTS,
  SPECIAL_DESTROY_POINTS,
} from '../constants.js';
import { PIECES, transformLocalCoord } from '../pieces.js';
import gravitySpecial   from './gravity.js';
import bombSpecial      from './bomb.js';
import lightningSpecial from './lightning.js';

// Single source of truth for which specials exist. Order doesn't
// matter — the picker re-shuffles by weight every roll. Adding a
// new special is one new file plus one entry in this array; the
// debug menu's "Force <name>" pills auto-build from it.
export const ALL_SPECIALS = [
  gravitySpecial,
  bombSpecial,
  lightningSpecial,
];

// Index by id for O(1) lookup from the trigger pipeline (board cells
// store the id, the trigger needs the definition).
export const SPECIALS_BY_ID = Object.fromEntries(ALL_SPECIALS.map(s => [s.id, s]));

// ---- Spawn-roll math ----------------------------------------

// The level-scaling chance curve. Centralized so debug tooling and
// any future HUD readout can use the same number.
export function specialChanceForLevel(level) {
  const bonus = Math.max(0, level - 1) * SPECIAL_BLOCK_PER_LEVEL_BONUS;
  return Math.min(SPECIAL_BLOCK_MAX_CHANCE, SPECIAL_BLOCK_BASE_CHANCE + bonus);
}

// Weighted random pick from the rarity tier of each available special.
// Returns null if no specials are eligible (every available() returned
// false, or the registry is empty).
function pickWeightedSpecial(game) {
  const eligible = ALL_SPECIALS.filter(s => s.available?.(game) ?? true);
  if (eligible.length === 0) return null;
  let total = 0;
  for (const s of eligible) total += SPECIAL_RARITY_WEIGHTS[s.rarity] ?? 1;
  let roll = Math.random() * total;
  for (const s of eligible) {
    roll -= SPECIAL_RARITY_WEIGHTS[s.rarity] ?? 1;
    if (roll <= 0) return s;
  }
  return eligible[eligible.length - 1]; // fp drift fallback
}

// Enumerate (row, col) of every filled mino in a piece's rot-0 frame.
// Used to pick which mino to tag at spawn.
function rot0Minos(type) {
  const cells = [];
  const m = PIECES[type][0];
  for (let r = 0; r < m.length; r++) {
    for (let c = 0; c < m[r].length; c++) {
      if (m[r][c]) cells.push({ r, c });
    }
  }
  return cells;
}

// Possibly tag the piece with one special. Returns the (possibly-
// extended) piece object — never mutates the input. Triggered from
// the decoratePiece hook in spawnNext().
//
// `forceKind` lets the debug menu queue a specific special on the
// next spawn (one-shot — Game stores it as `_forceNextSpecial` and
// clears it after consumption). Bypasses the chance roll but still
// honors `available()` so debug can't force a special the game has
// gated off.
export function maybeAttachSpecial(game, piece) {
  let chosen = null;
  const forced = game._forceNextSpecial;
  if (forced) {
    game._forceNextSpecial = null;
    chosen = SPECIALS_BY_ID[forced];
    if (chosen && chosen.available?.(game) === false) chosen = null;
  } else {
    if (Math.random() > specialChanceForLevel(game.level)) return piece;
    chosen = pickWeightedSpecial(game);
  }
  if (!chosen) return piece;
  const minos = rot0Minos(piece.type);
  if (minos.length === 0) return piece;
  const mino = minos[Math.floor(Math.random() * minos.length)];
  // Fire the spawn audio cue here — at the moment the special is
  // attached, which corresponds visually to "the new piece appears
  // with a glowing mino." main.js routes this to a per-kind sound
  // function with a generic shock-jolt fallback. Mirrors the
  // onSpecialTrigger pipeline above.
  game.onSpecialSpawn?.(chosen.id);
  return {
    ...piece,
    specials: [{ rot0Row: mino.r, rot0Col: mino.c, kind: chosen.id }],
  };
}

// Lookup helper used by the renderer: does the piece carry a special
// at the given (currentRotation, row, col)? Returns the kind string
// or null. The (r, c) passed in are CURRENT-rotation coords (i.e.
// what the renderer is iterating over); we transform each tagged
// rot-0 coord to current-rotation for comparison.
export function specialAtPieceCell(piece, r, c) {
  if (!piece?.specials) return null;
  for (const sp of piece.specials) {
    const t = transformLocalCoord(piece, sp.rot0Row, sp.rot0Col);
    if (t.r === r && t.c === c) return sp.kind;
  }
  return null;
}

// ---- boardSpecials grid management ---------------------------

// Build a fresh boardSpecials grid sized to match game.board.
export function newBoardSpecials(cols = COLS, rows = ROWS) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

// Mirror of board.js's removeRows but for the specials grid. Same
// two-phase splice-then-unshift pattern (interleaving would corrupt
// indices on multi-line clears — see the comment in board.js).
function removeRowsSpecials(specials, rows) {
  const cols = specials[0]?.length ?? COLS;
  const sorted = [...rows].sort((a, b) => b - a);
  for (const r of sorted) specials.splice(r, 1);
  for (let i = 0; i < sorted.length; i++) {
    specials.unshift(Array(cols).fill(null));
  }
}

// ---- Trigger dispatch ----------------------------------------

// ---- Trigger dispatch + destruction scoring --------------------
//
// Two intertwined concerns share state here:
//
//   1. Trigger dispatch — single chokepoint for "this cell just got
//      removed by some non-clear path." Fires the cell's special if
//      any.
//
//   2. Destruction scoring — every cell removed via onCellRemoved
//      earns SPECIAL_DESTROY_POINTS × level. Bomb blast cells,
//      Lightning column cells, plain Chisel hits, and chained
//      specials all flow through this single hook, so one constant
//      tunes them all.
//
// Notification batching uses a depth counter: each call into
// runSpecialTrigger increments depth; the destruction-cell counter
// resets on the OUTERMOST entry (depth 0 → 1) and the notification
// fires on the matching exit (depth 1 → 0). Chained triggers
// (Bomb-into-Bomb, Lightning-into-Gravity) share the outer trigger's
// notification batch — one big "+N" instead of confetti.
let _triggerDepth = 0;
let _triggerDestroyCount = 0;

function runSpecialTrigger(game, def, x, y, source) {
  if (_triggerDepth === 0) _triggerDestroyCount = 0;
  _triggerDepth++;
  // Audio cue first so it lands at the moment of break, before any
  // chained specials/cascades start competing for the channel.
  game.onSpecialTrigger?.(def.id, source);
  def.onTrigger?.(game, x, y, source);
  _triggerDepth--;
  if (_triggerDepth === 0 && _triggerDestroyCount > 0) {
    const points = _triggerDestroyCount * SPECIAL_DESTROY_POINTS * game.level;
    game.onSpecialDestroy?.(def.id, _triggerDestroyCount, points);
  }
}

function fireSpecialAt(game, x, y, source) {
  if (!game.boardSpecials) return;
  const kind = game.boardSpecials[y]?.[x];
  if (!kind) return;
  game.boardSpecials[y][x] = null;
  const def = SPECIALS_BY_ID[kind];
  if (!def) return;
  runSpecialTrigger(game, def, x, y, source);
}

// ---- The plugin ----------------------------------------------
//
// Subscribes to the four hooks the specials feature needs. Stays
// pure of any specific special's logic — every special drives its
// own behavior through `onTrigger`.

export default {
  // ---- Lifecycle ----

  reset(game) {
    const cols = game.board[0]?.length ?? COLS;
    const rows = game.board.length;
    game.boardSpecials = newBoardSpecials(cols, rows);
    game._pendingSpecialTriggers = null;
    game._forceNextSpecial = null;
    // Reset module-level trigger-batch counters. If a restart happens
    // mid-trigger (extremely unlikely — the only path is the player
    // hitting R during a chisel-into-bomb chain) we'd otherwise carry
    // stale depth into the new run and either suppress a notification
    // or fire one early.
    _triggerDepth = 0;
    _triggerDestroyCount = 0;
  },

  // ---- Spawn — possibly attach a special ----
  //
  // Modifier-style hook fired from spawnNext() between spawn(type)
  // and the assignment to game.current.

  decoratePiece(game, piece) {
    return maybeAttachSpecial(game, piece);
  },

  // ---- Lock — transfer piece-bound specials onto the board ----
  //
  // onLock fires BEFORE the board mutation, but writing to the
  // parallel boardSpecials grid is independent — no ordering
  // hazard. We resolve each tagged mino through transformLocalCoord
  // so rotation/flip state is honored.

  onLock(game) {
    const piece = game.current;
    if (!piece?.specials) return;
    if (!game.boardSpecials) return;
    for (const sp of piece.specials) {
      const t = transformLocalCoord(piece, sp.rot0Row, sp.rot0Col);
      const x = piece.x + t.c;
      const y = piece.y + t.r;
      if (y < 0 || y >= game.boardSpecials.length) continue;
      if (x < 0 || x >= game.boardSpecials[0].length) continue;
      game.boardSpecials[y][x] = sp.kind;
    }
  },

  // ---- Line clear ----
  //
  // beforeClear fires INSIDE completeClear (and the gravity cascade's
  // completeCascadeClear) before removeRows runs. We:
  //   1. Capture which special-bearing cells are about to vanish.
  //   2. Mirror removeRows on boardSpecials so post-clear rendering
  //      sees the right grid alignment.
  //   3. Stash the captured list for onClear to fire.

  beforeClear(game, rows) {
    if (!game.boardSpecials) return;
    const triggers = [];
    for (const r of rows) {
      const row = game.boardSpecials[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const kind = row[c];
        if (kind) triggers.push({ kind, x: c, y: r });
      }
    }
    removeRowsSpecials(game.boardSpecials, rows);
    game._pendingSpecialTriggers = triggers;
  },

  // onClear fires AFTER all standard scoring/spawn logic has run, so
  // triggers see the post-clear board. A cascade-triggering special
  // (Gravity) calls startGravityCascade; the cascade is idempotent
  // when one is already running, so a second Gravity special on the
  // same clear no-ops cleanly.

  onClear(game, _cleared) {
    const list = game._pendingSpecialTriggers;
    game._pendingSpecialTriggers = null;
    if (!list || list.length === 0) return;
    for (const t of list) {
      const def = SPECIALS_BY_ID[t.kind];
      if (!def) continue;
      // Each captured trigger is its own top-level event — the depth
      // counter resets the destroy-tally for each one, so a clear
      // that detonates two Bombs floats two separate "+N" notifications.
      runSpecialTrigger(game, def, t.x, t.y, 'lineClear');
    }
  },

  // ---- Cell removal (chisel + special blasts + chained removers) ----
  //
  // Three things happen for every cell removed via this hook:
  //
  //   1. Destruction score — SPECIAL_DESTROY_POINTS × level points
  //      are awarded. Plain chisel hits, bomb blasts, lightning
  //      column cells, and chained specials all earn the same flat
  //      bonus per cell.
  //   2. Notification batching — if we're inside a special trigger,
  //      bump the destroy counter so the outer trigger's "+N"
  //      notification reflects the total (including chained damage).
  //   3. Trigger fan-out — if the removed cell carried a special,
  //      that special's onTrigger fires next. The depth counter in
  //      runSpecialTrigger handles re-entry.

  onCellRemoved(game, x, y, source) {
    if (SPECIAL_DESTROY_POINTS > 0) {
      game.score += SPECIAL_DESTROY_POINTS * game.level;
      if (_triggerDepth > 0) _triggerDestroyCount += 1;
    }
    fireSpecialAt(game, x, y, source);
  },
};
