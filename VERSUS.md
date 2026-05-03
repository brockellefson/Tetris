# Networked Puyo Versus

How the **VS NETWORK** splash button finds you an opponent and pipes
the match between two browsers anywhere on the internet.

## TL;DR

No setup beyond the leaderboard. If `js/config.js` has a Supabase URL
and publishable key (the same pair `LEADERBOARD.md` walks you through),
versus mode works out of the box — Supabase Realtime is enabled by
default for every project.

If config is empty the **VS NETWORK** button auto-hides; the game
plays fine without it.

## Architecture

```
┌─────────┐   Realtime presence    ┌─────────┐
│ player A │ ◀──── lobby ─────▶   │ player B │
└────┬────┘                        └────┬────┘
     │                                  │
     │  pair message naming matchId     │
     ├──────────────────────────────────▶
     │                                  │
     ▼  per-match broadcast channel     ▼
   ┌────────────────────────────────────────┐
   │   puyo-vs-match:<matchId>              │
   │   ready / state / garbage / i_lost     │
   │   rematch_ready / left / color_lock …  │
   └────────────────────────────────────────┘
```

Two layers:

1. **Lobby** — every clicker subscribes to a single shared channel
   (`puyo-vs-lobby:v1`) and tracks themselves into Realtime
   *Presence*. On every presence sync each tab sees the full sorted
   list of players in the lobby. The lower-id player of the
   lowest-ranked pair generates a fresh `matchId` and broadcasts a
   `pair` message naming the partner. Both sides leave the lobby
   and resolve.
2. **Match** — both players subscribe to
   `puyo-vs-match:<matchId>` and exchange the existing event types
   (`ready`, `state`, `garbage`, `i_lost`, `rematch_ready`, `left`,
   plus card-driven events like `color_lock` / `color_blind`). The
   transport also surfaces a synthetic `peer_left` event when
   Realtime presence reports the opponent vanished — the match-end
   menu treats that as a forfeit win.

No SQL tables are needed for matchmaking. The leaderboard's
`scores` / `scores_puyo` tables are the only DB state the project
owns.

## Files

```
js/modes/puyo/versus/
├── matchmaking.js          ← presence-based lobby, returns
│                              { matchId, peerId } when paired
├── supabase-client.js      ← lazy singleton Supabase client
│                              (loads supabase-js from esm.sh on
│                              the first VS NETWORK click)
├── supabase-transport.js   ← MatchController-compatible transport
│                              wrapping a Realtime broadcast channel,
│                              with peer_left synthetic events
├── network-vs.js           ← the splash-click → match → end flow
├── match-controller.js     ← typed pub/sub over any transport
├── garbage-plugin.js       ← outgoing chains → 'garbage' events
├── state-sync-plugin.js    ← throttled board snapshots → 'state'
├── opponent-view.js        ← paints incoming snapshots
├── match-end-menu.js       ← REMATCH / EXIT modal
└── mode.js                 ← PUYO_VERSUS_MODE bundle
```

## Debugging

* **Two-tab dev test**: open `http://localhost:8000` in two tabs (or
  one Chrome + one Firefox window), click VS NETWORK in each. The
  same machine pairing is fine — Realtime treats every tab as a
  unique presence even when they share a public IP.
* **No Supabase config**: VS NETWORK button stays hidden. If you
  want to verify, set both `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`
  in `js/config.js` and reload.
* **Lobby state inspection**: Supabase Dashboard → your project →
  Realtime Inspector → join channel `puyo-vs-lobby:v1`. You'll see
  the presence state of any clients currently waiting and every
  `pair` broadcast as it goes by.
* **Stuck "FINDING OPPONENT…"**: someone has to be looking at the
  same time. Open a second tab to verify the flow is alive; if the
  dashboard shows zero presence in `puyo-vs-lobby:v1` while you
  *are* on that screen, something blocked the Realtime WebSocket
  (corporate proxy, content blocker, third-party-cookie shenanigans).

## Cancel + disconnect handling

* **Esc during matchmaking** removes you from the lobby and clears
  the overlay. So does clicking the splash button a second time
  while it's pulsing FINDING.
* **Tab close mid-match** triggers the peer's `peer_left` event
  within ~30s (Realtime presence heartbeat timeout). The peer's
  match-end menu paints YOU WIN and locks REMATCH.
* **Network blip mid-match** — supabase-js auto-reconnects to the
  same channel; messages sent during the gap are dropped, but
  state-sync re-sends every 100ms so the visible field re-syncs
  within one tick. Garbage / i_lost may genuinely drop on a long
  outage; that's an at-most-once tradeoff baked into the protocol.

## Adding a new versus event

Same as the local-only era:

1. Sender side calls `sendVersusMessage(type, payload)` (exported
   from `garbage-plugin.js` — re-exposed because every versus card
   already imports from there).
2. Receiver side adds a `matchController.on(type, handler)` line
   inside `network-vs.js`'s `wireMatchHandlers()` and writes into
   whichever `_pluginState` slot the relevant card reads.
3. The card itself (in `js/modes/puyo/powerups/`) declares
   `modes: ['puyo-versus']` and reads its slot from its own
   lifecycle hooks.

The transport doesn't care about event names; it ships everything
through a single `'msg'` broadcast event and lets MatchController
demultiplex by `msg.type`.
