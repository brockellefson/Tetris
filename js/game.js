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
  CHISEL_DURATION, FILL_DURATION,
  SHAKE_DURATION, SHAKE_LOCK, SHAKE_HARDDROP,
  B2B_MULTIPLIER, COMBO_BONUS, PERFECT_CLEAR_BONUS,
} from './constants.js';
import { newBoard, collides, lockPiece, findFullRows, removeRows } from './board.js';
import { spawn, tryMove, tryRotate, ghostPosition } from './piece.js';
import { bagShuffle, shapeOf } from './pieces.js';

export class Game {
  constructor() {
    // Plugins must exist before reset() so plugin.reset() hooks can fire
    // on the very first reset (called from this constructor and again on
    // every game.start()). main.js registers plugins after construction;
    // those plugins' init() runs immediately, and their reset() hook
    // fires from the next game.start().
    this._plugins = [];
    this.reset();
  }

  // -------- Plugin system --------
  //
  // Lifecycle hooks for self-contained gameplay extensions (Slick,
  // Whoops, Chisel, Fill, Gravity). Each plugin is a plain object with
  // any subset of the hook fields below. Game calls into them at fixed
  // dispatch points and otherwise stays ignorant of their existence.
  //
  // Hook contract — every hook receives `game` as the first arg.
  //   init(game)             once on registerPlugin()
  //   reset(game)            on every Game.reset()
  //   tick(game, dt)         every frame, BEFORE the freeze check —
  //                          plugins manage their own animation timers
  //                          even while another plugin freezes the
  //                          main tick body.
  //   freezesGameplay(game)  return true to skip the rest of tick()
  //                          (DAS / gravity / standard line-clear). Used
  //                          by modal plugins (Chisel cell-pick, Fill
  //                          cell-pick, Gravity cascade).
  //   onSpawn(game)          after spawnNext() installs a new current
  //                          piece. Whoops uses this to snapshot.
  //   onLock(game)           at the top of lockCurrent(), before the
  //                          board mutation. Whoops promotes the
  //                          pre-spawn snapshot here.
  //   onClear(game, cleared) at the end of completeClear(), after
  //                          score/level have been updated.
  //   onPlayerAdjustment(game, kind)
  //                          fires for any successful move / rotate /
  //                          flip. Slick uses this for its step-reset.
  //   beforeHoldSwap(game) / afterHoldSwap(game)
  //                          fired around holdPiece()'s internal
  //                          spawnNext on the first-hold branch, so
  //                          Whoops can preserve its undo target across
  //                          the swap (otherwise spawnNext's onSpawn
  //                          would overwrite it).
  //   shouldDeferLock(game)  return true to skip softDrop()'s
  //                          immediate lock-on-collision. Slick gates
  //                          locking behind its lock-delay window via
  //                          this hook.
  //   interceptInput(game, action) -> boolean
  //                          a plugin returning true claims the action
  //                          (used by Chisel/Fill/Whoops to handle
  //                          their A / S / W keys without Game needing
  //                          per-power-up tryActivate* methods).

  registerPlugin(plugin) {
    this._plugins.push(plugin);
    plugin.init?.(this);
  }

  _notifyPlugins(event, ...args) {
    for (const p of this._plugins) p[event]?.(this, ...args);
  }

  _tickPlugins(dt) {
    for (const p of this._plugins) p.tick?.(this, dt);
  }

  _isFrozenByPlugin() {
    for (const p of this._plugins) {
      if (p.freezesGameplay?.(this)) return true;
    }
    return false;
  }

  _shouldDeferLock() {
    for (const p of this._plugins) {
      if (p.shouldDeferLock?.(this)) return true;
    }
    return false;
  }

  // Returns true if any plugin claimed the action. Extra args
  // (e.g. boardClick coords) are forwarded to the plugin.
  _interceptInput(action, ...args) {
    for (const p of this._plugins) {
      if (p.interceptInput?.(this, action, ...args)) return true;
    }
    return false;
  }

