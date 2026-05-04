// ============================================================
// Network versus boot — SignalR random matchmaking
// ============================================================
//
// Owns the "click VS NETWORK → matchmaking → handshake → match →
// end" flow. Originally rode Supabase Realtime; now points at a
// self-hosted .NET SignalR service (../Matchmaking/src/Matchmaking.Server).
// The lifecycle shape and message protocol are unchanged — this
// file only cares about MatchController, not the underlying wire —
// so the swap is a three-import diff plus the transport constructor.
//
// Lifecycle:
//
//   1. Splash button click → check matchmaking config → open lobby
//      via findMatch(). Show "FINDING OPPONENT…" overlay with a
//      cancel hook (Esc / clicking the button again).
//   2. Matchmaking resolves with { matchId, peerId } → build a
//      SignalRMatchTransport against /hubs/match (server adds us to
//      the match:<matchId> SignalR group), wrap in MatchController.
//   3. Send a 'ready' message carrying our playerId + a fresh
//      seedCandidate. On receiving the peer's 'ready', begin the
//      match (game.start(PUYO_VERSUS_MODE)). Both peers seed the
//      same Puyo RNG using the smaller-id rule, mirroring local-vs.
//   4. On local game.gameOver edge → flush a final state snapshot
//      → send 'i_lost' → opponent paints YOU WIN.
//   5. On 'i_lost' or synthetic 'peer_left' → paint match end.
//      peer_left treats the disconnect as a win (the most-played
//      Puyo arcade convention) and locks the rematch button.
//   6. REMATCH stays on the same SignalR group — exchange a fresh
//      'rematch_ready' with a new seedCandidate, restart when both
//      sides are go. EXIT closes the transport (drops the SignalR
//      group membership) and returns to the splash.
//
// Architectural note: the body of this file is intentionally close
// to local-vs.js — same flag set, same reconcilePostMatchState
// logic, same chained onGameOver. The only differences are:
//   • Transport construction is async (SignalR WebSocket handshake +
//     JoinMatch invocation).
//   • A 'peer_left' synthetic event from the transport replaces
//     the never-implemented "tab close detected" behavior the
//     local version chose to skip.
//   • Cancel during matchmaking — local-vs paired instantly, so
//     there was nothing to cancel; the lobby flow can hang.
// ============================================================

import { PUYO_VERSUS_MODE } from './mode.js';
import { MatchController } from './match-controller.js';
import { SignalRMatchTransport } from './signalr-transport.js';
import { findMatch } from './signalr-matchmaking.js';
import { isVersusEnabled, getSignalRConnection } from './signalr-client.js';
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
import { setPuyoRng, resetPuyoRng } from '../pieces.js';
import { mulberry32, randomSeed } from '../../../util/rng.js';

