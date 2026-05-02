// ============================================================
// Game — the top-level state machine
// ============================================================
//
// One instance of `Game` owns the board, the current piece,
// the queue, the score, and all timers. It exposes high-level
// actions (move, rotate, hardDrop, etc.) and a tick(dt) method
// that advances time. Rendering and input are kept separate.
//
// To extend the game (new mechanics, modes, power-ups), most
// changes will live here.
// ============================================================

import {
  GRAVITY, DAS, ARR, SOFT, LINE_SCORES, CLEAR_DURATION, CHISEL_DURATION,
  FILL_DURATION,
  SHAKE_DURATION, SHAKE_LOCK, SHAKE_HARDDROP,
  B2B_MULTIPLIER, COMBO_BONUS, PERFECT_CLEAR_BONUS,
  LOCK_DELAY,
  GRAVITY_POWER_STEP,
  MAX_CHISEL_CHARGES, MAX_FILL_CHARGES, MAX_FLIP_CHARGES,
  MAX_WHOOPS_CHARGES,
} from './constants.js';
import { newBoard, collides, lockPiece, findFullRows, removeRows } from './board.js';
import { spawn, tryMove, tryRotate, tryFlip, ghostPosition } from './piece.js';
import { bagShuffle, shapeOf } from './pieces.js';

export class Game {
  constructor() {
    this.reset();
  }

  // -------- Lifecycle --------

  reset() {
    this.board       = newBoard();
    this.queue       = [];
    this.hold        = null;
    this.canHold     = true;
    this.current     = null;
    this.score       = 0;
    this.lines       = 0;
    this.level       = 1;
    this.dropTimer   = 0;
    this.gameOver    = false;
    this.paused      = false;
    this.started     = false;
    this.softDropping = false;
    this.moveState   = { left: false, right: false, leftHeld: 0, rightHeld: 0, lastShift: 0 };
    // Line-clear animation state. While clearingRows is non-empty,
    // the game pauses gravity/input and the renderer plays the effect.
    this.clearingRows = [];
    this.clearTimer  = 0;
    // Board-shake state — set by triggerShake(), decayed in tick(),
    // read by main.js as a CSS transform on the canvas.
    this.shakeTimer     = 0;
    this.shakeIntensity = 0;
    // Bonus-scoring state.
    //   combo — cumulative number of LINES cleared in the current streak
    //           (resets when a piece locks without clearing).
    //           A single double-clear sets combo = 2.
    //           A Tetris followed by a single sets combo = 5.
    //   lastClearWasTetris — for the back-to-back bonus.
    this.combo              = 0;
    this.lastClearWasTetris = false;
    // Roguelite power-up state.
    //   unlocks         — which features the player has unlocked.
    //                     Power-ups (in js/powerups/) flip these flags.
    //   pendingChoices  — number of unspent power-up choices. While > 0,
    //                     the game freezes (handled in tick()) so the
    //                     UI can show a choice menu.
    this.unlocks = {
      hold:      false,
      ghost:     false,
      nextCount: 0,
      // Slick — when true, a grounded piece waits LOCK_DELAY ms before
      // locking and resets that window on every successful move/rotate,
      // letting the player make split-second adjustments. The timer
      // itself lives on `lockDelayTimer` below.
      slick:     false,
      // Chisel / Fill are banked consumables. Picking the power-up
      // adds a charge here (capped at MAX_*_CHARGES); pressing A / S
      // spends one to enter the cell-pick interaction. Charges persist
      // across pieces and clears so the player can save them for the
      // exact wrong-block moment that needs them.
      chiselCharges: 0,
      fillCharges: 0,
      // Flip — banked horizontal mirror of the active piece.
      // Pressing F spends one. Capped at MAX_FLIP_CHARGES.
      flipCharges: 0,
      // Whoops — banked one-shot rewind of the active piece. Pressing
      // W restores the world to just before the current piece spawned
      // (board, score, queue, hold, combo, level, pendingChoices, etc.)
      // and respawns that piece type fresh. Capped at MAX_WHOOPS_CHARGES.
      whoopsCharges: 0,
    };
    // Whoops uses a two-stage snapshot system:
    //
    //   prePieceSnapshot  — captured at the top of every spawnNext().
    //                       Reflects the world right before the
    //                       *currently active* piece existed. By itself
    //                       it would only let Whoops undo the in-flight
    //                       piece (rarely useful — you can just rotate
    //                       and try again).
    //
    //   whoopsSnapshot    — the actual undo target. Promoted from
    //                       prePieceSnapshot at the top of lockCurrent()
    //                       (i.e., the moment a piece commits). Survives
    //                       the next spawn, so pressing W during the
    //                       *next* piece (or during the line-clear
    //                       animation, or after a spawn-collision game
    //                       over) rewinds to before the just-locked
    //                       piece — which is what "undo your last
    //                       piece" actually means to the player.
    //
    // Both are captured unconditionally regardless of whether the
    // player owns Whoops, so picking the card mid-run works on the
    // very next lock instead of needing to "arm" first.
    this.prePieceSnapshot = null;
    this.whoopsSnapshot   = null;
    // Slick power-up timer. Counts up while the active piece is grounded
    // and Slick is unlocked; cleared on successful move/rotate, on spawn,
    // and after locking. Ignored entirely when `unlocks.slick` is false,
    // so the standard "lock immediately on collision" path is unchanged.
    this.lockDelayTimer = 0;
    this.pendingChoices = 0;
    // The very first line clear of a run grants a bonus power-up choice
    // so the player gets a taste of the roguelite progression early
    // without having to slog through 5 lines first. Curses ride along
    // with each card now, so this single bonus also delivers a free
    // curse. Flag flips once and stays flipped until reset().
    this.firstClearAwarded = false;
    // Curses — debuffs bundled with each power-up choice. Whichever
    // power-up card the player picks, they also accept its random
    // attached curse, so every upgrade has a cost.
    //   junk                — true once Junk has been picked. Picking the
    //                         curse drops a one-time batch of 3 junk rows
    //                         onto the board; flag is mostly used for HUD.
    //   hyped               — gravity-table offset added to (level - 1).
    //                         Stacks on each pick. 0 = normal speed.
    //   cruelUntilLevel  — while game.level <= this, the bag excludes
    //                         I-pieces. Picking Cruel sets it to the
    //                         current level → curse expires next level-up.
    this.curses = {
      junk: false,
      hyped: 0,
      cruelUntilLevel: 0,
      // Growth — every pick widens the playfield by one column on the
      // right edge. Stacks (caps at +5). The board itself stores the
      // live width; this counter only drives the HUD tag and the
      // pick-time cap in the curse's `available()` check.
      extraCols: 0,
    };
    // Chisel power-up state.
    //   active — set by the Chisel power-up's apply(); freezes gameplay
    //            and tells the renderer/UI to await a block click.
    //   target — once a block is picked, holds {x, y, type, timer} while
    //            the destruction animation plays. The block is removed
    //            from the board the instant it's picked; `type` is kept
    //            around purely so the animation can use the right color.
    //   cursor — {x, y} of the keyboard-driven block selector while
    //            chisel.active. Free-roams the grid so the player can
    //            navigate to any cell with arrow keys; only confirms
    //            when the cell holds a block. Null when chisel is idle.
    this.chisel = { active: false, target: null, cursor: null };
    // Fill power-up state — a mirror of `chisel`, but for *placing* a
    // block on an empty cell instead of removing one.
    //   active      — gameplay is frozen waiting for the player to pick
    //                 an empty cell. Renderer paints a hint + cursor.
    //   target      — once a cell is picked, holds {x, y, timer} while
    //                 the materialize animation plays. The block is
    //                 written to the board the instant it's picked.
    //   cursor      — {x, y} of the keyboard-driven cell selector.
    //                 Free-roams just like chisel.cursor.
    //   savedPiece  — when a fill placement *completes a line*, we
    //                 hand off to the standard line-clear animation
    //                 (which expects current === null and would normally
    //                 spawnNext on completion). To preserve the active
    //                 piece across a fill-triggered clear, we stash
    //                 it here and have completeClear() restore it
    //                 instead of spawning a fresh one.
    this.fill = { active: false, target: null, cursor: null, savedPiece: null };
    // Gravity power-up state — a one-shot board-compaction sequence.
    //   active     — true while the cascade is running. Freezes player
    //                input and the normal gravity drop in tick().
    //   savedPiece — the active piece is hidden from the board for the
    //                duration of the cascade (so falling locked blocks
    //                don't visually pass through it). Restored to
    //                `current` when the sequence ends.
    //   phase      — 'fall' while we're stepping blocks downward,
    //                'clearing' while a line-clear animation triggered
    //                by the cascade plays. After a clear we loop back
    //                to 'fall' to see if the now-shifted board can
    //                drop further.
    //   stepTimer  — accumulates dt; each time it crosses
    //                GRAVITY_POWER_STEP we run one fall step.
    this.gravity = { active: false, savedPiece: null, phase: 'fall', stepTimer: 0 };
    this.refillQueue();
  }

