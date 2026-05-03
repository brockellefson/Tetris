// ============================================================
// storage.js — global leaderboard persistence (Supabase)
// ============================================================
//
// Pure data layer. Knows about Supabase and the `scores` table
// schema; knows nothing about the Game, the renderer, or any DOM.
// The leaderboard UI module (js/leaderboard.js) calls into here.
//
// All exported functions are async. They resolve to plain objects
// (or arrays of plain objects); they never throw — instead they
// return `{ ok: false, error }` so callers can render a friendly
// error message in the overlay without try/catch noise.
//
// Schema (mirrored from LEADERBOARD.md):
//
//   create table scores (
//     id          bigint primary key generated always as identity,
//     name        text   not null check (char_length(name) between 1 and 16),
//     score       integer not null check (score >= 0),
//     lines       integer not null check (lines >= 0),
//     level       integer not null check (level >= 1),
//     duration_ms integer not null check (duration_ms >= 0),
//     blessings   jsonb   not null default '[]'::jsonb,
//     curses      jsonb   not null default '[]'::jsonb,
//     specials    jsonb   not null default '{}'::jsonb,
//     created_at  timestamptz not null default now()
//   );
//
// RLS policies (also in LEADERBOARD.md):
//   • anonymous select  — anyone can read top scores
//   • anonymous insert  — anyone can post their own run
//   • no update / delete — entries are immutable from the client
//
// We use Supabase's PostgREST endpoint directly via fetch rather
// than pulling in @supabase/supabase-js. That sidesteps the
// CDN-import question, keeps the bundle tiny, and the two calls we
// need (insert + select) are one-liners against PostgREST anyway.
// ============================================================

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, LEADERBOARD_ENABLED } from './config.js';

// localStorage key for the player's last-used display name. Persisted
// so the submit form pre-fills on subsequent runs — saves the player
// from retyping every game over.
const NAME_STORAGE_KEY = 'stackoverflow.leaderboard.lastName';

// Common headers for every request. The anon key is sent twice on
// purpose: `apikey` is what PostgREST authenticates against, and
// the Authorization bearer is what RLS evaluates `auth.role()`
// against (it resolves to the `anon` role for the anon key).
function headers(extra = {}) {
  return {
    'apikey': SUPABASE_PUBLISHABLE_KEY,
    'Authorization': `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

// True iff config.js has both values filled in. The UI uses this to
// show a "leaderboard not configured" message instead of trying to
// hit a nonexistent endpoint.
export function isEnabled() {
  return LEADERBOARD_ENABLED;
}

// Fetch the top N scores, ordered by score descending. Defaults to
// 25 — comfortably fits the browser overlay without scrolling.
//
// Returns:
//   { ok: true,  scores: [...] }
//   { ok: false, error: string }
//
// The PostgREST query string mirrors the SQL it generates:
//   ?select=*&order=score.desc&limit=25
export async function fetchTopScores(limit = 25) {
  if (!LEADERBOARD_ENABLED) {
    return { ok: false, error: 'Leaderboard not configured' };
  }
  try {
    const url = `${SUPABASE_URL}/rest/v1/scores`
      + `?select=*`
      + `&order=score.desc`
      + `&limit=${encodeURIComponent(limit)}`;
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) {
      // Surface the PostgREST error message so a misconfigured RLS
      // policy is easy to debug from the browser console.
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body || res.statusText}` };
    }
    const scores = await res.json();
    return { ok: true, scores };
  } catch (err) {
    // Network failures, CORS misconfigs, etc.
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Submit a single score. The caller (leaderboard.js) is responsible
// for assembling the entry from game state — storage.js doesn't
// know anything about Game, blessings, or curses; it just shapes
// the row Supabase wants and posts it.
//
// `entry` shape:
//   {
//     name:        string (1..16 chars, trimmed by caller)
//     score:       integer >= 0
//     lines:       integer >= 0
//     level:       integer >= 1
//     durationMs:  integer >= 0
//     blessings:   array  (defaults to [])
//     curses:      array  (defaults to [])
//     specials:    object (defaults to {})
//   }
//
// Returns:
//   { ok: true,  row: <inserted row> }
//   { ok: false, error: string }
//
// Prefer header `Prefer: return=representation` so PostgREST hands
// the inserted row (with its `id` and `created_at`) back — the UI
// can then highlight the just-submitted row in the browser view.
export async function submitScore(entry) {
  if (!LEADERBOARD_ENABLED) {
    return { ok: false, error: 'Leaderboard not configured' };
  }
  // Cheap client-side validation. The DB checks again via column
  // constraints, so this is purely so the player gets a useful
  // message before the round-trip.
  const name = String(entry.name ?? '').trim();
  if (name.length < 1 || name.length > 16) {
    return { ok: false, error: 'Name must be 1–16 characters' };
  }
  const row = {
    name,
    score:       Math.max(0, Math.floor(entry.score      ?? 0)),
    lines:       Math.max(0, Math.floor(entry.lines      ?? 0)),
    level:       Math.max(1, Math.floor(entry.level      ?? 1)),
    duration_ms: Math.max(0, Math.floor(entry.durationMs ?? 0)),
    blessings:   Array.isArray(entry.blessings) ? entry.blessings : [],
    curses:      Array.isArray(entry.curses)    ? entry.curses    : [],
    specials:    (entry.specials && typeof entry.specials === 'object') ? entry.specials : {},
  };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scores`, {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${body || res.statusText}` };
    }
    const inserted = await res.json();
    // PostgREST returns an array even for single-row inserts.
    return { ok: true, row: Array.isArray(inserted) ? inserted[0] : inserted };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Read the last-used display name (or '' if none). Used to pre-fill
// the submit form's name field. Wrapped in try/catch because Safari
// in private mode throws on localStorage access.
export function loadLastName() {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

// Persist the last-used display name. Called from the submit flow
// right after a successful insert.
export function saveLastName(name) {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, String(name).trim().slice(0, 16));
  } catch {
    /* best-effort — private mode failures are silent */
  }
}
