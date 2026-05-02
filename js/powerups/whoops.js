// Power-up: Whoops — unlock-once rewind ability. Once picked,
// pressing W undoes the most recently locked piece: the cells it
// placed are removed, any rows it cleared come back fully populated,
// the score (line bonus + soft/hard drop points + combo + B2B +
// perfect-clear) snaps back, lines and level revert, queue/hold
// revert, and the piece is respawned fresh at the top so the player
// gets a do-over. Each cast arms a per-cast cooldown
// (COOLDOWN_LINES line clears) so the player can't chain rewinds
// every other piece.
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

import { COOLDOWN_LINES } from '../constants.js';
import { collides } from '../board.js';

// Module-level snapshot state. Reset to null on game reset so a
// restart doesn't carry over rewind history from the previous run.
let prePieceSnapshot = null;
let whoopsSnapshot   = null;

// Stash for beforeHoldSwap → afterHoldSwap. Module-scoped, but only
// non-null inside that single bracketed call.
let heldDuringSwap = null;

function captureSnapshot(game) {
  // Engine-level state Whoops always captures by name — these are
  // the canonical "world" fields that don't belong to any plugin.
  // Per-plugin state is captured generically via the serialize hook
  // below, so a new plugin's state automatically survives a Whoops
  // rewind without Whoops needing to know about it.
  const plugins = {};
  for (const p of game._plugins) {
    if (p.id && typeof p.serialize === 'function') {
      plugins[p.id] = p.serialize(game);
    }
  }
  return {
    board:              game.board.map(row => row.slice()),
    // Pre-shift queue: prepend the just-spawned piece type so
    // restore + spawnNext() reproduces the exact same draw order.
    queue:              [game.current.type, ...game.queue],
    hold:               game.hold,
    canHold:            game.canHold,
    score:              game.score,
    lines:              game.lines,
    level:              game.level,
    combo:              game.combo,
    lastClearWasTetris: game.lastClearWasTetris,
    firstClearAwarded:  game.firstClearAwarded,
    pendingChoices:     game.pendingChoices,
    plugins,
  };
}

export default {
  id: 'whoops',
  name: 'Whoops',
  description: 'Press W to undo your last piece. 5-line cooldown.',
  available: (game) => !game.unlocks.whoops,
  apply: (game) => {
    game.unlocks.whoops = true;
  },

  // ---- lifecycle hooks ----

  reset(game) {
    prePieceSnapshot = null;
    whoopsSnapshot   = null;
    heldDuringSwap   = null;
    // Cooldown lives in the plugin-state bag — that's the slot the
    // HUD reads to render the cooldown progress tag. Deliberately
    // NOT exposed via serialize/restore: a Whoops rewind shouldn't
    // refund its OWN cooldown (and module-level state aside, the
    // bag entry is just the HUD's view onto it).
    game._pluginState.whoops = { cooldown: 0 };
  },

  // Tick the per-cast cooldown down once per cleared line.
  onClear(game, cleared) {
    const s = game._pluginState.whoops;
    if (!s) return;
    if (s.cooldown > 0) s.cooldown = Math.max(0, s.cooldown - cleared);
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
    if (!game.unlocks.whoops) return false;
    if (!whoopsSnapshot) return false;
    // Per-cast cooldown — once the player has cast Whoops, the next
    // cast is locked behind COOLDOWN_LINES line clears even if a
    // fresh charge shows up before the timer drains. The HUD
    // surfaces this as a "WHOOPS CD N/5" tag.
    if (game._pluginState.whoops?.cooldown > 0) return false;
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
    game.queue              = s.queue.slice();
    game.hold               = s.hold;
    game.canHold            = s.canHold;
    // Per-plugin state — generic restore loop. Each plugin that
    // exposed serialize() also exposes restore(); we hand it the
    // captured snap and let it deep-copy as it sees fit.
    if (s.plugins) {
      for (const p of game._plugins) {
        if (p.id && typeof p.restore === 'function' && p.id in s.plugins) {
          p.restore(game, s.plugins[p.id]);
        }
      }
    }
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
    if (game._pluginState.fill) game._pluginState.fill.savedPiece = null;
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
    // unlock stays — the cast itself is gated behind the cooldown
    // armed below, not behind a consumable charge.
    // Arm the per-cast cooldown. Set AFTER the rewind so the bag
    // slot we just (re-)wrote isn't clobbered by the restore loop;
    // since whoops itself doesn't expose serialize/restore, the bag
    // is untouched by the rewind anyway, but explicit > implicit.
    if (game._pluginState.whoops) {
      game._pluginState.whoops.cooldown = COOLDOWN_LINES;
    } else {
      game._pluginState.whoops = { cooldown: COOLDOWN_LINES };
    }
    game.onWhoops?.();
    return true;
  },
};
