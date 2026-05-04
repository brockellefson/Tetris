// ============================================================
// SignalRMatchTransport — networked sibling of BroadcastChannel
// ============================================================
//
// Drop-in replacement for SupabaseRealtimeTransport. Implements the
// same { send, onMessage, close } shape MatchController accepts, so
// MatchController and every plugin that talks through it (garbage,
// state-sync, color-lock, color-blind, …) keeps working unchanged.
//
// Wire shape: every send invokes the server's `Send(matchId, envelope)`
// hub method, which fans out to OthersInGroup. Server is dumb —
// doesn't crack envelope.type open — so adding a new game event
// (e.g., a future card protocol) doesn't touch this file or the
// server.
//
// Disconnect detection: server fires `PeerLeft` on `OnDisconnectedAsync`
// for the surviving peer. We synthesize the same `peer_left` envelope
// supabase-transport.js used to so the rest of the app sees the
// identical event shape regardless of which transport is wired.
//
// Self-echo: SignalR's `Clients.OthersInGroup` already excludes the
// sender, so our own sends don't dispatch back to our handler. Same
// contract supabase-transport.js had via `broadcast: { self: false }`.
//
// Connection ownership: this transport DOES NOT own the underlying
// HubConnection — signalr-client.js caches it across multiple matches
// (rematches, sequential lobby sessions). Closing the transport
// removes our handlers but leaves the connection alive for next time.
// ============================================================

export class SignalRMatchTransport {
  // `connection`  — HubConnection from getSignalRConnection('/hubs/match')
  // `matchId`     — unique-per-match string from the Pair message
  // `selfId`      — our own playerId; used by the server's PeerLeft
  //                 fan-out to identify the survivor's peer
  // `peerId`      — opponent's playerId; we synthesize a `peer_left`
  //                 envelope when the server reports they disconnected.
  //                 Pass `null` to skip peer-left filtering.
  constructor(connection, matchId, selfId, peerId = null) {
    this._conn         = connection;
    this._matchId      = matchId;
    this._selfId       = selfId;
    this._peerId       = peerId;
    this._closed       = false;
    this._started      = false;
    this._pendingSends = [];     // queued until JoinMatch completes
    this.onMessage     = null;   // assigned by MatchController

    this._init();
    // Fire-and-forget start — same async-but-presented-as-sync shape
    // SupabaseRealtimeTransport had. Sends issued before subscribe
    // completes are queued and flushed on success.
    void this._start();
  }

  _init() {
    // Stash bound handlers so we can `off(...)` them precisely on
    // close. @microsoft/signalr's `on` doesn't return a disposable;
    // the only way to unsubscribe is to keep the function reference.
    this._onMsg = (envelope) => {
      if (this._closed) return;
      this.onMessage?.(envelope);
    };
    this._onPeerLeft = (peerId) => {
      if (this._closed) return;
      // Filter by known peerId — same defensive check supabase-
      // transport.js did. If the server ever fans out PeerLeft for
      // someone other than our peer (it shouldn't), we ignore it.
      if (this._peerId && peerId !== this._peerId) return;
      this.onMessage?.({ type: 'peer_left', payload: { peerId } });
    };
    this._conn.on('Msg', this._onMsg);
    this._conn.on('PeerLeft', this._onPeerLeft);
  }

  async _start() {
    try {
      // start() is idempotent if the connection is already running —
      // a previous transport on the same cached connection may have
      // already started it. State strings come from HubConnectionState
      // enum; the wire values are 'Connected' / 'Connecting' / etc.
      if (this._conn.state === 'Disconnected') {
        await this._conn.start();
      }
      await this._conn.invoke('JoinMatch', this._matchId, this._selfId);
      if (this._closed) return;
      this._started = true;
      // Flush any sends that fired before JoinMatch returned. FIFO
      // preserves protocol order (handshake before state-sync etc.).
      const queued = this._pendingSends;
      this._pendingSends = [];
      for (const msg of queued) this._rawSend(msg);
    } catch (err) {
      // Best-effort. If JoinMatch fails the network-vs flow will
      // observe via never receiving 'ready' and time out / cancel.
      console.error('[versus] SignalR JoinMatch failed', err);
    }
  }

  // BroadcastChannelTransport's send was synchronous — to match, we
  // queue if we haven't joined yet rather than awaiting. JoinMatch
  // typically resolves within ~100ms over a warm connection.
  send(msg) {
    if (this._closed) return;
    if (!this._started) {
      this._pendingSends.push(msg);
      return;
    }
    this._rawSend(msg);
  }

  _rawSend(msg) {
    // Fire-and-forget. State-sync re-sends every 100ms, garbage and
    // i_lost are application-acked by their effects, so single-message
    // drops are tolerable. If a specific message ever needs at-least-
    // once delivery, wrap retries above this layer.
    this._conn.invoke('Send', this._matchId, msg).catch(() => { /* best-effort */ });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._pendingSends = [];
    // Unsubscribe THIS transport's handlers without touching the
    // shared connection — a future match (rematch, new lobby session)
    // will reuse the same HubConnection and register fresh handlers.
    try { this._conn.off('Msg',      this._onMsg);      } catch { /* ignore */ }
    try { this._conn.off('PeerLeft', this._onPeerLeft); } catch { /* ignore */ }
  }
}
