// ============================================================
// matchmaking.js — random-pair lobby over Supabase Realtime Presence
// ============================================================
//
// "Click VS NETWORK → wait → get paired with the next person who
// clicks." That's the entire UX, and Realtime Presence is the
// shortest path to building it.
//
// Flow:
//
//   1. Caller invokes `findMatch({ playerId, onCancel })`.
//   2. We subscribe to a single shared lobby channel and `track`
//      ourselves into its presence state.
//   3. Every presence sync hands us the full list of players in
//      the lobby. Deterministic pairing rule: in any sync, the two
//      lowest-by-string-compare playerIds belong together. The
//      smaller of the two emits a 'pair' broadcast naming the
//      bigger and a fresh `matchId`. Both sides then leave the
//      lobby and resolve with `{ matchId, peerId }`.
//   4. The caller takes the matchId, builds a SupabaseRealtimeTransport
//      against `puyo-vs-match:<matchId>`, and starts the seed
//      handshake exactly like local-vs did.
//
// Why Presence (not a lobby table):
//   • Self-cleaning. If a tab closes mid-pairing, Realtime stops
//     hearing its heartbeats within ~30s and removes its presence
//     entry. A SQL lobby would need explicit cleanup.
//   • No schema changes. The leaderboard tables are the only DB
//     state the project owns; matchmaking adds zero rows.
//   • Three-way race resolves naturally. Three players join at
//     once → lowest-id sees themselves + two others, picks the
//     next-lowest, broadcasts pair. Third player sees themselves
//     in a 3-person lobby, isn't the lowest, waits. After the
//     pair leaves the lobby, the third gets a fresh sync showing
//     only themselves and goes back to waiting for one peer.
//
// The 'pair' broadcast is the deterministic source of truth for
// who-pairs-with-whom and what matchId. We could compute matchId
// independently on both sides (e.g., min(p1, p2)), but having the
// chooser broadcast it removes any tiebreak ambiguity if the two
// sides see slightly different presence states for a frame.
// ============================================================

import { getSupabaseClient } from './supabase-client.js';

const LOBBY_CHANNEL = 'puyo-vs-lobby:v1';

