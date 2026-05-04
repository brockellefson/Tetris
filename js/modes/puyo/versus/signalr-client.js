// ============================================================
// signalr-client.js — lazy SignalR HubConnection factory
// ============================================================
//
// .NET-port sibling of supabase-client.js. Everything that file said
// about Realtime applies here, with @microsoft/signalr swapped in for
// supabase-js:
//
//   • The leaderboard module (js/storage.js) talks Supabase via raw
//     fetch and is unaffected by this swap.
//   • Versus mode used to ride Supabase Realtime; it now dials a
//     self-hosted ASP.NET Core SignalR service. Same usage pattern —
//     dynamic import, lazy first call, graceful "service unavailable"
//     failure mode — just a different protocol.
//   • The @microsoft/signalr bundle is ~70 KB gzipped, comparable to
//     supabase-js. Loaded only when VS NETWORK is clicked.
//
// What you get back from getSignalRConnection(hubPath):
//   • An UNSTARTED HubConnection for `<MATCHMAKING_SERVICE_URL>/<hubPath>`.
//     Caller is responsible for `await conn.start()` (or letting the
//     transport do it). We don't pre-start because callers want to
//     register `conn.on(...)` handlers BEFORE the first message can
//     land.
//   • A null when matchmaking is disabled (URL blank) or the dynamic
//     import failed. Lets the splash flow render "CONNECTION FAILED"
//     instead of throwing.
//
// Connections are cached per (serverUrl, hubPath) pair. Lobby and
// match channels live on different paths (/hubs/lobby, /hubs/match),
// so they get separate cached connections — same pattern as the
// Supabase version, where the lobby and per-match Realtime channels
// were separate Phoenix-channel subscriptions over a single client.
// ============================================================

import { MATCHMAKING_SERVICE_URL, VERSUS_ENABLED } from '../../../config.js';

// ESM CDN — pinned to v8 major. esm.sh transpiles npm packages on
// the fly into browser-ready ES modules. @microsoft/signalr ships
// browser builds, so this Just Works without any bundler. If the
// CDN ever flakes, swap to https://cdn.jsdelivr.net/npm/@microsoft/signalr@8/+esm
// — same package, alternate mirror.
const SIGNALR_JS_URL = 'https://esm.sh/@microsoft/signalr@8';

// Cached promise — first caller kicks off the dynamic import, every
// subsequent caller awaits the same promise. On failure (bad CDN,
// offline, missing config) the promise resolves to `null`.
let _modulePromise = null;

// Cached HubConnections, keyed by full URL. Two transports for the
// same hub path share the same connection.
const _connections = new Map();

// True iff config.js has MATCHMAKING_SERVICE_URL filled in. The VS
// NETWORK button piggybacks on this to gracefully hide itself when
// the project is configured for offline-only play.
export function isVersusEnabled() {
  return VERSUS_ENABLED;
}

// Lazy-load @microsoft/signalr from the CDN, then build (or return
// the cached) HubConnection for the requested hub path. Returns
// Promise<HubConnection | null>.
export async function getSignalRConnection(hubPath) {
  if (!isVersusEnabled()) return null;
  if (!_modulePromise) {
    _modulePromise = (async () => {
      try {
        return await import(SIGNALR_JS_URL);
      } catch (err) {
        console.error('[versus] failed to load @microsoft/signalr', err);
        return null;
      }
    })();
  }
  const mod = await _modulePromise;
  if (!mod) return null;

  const url = MATCHMAKING_SERVICE_URL.replace(/\/+$/, '') + hubPath;
  if (_connections.has(url)) {
    return _connections.get(url);
  }
  // withAutomaticReconnect mirrors what supabase-js gave us for
  // free. The default retry schedule (0/2/10/30s) is appropriate
  // for realtime games — first retry is immediate, exponential-ish
  // afterwards.
  const conn = new mod.HubConnectionBuilder()
    .withUrl(url)
    .withAutomaticReconnect()
    .build();
  _connections.set(url, conn);
  return conn;
}

// Optional helper for shutdown / hot-reload tests. Stops every
// cached connection. Not wired today; kept here for symmetry with
// the .NET HubClientFactory.DisposeAllAsync.
export async function disposeAllConnections() {
  const conns = Array.from(_connections.values());
  _connections.clear();
  for (const c of conns) {
    try { await c.stop(); } catch { /* best-effort */ }
  }
}
