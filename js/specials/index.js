// ============================================================
// Special-blocks subsystem — registry, picker, and plugin
// ============================================================
//
// A "special block" is metadata attached to a single mino of a
// piece. While the piece is falling, the special travels with the
// piece via piece-local rot-0 coordinates. When the piece locks,
// the special anchors to a board cell in `_pluginState.specials.boardGrid`. When
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
  SPECIAL_BLOCK_BASE_CHANCE,
  SPECIAL_BLOCK_PER_LEVEL_BONUS,
  SPECIAL_BLOCK_MAX_CHANCE,
  SPECIAL_RARITY_WEIGHTS,
  SPECIAL_DESTROY_POINTS,
  SPECIAL_SETTLE_MS,
  LUCKY_BASE_PER_STACK,
  LUCKY_PER_LEVEL_PER_STACK,
  LUCKY_MAX_PER_STACK,
} from '../constants.js';
import { DEFAULT_LAYOUT } from '../layout.js';
import { PIECES, transformLocalCoord } from '../pieces.js';
import bombSpecial      from './bomb.js';
import lightningSpecial from './lightning.js';
import welderSpecial    from './welder.js';

// Single source of truth for which specials exist. Order doesn't
// matter — the picker re-shuffles by weight every roll. Adding a
// new special is one new file plus one entry in this array; the
// debug menu's "Force <name>" pills auto-build from it.
//
// Specials are gated on per-id unlock LEVELS (`game.unlocks.specials[id]`):
// a special is only eligible to spawn once the matching blessing card
// has been picked at least once. Until then the picker filters it out
// and the spawn roll is a no-op even when the chance lands.
export const ALL_SPECIALS = [
  bombSpecial,
  lightningSpecial,
  welderSpecial,
];

// Index by id for O(1) lookup from the trigger pipeline (board cells
// store the id, the trigger needs the definition).
export const SPECIALS_BY_ID = Object.fromEntries(ALL_SPECIALS.map(s => [s.id, s]));

// ---- Spawn-roll math ----------------------------------------

// The level-scaling chance curve. Each Lucky stack lifts the base, the
// per-level bonus, and the cap by the LUCKY_*_PER_STACK amounts (see
// constants.js). Centralized so debug tooling and any future HUD
// readout can use the same number.
export function specialChanceForLevel(level, lucky = 0) {
  const base    = SPECIAL_BLOCK_BASE_CHANCE     + lucky * LUCKY_BASE_PER_STACK;
  const perLvl  = SPECIAL_BLOCK_PER_LEVEL_BONUS + lucky * LUCKY_PER_LEVEL_PER_STACK;
  const maxCap  = SPECIAL_BLOCK_MAX_CHANCE      + lucky * LUCKY_MAX_PER_STACK;
  const bonus   = Math.max(0, level - 1) * perLvl;
  return Math.min(maxCap, base + bonus);
}