export function setupNetworkVersus({
  game,
  hud,
  music,
  hideMenuScreen,
  playMenuStartSound,
  playMenuHoverSound,
  matchEndMenu,
  matchmakingOverlay,
  returnToSplash,
}) {
  const playVsBtn$ = document.getElementById('play-versus-btn');
  if (!playVsBtn$) return;

  // If the project has no MATCHMAKING_SERVICE_URL configured, the
  // VS NETWORK button has nowhere to dial. Hide it on boot the
  // same way the leaderboard button is gated — a fresh clone of
  // the repo with empty config.js never advertises features that
  // can't work.
  if (!isVersusEnabled()) {
    playVsBtn$.classList.add('hidden');
    return;
  }

  // Per-match state — reset on every fresh splash click. See local-vs
  // for the original justification of each flag; the set is identical.
  let myId = null;
  let peerId = null;
  let matchController = null;
  let inMatch = false;
  let opponentView = null;
  let matchmakingHandle = null;   // { promise, cancel } from findMatch
  let matchmaking = false;        // true while waiting in the lobby
  let localReady    = false;
  let opponentReady = false;
  let opponentLeft  = false;
  let mySeedCandidate   = 0;
  let peerSeedCandidate = 0;

  // Splash hover ping — same family as the other splash buttons.
  playVsBtn$.addEventListener('mouseenter', () => {
    if (game.started) return;
    playMenuHoverSound();
  });

  // Click handler. Three states the button can be in:
  //   • Idle (most common): kick off matchmaking.
  //   • Currently matchmaking: cancel and return to splash. Useful
  //     when the player gives up on finding an opponent.
  //   • In-match / post-match: ignore. The button is hidden by
  //     hideMenuScreen() during a run, so this guard is defensive.
  playVsBtn$.addEventListener('click', () => {
    if (game.started || matchController) return;
    if (matchmaking) {
      cancelMatchmaking();
      return;
    }
    startMatchmaking();
  });

  // Esc-to-cancel and CANCEL-button-to-cancel both live inside
  // matchmakingOverlay (it owns its own keyboard handling). The
  // overlay calls back into us via the onCancel hook passed to
  // show(), so we don't need a separate document keydown listener
  // here for matchmaking.

  async function startMatchmaking() {
    matchmaking = true;
    myId = 'p_' + Math.random().toString(36).slice(2, 10);
    mySeedCandidate = randomSeed();

    matchmakingOverlay?.show({ onCancel: cancelMatchmaking });
    matchmakingOverlay?.setStatus('SEARCHING THE LOBBY…');

    // Pump live lobby counts straight into the overlay so the
    // player sees "<n> PLAYERS ONLINE" tick up/down while they wait.
    // Fires once per server LobbyCount fan-out (every join/leave).
    matchmakingHandle = findMatch({
      playerId: myId,
      onLobbyChange: ({ count }) => {
        matchmakingOverlay?.setOnlineCount(count);
      },
    });

    let pairing;
    try {
      pairing = await matchmakingHandle.promise;
    } catch (err) {
      // Cancelled or matchmaking error. The cancel path already
      // hid the overlay (CANCEL button → onCancel → cancelMatchmaking
      // → overlay.hide). On a real failure we surface the warning
      // status briefly before clearing.
      matchmaking = false;
      matchmakingHandle = null;
      const reason = String(err?.message || err || '');
      if (reason !== 'cancelled') {
        matchmakingOverlay?.setStatus('CONNECTION FAILED', { warning: true });
        setTimeout(() => {
          if (!game.started) matchmakingOverlay?.hide();
        }, 2400);
      }
      return;
    }

    matchmaking = false;
    matchmakingHandle = null;

    peerId = pairing.peerId;
    const matchId = pairing.matchId;

    // Found someone — flip the status to reflect what's happening
    // next so a player who's been staring at the spinner sees clear
    // forward progress before the match actually starts. The lobby
    // count is no longer meaningful (we've left the lobby), so drop
    // it now instead of leaving a stale tag visible.
    matchmakingOverlay?.setStatus('OPPONENT FOUND — CONNECTING…');
    matchmakingOverlay?.setOnlineCount(null);

    // Build the per-match transport. signalr-client caches one
    // HubConnection per hub path, so the lobby connection from
    // findMatch() and this match connection are independent. The
    // transport handles its own JoinMatch invocation in _start().
    const conn = await getSignalRConnection('/hubs/match');
    if (!conn) {
      matchmakingOverlay?.setStatus('CONNECTION FAILED', { warning: true });
      setTimeout(() => {
        if (!game.started) matchmakingOverlay?.hide();
      }, 2400);
      return;
    }

    const transport = new SignalRMatchTransport(conn, matchId, myId, peerId);
    matchController = new MatchController(transport);

    wireMatchHandlers();

    // Send our handshake. Mirrors local-vs's per-tab seedCandidate
    // exchange — both sides ship a fresh candidate with their
    // playerId, both compute the same agreedSeed independently.
    matchController.send('ready', { playerId: myId, seedCandidate: mySeedCandidate });
    matchmakingOverlay?.setStatus('WAITING FOR OPPONENT READY…');
  }

  // Cancel from any source — splash button second-click, the
  // overlay's CANCEL button, or its Esc handler. All paths converge
  // here so the cleanup steps live in exactly one place.
  function cancelMatchmaking() {
    if (!matchmaking && !matchmakingOverlay?.isOpen()) return;
    matchmakingHandle?.cancel('cancelled');
    matchmaking = false;
    matchmakingHandle = null;
    myId = null;
    matchmakingOverlay?.hide();
  }

  // All match-channel subscriptions in one place. Identical wiring
  // to local-vs's; the only added handler is `peer_left` (synthetic,
  // emitted by SignalRMatchTransport when the server's PeerLeft
  // fan-out tells us our peer is gone).
  function wireMatchHandlers() {
    matchController.on('ready', (payload) => {
      if (!payload || payload.playerId === myId) return;
      // peerId is already set from matchmaking; defend against
      // a corrupted payload by verifying it matches.
      if (payload.playerId !== peerId) return;
      peerSeedCandidate = payload.seedCandidate >>> 0;
      // Re-echo so a payload that lost the race against our
      // subscribe still gets answered. The peer ignores our second
      // ready (peerSeedCandidate is already set on their side too).
      matchController.send('ready', { playerId: myId, seedCandidate: mySeedCandidate });
      // Only begin once. inMatch flips on the first call; later
      // 'ready' echoes are no-ops thanks to this guard.
      if (!inMatch) beginMatch();
    });

    matchController.on('i_lost', () => {
      if (!inMatch) return;
      inMatch = false;
      showMatchEndMenu('YOU WIN');
    });

    matchController.on('rematch_ready', (payload) => {
      opponentReady     = true;
      peerSeedCandidate = (payload?.seedCandidate >>> 0) || peerSeedCandidate;
      reconcilePostMatchState();
    });

    matchController.on('left', () => {
      opponentLeft = true;
      reconcilePostMatchState();
    });

    // Synthetic from SignalRMatchTransport — the peer's connection
    // vanished from the match group (server's OnDisconnectedAsync
    // fired). Treat as "they left."
    // If we were mid-match, also treat it as a win for us so the
    // player isn't stranded waiting for an i_lost that's never
    // coming. Nothing to send back — the channel is dead on
    // their side.
    matchController.on('peer_left', () => {
      if (inMatch) {
        inMatch = false;
        showMatchEndMenu('YOU WIN');
      }
      opponentLeft = true;
      reconcilePostMatchState();
    });

    matchController.on('color_lock', (payload) => {
      if (!payload || !payload.color) return;
      const slot = game._pluginState.colorLock ??= { color: null, remaining: 0 };
      slot.color     = payload.color;
      slot.remaining = Math.max(0, payload.drops | 0);
    });

    matchController.on('color_blind', (payload) => {
      if (!payload) return;
      const slot = game._pluginState.colorBlind ??= { remaining: 0 };
      slot.remaining = Math.max(0, payload.placements | 0);
    });
  }

  function beginMatch() {
    inMatch = true;

    // Versus subsystems all hang off the controller. Each attach()
    // is idempotent; matching detach() runs on match-end / exit.
    attachMatchController(matchController);
    attachStateSync(matchController);
    const opponentCanvas = document.getElementById('opponent-board');
    if (opponentCanvas) {
      opponentView = setupOpponentView(matchController, opponentCanvas);
    }

    // Identical to local-vs — both tabs derive the same seed from
    // the smaller playerId's seedCandidate so the piece sequence
    // matches on both sides.
    seedPuyoForCurrentMatch();

    playMenuStartSound();
    game.start(PUYO_VERSUS_MODE);
    hud.hideOverlay();
    matchmakingOverlay?.hide();
    hideMenuScreen();
    music.playGame();
  }

  function seedPuyoForCurrentMatch() {
    if (!peerId) return;
    const myWins = myId < peerId;
    const seed = myWins ? mySeedCandidate : peerSeedCandidate;
    setPuyoRng(mulberry32(seed));
  }

  // Hook the existing onGameOver callback. In versus, a local death
  // sends 'i_lost' and surfaces the REMATCH/EXIT chooser instead of
  // the leaderboard prompt — versus runs aren't ranked. Outside of
  // an active match (e.g., we already won, opponent already lost),
  // the original handler still fires.
  const prevOnGameOver = game.onGameOver;
  game.onGameOver = () => {
    if (matchController && inMatch) {
      sendFinalState(game);
      matchController.send('i_lost', {});
      inMatch = false;
      showMatchEndMenu('YOU LOSE');
      return;
    }
    prevOnGameOver?.();
  };

  function showMatchEndMenu(title) {
    game.paused = true;
    localReady    = false;
    opponentReady = false;
    // opponentLeft persists across rematch attempts — once they're
    // gone, they're gone — so DON'T reset it here. (local-vs reset
    // it because BroadcastChannel had no disconnect detection;
    // SignalR's OnDisconnectedAsync does, so the flag has real meaning.)
    matchEndMenu?.show(title, {
      onRematch: clickRematch,
      onExit:    clickExit,
    });
    reconcilePostMatchState();
  }

  function reconcilePostMatchState() {
    if (!matchEndMenu) return;
    if (opponentLeft) {
      matchEndMenu.setRematchEnabled(false);
      matchEndMenu.setStatus('OPPONENT LEFT', { warning: true });
      return;
    }
    if (localReady && opponentReady) {
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

  function clickRematch() {
    if (localReady || opponentLeft) return;
    localReady = true;
    mySeedCandidate = randomSeed();
    matchController?.send('rematch_ready', { seedCandidate: mySeedCandidate });
    reconcilePostMatchState();
  }

  function clickExit() {
    matchController?.send('left', {});
    exitToSplash();
  }

  function startRematch() {
    matchEndMenu?.hide();
    inMatch = true;
    seedPuyoForCurrentMatch();
    playMenuStartSound();
    game.start(PUYO_VERSUS_MODE);
    hud.hideOverlay();
  }

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
    // run started from the splash. Same reasoning as local-vs.
    resetPuyoRng();
    returnToSplash?.();
  }
}
