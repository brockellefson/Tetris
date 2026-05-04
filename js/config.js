// ============================================================
// config.js — runtime configuration the player edits
// ============================================================
//
// Two services, two switches:
//
//   • Supabase project URL + publishable key — feeds the global
//     leaderboard (js/storage.js posts/fetches via PostgREST).
//     Both values are SAFE to commit to a public GitHub Pages repo:
//       - The publishable key (formerly "anon public") is intended
//         for client-side use; it gates access through Row Level
//         Security (RLS), not by being secret.
//       - The project URL is part of every request payload anyway.
//     What you DO NOT put here: the secret key (formerly
//     `service_role`). That one bypasses RLS and must never appear
//     in client code.
//
//   • Matchmaking service URL — feeds the VS NETWORK button. Used
//     to be Supabase Realtime; now points at a self-hosted .NET
//     SignalR service (../Matchmaking/src/Matchmaking.Server).
//     For local dev, the default `dotnet run` URL is correct as-is;
//     for GitHub Pages, deploy the service somewhere with HTTPS
//     and paste its base URL here.
//
// Either feature can be left blank — the corresponding splash
// button hides itself gracefully and the game still plays.
//
// Setup checklist for the leaderboard (see LEADERBOARD.md):
//   1. Create a free Supabase project at https://supabase.com.
//   2. Run the table + RLS SQL from LEADERBOARD.md in the SQL editor.
//   3. Settings → API → copy "Project URL" into SUPABASE_URL below
//      and the publishable key into SUPABASE_PUBLISHABLE_KEY.
// Setup checklist for matchmaking (see VERSUS.md):
//   1. cd ../Matchmaking && dotnet run --project src/Matchmaking.Server
//   2. Paste the URL it prints into MATCHMAKING_SERVICE_URL.
// ============================================================

export const SUPABASE_URL              = 'https://fmojymrjtuccabqjfbjo.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY  = 'sb_publishable_vwEIPhekQpLpT9SyDDpgcQ_rLA5qxfA';

// True only when both values are filled in. The leaderboard module
// reads this and short-circuits every Supabase call when it's false,
// so a fresh clone of the repo is fully playable without any setup.
export const LEADERBOARD_ENABLED =
  SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;

// Base URL of the .NET matchmaking service (Matchmaking.Server in
// the sibling repo). Trailing slash is fine — the SignalR client
// trims it. Default matches the launchSettings.json profile so
// `dotnet run` Just Works alongside `python3 -m http.server 8000`.
export const MATCHMAKING_SERVICE_URL = 'http://localhost:5180';

// True only when the matchmaking URL is filled in. The VS NETWORK
// splash button reads this and hides itself gracefully when blank.
export const VERSUS_ENABLED = MATCHMAKING_SERVICE_URL.length > 0;
