// ============================================================
// Local fake-versus boot — Phase 2 lifecycle wiring
// ============================================================
//
// Owns the "click VS LOCAL → handshake → match → end" flow for
// two browser tabs sharing one BroadcastChannel. main.js calls
// setupLocalVersus(...) once at boot; the function attaches the
// click handler and manages everything from there.
//
// Lifecycle:
//
//   1. Splash button click → open BroadcastChannel + send 'ready'
//      with a random per-tab playerId.
//   2. On receiving a 'ready' from another playerId → echo our own
//      'ready' (so the original sender hears us back) → both tabs
//      now aware of each other → start the match.
//   3. game.start(PUYO_VERSUS_MODE). The garbage plugin is already
//      registered (main.js does that at boot); attachMatchController
//      hooks the controller to its inbound/outbound logic.
//   4. On local game.gameOver edge → send 'i_lost' → opponent
//      receives → opponent's hud paints YOU WIN.
//   5. On receiving 'i_lost' → paint YOU WIN locally.
//   6. On overlay click / restart → reset state, close channel.
//
// Failure modes consciously not handled in Phase 2:
//   • Three+ tabs joining the same channel. Phase 2 assumes a
//     local two-tab dev session; once Phase 3 swaps to Supabase
//     Realtime + actual matchmaking, peer-uniqueness comes from
//     the lobby table.
//   • Tab close mid-match. The other tab keeps playing forever
//     — there's no heartbeat. Acceptable for a dev tool.
//   • Reconnect / rematch. Pressing R restarts your own game; if
//     the other side hasn't restarted, you'll be playing alone
//     until they do.

import { PUYO_VERSUS_MODE } from './mode.js';
import {
  MatchController,
  BroadcastChannelTransport,
} from './match-controller.js';
import {
  attachMatchController,
  detachMatchController,
} from './garbage-plugin.js';
import {
  attachStateSync,
  detachStateSync,
  sendFinalState,
} from './state-sync-plugin.js';
import { setupOpponentView } from './opponent-view.js';
import { setPuyoRng, resetPuyoRng, PUYO_COLORS } from '../pieces.js';
import { mulberry32, randomSeed } from '../../../util/rng.js';

const CHANNEL_NAME = 'stackoverflow-puyo-vs-local';