  // Try to spend one chisel charge and enter the cell-pick interaction.
  // Returns true on success, false if the keypress should be ignored.
  // Refuses while gameplay is otherwise frozen (paused, game over,
  // power-up menu open, line-clear or chisel/fill animation in
  // progress, or a chisel/fill session already active) so the player
  // can't double-spend or stall a clear animation. Also refuses on a
  // fully empty board — there'd be nothing to chisel.
  tryActivateChisel() {
    if (!this.started) return false;
    if (this.paused || this.gameOver) return false;
    if (this.pendingChoices > 0) return false;
    if (this.isClearing()) return false;
    if (this.chisel.active || this.chisel.target) return false;
    if (this.fill.active || this.fill.target) return false;
    if (this.gravity.active) return false;
    if (this.unlocks.chiselCharges <= 0) return false;
    // No locked block on the board → activating would just hang the
    // game waiting on a confirm that can't succeed. Refuse.
    const hasBlock = this.board.some(row => row.some(cell => cell !== null));
    if (!hasBlock) return false;
    this.unlocks.chiselCharges -= 1;
    this.chisel.active = true;
    this.chiselInitCursor();
    return true;
  }

  // Try to spend one Flip charge and horizontally mirror the active
  // piece. Returns true on success. Refuses while gameplay is frozen,
  // when there's no current piece, when the player has no charges, or
  // when the mirrored shape would collide at the current position
  // (player can move/rotate and try again — no charge spent).
  tryActivateFlip() {
    if (!this.started) return false;
    if (this.paused || this.gameOver) return false;
    if (this.pendingChoices > 0) return false;
    if (this.isClearing()) return false;
    if (this.chisel.active || this.chisel.target) return false;
    if (this.fill.active || this.fill.target) return false;
    if (this.gravity.active) return false;
    if (this.unlocks.flipCharges <= 0) return false;
    if (!this.current) return false;
    const flipped = tryFlip(this.board, this.current);
    if (!flipped) return false;
    this.unlocks.flipCharges -= 1;
    this.current = flipped;
    // Treat a successful flip as a player adjustment — refresh the
    // Slick lock-delay window so chaining flip + slide stays smooth.
    this.lockDelayTimer = 0;
    this.onFlip?.();                            // optional FX hook
    return true;
  }