// Generate a per-match channel suffix. 8 hex chars = ~32 bits of
// entropy, plenty to avoid collisions across simultaneous matches.
function makeMatchId() {
  const bytes = new Uint8Array(4);
  (globalThis.crypto || window.crypto).getRandomValues(bytes);
  return 'm_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// Public API. Returns a Promise that resolves once we're paired:
//   { matchId, peerId }      — caller can build the match transport
//
// `onCancel` is a hook for the UI's cancel button; if the caller
// invokes it (typically by calling the returned `cancel()`), the
// promise rejects with reason 'cancelled' and we leave the lobby
// cleanly. Bare `findMatch()` calls without cancellation will hang
// forever waiting for a peer, which is fine for tests but
// definitely not what the splash flow wants.
//
// Returns:
//   { promise, cancel }
//
// promise — Promise<{ matchId, peerId }> resolved on pairing.
// cancel  — Function. Calling it removes us from the lobby and
//           causes the promise to reject.
export function findMatch({ playerId } = {}) {
  if (!playerId) throw new Error('findMatch requires playerId');

  let resolved = false;
  let cancelled = false;
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

  let channel = null;
  let client  = null;

  // Async bootstrap. We can't make findMatch itself async because
  // we want to return cancel() synchronously — caller needs to be
  // able to cancel before subscribe completes (e.g., player smashes
  // VS NETWORK then clicks back to splash before the WebSocket is
  // even up).
  (async () => {
    client = await getSupabaseClient();
    if (!client) {
      reject(new Error('Realtime unavailable — check Supabase config'));
      return;
    }
    if (cancelled) return;

    channel = client.channel(LOBBY_CHANNEL, {
      config: {
        broadcast: { self: false, ack: false },
        // Presence is keyed by playerId so the sync state has stable
        // identity across reconnects. Without an explicit key,
        // Supabase auto-generates a per-tab presence_ref that
        // changes on every reconnect — fine for join/leave
        // detection, painful for "is the lowest-id me?".
        presence:  { key: playerId },
      },
    });

    // 'pair' message — fired by the lower-id side of any matched
    // pair. We accept it iff it names us as the partner.
    channel.on('broadcast', { event: 'pair' }, (e) => {
      if (resolved || cancelled) return;
      const { matchId, a, b } = e.payload || {};
      if (!matchId || !a || !b) return;
      // We're a participant only if our playerId is one of the two.
      // The OTHER party in the pair is our peer.
      let peerId = null;
      if (a === playerId) peerId = b;
      else if (b === playerId) peerId = a;
      else return; // not for us
      finishPairing(matchId, peerId);
    });

    // Presence sync — fires every time the membership changes.
    // We use it as the trigger for the deterministic pairing rule:
    // in any sync where we're the lowest-id and there's at least
    // one other player, broadcast pair to the next-lowest.
    channel.on('presence', { event: 'sync' }, () => {
      if (resolved || cancelled) return;
      const state = channel.presenceState();
      // presenceState() returns { [key]: [{ ...trackedPayload, presence_ref }] }
      // Multiple entries per key are possible if the same playerId
      // appears in multiple tabs — we just take the keys.
      const peers = Object.keys(state).sort();
      if (peers.length < 2) return;
      // Find our index in the sorted list and pair with our
      // immediate neighbor — but only if WE are the lower of the
      // pair. If we're the upper, wait for the lower to broadcast.
      const myIdx = peers.indexOf(playerId);
      if (myIdx === -1) return; // not yet visible to ourselves
      // Pair odd-index entries with their preceding even-index
      // entries: (peers[0], peers[1]), (peers[2], peers[3]), …
      // This guarantees each player picks the same partner from
      // each side regardless of how many extras are in the lobby.
      const partnerIdx = (myIdx % 2 === 0) ? myIdx + 1 : myIdx - 1;
      if (partnerIdx >= peers.length) return; // odd one out — wait
      const partnerId = peers[partnerIdx];
      // Only the lower-id of each pair broadcasts, so both sides
      // converge on a single match without racing.
      if (playerId < partnerId) {
        const matchId = makeMatchId();
        channel.send({
          type: 'broadcast',
          event: 'pair',
          payload: { matchId, a: playerId, b: partnerId },
        }).catch(() => {});
        // Optimistically resolve on our side too — the broadcast
        // ack is best-effort, but if the partner doesn't get the
        // message they'll re-trigger pair on their next presence
        // sync (we'll have already left the lobby, so they'll see
        // a different partner or wait alone).
        finishPairing(matchId, partnerId);
      }
      // Upper side: do nothing, wait for the broadcast.
    });

    channel.subscribe(async (status) => {
      if (cancelled || resolved) return;
      if (status !== 'SUBSCRIBED') return;
      try {
        await channel.track({ joined: Date.now() });
      } catch {
        // If track fails, we'll never appear in presence and
        // never be paired. Surface as a clean failure instead of
        // an indefinite hang.
        if (!resolved && !cancelled) reject(new Error('Failed to join lobby presence'));
      }
    });
  })();

  function finishPairing(matchId, peerId) {
    if (resolved || cancelled) return;
    resolved = true;
    // Leave the lobby cleanly so subsequent arrivals don't see
    // us as available. Realtime will eventually time us out
    // anyway, but the explicit unsubscribe makes the next sync
    // that fires for other waiting players show one fewer
    // person — letting odd-one-out players re-pair faster.
    teardown();
    resolve({ matchId, peerId });
  }

  function teardown() {
    if (channel && client) {
      try { client.removeChannel(channel); } catch { /* ignore */ }
    }
    channel = null;
  }

  function cancel(reason = 'cancelled') {
    if (resolved || cancelled) return;
    cancelled = true;
    teardown();
    reject(new Error(reason));
  }

  return { promise, cancel };
}
