// ============================================================
// MatchController — typed message bus over a swappable transport
// ============================================================
//
// Sits between the garbage plugin (and any future versus subsystem)
// and whichever transport actually moves bytes between players.
// The transport is dependency-injected so we can:
//
//   • Use SignalRMatchTransport for actual networked play (what's
//     wired today via setupNetworkVersus, dialing the .NET
//     Matchmaking.Server in the sibling repo).
//   • Unit-test the protocol with a MockTransport that just relays
//     to a paired peer in-memory (no browser, no network).
//
// An earlier iteration shipped a BroadcastChannelTransport for two-
// tabs-on-one-machine fake versus; it lived here next to the
// MatchController. Once the realtime transport stabilized that
// devtool earned its retirement — SignalR works fine for two
// browsers on the same laptop too. The architectural seam stayed:
// any new transport just needs to implement { send, onMessage, close }.
//
// Protocol shape:
//   { type: string, payload: any }
//
// type is the event name; payload is whatever the event carries.
// MatchController.send(type, payload) wraps in this envelope and
// hands to transport.send. Inbound messages flow through
// transport.onMessage(envelope) → MatchController dispatches to
// the registered handler for that type.
//
// Today's events (for Phase 2):
//   ready    — { playerId, time }   handshake; both tabs send on
//                                   click, peer-up when both seen.
//   garbage  — { count }            nuisance to drop on opponent.
//   i_lost   — {}                   game-over signal; opponent wins.
//
// Future events (Phase 4-5) will add `match_start`, `state_diff`
// (opponent field render), `card_pick`, etc. Adding a new event
// is a one-liner — caller registers a handler with on().

// Wraps any transport satisfying { send(msg), onMessage = fn }.
// Exposes a typed pub/sub layer on top.
export class MatchController {
  constructor(transport) {
    this.transport = transport;
    this._handlers = new Map();
    this._closed = false;
    this.transport.onMessage = (msg) => {
      if (this._closed) return;
      if (!msg || typeof msg.type !== 'string') return;
      const handler = this._handlers.get(msg.type);
      if (handler) handler(msg.payload);
    };
  }

  send(type, payload) {
    if (this._closed) return;
    this.transport.send({ type, payload });
  }

  on(type, handler) {
    this._handlers.set(type, handler);
  }

  off(type) {
    this._handlers.delete(type);
  }

  close() {
    this._closed = true;
    this.transport.close?.();
    this._handlers.clear();
  }
}

// In-memory transport for tests. pair(other) wires two MockTransports
// together so .send on one fires .onMessage on the other on the next
// microtask (Promise.resolve so the call doesn't reentrantly recurse
// through synchronous handler chains).
export class MockTransport {
  constructor() {
    this._peer = null;
    this.onMessage = null;
    this._closed = false;
  }
  pair(other) {
    this._peer = other;
    other._peer = this;
  }
  send(msg) {
    if (this._closed || !this._peer) return;
    Promise.resolve().then(() => {
      if (this._peer && !this._peer._closed) this._peer.onMessage?.(msg);
    });
  }
  close() {
    this._closed = true;
    this._peer = null;
  }
}
