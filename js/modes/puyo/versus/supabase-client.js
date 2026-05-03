// ============================================================
// supabase-client.js — lazy singleton Supabase client (Realtime)
// ============================================================
//
// The leaderboard module (js/storage.js) talks to Supabase via raw
// fetch against the PostgREST endpoint — that's perfect for the two
// stateless calls it needs (insert + select), and it sidesteps the
// CDN-import question.
//
// Versus mode is different: it needs Realtime channels (Presence for
// the lobby + broadcast for the per-match message stream), which
// ride a Phoenix-Channels-flavored WebSocket protocol. Hand-rolling
// that protocol (auth tokens, heartbeats, reconnection, presence
// diffs) would be ~400 lines of delicate code. Instead, we pull in
// the official @supabase/supabase-js client via esm.sh — one CDN
// import, ~80KB gzipped, and we get a battle-tested implementation.
//
// We keep the import scoped to this module so the rest of the app
// stays free of supabase-js — only versus mode pays the bundle cost,
// and only when the player actually clicks VS NETWORK (the dynamic
// import below loads on demand). Tetris and SP Puyo never touch it.
//
// The client is a singleton because each `createClient` call spins
// up its own WebSocket — repeated calls would leak connections.
// First-call wins; every subsequent caller gets the same instance.
// ============================================================

import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  LEADERBOARD_ENABLED,
} from '../../../config.js';

// ESM CDN — pinned to v2 major. esm.sh transpiles npm packages on
// the fly into browser-ready ES modules; supabase-js publishes
// browser builds, so this Just Works without any bundler. If the
// CDN ever flakes, swap to https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm
// — same package, alternate mirror.
const SUPABASE_JS_URL = 'https://esm.sh/@supabase/supabase-js@2';

// Cached promise — first caller kicks off the dynamic import, every
// subsequent caller awaits the same promise. On failure (bad CDN,
// offline, missing config) the promise resolves to `null` so callers
// can branch on "Realtime unavailable" without wrapping every
// access in try/catch.
let _clientPromise = null;

// True iff config.js has both URL and key filled in. Versus mode
// piggybacks on the leaderboard's enable flag — same credentials,
// same project — so a fresh clone of the repo without Supabase
// config gracefully hides the VS NETWORK button instead of trying
// to dial a nonexistent server.
export function isVersusEnabled() {
  return LEADERBOARD_ENABLED;
}

// Lazy-init the Supabase client. Returns a Promise<SupabaseClient | null>.
// The dynamic `import(...)` call ensures the ~80KB bundle isn't pulled
// for Tetris-only sessions — the network only fetches it when a
// player actually clicks VS NETWORK.
//
// Realtime config:
//   • params.eventsPerSecond — default 10. We send state snapshots
//     at ~10Hz (state-sync-plugin's SEND_INTERVAL_MS = 100ms) plus
//     a handful of garbage / handshake events per match, so 20 gives
//     comfortable headroom without paying for a higher tier.
export function getSupabaseClient() {
  if (!isVersusEnabled()) return Promise.resolve(null);
  if (_clientPromise) return _clientPromise;
  _clientPromise = (async () => {
    try {
      const mod = await import(SUPABASE_JS_URL);
      const createClient = mod.createClient || mod.default?.createClient;
      if (typeof createClient !== 'function') {
        // Defensive — esm.sh has shipped both shapes at various
        // points. If neither is present the import is broken and
        // we're better off failing loud here than crashing in
        // matchmaking.
        console.error('[versus] supabase-js import missing createClient');
        return null;
      }
      return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        realtime: { params: { eventsPerSecond: 20 } },
        // No auth persistence — every tab is anonymous. Skipping
        // localStorage avoids a write-permission prompt in private
        // browsing modes that throw on storage access (Safari).
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch (err) {
      console.error('[versus] failed to load supabase-js', err);
      return null;
    }
  })();
  return _clientPromise;
}