  // Try to spend the Whoops charge and rewind to just before the
  // most recently locked piece spawned. Returns true on success.
  //
  // The undo target is `whoopsSnapshot`, which is promoted from
  // `prePieceSnapshot` at the top of lockCurrent(). Pressing W
  // when no piece has locked yet (very first piece of the run,
  // before any commit) refuses — there's nothing to undo.
  //
  // Gating differs slightly from other powerups:
  //   • Allowed during line-clear animation — we halt the animation
  //     and roll back, since the clear belongs to the piece being
  //     undone. The snapshot predates the clear, so the cleared
  //     rows come back automatically as part of the board restore.
  //   • Allowed from gameOver — the clutch use of Whoops is undoing
  //     the lock that led to a spawn-collision death.
  //   • Refused while paused, while a powerup choice menu is up,
  //     and while a chisel/fill cell-pick session is in progress.
  //     Those states own the input layer; rewinding under them
  //     would desync the UI.
  tryActivateWhoops() {
    if (this.unlocks.whoopsCharges <= 0) return false;
    if (!this.whoopsSnapshot) return false;
    if (this.paused) return false;
    if (this.pendingChoices > 0) return false;
    if (this.chisel.active || this.chisel.target) return false;
    if (this.fill.active || this.fill.target) return false;
    if (this.gravity.active) return false;
    const s = this.whoopsSnapshot;
    // Restore world state. Board and queue are deep-copied on
    // capture, so assigning the snapshot's references directly
    // would let later mutations alias the snapshot — copy again.
    this.board              = s.board.map(row => row.slice());
    this.queue              = s.queue.slice();
    this.hold               = s.hold;
    this.canHold            = s.canHold;
    this.score              = s.score;
    this.lines              = s.lines;
    this.level              = s.level;
    this.combo              = s.combo;
    this.lastClearWasTetris = s.lastClearWasTetris;
    this.firstClearAwarded  = s.firstClearAwarded;
    this.pendingChoices     = s.pendingChoices;
    // Halt any in-progress line-clear animation — restoring the
    // pre-clear board makes the flash visually wrong, and tick()
    // would otherwise call completeClear() on a board that no
    // longer has full rows to remove.
    this.clearingRows = [];
    this.clearTimer = 0;
    // Same for fill.savedPiece — if the rewind cancels a fill-
    // triggered clear, there's no saved piece to restore later.
    this.fill.savedPiece = null;
    // Bring the run back from the dead if the collision happened
    // on the spawn following the undone lock.
    this.gameOver = false;
    // Drop both snapshots so spawnNext can capture fresh state
    // from the just-restored world without aliasing or treating
    // pre-restore data as the new "undo target."
    this.whoopsSnapshot   = null;
    this.prePieceSnapshot = null;
    this.lockDelayTimer = 0;
    this.dropTimer = 0;
    this.spawnNext();
    this.unlocks.whoopsCharges -= 1;
    this.onWhoops?.();
    return true;
  }

  // -------- Gravity power-up --------
  //
  // One-shot blessing. Picking the card calls startGravity(); the
  // active piece is parked, all locked blocks fall to fill empty
  // space below them one row at a time (animated step-by-step in
  // tick()), full rows are cleared with the standard line-clear
  // animation/score, and the fall-then-clear loop repeats until the
  // board is stable. Then the active piece is restored and play
  // resumes.

  // Begin the gravity cascade. Idempotent — refuses to re-enter
  // if a sequence is already running. The active piece is moved
  // into `gravity.savedPiece` and `current` is cleared so the
  // renderer hides it for the duration (otherwise falling locked
  // blocks would visually pass through the piece's silhouette).
  startGravity() {
    if (this.gravity.active) return;
    this.gravity.active     = true;
    this.gravity.savedPiece = this.current;
    this.current            = null;
    this.gravity.phase      = 'fall';
    this.gravity.stepTimer  = 0;
    // Cancel any in-flight Slick lock-delay window — there's no
    // active piece for it to apply to during the cascade.
    this.lockDelayTimer     = 0;
    this.dropTimer          = 0;
  }

  // Perform one fall step over the locked-block grid. Every cell
  // that has a block above an empty space gets shifted down by one
  // row. Returns true if at least one block moved (caller uses this
  // to decide whether the cascade has settled).
  //
  // Iteration is bottom-up (rows-2 → 0) so a stack of N floating
  // blocks above a single gap doesn't collapse all N rows in one
  // step — only the bottommost floating block falls per call. That
  // gives the cascade its visible "rain" cadence; without it the
  // board would resolve in a single frame.
  gravityStep() {
    const rows = this.board.length;
    const cols = this.board[0]?.length ?? 10;
    let moved = false;
    for (let r = rows - 2; r >= 0; r--) {
      for (let c = 0; c < cols; c++) {
        if (this.board[r][c] && !this.board[r + 1][c]) {
          this.board[r + 1][c] = this.board[r][c];
          this.board[r][c]     = null;
          moved = true;
        }
      }
    }
    return moved;
  }

  // Complete a gravity-induced line clear. Mirrors completeClear()'s
  // scoring path (line score, B2B, combo, perfect-clear, lines/level,
  // milestone power-up choices) but does NOT spawn a new piece — the
  // saved piece is restored at the end of the whole cascade by
  // endGravity(), not after every clear. After scoring, we loop back
  // into the 'fall' phase to see if the cleared rows expose more
  // floating blocks that can now drop.
  gravityCompleteClear() {
    const cleared = this.clearingRows.length;
    removeRows(this.board, this.clearingRows);

    const wasB2B = (cleared === 4 && this.lastClearWasTetris);

    let lineScore = LINE_SCORES[cleared] * this.level;
    if (wasB2B) lineScore = Math.floor(lineScore * B2B_MULTIPLIER);
    this.score += lineScore;

    this.combo += cleared;
    this.score += COMBO_BONUS * this.combo * this.level;

    this.lastClearWasTetris = (cleared === 4);

    const perfect = this.board.every(row => row.every(cell => cell === null));
    if (perfect) this.score += PERFECT_CLEAR_BONUS;

    const linesBefore = this.lines;
    this.lines += cleared;
    this.level = Math.floor(this.lines / 10) + 1;

    // Roguelite power-up milestones — same rule as completeClear().
    // The choice menu won't surface until endGravity() fires the
    // onGravityComplete hook, so any picks earned mid-cascade queue
    // up cleanly behind the animation.
    let milestonesEarned =
      Math.floor(this.lines / 5) - Math.floor(linesBefore / 5);
    if (!this.firstClearAwarded && cleared > 0) {
      this.firstClearAwarded = true;
      milestonesEarned += 1;
    }
    if (milestonesEarned > 0) {
      this.pendingChoices += milestonesEarned;
      this.onPowerUpChoice?.(this.pendingChoices);
    }

    if (perfect)         this.onPerfectClear?.();
    if (cleared === 4)   this.onTetris?.(wasB2B);
    if (this.combo >= 2) this.onCombo?.(this.combo);

    this.clearingRows = [];
    this.clearTimer = 0;
    // Cleared rows may have exposed more floating blocks above —
    // continue the cascade.
    this.gravity.phase     = 'fall';
    this.gravity.stepTimer = 0;
  }

