// ============================================================
// leaderboard.js — global leaderboard UI (submit + browse overlays)
// ============================================================
//
// Owns the two overlays declared in index.html:
//
//   #leaderboard-submit  — "save your score" card shown once per
//                          run, the moment Game.onGameOver edge-fires.
//                          The player types a 1–16 char display
//                          name and SUBMIT posts the score (plus
//                          run metadata) to Supabase.
//
//   #leaderboard-browse  — top-25 scores table reachable from the
//                          splash menu's LEADERBOARD button (and
//                          from a "View Top Scores" path after a
//                          successful submit).
//
// Game state interaction:
//   • Reads game.score / lines / level / unlocks / curses /
//     runDurationMs() to build the submission payload.
//   • Doesn't mutate game state — restart and pause are owned by
//     input.js and main.js as before.
//
// Lifecycle (wired in main.js):
//   const lb = setupLeaderboard(game);
//   game.onGameOver = () => lb.showSubmit();    // post-run flow
//   leaderboardBtn.onclick = () => lb.showBrowse();
//   lb.hide();   // call on restart so a new run starts clean
//
// Audio + visual conventions follow CLAUDE.md → "UI conventions":
// every interactive surface gets hover + select sounds, the
// submit button highlights in cyan, and the just-submitted row
// in the browser uses the gold .highlight class (same family as
// .debug-pill.active).
// ============================================================

import {
  isEnabled, fetchTopScores, submitScore, loadLastName, saveLastName,
} from './storage.js';
import {
  playCycleSound, playSelectSound, playMenuOpenSound, wireMenuSounds,
} from './sound.js';

// Format a millisecond duration as "M:SS" (or "H:MM:SS" past an hour).
// Pure helper kept local — the renderer never needs it elsewhere.
function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

// Build the blessings list for the submission payload. Each entry
// is `{ id, stacks }` so we can later render a small icon strip in
// the browser without re-deriving from raw flags. Booleans contribute
// stacks: 1, counters contribute their current value, the specials
// sub-bag is flattened into per-special entries (bomb / lightning /
// welder, each carrying its own level as `stacks`).
function snapshotBlessings(game) {
  const u = game.unlocks ?? {};
  const out = [];
  if (u.hold)         out.push({ id: 'hold',   stacks: 1 });
  if (u.ghost)        out.push({ id: 'ghost',  stacks: 1 });
  if (u.slick)        out.push({ id: 'slick',  stacks: 1 });
  if (u.chisel)       out.push({ id: 'chisel', stacks: 1 });
  if (u.fill)         out.push({ id: 'fill',   stacks: 1 });
  if (u.whoops)       out.push({ id: 'whoops', stacks: 1 });
  if (u.flip)         out.push({ id: 'flip',   stacks: 1 });
  if (u.nextCount > 0) out.push({ id: 'psychic', stacks: u.nextCount });
  if (u.lucky > 0)     out.push({ id: 'lucky',   stacks: u.lucky });
  const sp = u.specials ?? {};
  if (sp.bomb > 0)      out.push({ id: 'bomb',      stacks: sp.bomb });
  if (sp.lightning > 0) out.push({ id: 'lightning', stacks: sp.lightning });
  if (sp.welder > 0)    out.push({ id: 'welder',    stacks: sp.welder });
  return out;
}

// Build the curses list for the submission payload. Same shape as
// blessings — id + stacks. Cruel is interesting: it's "active" only
// while the player hasn't leveled past it, so we record whether it
// was active at game-over (stacks=1) rather than the raw counter.
function snapshotCurses(game) {
  const c = game.curses ?? {};
  const out = [];
  if (c.junk)            out.push({ id: 'junk',   stacks: 1 });
  if (c.hyped > 0)       out.push({ id: 'hyped',  stacks: c.hyped });
  if (c.cruelUntilLevel >= (game.level ?? 1))
                         out.push({ id: 'cruel',  stacks: 1 });
  if (c.extraCols > 0)   out.push({ id: 'growth', stacks: c.extraCols });
  return out;
}