export function setupLocalVersus({
  game,
  hud,
  music,
  hideMenuScreen,
  playMenuStartSound,
  playMenuHoverSound,
  matchEndMenu,
  returnToSplash,
}) {
  const playVsBtn$ = document.getElementById('play-versus-btn');
  if (!playVsBtn$) return;

  // Per-tab handshake state. Reset on every fresh splash click so
  // a botched handshake (peer never showed up, player closed it,
  // etc.) doesn't leak.
  let myId = null;
  let peerId = null;
  let matchController = null;
  let inMatch = false;
  let opponentView = null;
  // Post-match coordination state. All three flags reset on every
  // match-end (showMatchEndMenu) and on every fresh match start.
  //   localReady    — we clicked REMATCH, sent 'rematch_ready'
  //   opponentReady — we received the peer's 'rematch_ready'
  //   opponentLeft  — we received the peer's 'left'; rematch is
  //                   no longer possible from this side either,
  //                   the menu locks REMATCH and only EXIT works.
  let localReady    = false;
  let opponentReady = false;
  let opponentLeft  = false;
  // Seed-negotiation state. Each handshake message (initial
  // 'ready' and per-rematch 'rematch_ready') carries a fresh
  // seedCandidate. Whichever message comes from the smaller
  // playerId wins — both tabs derive the same agreedSeed
  // independently from the two candidates + the two playerIds.
  // Regenerated every time we send a fresh 'ready' /
  // 'rematch_ready' so consecutive matches don't replay the
  // same piece sequence.
  let mySeedCandidate   = 0;
  let peerSeedCandidate = 0;

  // Splash hover ping — same family as the other splash buttons.
  playVsBtn$.addEventListener('mouseenter', () => {
    if (game.started) return;
    playMenuHoverSound();
  });

  playVsBtn$.addEventListener('click', () => {
    if (game.started || matchController) return;
    startHandshake();
  });

  function startHandshake() {
    myId = 'p_' + Math.random().toString(36).slice(2, 10);
    mySeedCandidate = randomSeed();
    const transport = new BroadcastChannelTransport(CHANNEL_NAME);
    matchController = new MatchController(transport);

    // Handshake: any 'ready' that isn't us means a peer is here.
    // Echo back so the peer hears our own ready (covers the case
    // where we announced before they opened the channel). Once
    // we've claimed a peer, ignore subsequent 'ready' messages
    // (third tabs trying to join an in-progress match).
    //
    // The payload carries a per-tab seedCandidate so we can
    // deterministically agree on the match seed. Both tabs see
    // both candidates; agreedSeed is whichever came from the
    // smaller playerId.
    matchController.on('ready', (payload) => {
      if (!payload || payload.playerId === myId) return;
      if (peerId) return;
      peerId            = payload.playerId;
      peerSeedCandidate = payload.seedCandidate >>> 0;
      matchController.send('ready', { playerId: myId, seedCandidate: mySeedCandidate });
      beginMatch();
    });

    matchController.on('i_lost', () => {
      // Opponent died → we won. Drop the in-match flag so any
      // late-arriving state snapshots from before they died don't
      // clobber the menu, then surface the post-match REMATCH /
      // EXIT chooser.
      if (!inMatch) return;
      inMatch = false;
      showMatchEndMenu('YOU WIN');
    });

    // Post-match coordination — the peer hit REMATCH. Stash
    // their fresh seedCandidate (rematches need a new sequence,
    // not a replay of the previous match's pieces) and re-
    // evaluate; if we're also ready, this is the moment both
    // sides start the new match.
    matchController.on('rematch_ready', (payload) => {
      opponentReady     = true;
      peerSeedCandidate = (payload?.seedCandidate >>> 0) || peerSeedCandidate;
      reconcilePostMatchState();
    });

    // Post-match coordination — the peer hit EXIT. Lock our menu
    // so we can't sit waiting for a rematch that won't come, and
    // surface the message. EXIT stays enabled — the player can
    // still leave.
    matchController.on('left', () => {
      opponentLeft = true;
      reconcilePostMatchState();
    });

    matchController.send('ready', { playerId: myId, seedCandidate: mySeedCandidate });
    hud.showOverlay('VS LOCAL', 'WAITING FOR OPPONENT…');
  }

  function beginMatch() {
    inMatch = true;

    // Wire all versus subsystems to the same controller. Each
    // attach() is idempotent and tears itself down via the
    // matching detach() on match end. The opponent view starts
    // painting "WAITING…" immediately and flips to live data
    // when the peer's first state snapshot lands.
    attachMatchController(matchController);
    attachStateSync(matchController);
    const opponentCanvas = document.getElementById('opponent-board');
    if (opponentCanvas) {
      opponentView = setupOpponentView(matchController, opponentCanvas);
    }

    // Card-driven inter-player events. These write into plugin-
    // state slots that the relevant card plugins read from their
    // lifecycle hooks. Centralizing the receivers here (rather
    // than in each card file) keeps the controller subscription
    // surface in one place; cards just pick the right slot to
    // watch on their own side.
    matchController.on('color_lock', (payload) => {
      if (!payload) return;
      const drops = Math.max(0, payload.drops | 0);
      if (drops <= 0) return;
      // Defensive — slot may not exist yet (the color-lock
      // plugin's reset hook seeds it on game.start, which fires
      // a few lines below). Lazy-create here so an event
      // arriving milliseconds before reset doesn't get dropped.
      const slot = game._pluginState.colorLock ??= { locks: {} };
      if (!slot.locks) slot.locks = {};

      // Pick the color this event will lock. The sender's
      // payload.color is a hint; the receiver makes the final
      // call so each pick reliably adds a NEW lock when one is
      // available, regardless of what the sender happened to
      // roll. Stack semantics:
      //   1. If the hint isn't already locked, honor it.
      //   2. Otherwise, lock any color not yet in the map.
      //   3. Otherwise (all 5 already locked), refresh a
      //      random already-locked color's window. The all-
      //      locked junk-pair state holds either way; the
      //      refresh just postpones the moment one of the
      //      timers would have lapsed (timers are frozen during
      //      all-locked anyway, so this is a no-op until
      //      something else lifts a lock — kept for forward-
      //      compat in case future cards drop a lock early).
      const lockedColors = Object.keys(slot.locks).filter(c => slot.locks[c] > 0);
      const lockedSet    = new Set(lockedColors);
      let target = null;
      if (payload.color && PUYO_COLORS.includes(payload.color) && !lockedSet.has(payload.color)) {
        target = payload.color;
      } else {
        const unlocked = PUYO_COLORS.filter(c => !lockedSet.has(c));
        if (unlocked.length > 0) {
          target = unlocked[Math.floor(Math.random() * unlocked.length)];
        } else {
          target = lockedColors[Math.floor(Math.random() * lockedColors.length)];
        }
      }
      slot.locks[target] = drops;
    });

    matchController.on('color_blind', (payload) => {
      if (!payload) return;
      const slot = game._pluginState.colorBlind ??= { remaining: 0 };
      // Overwrite, don't add — a second Color Blind during an
      // active one refreshes the window rather than stacking
      // duration. Keeps the disruption time-bounded; otherwise
      // a heavy color-blind picker could grey out the opponent
      // for entire matches.
      slot.remaining = Math.max(0, payload.placements | 0);
    });

    // Seed the puyo RNG so both tabs produce the same piece
    // sequence — the cornerstone of versus fairness. Same seed
    // on both sides means identical pair colors at every spawn,
    // so the match comes down to skill, not draw luck.
    seedPuyoForCurrentMatch();

    playMenuStartSound();
    game.start(PUYO_VERSUS_MODE);
    hud.hideOverlay();
    hideMenuScreen();
    music.playGame();
  }

  // Derive the agreed seed from the two seedCandidates and the
  // two playerIds, then install it as the puyo RNG for this
  // match. Tiebreaker is the smaller playerId (lexicographic
  // string compare) so both tabs reach the same answer
  // independently — no extra round-trip needed.
  function seedPuyoForCurrentMatch() {
    if (!peerId) return;
    const myWins = myId < peerId;
    const seed = myWins ? mySeedCandidate : peerSeedCandidate;
    setPuyoRng(mulberry32(seed));
  }

  // Hook into the existing game-over edge so a local death sends
  // 'i_lost' to the opponent and surfaces the REMATCH / EXIT
  // chooser. We chain rather than overwrite — main.js sets
  // onGameOver to leaderboard.showSubmit; in versus we DON'T want
  // the leaderboard prompt (puyo versus runs aren't ranked here),
  // so we skip the chain when in match. Outside versus the
  // original handler still fires.
  //
  // We also force a final state snapshot here. Game.tick early-
  // returns when game.gameOver is true, so the state-sync plugin's
  // tick hook never fires after death. Without an explicit flush
  // the opponent would see our last pre-death frame instead of the
  // actual moment of loss.
  const prevOnGameOver = game.onGameOver;
  game.onGameOver = () => {
    if (matchController && inMatch) {
      sendFinalState(game);
      matchController.send('i_lost', {});
      inMatch = false;
      showMatchEndMenu('YOU LOSE');
      return; // skip the leaderboard prompt for versus runs
    }
    prevOnGameOver?.();
  };

  // Pop the post-match chooser. Both win and loss paths land here
  // — the title is the only thing that differs. Resets the
  // coordination flags so a previous match's "OPPONENT LEFT"
  // doesn't leak into this one's menu.
  //
  // Also freezes the local game in place. The loser was already
  // halted by gameOver (Game.tick early-returns), but the WINNER's
  // game is still alive and would otherwise keep dropping pieces
  // behind the menu. Setting paused=true cleanly stops gravity,
  // input, plugin ticks, and state-sync sends. game.start (on
  // rematch) and game.reset (on exit) both clear paused, so
  // cleanup is automatic — no detangling needed.
  function showMatchEndMenu(title) {
    game.paused = true;
    localReady    = false;
    opponentReady = false;
    opponentLeft  = false;
    matchEndMenu?.show(title, {
      onRematch: clickRematch,
      onExit:    clickExit,
    });
    // The peer's 'rematch_ready' might have arrived before our
    // own match ended (they finished us off, then immediately
    // clicked REMATCH while our match-over edge was still
    // settling). Reconcile after show() so any pre-shown peer
    // state is reflected immediately.
    reconcilePostMatchState();
  }

  // Single source of truth for the menu's status / button-enabled
  // state, derived from the three flags. Called whenever a flag
  // changes (local click, peer event) — the handshake's "did
  // anything just become possible / impossible?" check runs here.
  //
  //   opponentLeft: REMATCH disabled, status reads "OPPONENT LEFT"
  //   localReady && opponentReady: both ready → start new match
  //   localReady: REMATCH disabled, status reads "WAITING…"
  //   opponentReady: REMATCH stays enabled, status reads "OPPONENT READY"
  //   else: clean post-match menu
  function reconcilePostMatchState() {
    if (!matchEndMenu) return;
    if (opponentLeft) {
      matchEndMenu.setRematchEnabled(false);
      matchEndMenu.setStatus('OPPONENT LEFT', { warning: true });
      return;
    }
    if (localReady && opponentReady) {
      // Both signed off on a rematch — fire it. Each tab fires
      // independently when both flags land on its side.
      startRematch();
      return;
    }
    if (localReady) {
      matchEndMenu.setRematchEnabled(false);
      matchEndMenu.setStatus('WAITING FOR OPPONENT…');
      return;
    }
    if (opponentReady) {
      matchEndMenu.setRematchEnabled(true);
      matchEndMenu.setStatus('OPPONENT IS READY');
      return;
    }
    matchEndMenu.setRematchEnabled(true);
    matchEndMenu.setStatus('');
  }

  // Click handlers — these only update state. The actual rematch
  // / exit work runs out of reconcilePostMatchState (rematch) or
  // exitToSplash (exit). Single-direction data flow keeps the
  // state machine clean.
  function clickRematch() {
    if (localReady || opponentLeft) return; // already pressed, or no peer
    localReady = true;
    // Fresh seedCandidate per rematch so consecutive matches
    // play different sequences. The peer's incoming
    // 'rematch_ready' overwrites peerSeedCandidate too, so by
    // the time both sides are ready both candidates are fresh.
    mySeedCandidate = randomSeed();
    matchController?.send('rematch_ready', { seedCandidate: mySeedCandidate });
    reconcilePostMatchState();
  }

  function clickExit() {
    matchController?.send('left', {});
    exitToSplash();
  }

  // Start the next round on the same channel. Both sides fire
  // this independently when both ready-flags land on their side
  // — minor latency drift between tabs is fine, garbage events
  // queue cleanly across the gap. Reseed before game.start so
  // both tabs install the same fresh RNG for the new sequence.
  function startRematch() {
    matchEndMenu?.hide();
    inMatch = true;
    seedPuyoForCurrentMatch();
    playMenuStartSound();
    game.start(PUYO_VERSUS_MODE);
    hud.hideOverlay();
  }

  // EXIT TO MENU — tear down everything versus-specific and route
  // back to the splash via main.js's existing returnToSplash flow
  // (the same path the in-game MAIN MENU button uses). Closes the
  // BroadcastChannel so a follow-up VS LOCAL click starts fresh.
  // The peer was notified via 'left' before this fires.
  function exitToSplash() {
    matchEndMenu?.hide();
    if (opponentView) {
      opponentView.teardown();
      opponentView = null;
    }
    detachStateSync();
    detachMatchController();
    matchController?.close();
    matchController = null;
    peerId = null;
    inMatch = false;
    localReady    = false;
    opponentReady = false;
    opponentLeft  = false;
    // Restore SP behavior — Math.random for any subsequent Puyo
    // run started from the splash. Without this, the next SP
    // session would still be running the seeded versus RNG
    // (technically harmless — same outputs every time — but
    // weird and predictable).
    resetPuyoRng();
    returnToSplash?.();
  }
}