  // Wrap up the gravity cascade and hand control back to the player.
  // Restores the saved piece into `current`. If the (extremely
  // unlikely) restoration overlaps a block — e.g. a clever Fill /
  // Junk-row interaction shifted blocks under the parked piece —
  // we end the run, mirroring the standard spawn-collision rule.
  endGravity() {
    this.gravity.active = false;
    if (this.gravity.savedPiece) {
      this.current = this.gravity.savedPiece;
      this.gravity.savedPiece = null;
      if (collides(this.board, this.current)) {
        this.gameOver = true;
      }
    }
    this.gravity.phase     = 'fall';
    this.gravity.stepTimer = 0;
    // Reset gravity-drop accumulator so the restored piece doesn't
    // immediately fall a row from leftover dt collected pre-cascade.
    this.dropTimer = 0;
    // Lets main.js re-open any choice menu deferred by gravity.active.
    this.onGravityComplete?.();
  }

  // Mirror of tryActivateChisel for fill. Same gating rules; the
  // empty-cell check is the inverse — refuse if the board is fully
  // packed (which would also imply game over, but we guard anyway).
  tryActivateFill() {
    if (!this.started) return false;
    if (this.paused || this.gameOver) return false;
    if (this.pendingChoices > 0) return false;
    if (this.isClearing()) return false;
    if (this.chisel.active || this.chisel.target) return false;
    if (this.fill.active || this.fill.target) return false;
    if (this.gravity.active) return false;
    if (this.unlocks.fillCharges <= 0) return false;
    const hasEmpty = this.board.some(row => row.some(cell => cell === null));
    if (!hasEmpty) return false;
    this.unlocks.fillCharges -= 1;
    this.fill.active = true;
    this.fillInitCursor();
    return true;
  }

  // Seed the chisel cursor on the topmost-leftmost filled cell so the
  // highlight starts on a meaningful block. Falls back to (0, 0) only
  // if the board is somehow empty (tryActivateChisel guards against
  // this, so the fallback should be unreachable in practice).
  chiselInitCursor() {
    const cols = this.board[0]?.length ?? 10;
    for (let r = 0; r < this.board.length; r++) {
      for (let c = 0; c < cols; c++) {
        if (this.board[r][c]) {
          this.chisel.cursor = { x: c, y: r };
          return;
        }
      }
    }
    this.chisel.cursor = { x: 0, y: 0 };
  }

  // Move the chisel cursor by (dx, dy), clamped to board bounds.
  // Cursor moves freely over empty cells too — the player can use it
  // as a normal pointer; only confirming an empty cell is a no-op.
  chiselMoveCursor(dx, dy) {
    if (!this.chisel.active || !this.chisel.cursor) return;
    const cols = this.board[0]?.length ?? 10;
    const rows = this.board.length;
    const nx = Math.max(0, Math.min(cols - 1, this.chisel.cursor.x + dx));
    const ny = Math.max(0, Math.min(rows - 1, this.chisel.cursor.y + dy));
    // Only fire the cursor-move hook when the position actually changed
    // (clamping at a board edge means a keypress can be a no-op — and
    // we don't want a UI tick for a no-op).
    const moved = nx !== this.chisel.cursor.x || ny !== this.chisel.cursor.y;
    this.chisel.cursor = { x: nx, y: ny };
    if (moved) this.onCursorMove?.();
  }

  // Keyboard-confirm the cursor cell. Defers to chiselSelect, which
  // already returns false for empty cells so misfires are harmless.
  chiselConfirm() {
    if (!this.chisel.active || !this.chisel.cursor) return false;
    return this.chiselSelect(this.chisel.cursor.x, this.chisel.cursor.y);
  }

  // Seed the fill cursor on the bottom-leftmost empty cell — most
  // fill targets will be near the bottom of the stack (filling in
  // gaps to complete a line), so starting low minimizes travel.
  // Falls back to the spawn area if the board is somehow completely
  // full (the power-up's `available` guard makes this unlikely).
  fillInitCursor() {
    const cols = this.board[0]?.length ?? 10;
    for (let r = this.board.length - 1; r >= 0; r--) {
      for (let c = 0; c < cols; c++) {
        if (!this.board[r][c]) {
          this.fill.cursor = { x: c, y: r };
          return;
        }
      }
    }
    this.fill.cursor = { x: 0, y: 0 };
  }

  // Move the fill cursor by (dx, dy), clamped to board bounds.
  // Same free-roaming behavior as chiselMoveCursor.
  fillMoveCursor(dx, dy) {
    if (!this.fill.active || !this.fill.cursor) return;
    const cols = this.board[0]?.length ?? 10;
    const rows = this.board.length;
    const nx = Math.max(0, Math.min(cols - 1, this.fill.cursor.x + dx));
    const ny = Math.max(0, Math.min(rows - 1, this.fill.cursor.y + dy));
    // Match chiselMoveCursor — suppress the hook when clamping makes the
    // press a no-op so we don't double-tick at the board edge.
    const moved = nx !== this.fill.cursor.x || ny !== this.fill.cursor.y;
    this.fill.cursor = { x: nx, y: ny };
    if (moved) this.onCursorMove?.();
  }

  // Keyboard-confirm the cursor cell. Defers to fillSelect, which
  // returns false for filled cells (and cells under the active piece)
  // so misfires are harmless.
  fillConfirm() {
    if (!this.fill.active || !this.fill.cursor) return false;
    return this.fillSelect(this.fill.cursor.x, this.fill.cursor.y);
  }