// Weighted random pick from the rarity tier of each ELIGIBLE special.
// "Eligible" means: the player has unlocked it (`unlocks.specials[id] > 0`)
// AND the special's optional `available(game)` returns true. Returns
// null when nothing's eligible (the picker is then a no-op upstream
// in maybeAttachSpecial).
function pickWeightedSpecial(game) {
  const unlocked = game.unlocks?.specials ?? {};
  const eligible = ALL_SPECIALS.filter(s => {
    if ((unlocked[s.id] ?? 0) <= 0) return false;
    return s.available?.(game) ?? true;
  });
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
// `forceNext` (a slot inside the specials state bag) lets the debug
// menu queue a specific special on the next spawn — set it via
// `game._pluginState.specials.forceNext = '<id>'` and the next
// spawn consumes it. Bypasses the chance roll but still honors
// `available()` so debug can't force a special the game has gated off.
export function maybeAttachSpecial(game, piece) {
  const s = specialsState(game);
  let chosen = null;
  const forced = s?.forceNext;
  if (forced) {
    // Debug-menu force path bypasses the chance roll AND the unlock
    // gate (so testers can stage a special before the player has the
    // matching blessing). The trigger code defaults to level 1 when
    // unlocks.specials[kind] is 0 — see bomb.js / lightning.js.
    s.forceNext = null;
    chosen = SPECIALS_BY_ID[forced];
    if (chosen && chosen.available?.(game) === false) chosen = null;
  } else {
    // Bail BEFORE the chance roll if no special is unlocked — burning
    // an RNG call to find an empty pool would just be wasted entropy
    // (and would log as a non-deterministic call site under any future
    // replay tooling).
    const unlocked = game.unlocks?.specials ?? {};
    const anyUnlocked = ALL_SPECIALS.some(s => (unlocked[s.id] ?? 0) > 0);
    if (!anyUnlocked) return piece;
    const lucky = game.unlocks?.lucky ?? 0;
    if (Math.random() > specialChanceForLevel(game.level, lucky)) return piece;
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

// Convenience accessor — slot lives in the plugin-state bag, seeded
// by this plugin's reset hook. Used by external readers (renderer,
// gravity-cascade) that need the parallel grid.
export const specialsState = (game) => game._pluginState.specials;

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

// Build a fresh boardSpecials grid sized to match game.board. The
// default layout is the historic 10×20 board so legacy callers that
// pass nothing still work; the standard caller (this plugin's reset
// hook below) reads dimensions off the live board so a runtime-grown
// or mode-swapped playfield gets a matched parallel grid.
export function newBoardSpecials(cols = DEFAULT_LAYOUT.cols, rows = DEFAULT_LAYOUT.rows) {
  return Array.from({ length: rows }, () => Array(cols).fill(null));
}

// Mirror of board.js's removeRows but for the specials grid. Same
// two-phase splice-then-unshift pattern (interleaving would corrupt
// indices on multi-line clears — see the comment in board.js).
function removeRowsSpecials(specials, rows) {
  const cols = specials[0]?.length ?? 0;
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
  if (_triggerDepth === 0) {
    if (_triggerDestroyCount > 0) {
      const points = _triggerDestroyCount * SPECIAL_DESTROY_POINTS * game.level;
      game.onSpecialDestroy?.(def.id, _triggerDestroyCount, points);
    }
    // Arm the settle pause — a beat between "the special finished
    // resolving" and "the power-up menu pops up." See the
    // SPECIAL_SETTLE_MS comment in constants.js for the gate
    // semantics. The timer is set unconditionally; whether it
    // actually freezes gameplay is decided in freezesGameplay below
    // (gated on pendingChoices > 0). The tick hook holds it at full
    // duration while another plugin is freezing (e.g. a Gravity
    // cascade kicked off by this same trigger), so the settle starts
    // counting down only after the cascade has finished and the player
    // can actually see the result.
    //
    // Clear Game's universal menu-settle so the two waits don't run
    // in parallel — for a special clear we want ONLY the special
    // settle, not max(special, menu). completeClear arms
    // _menuSettleTimer eagerly when a milestone is earned, before it
    // knows whether a special will trigger; this is where we retract
    // it now that we know one did.
    const s = specialsState(game);
    if (s) s.settleTimer = SPECIAL_SETTLE_MS;
    game._menuSettleTimer = 0;
  }
}

function fireSpecialAt(game, x, y, source) {
  const s = specialsState(game);
  if (!s?.boardGrid) return;
  const kind = s.boardGrid[y]?.[x];
  if (!kind) return;
  s.boardGrid[y][x] = null;
  const def = SPECIALS_BY_ID[kind];
  if (!def) return;
  runSpecialTrigger(game, def, x, y, source);
}

// ---- The plugin ----------------------------------------------
//
// Subscribes to the four hooks the specials feature needs. Stays
// pure of any specific special's logic — every special drives its
// own behavior through `onTrigger`.

// Module-scoped capture between beforeHoldSwap and afterHoldSwap so
// the special on the piece going INTO hold survives across the
// piece-swap operation. Cleared after the swap to prevent stale
// state from leaking into the next hold.
let _pendingHoldSpecials = null;

export default {
  id: 'specials',
  // Tetris-only — every concrete special (Bomb / Lightning / Welder)
  // and every blessing tier currently in ALL_POWERUPS is wired
  // against tetromino spawn-tagging, full-row clear pipelines, and
  // Tetris-specific cards. When Puyo lands, its special-block kit
  // (if any) ships as a parallel plugin under js/modes/puyo/.
  modes: ['tetris'],

  // ---- Lifecycle ----

  reset(game) {
    const cols = game.board[0]?.length ?? game.layout.cols;
    const rows = game.board.length;
    game._pluginState.specials = {
      // Parallel-to-game.board grid storing each cell's special kind.
      boardGrid: newBoardSpecials(cols, rows),
      // Mirror of the active piece's `specials` array for the held
      // slot. Owned here (not on Game) so a held special doesn't
      // evaporate on swap and so Whoops auto-rewinds it via the
      // generic plugin-serialize loop.
      holdSpecials: null,
      // List of pending triggers captured in beforeClear, fired in
      // onClear. Lives in the bag (not module-state) so a Whoops
      // rewind mid-clear doesn't leave stale entries.
      pendingTriggers: null,
      // Debug-menu queue: when set, the next spawnNext consumes this
      // id instead of rolling. Cleared by maybeAttachSpecial.
      forceNext: null,
      // Post-trigger settle pause (ms remaining). Set to
      // SPECIAL_SETTLE_MS at the end of every top-level
      // runSpecialTrigger; counted down by this plugin's tick hook,
      // BUT only while no other plugin is freezing and no clear
      // animation is running (so a Gravity cascade kicked off by the
      // trigger doesn't run the timer down before the player gets to
      // see the cascade end). Gates `freezesGameplay` while > 0 AND
      // `pendingChoices > 0` so normal play between specials isn't
      // input-locked.
      settleTimer: 0,
    };
    _pendingHoldSpecials = null;
    // Reset module-level trigger-batch counters. If a restart happens
    // mid-trigger (extremely unlikely — the only path is the player
    // hitting R during a chisel-into-bomb chain) we'd otherwise carry
    // stale depth into the new run and either suppress a notification
    // or fire one early.
    _triggerDepth = 0;
    _triggerDestroyCount = 0;
  },

  // ---- Serialize / restore (Whoops snapshot) ----
  //
  // The specials plugin opts into Whoops's generic plugin-snapshot
  // loop by exposing serialize/restore. Captures the boardGrid (deep-
  // cloned so later mutations don't alias the snapshot) and the
  // held-specials slot. The active piece's own `specials` array is
  // intentionally NOT serialized — restore goes through spawnNext
  // → decoratePiece, which re-rolls fresh, so the rewound piece may
  // carry a different special. By design: rewinding shouldn't lock
  // in a known-good roll.
  serialize(game) {
    const s = specialsState(game);
    if (!s) return null;
    return {
      boardGrid: s.boardGrid ? s.boardGrid.map(row => row.slice()) : null,
      holdSpecials: s.holdSpecials ? s.holdSpecials.map(sp => ({ ...sp })) : null,
    };
  },
  restore(game, snap) {
    if (!snap) return;
    const s = specialsState(game);
    if (!s) return;
    if (snap.boardGrid) s.boardGrid = snap.boardGrid.map(row => row.slice());
    s.holdSpecials = snap.holdSpecials
                       ? snap.holdSpecials.map(sp => ({ ...sp }))
                       : null;
  },

  // ---- Settle pause (tick + freeze gates) ----
  //
  // After a top-level trigger ends, runSpecialTrigger arms
  // `settleTimer = SPECIAL_SETTLE_MS`. We then:
  //
  //   • Hold the timer at full duration while another plugin is
  //     freezing (the Gravity cascade, a future bomb-with-animation,
  //     etc.) or the line-clear animation is running. This is the
  //     "wait for the special's effect to finish playing out" gate —
  //     a Gravity special triggered by a clear kicks off the cascade
  //     synchronously inside runSpecialTrigger, so the timer is
  //     already set before the cascade begins. Letting it count down
  //     during the cascade would defeat the purpose.
  //
  //   • Once the world is otherwise quiet, decrement each frame until
  //     it hits zero.
  //
  //   • freezesGameplay returns true while the timer is positive AND
  //     `pendingChoices > 0`. The pending-choices gate is the whole
  //     point: we only want to delay the level-up menu, not lock input
  //     during normal play between bombs.
  //
  // Because `freezesGameplay` returns true during settle, Game's
  // `_isBusy` stays true, the busy → idle transition tracker holds
  // off `onPluginIdle`, and main.js doesn't get the cue to call
  // `powerupMenu.showNext` until the settle completes. That's the
  // single seam that ties this whole thing together.
  //
  // The loop in `tick` skips itself when checking "are other plugins
  // freezing" — we obviously want to ignore our own freeze, otherwise
  // the timer would never count down once we started enforcing it.

  tick(game, dt) {
    const s = specialsState(game);
    if (!s || s.settleTimer <= 0) return;
    if (game.isClearing()) return;
    for (const p of game._plugins) {
      if (p === this) continue;
      if (p.freezesGameplay?.(game)) return;
    }
    s.settleTimer -= dt;
    if (s.settleTimer < 0) s.settleTimer = 0;
  },

  freezesGameplay(game) {
    const s = specialsState(game);
    if (!s || s.settleTimer <= 0) return false;
    // Only enforce the freeze when there's actually a level-up menu
    // queued. Without this gate, every Bomb during normal play would
    // lock input for SPECIAL_SETTLE_MS after the piece spawned, which
    // feels laggy. The timer still counts down silently in that case
    // and expires harmlessly.
    return game.pendingChoices > 0;
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
  // parallel boardGrid is independent — no ordering hazard. We
  // resolve each tagged mino through transformLocalCoord so rotation/
  // flip state is honored.

  onLock(game) {
    const piece = game.current;
    if (!piece?.specials) return;
    const s = specialsState(game);
    if (!s?.boardGrid) return;
    for (const sp of piece.specials) {
      const t = transformLocalCoord(piece, sp.rot0Row, sp.rot0Col);
      const x = piece.x + t.c;
      const y = piece.y + t.r;
      if (y < 0 || y >= s.boardGrid.length) continue;
      if (x < 0 || x >= s.boardGrid[0].length) continue;
      s.boardGrid[y][x] = sp.kind;
    }
  },

  // ---- Hold swap — preserve specials across the swap ----
  //
  // Game.holdPiece fires beforeHoldSwap before swapping current and
  // afterHoldSwap after. We use the bracket to:
  //   1. Stash the active piece's specials in _pendingHoldSpecials
  //      (module-scoped — only valid between the two hooks).
  //   2. After the swap, the new `current` is either the previously-
  //      held piece (no specials yet) or a fresh-from-queue piece
  //      (which got its own decoratePiece roll). Reattach the
  //      previously-held specials onto current if applicable, then
  //      promote our captured pending into holdSpecials so the next
  //      swap can restore it.

  beforeHoldSwap(game) {
    _pendingHoldSpecials = game.current?.specials
      ? game.current.specials.map(sp => ({ ...sp }))
      : null;
  },

  afterHoldSwap(game) {
    const s = specialsState(game);
    if (!s) return;
    // Restore previously-held specials onto the new active piece
    // (only the swap branch — the first-hold branch's new piece
    // came from spawnNext + decoratePiece, which already rolled its
    // own special if any; we don't overwrite that). Distinguish by
    // whether holdSpecials had anything to give back.
    if (s.holdSpecials && game.current && !game.current.specials) {
      game.current.specials = s.holdSpecials.map(sp => ({ ...sp }));
    }
    // The piece going INTO hold now becomes the held special.
    s.holdSpecials = _pendingHoldSpecials;
    _pendingHoldSpecials = null;
  },

  // ---- Line clear ----
  //
  // beforeClear fires INSIDE completeClear (and the gravity cascade's
  // completeCascadeClear) before removeRows runs. We:
  //   1. Capture which special-bearing cells are about to vanish.
  //   2. Mirror removeRows on boardGrid so post-clear rendering
  //      sees the right grid alignment.
  //   3. Stash the captured list for onClear to fire.

  beforeClear(game, rows) {
    const s = specialsState(game);
    if (!s?.boardGrid) return;
    const triggers = [];
    for (const r of rows) {
      const row = s.boardGrid[r];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const kind = row[c];
        if (kind) triggers.push({ kind, x: c, y: r });
      }
    }
    removeRowsSpecials(s.boardGrid, rows);
    s.pendingTriggers = triggers;
  },

  // onClear fires AFTER all standard scoring/spawn logic has run, so
  // triggers see the post-clear board. A cascade-triggering special
  // (Gravity) calls startGravityCascade; the cascade is idempotent
  // when one is already running, so a second Gravity special on the
  // same clear no-ops cleanly.

  onClear(game, _cleared) {
    const s = specialsState(game);
    if (!s) return;
    const list = s.pendingTriggers;
    s.pendingTriggers = null;
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