  // Threads a value through every plugin that exposes `event` as a
  // method, letting plugins layer modifiers on top of an engine
  // value (e.g. Hyped bumps the gravity-table lookup index). Each
  // plugin's hook receives (game, currentValue, ...args) and returns
  // the new value. Order is registration order — first plugin sees
  // the engine default; later plugins see the prior plugin's output.
  _reduceHookValue(event, value, ...args) {
    for (const p of this._plugins) {
      if (p[event]) value = p[event](this, value, ...args);
    }
    return value;
  }

  // Veto-style poll: returns true unless any plugin's `event(game,
  // ...args)` returns false. Used for "is this allowed?" gates that
  // any plugin can refuse (e.g. Cruel forbidding I-pieces in the
  // bag refill).
  _allowedByAllPlugins(event, ...args) {
    for (const p of this._plugins) {
      if (p[event] && p[event](this, ...args) === false) return false;
    }
    return true;
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
    // (Whoops snapshot state — prePieceSnapshot / whoopsSnapshot —
    // used to live here. It now lives as module-level state inside
    // js/powerups/whoops.js, captured by the plugin's onSpawn /
    // onLock hooks and consumed by its interceptInput.)
    //
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
    // Plugins reset AFTER all the standard fields, so a plugin can read
    // the freshly-initialized board / queue / unlocks if it needs them.
    this._notifyPlugins('reset');
  }

  // ----------------------------------------------------------------
  // The following gameplay extensions used to live as Game methods
  // and have since moved to their own plugin modules. Game dispatches
  // into them via the hook bus (registerPlugin / _interceptInput /
  // _notifyPlugins / _reduceHookValue / _allowedByAllPlugins):
  //
  //   tryActivateChisel  → js/powerups/chisel.js  ('chisel:activate')
  //   chisel cursor/pick → js/powerups/chisel.js  ('cursor:*' / 'boardClick')
  //   tryActivateFill    → js/powerups/fill.js    ('fill:activate')
  //   fill cursor/pick   → js/powerups/fill.js    ('cursor:*' / 'boardClick')
  //   tryActivateFlip    → js/powerups/flip.js    ('flip:activate')
  //   tryActivateWhoops  → js/powerups/whoops.js  ('whoops')
  //   gravity cascade    → js/powerups/gravity.js (apply + tick + freezesGameplay)
  //   slick lock-delay   → js/powerups/slick.js   (tick + shouldDeferLock)
  //   addColumn/tryRemoveColumn → js/curses/growth.js (apply / 'growth:removeColumn')
  //   addJunkRow/addJunkBatch   → js/curses/junk.js   (apply)
  //   addRainBlocks            → js/curses/rain.js   (apply)
  //   gravity index modifier   → js/curses/hyped.js  (modifyGravityIndex)
  //   bag piece filter         → js/curses/cruel.js  (allowsBagPiece)
  //
  // The state slots they read/write (game.chisel, game.fill,
  // game.gravity, game.curses, game.unlocks, game.lockDelayTimer)
  // still live on Game so the renderer / HUD can read them.
  // ----------------------------------------------------------------

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
    // Plugins can veto specific piece types via the allowsBagPiece
    // hook (Cruel uses it to filter out I-pieces while the curse is
    // active). The bag is re-evaluated every refill, so as soon as
    // the player levels past Cruel's window the I-piece returns.
    const allowsType = (type) => this._allowedByAllPlugins('allowsBagPiece', type);
    while (this.queue.length < 7) {
      this.queue.push(...bagShuffle(allowsType));
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
    // Plugin hook fires AFTER the spawn (and the collision check) so
    // plugins see the new `current` and a possibly-set `gameOver`.
    // Whoops captures its pre-spawn snapshot here (reconstructing the
    // pre-shift queue from `current.type` + remaining queue); Slick
    // resets its lock-delay window for the fresh piece.
    this._notifyPlugins('onSpawn');
  }