  // Apply a chosen power-up. Decrements the pending count so the next
  // queued choice (if any) can be presented.
  applyPowerUp(powerup) {
    powerup.apply(this);
    this.pendingChoices = Math.max(0, this.pendingChoices - 1);
  }

  // Apply a chosen curse. Mirrors applyPowerUp — main.js calls this
  // alongside applyPowerUp when the player picks a bundled card so
  // both the buff and its attached debuff land in one pick.
  applyCurse(curse) {
    curse.apply(this);
  }

  // Growth curse — widen the board by one column, on the right
  // edge so existing block positions and the active piece are unaffected.
  // Each row gets a trailing null appended; the renderer and click-to-cell
  // helpers read width from board[0].length so they pick the change up
  // automatically. Returns the new column count.
  addColumn() {
    for (const row of this.board) row.push(null);
    return this.board[0].length;
  }

  // Push a junk row onto the bottom of the board, shifting everything
  // up by one. The junk row is filled with the dedicated 'JUNK' cell
  // type — rendered in a muted slate gray (see COLORS.JUNK) so the
  // player can tell rubble apart from real placed pieces at a glance.
  // One column is left empty so the row can theoretically be cleared.
  // If shifting up causes the active piece to overlap a block, the
  // game ends (mirrors how spawn-on-collision triggers game over).
  addJunkRow() {
    this.board.shift();
    const COLS = this.board[0]?.length ?? 10;
    const gap = Math.floor(Math.random() * COLS);
    const row = [];
    for (let c = 0; c < COLS; c++) {
      row.push(c === gap ? null : 'JUNK');
    }
    this.board.push(row);
    if (this.current && collides(this.board, this.current)) {
      this.gameOver = true;
    }
  }

  // Drops a batch of 3 junk rows in one go. Stops early if
  // the game already ended (so we don't keep mutating after game over).
  // Returns how many rows actually got placed so callers can drive UI.
  addJunkBatch() {
    const count = 3;
    let placed = 0;
    for (let i = 0; i < count; i++) {
      if (this.gameOver) break;
      this.addJunkRow();
      placed += 1;
    }
    return placed;
  }

  // Rain curse helper — drops 5-10 junk blocks into random columns,
  // one-shot. Each block lands on top of whatever is already stacked
  // in its column (or on the floor if the column is empty), as if it
  // had been hard-dropped. Columns that are filled all the way to
  // the top are skipped, and we avoid landing inside the active
  // piece to prevent unfair instant overlaps. Multiple blocks can
  // hit the same column — they pile up in arrival order. Returns
  // the number of blocks actually placed.
  addRainBlocks() {
    const ROWS = this.board.length;
    const COLS = this.board[0]?.length ?? 10;
    const want = 5 + Math.floor(Math.random() * 6); // 5-10
    let placed = 0;
    for (let i = 0; i < want; i++) {
      // Each drop independently picks any column that still has
      // headroom right now — that's how the same column can stack
      // up under multiple raindrops in a row.
      const candidates = [];
      for (let c = 0; c < COLS; c++) {
        if (!this.board[0][c]) candidates.push(c);
      }
      if (candidates.length === 0) break;
      const c = candidates[Math.floor(Math.random() * candidates.length)];
      // Find the topmost filled cell in this column; the junk lands
      // one row above it. Empty column → land on the floor.
      let landingRow = ROWS - 1;
      for (let r = 0; r < ROWS; r++) {
        if (this.board[r][c]) { landingRow = r - 1; break; }
      }
      if (landingRow < 0) continue;                      // packed full
      if (this.isCellUnderActivePiece(c, landingRow)) continue; // don't trap the piece
      this.board[landingRow][c] = 'JUNK';
      placed += 1;
    }
    // Defensive — landing on top of the stack shouldn't intersect the
    // active piece, but if a placement *did* land under one (e.g. the
    // piece is mid-soft-drop above an empty column), end the run.
    if (this.current && collides(this.board, this.current)) {
      this.gameOver = true;
    }
    return placed;
  }

  // Player picked a block to chisel out. Returns true if the click hit
  // a filled cell; false (and no state change) otherwise so the UI can
  // ignore the click. The block is removed immediately — the timer on
  // chisel.target only drives the visual shatter effect.
  chiselSelect(x, y) {
    if (!this.chisel.active) return false;
    if (x < 0 || x >= this.board[0].length || y < 0 || y >= this.board.length) return false;
    const type = this.board[y][x];
    if (!type) return false;                 // empty cell — let the player try again
    this.board[y][x] = null;
    this.chisel.active = false;
    this.chisel.cursor = null;
    this.chisel.target = { x, y, type, timer: 0 };
    this.onChiselHit?.();                    // optional FX hook
    return true;
  }

  // True iff (x, y) is one of the cells currently occupied by the
  // active piece. Used by fillSelect to refuse placement under the
  // active piece — placing a locked block where a piece already lives
  // would either trap the player or force an instant game-over.
  isCellUnderActivePiece(x, y) {
    if (!this.current) return false;
    const s = shapeOf(this.current);
    for (let r = 0; r < s.length; r++) {
      for (let c = 0; c < s[r].length; c++) {
        if (!s[r][c]) continue;
        if (this.current.x + c === x && this.current.y + r === y) return true;
      }
    }
    return false;
  }

  // Player picked an empty cell to fill. Returns true if the click
  // hit a valid (empty, not under active piece) cell; false otherwise
  // so the UI can ignore the click and let the player try again.
  // The block is written to the board immediately as type 'FILL';
  // the timer on fill.target only drives the materialize visual.
  fillSelect(x, y) {
    if (!this.fill.active) return false;
    if (x < 0 || x >= this.board[0].length || y < 0 || y >= this.board.length) return false;
    if (this.board[y][x]) return false;        // already filled — no-op
    if (this.isCellUnderActivePiece(x, y)) return false; // would trap the active piece
    this.board[y][x] = 'FILL';
    this.fill.active = false;
    this.fill.cursor = null;
    this.fill.target = { x, y, timer: 0 };
    this.onFillHit?.();                       // optional FX hook
    return true;
  }