export function setupLeaderboard(game) {
  // -------- DOM lookups --------
  const submit$    = document.getElementById('leaderboard-submit');
  const browse$    = document.getElementById('leaderboard-browse');
  const launcher$  = document.getElementById('leaderboard-btn');

  // Submit overlay
  const sScore$    = document.getElementById('ls-score');
  const sLines$    = document.getElementById('ls-lines');
  const sLevel$    = document.getElementById('ls-level');
  const sTime$     = document.getElementById('ls-time');
  const sName$     = document.getElementById('ls-name');
  const sStatus$   = document.getElementById('ls-status');
  const sSubmit$   = document.getElementById('ls-submit-btn');
  const sSkip$     = document.getElementById('ls-skip-btn');

  // Browse overlay
  const bStatus$   = document.getElementById('lb-status');
  const bRows$     = document.getElementById('lb-rows');
  const bClose$    = document.getElementById('lb-close-btn');

  // -------- Splash launcher visibility --------
  // The LEADERBOARD button is hidden via the .hidden class on a
  // fresh clone (no Supabase URL configured). Only un-hide it once
  // we've confirmed the leaderboard is enabled — otherwise clicking
  // it would just show "Leaderboard not configured" and feel broken.
  if (isEnabled() && launcher$) {
    launcher$.classList.remove('hidden');
  }

  // -------- Submit overlay --------
  // True while the submit overlay is up. Used by wireMenuSounds'
  // shouldPlay guard so a hover that fires after the overlay
  // hides stays silent.
  function submitOpen() {
    return !submit$.classList.contains('hidden');
  }
  function browseOpen() {
    return !browse$.classList.contains('hidden');
  }

  // Has the post-game-over submit overlay already been shown for
  // the current run? Game.onGameOver is edge-fired so this should
  // never double-fire, but the guard belt-and-suspenders against
  // future plugins that might somehow bounce gameOver.
  let submittedThisRun = false;

  // Highest-priority showSubmit: snapshots the run, shows the form.
  // The actual fetch happens later when the player hits SUBMIT.
  function showSubmit() {
    if (!isEnabled())     return; // no backend, no-op
    if (submittedThisRun) return; // already shown for this run
    if (!game.gameOver)   return; // safety — shouldn't fire mid-run
    submittedThisRun = true;

    // Snapshot run stats AT show-time so the form values don't
    // drift if the player lingers (game state can keep mutating
    // for a few frames as plugins settle even past game-over).
    const snap = {
      name:       (sName$.value || loadLastName() || '').toUpperCase(),
      score:      game.score,
      lines:      game.lines,
      level:      game.level,
      durationMs: game.runDurationMs(),
      blessings:  snapshotBlessings(game),
      curses:     snapshotCurses(game),
      specials:   game.unlocks?.specials ?? {},
    };
    sScore$.textContent = snap.score.toLocaleString();
    sLines$.textContent = snap.lines.toLocaleString();
    sLevel$.textContent = snap.level.toLocaleString();
    sTime$.textContent  = formatDuration(snap.durationMs);
    sName$.value        = snap.name; // pre-fill last-used name
    sStatus$.textContent = '';
    sStatus$.className   = 'leaderboard-status';
    sSubmit$.disabled    = false;
    sSkip$.disabled      = false;

    submit$.classList.remove('hidden');
    playMenuOpenSound();
    // Defer the focus by a frame so the modal-open animation has
    // already started — focusing mid-paint can scroll oddly.
    requestAnimationFrame(() => sName$.focus());

    // Stash the snapshot on the closure so SUBMIT uses the
    // frozen-at-show stats, not whatever game.score happens to be
    // a few hundred ms later. SUBMIT only swaps in the live name
    // (so typing a different name still works).
    pendingSnap = snap;
  }
  // Holds the snapshot built by showSubmit so the SUBMIT click can
  // post the same numbers regardless of any later game state drift.
  let pendingSnap = null;

  // Close the submit overlay without saving. Used by SKIP, by Esc,
  // and by hide() (called from main.js on restart).
  function closeSubmit() {
    submit$.classList.add('hidden');
    pendingSnap = null;
  }

  async function doSubmit() {
    if (!pendingSnap) return;
    const name = (sName$.value || '').trim();
    if (name.length === 0) {
      sStatus$.textContent = 'Enter a name first';
      sStatus$.className   = 'leaderboard-status error';
      sName$.focus();
      return;
    }
    sSubmit$.disabled = true;
    sSkip$.disabled   = true;
    sStatus$.textContent = 'Saving…';
    sStatus$.className   = 'leaderboard-status';

    const result = await submitScore({ ...pendingSnap, name });
    if (!result.ok) {
      sStatus$.textContent = result.error || 'Save failed';
      sStatus$.className   = 'leaderboard-status error';
      sSubmit$.disabled = false;
      sSkip$.disabled   = false;
      return;
    }
    // Persist the name for the next run's pre-fill.
    saveLastName(name);

    sStatus$.textContent = 'Saved! Opening leaderboard…';
    sStatus$.className   = 'leaderboard-status success';
    // Brief pause so the success message is actually readable
    // before the browse overlay covers it.
    setTimeout(() => {
      closeSubmit();
      // Pass the just-inserted row's id so the browser can highlight
      // it in the list. Falls back gracefully if the id is missing.
      showBrowse({ highlightId: result.row?.id });
    }, 600);
  }

  // -------- Submit overlay wiring --------
  wireMenuSounds(sSubmit$, {
    hover: playCycleSound,
    click: null, // doSubmit fires playSelectSound on success path
    shouldPlay: submitOpen,
  });
  wireMenuSounds(sSkip$, { shouldPlay: submitOpen });

  sSubmit$.addEventListener('click', () => {
    if (sSubmit$.disabled) return;
    playSelectSound();
    doSubmit();
  });
  sSkip$.addEventListener('click', () => {
    if (sSkip$.disabled) return;
    closeSubmit();
  });

  // Force the name input to upper case + strip non-displayables
  // so the leaderboard reads consistently. We don't restrict to
  // ASCII so unicode handles are fine; we just normalize case.
  sName$.addEventListener('input', () => {
    const cur = sName$.value;
    const upper = cur.toUpperCase();
    if (cur !== upper) sName$.value = upper;
  });

  // Enter submits, Esc skips. Captured at the input so they don't
  // fall through to gameplay handlers (which might restart the
  // game on the wrong key).
  sName$.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation();
      sSubmit$.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeSubmit();
    }
  });

  // -------- Browse overlay --------
  // Track the highlighted row's id so a refresh keeps the gold
  // marker in place if the same row is still in the top N.
  let highlightedId = null;

  async function showBrowse({ highlightId } = {}) {
    if (!isEnabled()) {
      // Surface the missing-config case directly in the overlay
      // rather than silently no-op'ing — clearest path for someone
      // who's just cloned the repo and hit the button.
      bStatus$.textContent = 'Leaderboard not configured (see LEADERBOARD.md)';
      bStatus$.className   = 'leaderboard-status error';
      bRows$.innerHTML     = '';
      browse$.classList.remove('hidden');
      playMenuOpenSound();
      return;
    }
    if (typeof highlightId === 'number') highlightedId = highlightId;

    bStatus$.textContent = 'Loading…';
    bStatus$.className   = 'leaderboard-status';
    bRows$.innerHTML     = '';
    browse$.classList.remove('hidden');
    playMenuOpenSound();

    const result = await fetchTopScores(25);
    // The user might close the overlay before the request returns
    // — bail in that case so we don't paint into a hidden surface.
    if (!browseOpen()) return;

    if (!result.ok) {
      bStatus$.textContent = result.error || 'Load failed';
      bStatus$.className   = 'leaderboard-status error';
      return;
    }
    const scores = result.scores ?? [];
    if (scores.length === 0) {
      bStatus$.textContent = 'No scores yet — be the first.';
      bStatus$.className   = 'leaderboard-status';
      return;
    }
    bStatus$.textContent = '';
    renderRows(scores, highlightedId);
  }

  function renderRows(scores, highlightId) {
    // Build via documentFragment so we touch the DOM exactly once
    // — meaningful when the overlay is sitting on top of the
    // synthwave background's per-frame transforms.
    const frag = document.createDocumentFragment();
    scores.forEach((row, idx) => {
      const tr = document.createElement('tr');
      const rank = idx + 1;
      tr.classList.add(`rank-${rank}`);
      if (row.id === highlightId) tr.classList.add('highlight');
      tr.innerHTML = `
        <td class="lb-col-rank">${rank}</td>
        <td class="lb-col-name">${escapeHtml(row.name)}</td>
        <td class="lb-col-score">${Number(row.score).toLocaleString()}</td>
        <td class="lb-col-lines">${Number(row.lines).toLocaleString()}</td>
        <td class="lb-col-level">${Number(row.level).toLocaleString()}</td>
        <td class="lb-col-time">${formatDuration(row.duration_ms)}</td>
      `;
      frag.appendChild(tr);
    });
    bRows$.innerHTML = '';
    bRows$.appendChild(frag);
  }

  // Names come from arbitrary user input so escape before injecting
  // into innerHTML. Tiny helper — pulling in a library would be
  // overkill for the four dangerous characters.
  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // -------- Browse overlay wiring --------
  wireMenuSounds(bClose$, { shouldPlay: browseOpen });
  bClose$.addEventListener('click', () => {
    browse$.classList.add('hidden');
  });

  // Esc anywhere while the browse overlay is up closes it. Capture
  // phase + stopImmediatePropagation so it doesn't leak to gameplay
  // (which would otherwise pause-toggle on the same key).
  document.addEventListener('keydown', (e) => {
    if (!browseOpen()) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      bClose$.click();
    }
  }, { capture: true });

  // -------- Lifecycle --------
  // Called from main.js's restart paths. Hides both overlays AND
  // resets the submittedThisRun guard so the next death triggers
  // the submit flow again.
  function reset() {
    submittedThisRun = false;
    closeSubmit();
    browse$.classList.add('hidden');
  }

  return { showSubmit, showBrowse, hide: reset };
}
