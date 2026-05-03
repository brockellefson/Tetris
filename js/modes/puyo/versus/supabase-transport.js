// ============================================================
// SupabaseRealtimeTransport — networked sibling of BroadcastChannel
// ============================================================
//
// Implements the same { send, onMessage, close } surface that
// MatchController accepts. Wraps a Supabase Realtime broadcast
// channel — every peer subscribed to the same channel name receives
// every other peer's posts. The contract is identical to
// BroadcastChannelTransport's, which means MatchController doesn't
// need to know whether it's running over BroadcastChannel (local
// dev), MockTransport (tests), or this (real network).
//
// Channel naming: callers pass a per-match channel name like
// `puyo-vs-match:m_a3f9c1b2`. Two peers paired by matchmaking both
// subscribe to the same name and start exchanging messages.
//
// Wire shape: every send wraps the caller's envelope inside a single
// broadcast event named `'msg'`. Supabase Realtime broadcasts have
// a per-event name field; we collapse everything into one `'msg'`
// stream and let MatchController demultiplex by `msg.type`. This
// keeps the transport ignorant of game-event names — adding a new
// match event (color_lock, future card protocols, etc.) doesn't
// touch this file.
//
// Self-echo: by default Realtime broadcasts return your own messages
// to yourself. We pass `config: { broadcast: { self: false } }` so
// our own sends don't dispatch back into our handler — BroadcastChannel
// has the same isolation, so the contract matches.
//
// Disconnect detection: Realtime fires presence `leave` events on
// the same channel when a peer disconnects (tab close, network drop,
// 30s heartbeat miss). We track presence on the match channel too
// and surface a synthetic `peer_left` message via onMessage so the
// versus flow can react. Synthetic events are tagged so the protocol
// stays aligned with what BroadcastChannelTransport could emit.
// ============================================================

// All callers pass an already-acquired Supabase client (from
// getSupabaseClient()). The transport doesn't import the client
// factory itself — keeps it test-friendly with mock clients and
// avoids a circular import if anyone wants to instantiate it from
// a different entry point later.
export class SupabaseRealtimeTransport {
  // `client`        — Supabase client from getSupabaseClient()
  // `channelName`   — unique-per-match string, e.g. 'puyo-vs-match:m_xxxxx'
  // `selfId`        — our own playerId, used for presence so the
  //                   peer can detect our disconnect
  // `peerId`        — opponent's playerId; we synthesize a
  //                   `peer_left` event when they vanish from
  //                   presence. Pass `null` to skip presence tracking
  //                   (used by the lobby flow, where peer identity
  //                   isn't known yet).
  constructor(client, channelName, { selfId, peerId = null } = {}) {
    this._client       = client;
    this._channelName  = channelName;
    this._selfId       = selfId;
    this._peerId       = peerId;
    this._channel      = null;
    this._closed       = false;
    this._pendingSends = [];     // queued until subscribe completes
    this._subscribed   = false;
    this.onMessage     = null;   // assigned by MatchController

    this._init();
  }

  // Subscribe + wire all event handlers. Channel names are namespaced
  // by Supabase per-project — passing the same name from two clients
  // hooked to the same project pairs them. We DON'T await subscribe
  // in the constructor (constructors can't be async); instead we
  // queue any sends that fire before subscription completes and
  // flush them in the SUBSCRIBED callback.
  _init() {
    const channel = this._client.channel(this._channelName, {
      config: {
        broadcast: { self: false, ack: false },
        presence:  { key: this._selfId },
      },
    });

    // Inbound game messages. MatchController's protocol envelope
    // ({ type, payload }) is whatever the caller passed to send();
    // we just hand it back through onMessage.
    channel.on('broadcast', { event: 'msg' }, (e) => {
      if (this._closed) return;
      this.onMessage?.(e.payload);
    });

    // Presence-based peer-left detection. We only listen for leave
    // events naming our known peerId — joins are noise (we already
    // know who our peer is, the matchmaking layer told us). The
    // synthetic envelope mirrors the shape MatchController expects
    // so the versus flow can subscribe to it via on('peer_left').
    if (this._peerId) {
      channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
        if (this._closed) return;
        for (const presence of leftPresences || []) {
          // presence.presence_ref is a per-tab ID Supabase manages;
          // we keyed our track() call with selfId so the peer's
          // presence row is identified by their selfId. Both
          // populate as `key` on the presence object.
          if (presence.key === this._peerId || presence.presence_ref === this._peerId) {
            this.onMessage?.({ type: 'peer_left', payload: { peerId: this._peerId } });
            return;
          }
        }
      });
    }

    channel.subscribe(async (status) => {
      if (this._closed) return;
      if (status !== 'SUBSCRIBED') return;
      this._subscribed = true;
      // Track our own presence so the peer can detect when we
      // disappear. Track is idempotent — re-tracking on resubscribe
      // (after a network blip) updates the existing entry rather
      // than creating duplicates.
      try {
        await channel.track({ key: this._selfId, t: Date.now() });
      } catch {
        // Best-effort. If presence is rejected (rare), the channel
        // still works for broadcast — the peer just won't get a
        // peer_left synthetic event when we go away.
      }
      // Flush any sends that the caller attempted before SUBSCRIBED
      // landed. Order is preserved (we used a FIFO array).
      const queued = this._pendingSends;
      this._pendingSends = [];
      for (const msg of queued) this._rawSend(msg);
    });

    this._channel = channel;
  }

  // BroadcastChannelTransport's send is synchronous — to match, we
  // queue if we haven't subscribed yet rather than awaiting. The
  // subscription typically completes within a few hundred ms, well
  // before the first game-state snapshot fires.
  send(msg) {
    if (this._closed) return;
    if (!this._subscribed) {
      this._pendingSends.push(msg);
      return;
    }
    this._rawSend(msg);
  }

  _rawSend(msg) {
    // `send` returns a promise that resolves to 'ok' / 'error' /
    // 'timed out'. We don't await — versus traffic is tolerant of
    // single-message drops (state-sync re-sends every 100ms,
    // garbage/i_lost are application-acked by their effects). If
    // a specific message ever needs at-least-once delivery, a
    // higher-level retry belongs above the transport, not in it.
    this._channel.send({
      type: 'broadcast',
      event: 'msg',
      payload: msg,
    }).catch(() => { /* best-effort */ });
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    this._pendingSends = [];
    if (this._channel) {
      try { this._client.removeChannel(this._channel); } catch { /* ignore */ }
      this._channel = null;
    }
  }
}