  // Called from tick() once the fill materialize animation finishes.
  // Checks whether the new block completed any rows; if so, kicks off
  // the standard line-clear animation. The active piece is preserved
  // across the clear — see `fill.savedPiece` in reset().
  fillComplete() {
    this.fill.target = null;
    const fullRows = findFullRows(this.board);
    if (fullRows.length === 0) {
      // No clear → just resume play. Notify main.js so any deferred
      // power-up / curse menu can finally surface.
      this.onFillComplete?.();
      return;
    }
    // Hand off to the standard clear flow. Hide the current piece so
    // completeClear()'s spawnNext() doesn't fire on an active piece;
    // we'll restore it from fill.savedPiece in completeClear().
    this.fill.savedPiece = this.current;
    this.current = null;
    this.clearingRows = fullRows;
    this.clearTimer = 0;
    this.onLineClear?.(fullRows.length);
  }

  // Kick off a shake. Larger calls overwrite — hard drops will
  // therefore "win" over the small lock shake fired by lockCurrent().
  triggerShake(intensity) {
    this.shakeIntensity = intensity;
    this.shakeTimer = 0;
  }

  // Current shake offset in pixels — damped oscillation, mostly vertical.
  shakeOffset() {
    if (this.shakeIntensity <= 0 || this.shakeTimer >= SHAKE_DURATION) {
      return { x: 0, y: 0 };
    }
    const t     = this.shakeTimer / SHAKE_DURATION;
    const decay = 1 - t;
    const phase = t * Math.PI * 6;        // ~3 oscillations
    return {
      x: this.shakeIntensity * 0.35 * Math.sin(phase * 1.7) * decay,
      y: this.shakeIntensity        * Math.sin(phase)       * decay,
    };
  }

  // True while a line-clear animation is playing.
  isClearing() {
    return this.clearingRows.length > 0;
  }

  // Animation progress 0..1 — used by the renderer.
  clearProgress() {
    return Math.min(1, this.clearTimer / CLEAR_DURATION);
  }

  // Chisel-shatter animation progress 0..1, or null if no target.
  chiselProgress() {
    if (!this.chisel.target) return null;
    return Math.min(1, this.chisel.target.timer / CHISEL_DURATION);
  }

  // Fill-materialize animation progress 0..1, or null if no target.
  fillProgress() {
    if (!this.fill.target) return null;
    return Math.min(1, this.fill.target.timer / FILL_DURATION);
  }

  start() {
    this.reset();
    this.started = true;
    this.spawnNext();
  }

  togglePause() {
    if (this.gameOver || !this.started) return;
    this.paused = !this.paused;
  }

  // -------- Piece management --------

  refillQueue() {
    // While the Cruel curse is active for this level, exclude I-pieces
    // from the bag. The bag is re-evaluated every refill, so as soon as
    // the player levels past `cruelUntilLevel` the I-piece returns.
    while (this.queue.length < 7) {
      const allowI = this.level > this.curses.cruelUntilLevel;
      this.queue.push(...bagShuffle(allowI));
    }
  }

  spawnNext() {
    this.refillQueue();
    // Whoops snapshot — captured BEFORE the queue shift / spawn so
    // that restoring it puts the about-to-spawn piece type back at
    // queue[0] and the world looks exactly as it did one frame
    // before this piece existed. Captures everything the line-clear
    // path can mutate (board, score, lines/level, combo, B2B,
    // pendingChoices, firstClearAwarded) plus the carry-state
    // (queue, hold, canHold) so an undo across a hold-swap or a
    // milestone-crossing clear is fully reversible.
    const peekedType = this.queue[0];
    this.prePieceSnapshot = {
      board:              this.board.map(row => row.slice()),
      queue:              this.queue.slice(),
      hold:               this.hold,
      canHold:            this.canHold,
      score:              this.score,
      lines:              this.lines,
      level:              this.level,
      combo:              this.combo,
      lastClearWasTetris: this.lastClearWasTetris,
      firstClearAwarded:  this.firstClearAwarded,
      pendingChoices:     this.pendingChoices,
      pieceType:          peekedType,
    };
    const type = this.queue.shift();
    this.current = spawn(type);
    this.canHold = true;
    // Fresh piece — clear any leftover lock-delay window from the
    // previous piece so Slick starts measuring from this piece's
    // first grounded frame.
    this.lockDelayTimer = 0;
    // If the new piece spawns into a filled cell, the game is over.
    if (collides(this.board, this.current)) {
      this.gameOver = true;
    }
  }

  // -------- Player actions --------
  // All player actions are no-ops if there's no active piece — this
  // protects against input during the line-clear animation.

  move(dx) {
    if (!this.current) return;
    const next = tryMove(this.board, this.current, dx, 0);
    if (next) {
      this.current = next;
      // Slick "step reset": any successful adjustment refreshes the
      // lock-delay window so the player can chain inputs into a slot.
      this.lockDelayTimer = 0;
    }
  }

  rotate(dir) {
    if (!this.current) return;
    const next = tryRotate(this.board, this.current, dir);
    if (next) {
      this.current = next;
      this.lockDelayTimer = 0; // Slick step reset (see move()).
    }
  }

  softDrop() {
    if (!this.current) return;
    const next = tryMove(this.board, this.current, 0, 1);
    if (next) {
      this.current = next;
      this.score += 1; // 1 point per soft-dropped cell
    } else {
      // With Slick unlocked, defer locking to the lock-delay timer in
      // tick() so the player gets a brief window to adjust. Without
      // Slick, locking is immediate (the original behavior).
      if (this.unlocks.slick) return;
      this.lockCurrent();
    }
  }

  hardDrop() {
    if (!this.current) return;
    let drops = 0;
    while (true) {
      const next = tryMove(this.board, this.current, 0, 1);
      if (!next) break;
      this.current = next;
      drops++;
    }
    this.score += drops * 2; // 2 points per hard-dropped cell
    this.lockCurrent();
    // Bigger shake for longer falls — gives hard drops their "weight".
    // Fires AFTER lockCurrent so it overwrites the small lock shake.
    this.triggerShake(Math.min(8, SHAKE_HARDDROP + drops * 0.18));
  }