  // -------- Player actions --------
  // All player actions are no-ops if there's no active piece — this
  // protects against input during the line-clear animation.

  move(dx) {
    if (!this.current) return;
    const next = tryMove(this.board, this.current, dx, 0);
    if (next) {
      this.current = next;
      // Notify plugins of a successful adjustment. Slick uses this for
      // its step-reset (refresh the lock-delay window).
      this._notifyPlugins('onPlayerAdjustment', 'move');
    }
  }

  rotate(dir) {
    if (!this.current) return;
    const next = tryRotate(this.board, this.current, dir);
    if (next) {
      this.current = next;
      this._notifyPlugins('onPlayerAdjustment', 'rotate');
    }
  }

  softDrop() {
    if (!this.current) return;
    const next = tryMove(this.board, this.current, 0, 1);
    if (next) {
      this.current = next;
      this.score += 1; // 1 point per soft-dropped cell
    } else {
      // Lock immediately unless a plugin (e.g., Slick) wants to defer
      // — in which case it's responsible for eventually calling
      // lockCurrent() itself, typically from its own tick().
      if (this._shouldDeferLock()) return;
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
      // the queue. spawnNext would normally fire onSpawn, which
      // overwrites Whoops' pre-spawn snapshot — but pressing W after a
      // hold should rewind to before the *held* piece existed, not
      // before the pulled-from-queue piece. Bracket the spawn with
      // beforeHoldSwap / afterHoldSwap so Whoops can preserve its
      // existing snapshot across the swap.
      this._notifyPlugins('beforeHoldSwap');
      this.spawnNext();
      this._notifyPlugins('afterHoldSwap');
    }
    this.hold = t;
    this.canHold = false;
  }

  // -------- Lock & line clear --------

  lockCurrent() {
    // Plugin hook — fires BEFORE the board mutates so plugins can
    // capture pre-lock state (Whoops promotes its pre-spawn snapshot
    // to the undo target here; the snapshot's whole purpose is to
    // predate the lock and any clears it triggers).
    this._notifyPlugins('onLock');

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
    // Plugin hook — fires after scoring is fully applied. Gravity uses
    // this to loop back into another fall step; Fill uses it to know
    // a fill-triggered clear has wrapped up.
    this._notifyPlugins('onClear', cleared);
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

    // Plugins tick every frame, even while another plugin is freezing
    // the rest of the loop. Each plugin self-gates internally based on
    // its own state (Chisel only advances when chisel.target exists,
    // Slick only checks lock-delay when unlocks.slick is on, etc.) so
    // this is cheap when no plugin is currently active.
    this._tickPlugins(dt);

    // Decay any active board shake unconditionally — pure visual,
    // never paused by any freeze. (Used to be ducked into individual
    // freeze branches; lifting it out keeps the shake silky during
    // modals and the gravity cascade alike.)
    if (this.shakeIntensity > 0) {
      this.shakeTimer += dt;
      if (this.shakeTimer >= SHAKE_DURATION) {
        this.shakeIntensity = 0;
        this.shakeTimer = 0;
      }
    }

    // Plugin freeze takes priority over the choice menu — Gravity
    // milestones earned mid-cascade can bump pendingChoices > 0, and
    // we need the cascade to keep ticking through that interval. The
    // menu itself stays deferred by main.js's gravity.active /
    // chisel/fill checks until endGravity (or chisel/fill complete)
    // fires its onComplete hook.
    if (this._isFrozenByPlugin()) return;

    // Freeze gameplay while the power-up choice menu is open.
    if (this.pendingChoices > 0) return;

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

    // Apply gravity. Plugins can modify the gravity-table lookup index
    // via the modifyGravityIndex hook (Hyped adds +1 per stack to
    // make pieces fall faster than the player's actual level implies).
    const gravityIdx = Math.min(
      this._reduceHookValue('modifyGravityIndex', this.level - 1),
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
