// ============================================================
// config.js — runtime configuration the player edits
// ============================================================
//
// Holds the Supabase project URL + publishable key used by the
// global leaderboard. Both values are SAFE to commit to a public
// GitHub Pages repo:
//
//   • The publishable key (formerly "anon public") is intended
//     for client-side use; it gates access through Row Level
//     Security (RLS), not by being secret.
//   • The project URL is part of every request payload anyway.
//
// What you DO NOT put here: the secret key (formerly `service_role`).
// That one bypasses RLS and must never appear in client code.
//
// Setup checklist (see LEADERBOARD.md for the full walk-through):
//   1. Create a free Supabase project at https://supabase.com.
//   2. Run the table + RLS SQL from LEADERBOARD.md in the SQL editor.
//   3. Settings → API → copy "Project URL" into SUPABASE_URL below
//      and the publishable key into SUPABASE_PUBLISHABLE_KEY.
//
// If either value is left blank, the leaderboard module disables
// itself gracefully — the game still plays, the splash button just
// stays hidden.
// ============================================================

export const SUPABASE_URL              = 'https://fmojymrjtuccabqjfbjo.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY  = 'sb_publishable_vwEIPhekQpLpT9SyDDpgcQ_rLA5qxfA';

// True only when both values are filled in. The leaderboard module
// reads this and short-circuits every Supabase call when it's false,
// so a fresh clone of the repo is fully playable without any setup.
export const LEADERBOARD_ENABLED =
  SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
