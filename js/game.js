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
  GRAVITY, DAS, ARR, SOFT, LINE_SCORES, CLEAR_DURATION,
  SHAKE_DURATION, SHAKE_LOCK, SHAKE_HARDDROP,
} from './constants.js';
import { newBoard, collides, lockPiece, findFullRows, removeRows } from './board.js';
import { spawn, tryMove, tryRotate, ghostPosition } from './piece.js';
import { bagShuffle } from './pieces.js';

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
    this.refillQueue();
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
    while (this.queue.length < 7) this.queue.push(...bagShuffle());
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
    const fullRows = findFullRows(this.board);
    if (fullRows.length > 0) {
      // Start the clear animation. The rows stay on the board — the
      // renderer will paint them with the clearing effect, and tick()
      // will call completeClear() when CLEAR_DURATION elapses.
      this.clearingRows = fullRows;
      this.clearTimer = 0;
      this.current = null; // hide the piece; spawn deferred until clear completes
    } else {
      this.spawnNext();
    }
  }

  // Called from tick() once the clear animation finishes.
  completeClear() {
    const cleared = this.clearingRows.length;
    removeRows(this.board, this.clearingRows);
    this.score += LINE_SCORES[cleared] * this.level;
    this.lines += cleared;
    this.level = Math.floor(this.lines / 10) + 1;
    this.clearingRows = [];
    this.clearTimer = 0;
    this.spawnNext();
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

    // Apply gravity
    const gravityMs = this.softDropping
      ? SOFT
      : GRAVITY[Math.min(this.level - 1, GRAVITY.length - 1)];
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
