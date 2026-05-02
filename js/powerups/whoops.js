// Power-up: Whoops — banked one-shot rewind. Pressing W after the
// player picks this card undoes the most recently locked piece: the
// cells it placed are removed, any rows it cleared come back fully
// populated, the score (line bonus + soft/hard drop points + combo +
// B2B + perfect-clear) snaps back, lines and level revert, queue/hold
// revert, and the piece is respawned fresh at the top so the player
// gets a do-over.
//
// This module exports a single object with two roles:
//
//   1. Power-up card (id, name, description, available, apply) —
//      consumed by the choice-menu / power-up registry.
//
//   2. Lifecycle plugin (onSpawn, onLock, beforeHoldSwap,
//      afterHoldSwap, interceptInput) — registered on the Game in
//      main.js. The two snapshot slots used to live on Game.* but
//      they're purely Whoops business, so they now live as module-
//      level state in this file.
//
// Snapshot model (two stages):
//
//   prePieceSnapshot  Captured by onSpawn after every spawnNext().
//                     Reflects the world right before the now-active
//                     piece exists. By itself this would only let
//                     Whoops undo the in-flight piece (rarely useful —
//                     you can just rotate and try again).
//
//   whoopsSnapshot    The actual undo target. Promoted from
//                     prePieceSnapshot in onLock — the moment a piece
//                     commits, the snapshot becomes the rewind point
//                     for the *next* W press, regardless of how many
//                     pieces have spawned since.
//
// Hold interaction (beforeHoldSwap / afterHoldSwap):
//   The first-hold branch in Game.holdPiece() calls spawnNext to pull
//   the next-from-queue piece. That triggers onSpawn, which would
//   normally overwrite prePieceSnapshot — but a hold isn't a fresh
//   piece. Bracket the swap with beforeHoldSwap/afterHoldSwap so the
//   pre-existing snapshot survives.
//
// Capture timing detail:
//   Game.spawnNext fires onSpawn AFTER `queue.shift()` and `spawn()`,
//   so by the time we capture, `game.current` is the new piece and
//   `game.queue` no longer contains its type. We reconstruct the
//   pre-shift queue as `[game.current.type, ...game.queue]` so the
//   later restore + spawnNext() round-trip puts the same piece back
//   in play with the same upcoming queue order.

import { MAX_WHOOPS_CHARGES } from '../constants.js';
import { collides } from '../board.js';

// Module-level snapshot state. Reset to null on game reset so a
// restart doesn't carry over rewind history from the previous run.
let prePieceSnapshot = null;
let whoopsSnapshot   = null;

// Stash for beforeHoldSwap → afterHoldSwap. Module-scoped, but only
// non-null inside that single bracketed call.
let heldDuringSwap = null;

function captureSnapshot(game) {
  return {
    board:              game.board.map(row => row.slice()),
    // Mirror of `board` for the special-block tags. Deep-copied so a
    // later mutation can't alias the snapshot. The active piece's own
    // `specials` field is intentionally NOT preserved — restore goes
    // through spawnNext, which re-rolls decoratePiece, so the
    // respawned piece may carry a different special (or none). That's
    // by design: rewinding shouldn't lock in a known-good roll.
    boardSpecials:      game.boardSpecials
                          ? game.boardSpecials.map(row => row.slice())
                          : null,
    // Pre-shift queue: prepend the just-spawned piece type so
    // restore + spawnNext() reproduces the exact same draw order.
    queue:              [game.current.type, ...game.queue],
    hold:               game.hold,
    // Hold's specials slot — preserved alongside `hold` so a rewind
    // brings back not just the held piece type but its tagged mino.
    // Deep-cloned so later mutations on the live array can't alias
    // the snapshot.
    holdSpecials:       game.holdSpecials
                          ? game.holdSpecials.map(s => ({ ...s }))
                          : null,
    canHold:            game.canHold,
    score:              game.score,
    lines:              game.lines,
    level:              game.level,
    combo:              game.combo,
    lastClearWasTetris: game.lastClearWasTetris,
    firstClearAwarded:  game.firstClearAwarded,
    pendingChoices:     game.pendingChoices,
  };
}

