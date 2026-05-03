// ============================================================
// Garbage plugin — bridges chains and nuisance puyos in versus
// ============================================================
//
// Two responsibilities, both running off Game's existing lifecycle
// hooks (no new engine surface area):
//
//   1. OUTGOING: every onClear during a chain accumulates outgoing
//      nuisance based on the score delta that step contributed.
//      When the cascade settles and a fresh piece spawns, flush
//      the accumulated count via the match controller. The
//      opponent receives a single 'garbage' event per chain
//      regardless of how many steps it had — one event per
//      "attack."
//
//   2. INCOMING: 'garbage' messages from the match controller
//      pile into a queue. When the player's next piece spawns,
//      drain the queue by calling dropNuisance(game, count) so
//      the gray puyos land on top of their stack.
//
// The plugin gates on `modes: ['puyo-versus']` so it stays inert
// in single-player Puyo and Tetris. It needs a match controller
// to do anything useful — the splash flow (Phase 2) calls
// attachMatchController() right before kicking off the run, and
// detachMatchController() on game-over / restart.
//
// Nuisance formula:
//   per_step = floor(cells × chainPower(step) × level / TARGET)
//
// TARGET = 70 mirrors arcade Puyo's standard. With our chain power
// table that's: 4-cell singles send 0, 4-step chains send ~3
// nuisance, 5+ chains send 10+. Tunable by changing TARGET — the
// architecture doesn't depend on the number.

import { dropNuisance } from '../nuisance.js';
// Pull the same scoring helper the match policy uses for game.score
// so outgoing nuisance stays in lockstep with displayed payout —
// any future tweak to chain power, group bonus, or color bonus
// flows through both score and versus pressure simultaneously.
import { pointsForStep } from '../match-policy.js';

// Points-per-nuisance-cell. Lower = nuisance flies more freely;
// higher = chains have to be bigger to threaten the opponent.
//
// Tuning history:
//   70 — arcade-canonical (Puyo Puyo 1991). Singles send 0; only
//        real chains threaten the opponent. Felt anemic in our
//        playtests — popping 4-groups one at a time produced
//        nothing on the opponent's side.
//   40 — Mean Bean Machine feel. Single 4-clears send 1 (constant
//        trickle of pressure); 5-clears send 3 (group bonus pops);
//        2-chains send 9, 4-chains around 57 (still board-filling
//        at the high end). Matches the back-and-forth tempo
//        casual MBM play has.
const NUISANCE_TARGET = 40;

// The match controller for the live match, attached by the splash
// flow when the run starts. Module-level so the plugin's hooks
// reach it without threading it through every dispatch site.
// Cleared on detach so a finished match doesn't keep firing into
// a dead channel.
let _matchController = null;

export function attachMatchController(controller) {
  _matchController = controller;
  // Wire the inbound side. We can't subscribe in init() because
  // init runs at registerPlugin time (boot) and the controller
  // doesn't exist yet — splash flow attaches mid-run.
  //
  // Each incoming 'garbage' event runs through the
  // modifyIncomingGarbage plugin hook chain BEFORE landing in
  // the queue. Cards (Shield, Thorns) subscribe to the hook to
  // halve the count or reflect a portion back; the chain returns
  // the final landing count. The chain runs in plugin
  // registration order — Shield decides to absorb first, then
  // Thorns reflects whatever's left. Tweaking the order is a
  // matter of registerPlugin order in main.js.
  controller.on('garbage', (payload) => {
    let count = Math.max(0, payload?.count | 0);
    if (_gameRef && typeof _gameRef._reduceHookValue === 'function') {
      count = _gameRef._reduceHookValue('modifyIncomingGarbage', count);
      count = Math.max(0, count | 0);
    }
    _pendingIncoming += count;
  });
}

export function detachMatchController() {
  if (_matchController) {
    _matchController.off('garbage');
    _matchController = null;
  }
  _pendingIncoming = 0;
}

// Buffer for inbound garbage waiting to drop on the next onSpawn.
// Module-level rather than in `_pluginState` because it's tied to
// the live channel, not to the run — a Whoops rewind shouldn't
// undo nuisance the opponent already sent. (Whoops is Tetris-only
// today, so this is forward-compat caution.)
let _pendingIncoming = 0;

// Game ref stashed by the plugin's reset hook so the
// match-controller subscription (set up in attachMatchController,
// which doesn't take a game arg) can still reach Game's plugin
// hook chain — modifyIncomingGarbage runs through every card
// that subscribes, letting Shield / Thorns mutate the incoming
// count before it lands in the queue.
let _gameRef = null;

