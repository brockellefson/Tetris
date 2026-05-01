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
  POLISH_DURATION,
  SHAKE_DURATION, SHAKE_LOCK, SHAKE_HARDDROP,
  B2B_MULTIPLIER, COMBO_BONUS, PERFECT_CLEAR_BONUS,
} from './constants.js';
import { newBoard, collides, lockPiece, findFullRows, removeRows } from './board.js';
import { spawn, tryMove, tryRotate, ghostPosition } from './piece.js';
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
      // Number of extra columns granted by the Growth Spurt power-up.
      // Caps at 5 (the highest tier). The board itself stores the actual
      // width — this counter is just for the unlock-gating UI and reset.
      extraCols: 0,
    };
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
    //                         curse drops a one-time batch of 3-5 junk rows
    //                         onto the board; flag is mostly used for HUD.
    //   hyped               — gravity-table offset added to (level - 1).
    //                         Stacks on each pick. 0 = normal speed.
    //   flexibleUntilLevel  — while game.level <= this, the bag excludes
    //                         I-pieces. Picking Flexible sets it to the
    //                         current level → curse expires next level-up.
    this.curses = {
      junk: false,
      hyped: 0,
      flexibleUntilLevel: 0,
      rain: false,
    };
    // Rain curse: counts piece placements while curses.rain is active.
    // Rolls over to 0 after every batch of 5 — see lockCurrent().
    this.placementCount = 0;
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
    // Polish power-up state — a mirror of `chisel`, but for *placing* a
    // block on an empty cell instead of removing one.
    //   active      — gameplay is frozen waiting for the player to pick
    //                 an empty cell. Renderer paints a hint + cursor.
    //   target      — once a cell is picked, holds {x, y, timer} while
    //                 the materialize animation plays. The block is
    //                 written to the board the instant it's picked.
    //   cursor      — {x, y} of the keyboard-driven cell selector.
    //                 Free-roams just like chisel.cursor.
    //   savedPiece  — when a polish placement *completes a line*, we
    //                 hand off to the standard line-clear animation
    //                 (which expects current === null and would normally
    //                 spawnNext on completion). To preserve the active
    //                 piece across a polish-triggered clear, we stash
    //                 it here and have completeClear() restore it
    //                 instead of spawning a fresh one.
    this.polish = { active: false, target: null, cursor: null, savedPiece: null };
    this.refillQueue();
  }

  // Seed the chisel cursor on the topmost-leftmost filled cell so the
  // highlight starts on a meaningful block. Called by the chisel power-up
  // immediately after activating. Falls back to (0, 0) only if the board
  // is somehow empty (the power-up's `available` guard prevents this).
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
    this.chisel.cursor = { x: nx, y: ny };
  }

  // Keyboard-confirm the cursor cell. Defers to chiselSelect, which
  // already returns false for empty cells so misfires are harmless.
  chiselConfirm() {
    if (!this.chisel.active || !this.chisel.cursor) return false;
    return this.chiselSelect(this.chisel.cursor.x, this.chisel.cursor.y);
  }

  // Seed the polish cursor on the bottom-leftmost empty cell — most
  // polish targets will be near the bottom of the stack (filling in
  // gaps to complete a line), so starting low minimizes travel.
  // Falls back to the spawn area if the board is somehow completely
  // full (the power-up's `available` guard makes this unlikely).
  polishInitCursor() {
    const cols = this.board[0]?.length ?? 10;
    for (let r = this.board.length - 1; r >= 0; r--) {
      for (let c = 0; c < cols; c++) {
        if (!this.board[r][c]) {
          this.polish.cursor = { x: c, y: r };
          return;
        }
      }
    }
    this.polish.cursor = { x: 0, y: 0 };
  }

  // Move the polish cursor by (dx, dy), clamped to board bounds.
  // Same free-roaming behavior as chiselMoveCursor.
  polishMoveCursor(dx, dy) {
    if (!this.polish.active || !this.polish.cursor) return;
    const cols = this.board[0]?.length ?? 10;
    const rows = this.board.length;
    const nx = Math.max(0, Math.min(cols - 1, this.polish.cursor.x + dx));
    const ny = Math.max(0, Math.min(rows - 1, this.polish.cursor.y + dy));
    this.polish.cursor = { x: nx, y: ny };
  }

  // Keyboard-confirm the cursor cell. Defers to polishSelect, which
  // returns false for filled cells (and cells under the active piece)
  // so misfires are harmless.
  polishConfirm() {
    if (!this.polish.active || !this.polish.cursor) return false;
    return this.polishSelect(this.polish.cursor.x, this.polish.cursor.y);
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

  // Growth Spurt power-up — widen the board by one column, on the right
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

  // Drops a random batch of 3-5 junk rows in one go. Stops early if
  // the game already ended (so we don't keep mutating after game over).
  // Returns how many rows actually got placed so callers can drive UI.
  addJunkBatch() {
    const count = 3 + Math.floor(Math.random() * 3); // 3, 4, or 5
    let placed = 0;
    for (let i = 0; i < count; i++) {
      if (this.gameOver) break;
      this.addJunkRow();
      placed += 1;
    }
    return placed;
  }

  // Rain curse helper — scatters a random number (1-3) of junk blocks
  // across the top row's currently-empty cells. Pieces spawn at row 0
  // or row -1, so a rain block landing in a spawn-occupied column will
  // trigger game-over via the spawn-collision check on the *next*
  // spawnNext() call. Returns the number of blocks actually placed.
  addRainBlocks() {
    const COLS = this.board[0]?.length ?? 10;
    const empties = [];
    for (let c = 0; c < COLS; c++) {
      if (!this.board[0][c]) empties.push(c);
    }
    if (empties.length === 0) return 0;
    // Fisher-Yates so we pick distinct random columns.
    for (let i = empties.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [empties[i], empties[j]] = [empties[j], empties[i]];
    }
    const count = Math.min(empties.length, 1 + Math.floor(Math.random() * 3));
    for (let i = 0; i < count; i++) {
      this.board[0][empties[i]] = 'JUNK';
    }
    // If a rain block landed inside the active piece, it's game over.
    if (this.current && collides(this.board, this.current)) {
      this.gameOver = true;
    }
    return count;
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
  // active piece. Used by polishSelect to refuse placement under the
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

  // Player picked an empty cell to polish. Returns true if the click
  // hit a valid (empty, not under active piece) cell; false otherwise
  // so the UI can ignore the click and let the player try again.
  // The block is written to the board immediately as type 'POLISH';
  // the timer on polish.target only drives the materialize visual.
  polishSelect(x, y) {
    if (!this.polish.active) return false;
    if (x < 0 || x >= this.board[0].length || y < 0 || y >= this.board.length) return false;
    if (this.board[y][x]) return false;        // already filled — no-op
    if (this.isCellUnderActivePiece(x, y)) return false; // would trap the active piece
    this.board[y][x] = 'POLISH';
    this.polish.active = false;
    this.polish.cursor = null;
    this.polish.target = { x, y, timer: 0 };
    this.onPolishHit?.();                       // optional FX hook
    return true;
  }

  // Called from tick() once the polish materialize animation finishes.
  // Checks whether the new block completed any rows; if so, kicks off
  // the standard line-clear animation. The active piece is preserved
  // across the clear — see `polish.savedPiece` in reset().
  polishComplete() {
    this.polish.target = null;
    const fullRows = findFullRows(this.board);
    if (fullRows.length === 0) {
      // No clear → just resume play. Notify main.js so any deferred
      // power-up / curse menu can finally surface.
      this.onPolishComplete?.();
      return;
    }
    // Hand off to the standard clear flow. Hide the current piece so
    // completeClear()'s spawnNext() doesn't fire on an active piece;
    // we'll restore it from polish.savedPiece in completeClear().
    this.polish.savedPiece = this.current;
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

  // Polish-materialize animation progress 0..1, or null if no target.
  polishProgress() {
    if (!this.polish.target) return null;
    return Math.min(1, this.polish.target.timer / POLISH_DURATION);
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
    // While the Flexible curse is active for this level, exclude I-pieces
    // from the bag. The bag is re-evaluated every refill, so as soon as
    // the player levels past `flexibleUntilLevel` the I-piece returns.
    while (this.queue.length < 7) {
      const allowI = this.level > this.curses.flexibleUntilLevel;
      this.queue.push(...bagShuffle(allowI));
    }
  }

  spawnNext() {
    this.refillQueue();
    const type = this.queue.shift();
    this.current = spawn(type);
    this.canHold = true;
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
    if (next) this.current = next;
  }

  rotate(dir) {
    if (!this.current) return;
    const next = tryRotate(this.board, this.current, dir);
    if (next) this.current = next;
  }

  softDrop() {
    if (!this.current) return;
    const next = tryMove(this.board, this.current, 0, 1);
    if (next) {
      this.current = next;
      this.score += 1; // 1 point per soft-dropped cell
    } else {
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
      this.spawnNext();
    }
    this.hold = t;
    this.canHold = false;
  }

  // -------- Lock & line clear --------

  lockCurrent() {
    lockPiece(this.board, this.current);
    this.triggerShake(SHAKE_LOCK); // small bounce on every placement
    this.onLock?.(); // optional sound / FX hook (set by main.js)

    // Rain curse: every 5th placement, drop a fresh batch of junk
    // blocks into the top row. Done before findFullRows so newly-rained
    // blocks can still complete a full row that the lock just made.
    if (this.curses.rain) {
      this.placementCount += 1;
      if (this.placementCount >= 5) {
        this.placementCount = 0;
        const placed = this.addRainBlocks();
        if (placed > 0) this.onRain?.(placed);
      }
    }

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
    // If this clear was triggered by Polish (rather than a piece lock),
    // the player still has an active piece on screen — we stashed it in
    // polish.savedPiece in polishComplete(). Restore it instead of
    // spawning a fresh one. If the saved piece happens to overlap a
    // block left behind in a non-cleared row, that's a legitimate game
    // over (same rule as spawn-collision elsewhere).
    if (this.polish.savedPiece) {
      this.current = this.polish.savedPiece;
      this.polish.savedPiece = null;
      if (collides(this.board, this.current)) this.gameOver = true;
      this.onPolishComplete?.();
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

    // Polish: same shape as chisel — frozen while waiting for the
    // player to pick a cell, frozen-but-animating while the
    // materialize effect plays. polishComplete() runs the line-clear
    // check (which may itself kick off the standard clear animation
    // flow handled below).
    if (this.polish.active) return;
    if (this.polish.target) {
      this.polish.target.timer += dt;
      if (this.polish.target.timer >= POLISH_DURATION) {
        this.polishComplete();
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
  }

  // -------- Helpers used by the renderer --------

  ghostY() {
    return this.current ? ghostPosition(this.board, this.current) : 0;
  }
}