export default {
  id: 'whoops',
  name: 'Whoops',
  description: 'Press W to undo your last piece. One charge.',
  available: (game) => game.unlocks.whoopsCharges < MAX_WHOOPS_CHARGES,
  apply: (game) => {
    game.unlocks.whoopsCharges = Math.min(
      MAX_WHOOPS_CHARGES,
      game.unlocks.whoopsCharges + 1,
    );
  },

  // ---- lifecycle hooks ----

  reset() {
    prePieceSnapshot = null;
    whoopsSnapshot   = null;
    heldDuringSwap   = null;
  },

  onSpawn(game) {
    // A spawn-collision game over still spawns a piece (just one that
    // doesn't fit). We capture anyway — Whoops' clutch use case is
    // undoing the lock that triggered exactly that death.
    if (!game.current) return;
    prePieceSnapshot = captureSnapshot(game);
  },

  onLock() {
    if (prePieceSnapshot) whoopsSnapshot = prePieceSnapshot;
  },

  beforeHoldSwap() {
    heldDuringSwap = prePieceSnapshot;
  },

  afterHoldSwap() {
    prePieceSnapshot = heldDuringSwap;
    heldDuringSwap = null;
  },

  interceptInput(game, action) {
    if (action !== 'whoops') return false;
    // Charge & snapshot gate first so we don't consume the keypress
    // when there's nothing to do (caller treats falsy return as
    // unhandled, but for W there's no fallback — false is fine).
    if (game.unlocks.whoopsCharges <= 0) return false;
    if (!whoopsSnapshot) return false;
    // Gating differs slightly from other powerups:
    //   • Allowed during line-clear animation — we halt the animation
    //     and roll back, since the clear belongs to the piece being
    //     undone. The snapshot predates the clear, so the cleared
    //     rows come back automatically as part of the board restore.
    //   • Allowed from gameOver — the clutch use of Whoops is undoing
    //     the lock that led to a spawn-collision death.
    //   • Refused while paused, while a powerup choice menu is up,
    //     and while any plugin is mid-modal (Chisel/Fill/Gravity).
    if (game.paused) return false;
    if (game.pendingChoices > 0) return false;
    if (game._isFrozenByPlugin()) return false;

    const s = whoopsSnapshot;
    // Restore world state. Board and queue are deep-copied on
    // capture; copy again on restore so later mutations don't alias
    // the snapshot.
    game.board              = s.board.map(row => row.slice());
    if (s.boardSpecials) {
      game.boardSpecials = s.boardSpecials.map(row => row.slice());
    }
    game.queue              = s.queue.slice();
    game.hold               = s.hold;
    game.holdSpecials       = s.holdSpecials
                                ? s.holdSpecials.map(sp => ({ ...sp }))
                                : null;
    game.canHold            = s.canHold;
    game.score              = s.score;
    game.lines              = s.lines;
    game.level              = s.level;
    game.combo              = s.combo;
    game.lastClearWasTetris = s.lastClearWasTetris;
    game.firstClearAwarded  = s.firstClearAwarded;
    game.pendingChoices     = s.pendingChoices;
    // Halt any in-progress line-clear animation — restoring the
    // pre-clear board makes the flash visually wrong, and tick()
    // would otherwise call completeClear() on a board that no
    // longer has full rows to remove.
    game.clearingRows = [];
    game.clearTimer = 0;
    // Same for fill.savedPiece — if the rewind cancels a fill-
    // triggered clear, there's no saved piece to restore later.
    if (game.fill) game.fill.savedPiece = null;
    // Bring the run back from the dead if the collision happened
    // on the spawn following the undone lock.
    game.gameOver = false;
    // Drop both snapshots so spawnNext can capture fresh state from
    // the just-restored world without aliasing or treating pre-
    // restore data as the new "undo target."
    whoopsSnapshot   = null;
    prePieceSnapshot = null;
    game.lockDelayTimer = 0;
    game.dropTimer = 0;
    game.spawnNext();
    // spawnNext can flip gameOver if the restored top-of-queue piece
    // collides — that's a legitimate end (the player asked for the
    // restore and got back to the same dead board). Either way, the
    // charge is spent.
    game.unlocks.whoopsCharges -= 1;
    game.onWhoops?.();
    return true;
  },
};
