# Global Leaderboard Setup

The leaderboard is backed by [Supabase](https://supabase.com) — a hosted Postgres + REST API with a generous free tier. Setup is roughly five minutes once you have a Supabase account.

## 1. Create the project

Sign in at [supabase.com](https://supabase.com) and create a new project. Pick a region close to your players. The free tier is plenty for a Tetris leaderboard — limits are 500 MB of database and 50,000 monthly active users.

When the project finishes provisioning, you'll land on its dashboard.

## 2. Create the table and RLS policies

In the left sidebar, open **SQL Editor**, paste the block below, and click **Run**.

```sql
-- One row per submitted score. Immutable from the client.
create table if not exists scores (
  id          bigint generated always as identity primary key,
  name        text   not null check (char_length(name) between 1 and 16),
  score       integer not null check (score >= 0),
  lines       integer not null check (lines >= 0),
  level       integer not null check (level >= 1),
  duration_ms integer not null check (duration_ms >= 0),
  blessings   jsonb   not null default '[]'::jsonb,
  curses      jsonb   not null default '[]'::jsonb,
  specials    jsonb   not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Index for the "top N" query the browser hits on every overlay open.
create index if not exists scores_score_desc_idx
  on scores (score desc, created_at desc);

-- Lock the table down. RLS is OFF by default — without these
-- policies, anonymous requests would be rejected entirely.
alter table scores enable row level security;

-- Anyone can read the leaderboard.
create policy "Public read"
  on scores for select
  to anon
  using (true);

-- Anyone can post a score. The CHECK constraints above prevent the
-- obvious garbage (negative scores, oversized names). Anti-cheat
-- beyond that is intentionally out of scope for v1.
create policy "Public insert"
  on scores for insert
  to anon
  with check (true);

-- No update / delete policy = those operations are denied for the
-- anon role. Entries are immutable once posted; you can manage them
-- yourself from the Supabase dashboard if you ever need to.
```

Verify by opening **Table Editor** in the sidebar — you should see an empty `scores` table.

## 3. Copy the credentials into `js/config.js`

In the Supabase dashboard, open **Project Settings → API**. You need two values from there:

- **Project URL** (e.g. `https://abcdefghijklmno.supabase.co`)
- **anon public** key (the long JWT, NOT the `service_role` key)

Open `js/config.js` and paste them in:

```js
export const SUPABASE_URL      = 'https://abcdefghijklmno.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...your.anon.key.here';
```

Both values are safe to commit to a public repo — the anon key is designed for client-side use and is gated by the RLS policies you just created. The `service_role` key would bypass RLS, so never put that in `config.js`.

## 4. Test

Reload the game. You should see:

1. A new **LEADERBOARD** button on the splash screen below **PLAY**.
2. After your first game over, a **SAVE YOUR SCORE** overlay appears — type a name and hit **SUBMIT**. The top-scores browser opens with your row highlighted in gold.
3. Clicking **LEADERBOARD** from the splash always shows the current top 25.

If the button is missing, double-check that both values in `config.js` are non-empty strings. If the submit fails with an HTTP error in the status line, the most common cause is forgetting to enable RLS or skipping one of the two policies — re-run the SQL block above to be sure.

## What gets recorded

Each submission carries the player's display name plus enough run metadata to reconstruct the shape of the run later:

| Column        | Notes                                                               |
|---------------|---------------------------------------------------------------------|
| `score`       | Final score                                                         |
| `lines`       | Total lines cleared                                                 |
| `level`       | Highest level reached                                               |
| `duration_ms` | Wall-clock milliseconds from `Game.start()` to game over            |
| `blessings`   | JSON array of `{id, stacks}` — every unlocked blessing at game over |
| `curses`      | JSON array of `{id, stacks}` — every active curse at game over      |
| `specials`    | JSON object — special-block unlock levels (`{bomb, lightning, …}`)  |

The browser overlay only renders score / lines / level / time today, but the metadata is there for whenever you want to add filters ("show me runs that beat Cruel"), per-card stat pages, or a "build inspector" that shows what blessings and curses defined the top runs.

## Disabling the leaderboard

Clear both values in `config.js`:

```js
export const SUPABASE_URL      = '';
export const SUPABASE_ANON_KEY = '';
```

The splash button hides itself, the post-game-over submit overlay never appears, and the game continues to play exactly as it did before the leaderboard was added. Useful for local development or if you'd rather keep the project offline.

## Future directions (not implemented)

The architecture leaves a few seams open:

- **Per-week / per-month boards** — `created_at` is already indexed; add a date filter to the PostgREST query in `js/storage.js`.
- **Filtered leaderboards** — the `blessings` / `curses` JSONB columns are indexed-friendly via a GIN index; queries like "top runs with the Cruel curse active" are one `where` clause away.
- **Replay validation** — would require the bag RNG to be seeded and recorded, plus a server-side runner that replays the input log against the same engine. Big project; deliberately out of scope for v1.