  holdPiece() {
    if (!this.current || !this.canHold) return;
    if (!this.unlocks.hold) return; // gated behind a power-up
    const t = this.current.type;
    if (this.hold) {
      this.current = spawn(this.hold);
      if (collides(this.board, this.current)) this.gameOver = true;
    } else {
      // First-hold branch: stash the held piece and pull the next from
      // the queue. spawnNext would normally overwrite prePieceSnapshot,
      // but for Whoops semantics this hold action shouldn't replace
      // the undo target — pressing W should rewind to before the
      // *held* piece existed (returning the held piece to play, with
      // the just-shifted piece going back to the front of the queue).
      // Save & restore the snapshot around the call.
      const savedSnapshot = this.prePieceSnapshot;
      this.spawnNext();
      this.prePieceSnapshot = savedSnapshot;
    }
    this.hold = t;
    this.canHold = false;
  }

  // -------- Lock & line clear --------

  lockCurrent() {
    // Whoops bookmark — the moment a piece commits, promote the
    // pre-spawn snapshot to the undo target. This is what lets the
    // player press W *after* the next piece has already spawned and
    // still rewind to before THIS piece. The snapshot itself was
    // taken at spawn time, so it predates any soft/hard-drop scoring
    // and any clears this lock is about to trigger — restoring it
    // unwinds all of those in one assignment.
    if (this.prePieceSnapshot) {
      this.whoopsSnapshot = this.prePieceSnapshot;
    }

    lockPiece(this.board, this.current);
    this.triggerShake(SHAKE_LOCK); // small bounce on every placement
    this.onLock?.(); // optional sound / FX hook (set by main.js)

    const fullRows = findFullRows(this.board);
    if (fullRows.length > 0) {
      // Start the clear animation. The rows stay on the board — the
      // renderer will paint them with the clearing effect, and tick()
      // will call completeClear() when CLEAR_DURATION elapses.
      this.clearingRows = fullRows;
      this.clearTimer = 0;
      this.current = null; // hide the piece; spawn deferred until clear completes
      this.onLineClear?.(fullRows.length); // fires at start of animation
    } else {
      // No clear → combo broken. (B2B is preserved across non-clearing
      // placements; only a non-Tetris clear breaks B2B.)
      this.combo = 0;
      this.spawnNext();
    }
  }

  // Called from tick() once the clear animation finishes.
  completeClear() {
    const cleared = this.clearingRows.length;
    removeRows(this.board, this.clearingRows);

    // Capture the B2B flag before we mutate state — needed for both the
    // bonus calculation and the visual notification below.
    const wasB2B = (cleared === 4 && this.lastClearWasTetris);

    // Base line score (current level — level-up happens after).
    let lineScore = LINE_SCORES[cleared] * this.level;
    if (wasB2B) lineScore = Math.floor(lineScore * B2B_MULTIPLIER);
    this.score += lineScore;

    // Combo bonus: combo accumulates the actual line count, then awards
    // COMBO_BONUS × combo × level. So a Tetris in a streak pays much
    // more than a single, and chains of multi-line clears compound fast.
    this.combo += cleared;
    this.score += COMBO_BONUS * this.combo * this.level;

    // Update B2B state. Only a Tetris keeps the chain alive — a Single,
    // Double, or Triple breaks it.
    this.lastClearWasTetris = (cleared === 4);

    // Perfect Clear: flat bonus when the board is fully empty.
    const perfect = this.board.every(row => row.every(cell => cell === null));
    if (perfect) this.score += PERFECT_CLEAR_BONUS;

    const linesBefore = this.lines;
    const oldLevel = this.level;
    this.lines += cleared;
    this.level = Math.floor(this.lines / 10) + 1;

    // (Junk curse used to drop another batch on every level-up here;
    // it's now a one-shot hit at pick time, so nothing to do on
    // level-up.)

    // Roguelite power-up milestone — every 5 lines earns a choice.
    // (Max 1 per clear since clears top out at 4 lines.) The very
    // first line clear of a run also earns a bonus choice on top of
    // any milestone, so a starting tetris awards 2 power-ups.
    // Each card in the resulting menu carries its own random curse
    // (see js/main.js) — there's no separate curse milestone anymore.
    let milestonesEarned =
      Math.floor(this.lines / 5) - Math.floor(linesBefore / 5);
    if (!this.firstClearAwarded && cleared > 0) {
      this.firstClearAwarded = true;
      milestonesEarned += 1;
    }
    if (milestonesEarned > 0) {
      this.pendingChoices += milestonesEarned;
      this.onPowerUpChoice?.(this.pendingChoices);
    }

    // Visual / FX hooks — fired in importance order so the notification
    // stack reads top-to-bottom: PERFECT > TETRIS/B2B > COMBO.
    if (perfect)         this.onPerfectClear?.();
    if (cleared === 4)   this.onTetris?.(wasB2B);
    if (this.combo >= 2) this.onCombo?.(this.combo);

    this.clearingRows = [];
    this.clearTimer = 0;
    // If this clear was triggered by Fill (rather than a piece lock),
    // the player still has an active piece on screen — we stashed it in
    // fill.savedPiece in fillComplete(). Restore it instead of
    // spawning a fresh one. If the saved piece happens to overlap a
    // block left behind in a non-cleared row, that's a legitimate game
    // over (same rule as spawn-collision elsewhere).
    if (this.fill.savedPiece) {
      this.current = this.fill.savedPiece;
      this.fill.savedPiece = null;
      if (collides(this.board, this.current)) this.gameOver = true;
      this.onFillComplete?.();
    } else {
      this.spawnNext();
    }
  }

  // -------- Held-key controls (DAS / ARR / soft drop) --------

  startMove(dir) {
    if (dir < 0) {
      this.moveState.left = true;
      this.moveState.leftHeld = 0;
    } else {
      this.moveState.right = true;
      this.moveState.rightHeld = 0;
    }
    this.moveState.lastShift = 0;
  }

  stopMove(dir) {
    if (dir < 0) this.moveState.left = false;
    else this.moveState.right = false;
  }

