// ============================================================
// signalr-matchmaking.js — server-paired lobby over SignalR
// ============================================================
//
// Drop-in replacement for matchmaking.js. Same UX:
//
//   "Click VS NETWORK → wait → get paired with the next person who
//    clicks."
//
// What changed: pairing is no longer client-side. The .NET server's
// LobbyService owns the sorted member list and atomically pulls the
// two oldest waiters into a pair, then sends each side a targeted
// PairMessage. That removes the deterministic-tie-break dance the
// JS Supabase version did via "lower-id broadcasts the pair" and
// makes the protocol robust against a malicious client trying to
// game the lobby.
//
// Flow:
//   1. Caller invokes `findMatch({ playerId, onLobbyChange })`.
//   2. We open the cached HubConnection at /hubs/lobby, register
//      handlers for 'Pair' and 'LobbyCount', invoke EnterLobby.
//   3. Server fans out LobbyCount on every join/leave (drives the
//      "<n> PLAYERS ONLINE" tag in the matchmaking overlay).
//   4. Server sends Pair(matchId, peerId) to each side of any new
//      pairing. Caller resolves with { matchId, peerId } and moves
//      on to the per-match transport.
//
// Same return shape as the Supabase version: { promise, cancel } so
// network-vs.js doesn't need to care about transport changes.
// ============================================================

import { getSignalRConnection } from './signalr-client.js';

// Public API. Returns a Promise that resolves once we're paired:
//   { matchId, peerId }      — caller can build the match transport
//
// `onLobbyChange` is an optional callback fired every time the
// server fans out LobbyCount. Receives `{ count }` mirroring the
// Supabase version exactly so callers don't need to branch.
//
// Returns:
//   { promise, cancel }
export function findMatch({ playerId, onLobbyChange } = {}) {
  if (!playerId) throw new Error('findMatch requires playerId');

  let resolved = false;
  let cancelled = false;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

  let conn = null;
  let pairHandler = null;
  let countHandler = null;

  // Async bootstrap. We can't make findMatch itself async because we
  // want to return cancel() synchronously — caller needs to be able
  // to cancel before the WebSocket is even up.
  (async () => {
    conn = await getSignalRConnection('/hubs/lobby');
    if (!conn) {
      reject(new Error('SignalR unavailable — check MATCHMAKING_SERVICE_URL'));
      return;
    }
    if (cancelled) return;

    // Pair message — server tells us we've been matched. Wire shape
    // is camelCase by SignalR's default JsonHubProtocol, so the
    // PairMessage record from the .NET side ({ MatchId, PeerId })
    // arrives as { matchId, peerId }.
    pairHandler = (pairMessage) => {
      if (resolved || cancelled) return;
      const matchId = pairMessage?.matchId;
      const peerId  = pairMessage?.peerId;
      if (!matchId || !peerId) return;
      finishPairing(matchId, peerId);
    };

    // LobbyCount fan-out. Errors from the consumer can't be allowed
    // to break matchmaking — same defensive guard the Supabase
    // version had around onLobbyChange.
    countHandler = (count) => {
      try { onLobbyChange?.({ count }); } catch { /* ignore */ }
    };

    conn.on('Pair', pairHandler);
    conn.on('LobbyCount', countHandler);

    try {
      // start() is idempotent — a previous lobby session on the
      // cached connection may have already started it.
      if (conn.state === 'Disconnected') {
        await conn.start();
      }
      if (cancelled) {
        teardown();
        return;
      }
      await conn.invoke('EnterLobby', playerId);
    } catch (err) {
      if (resolved || cancelled) return;
      teardown();
      reject(err);
    }
  })();

  function finishPairing(matchId, peerId) {
    if (resolved || cancelled) return;
    resolved = true;
    // Unsubscribe BEFORE resolving so the caller can't race a
    // post-resolve LobbyCount tick into their UI. The server has
    // already removed us from LobbyService inside TryPair, so we
    // don't need to invoke LeaveLobby — just stop listening.
    teardown(/* alreadyOutOfLobby */ true);
    resolve({ matchId, peerId });
  }

  function teardown(alreadyOutOfLobby = false) {
    if (conn) {
      try { if (pairHandler)  conn.off('Pair',       pairHandler);  } catch { /* ignore */ }
      try { if (countHandler) conn.off('LobbyCount', countHandler); } catch { /* ignore */ }
      // Tell the server to drop us if we never paired (cancel /
      // error path). Skipped on the resolved-pairing path where
      // the server already removed us atomically inside TryPair.
      if (!alreadyOutOfLobby) {
        try {
          if (conn.state === 'Connected') {
            conn.invoke('LeaveLobby').catch(() => { /* best-effort */ });
          }
        } catch { /* ignore */ }
      }
    }
  }

  function cancel(reason = 'cancelled') {
    if (resolved || cancelled) return;
    cancelled = true;
    teardown();
    reject(new Error(reason));
  }

  return { promise, cancel };
}