// Generic versus-message sender — single seam for cards that
// need to push messages onto the channel without reaching for
// the controller themselves. sendGarbageNow is a thin wrapper
// over this. Color Lock and any future inter-player card use it
// directly with their own event types.
export function sendVersusMessage(type, payload) {
  if (!_matchController) return;
  _matchController.send(type, payload);
}

// Sends a 'garbage' message immediately. Cards that need to push
// extra garbage onto the wire mid-effect (Thorns reflecting 25%
// of incoming back to the opponent) import this helper rather
// than calling sendVersusMessage directly — keeps the count
// validation in one place.
export function sendGarbageNow(count) {
  if (count <= 0) return;
  sendVersusMessage('garbage', { count });
}

export default {
  id: 'garbage',
  modes: ['puyo-versus'],

  // Plugin-state bag carries per-run accounting that the renderer
  // / HUD might want to display later (incoming queue badge, "last
  // chain sent N garbage" readout, etc.). Today nothing reads it,
  // but the slot is here so future UI hooks have a stable place to
  // look without a follow-up refactor.
  reset(game) {
    game._pluginState.garbage = {
      outgoingThisChain: 0,
      lastSent:          0,
      // Mirrors the module-level _pendingIncoming so the renderer
      // can read it without an import.
      incoming:          0,
    };
    // Reset module-level counters too — a fresh game means the
    // previous match's accounting is dead.
    _pendingIncoming = 0;
    // Stash the game ref so the controller's 'garbage' callback
    // can reach _reduceHookValue without a closure-over-game in
    // attachMatchController (which fires from network-vs.js, not
    // from a plugin hook, and doesn't get game directly).
    _gameRef = game;
  },

  // onClear fires once per chain step (Puyo) — accumulate outgoing.
  // game.combo holds the chain step (PuyoMatchPolicy incremented
  // it right before this hook fired). The third arg is the full
  // result (cells + groups), which pointsForStep uses to compute
  // the per-step payout including group-size and color-count
  // bonuses — same formula that fed game.score, so a player who
  // sees +320 on screen knows it's about to translate to 4 nuisance
  // (320/70 floored).
  onClear(game, cleared, result) {
    if (!result) return;
    const step = game.combo;
    if (step <= 0) return;
    const points = pointsForStep(result, step, game.level);
    const nuisance = Math.floor(points / NUISANCE_TARGET);
    if (nuisance <= 0) return;
    const s = game._pluginState.garbage;
    s.outgoingThisChain += nuisance;
  },

  // onSpawn fires AFTER spawnNext() installs a new current piece.
  // For versus that's the right beat to flush the round-trip:
  //
  //   1. OFFSET. Outgoing nuisance from this chain first cancels
  //      our own incoming queue. Real Puyo's defining versus
  //      mechanic — a counter-chain absorbs an attack rather than
  //      stacking on top of it. Each side runs offset against ITS
  //      OWN incoming buffer at flush time; whatever's left of
  //      outgoing flies to the opponent, whatever's left of
  //      incoming drops on us.
  //   2. SEND. Forward the leftover outgoing as a single 'garbage'
  //      event regardless of how many chain steps fed it.
  //   3. DROP. Drain whatever incoming survived the offset onto
  //      our own field via dropNuisance. The new piece is at the
  //      top of the field; nuisance lands on the existing stack
  //      below, so they don't collide unless the stack already
  //      reached the spawn area (in which case the player is
  //      about to lose anyway).
  //
  // Offset timing is intentionally simple: cancellation runs
  // against `_pendingIncoming` AT THE MOMENT of flush. If the
  // opponent's chain finishes a frame later and their garbage
  // arrives after we've flushed, it sits in our queue for the
  // NEXT spawn — same as if it had arrived between any other
  // pair of locks. Real Puyo's "all attacks in flight cancel" is
  // an approximation of this with vanishingly small latency.
  onSpawn(game) {
    const s = game._pluginState.garbage;

    // Offset — outgoing eats incoming first.
    const cancel = Math.min(s.outgoingThisChain, _pendingIncoming);
    s.outgoingThisChain -= cancel;
    _pendingIncoming    -= cancel;

    if (s.outgoingThisChain > 0) {
      _matchController?.send('garbage', { count: s.outgoingThisChain });
      s.lastSent = s.outgoingThisChain;
    } else {
      s.lastSent = 0;
    }
    s.outgoingThisChain = 0;

    if (_pendingIncoming > 0) {
      // Versus drops use randomized column order — see
      // nuisance.js for why the SP curse keeps the deterministic
      // sweep. Two same-sized garbage hits should LOOK different
      // when they land, so opponents can't lean on left-edge
      // muscle memory to set up counter-chains.
      dropNuisance(game, _pendingIncoming, { randomize: true });
      _pendingIncoming = 0;
    }
    s.incoming = _pendingIncoming;
  },
};