  startSoftDrop() {
    this.softDropping = true;
    this.dropTimer = SOFT; // make the next gravity tick fire immediately
  }

  stopSoftDrop() {
    this.softDropping = false;
  }

  // -------- Per-frame update --------

  tick(dt) {
    if (!this.started || this.paused || this.gameOver) return;

    // Gravity power-up cascade. Owns its own line-clear sub-state
    // ('fall' vs 'clearing') so a gravity-triggered clear can flow
    // straight back into another fall step instead of spawning a
    // new piece the way the standard line-clear path does.
    //
    // Checked BEFORE the pendingChoices guard because a clear
    // triggered mid-cascade can earn a milestone (bumping
    // pendingChoices > 0), and we must keep stepping the cascade
    // through that interval — the menu itself is deferred by
    // main.js's gravity.active gate, so it'll open cleanly once
    // endGravity() fires.
    if (this.gravity.active) {
      // Let the board shake decay alongside the cascade so a recent
      // hard-drop tremor doesn't freeze mid-shake for the duration.
      if (this.shakeIntensity > 0) {
        this.shakeTimer += dt;
        if (this.shakeTimer >= SHAKE_DURATION) {
          this.shakeIntensity = 0;
          this.shakeTimer = 0;
        }
      }
      if (this.gravity.phase === 'clearing') {
        this.clearTimer += dt;
        if (this.clearTimer >= CLEAR_DURATION) this.gravityCompleteClear();
        return;
      }
      // 'fall' phase — accumulate dt and run a step each time the
      // step interval elapses. A single dt slice can span multiple
      // steps (low frame rate), so loop until we're back under it.
      this.gravity.stepTimer += dt;
      while (this.gravity.stepTimer >= GRAVITY_POWER_STEP) {
        this.gravity.stepTimer -= GRAVITY_POWER_STEP;
        const moved = this.gravityStep();
        if (!moved) {
          // Cascade settled. Any full rows? If so kick off the
          // standard clear animation; gravityCompleteClear() will
          // resume the fall loop after the animation finishes.
          const fullRows = findFullRows(this.board);
          if (fullRows.length > 0) {
            this.clearingRows  = fullRows;
            this.clearTimer    = 0;
            this.gravity.phase = 'clearing';
            this.onLineClear?.(fullRows.length);
          } else {
            this.endGravity();
          }
          break;
        }
      }
      return;
    }

    // Freeze gameplay while the power-up choice menu is open.
    if (this.pendingChoices > 0) return;

    // Chisel: while waiting for the player to pick a block, gameplay
    // is frozen. While the destruction animation plays, gameplay is
    // also frozen — but the timer must keep advancing so the animation
    // ends. We update the timer here, then return early.
    if (this.chisel.active) return;
    if (this.chisel.target) {
      this.chisel.target.timer += dt;
      if (this.chisel.target.timer >= CHISEL_DURATION) {
        this.chisel.target = null;
        this.onChiselComplete?.();          // tells main.js to resume the menu queue
      }
      return;
    }

    // Fill: same shape as chisel — frozen while waiting for the
    // player to pick a cell, frozen-but-animating while the
    // materialize effect plays. fillComplete() runs the line-clear
    // check (which may itself kick off the standard clear animation
    // flow handled below).
    if (this.fill.active) return;
    if (this.fill.target) {
      this.fill.target.timer += dt;
      if (this.fill.target.timer >= FILL_DURATION) {
        this.fillComplete();
      }
      return;
    }

    // Decay any active board shake (continues during line-clear animations).
    if (this.shakeIntensity > 0) {
      this.shakeTimer += dt;
      if (this.shakeTimer >= SHAKE_DURATION) {
        this.shakeIntensity = 0;
        this.shakeTimer = 0;
      }
    }

    // Line-clear animation takes precedence — pause gravity & input
    // while the cleared rows flash and wipe.
    if (this.isClearing()) {
      this.clearTimer += dt;
      if (this.clearTimer >= CLEAR_DURATION) this.completeClear();
      return;
    }

    // Auto-shift held movement (DAS → ARR)
    const ms = this.moveState;
    if (ms.left || ms.right) {
      const dir = ms.left ? -1 : 1;
      const heldKey = dir === -1 ? 'leftHeld' : 'rightHeld';
      ms[heldKey] += dt;
      if (ms[heldKey] > DAS) {
        ms.lastShift += dt;
        while (ms.lastShift >= ARR) {
          this.move(dir);
          ms.lastShift -= ARR;
        }
      }
    }

    // Apply gravity. The Hyped curse adds an offset to the level lookup
    // so pieces fall faster than the player's actual level would imply.
    const gravityIdx = Math.min(
      this.level - 1 + this.curses.hyped,
      GRAVITY.length - 1,
    );
    const gravityMs = this.softDropping
      ? SOFT
      : GRAVITY[Math.max(0, gravityIdx)];
    this.dropTimer += dt;
    while (this.dropTimer >= gravityMs) {
      this.dropTimer -= gravityMs;
      this.softDrop();
      if (this.gameOver) break;
    }

    // Slick lock-delay. While the active piece is grounded (the next
    // gravity step would collide), accumulate the lock timer; lock
    // when it overflows. The instant the piece is no longer grounded
    // (player slid it off a ledge), reset to 0. softDrop() above is
    // already a no-op for grounded pieces when Slick is unlocked, so
    // the only path that retires the piece is this timer or a hard
    // drop. move()/rotate() reset the timer on success for step-reset.
    if (this.unlocks.slick && this.current && !this.isClearing()) {
      const grounded = !tryMove(this.board, this.current, 0, 1);
      if (grounded) {
        this.lockDelayTimer += dt;
        if (this.lockDelayTimer >= LOCK_DELAY) {
          this.lockDelayTimer = 0;
          this.lockCurrent();
        }
      } else {
        this.lockDelayTimer = 0;
      }
    }
  }

  // -------- Helpers used by the renderer --------

  ghostY() {
    return this.current ? ghostPosition(this.board, this.current) : 0;
  }
}
