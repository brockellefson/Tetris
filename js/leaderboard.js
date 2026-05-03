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
  const bStatus$       = document.getElementById('lb-status');
  const bRows$         = document.getElementById('lb-rows');
  const bClose$        = document.getElementById('lb-close-btn');
  const bTabs$         = document.getElementById('lb-tabs');
  const bLinesHeader$  = document.getElementById('lb-col-lines-header');
  // The "Lines" / "Chains" header text per mode. Mirrors what the
  // in-game HUD shows next to game.lines so a Puyo run's "Chains"
  // column header tracks the same vocabulary on the leaderboard.
  const COL_LABEL_BY_MODE = { tetris: 'Lines', puyo: 'Chains' };

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
      // Captured at show-time so the submit posts to the right
      // mode's leaderboard even if game.mode changes between the
      // game-over moment and the player hitting SUBMIT.
      mode:       game.mode?.id ?? 'tetris',
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

    // Route to the right table for the run's mode — Tetris's
    // scores live in `scores`, Puyo's in `scores_puyo`. The
    // snapshot also captures the mode at show-time so a mode
    // switch between game-over and submit doesn't cross-post.
    const result = await submitScore({ ...pendingSnap, name }, pendingSnap.mode);
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
      // Pass the just-inserted row's id AND its mode so the browser
      // opens on the right tab and highlights the row in the list.
      // Falls back gracefully if either is missing.
      showBrowse({
        highlightId: result.row?.id,
        mode:        pendingSnap?.mode,
      });
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
  // Which mode's leaderboard is currently in view. Sticks across
  // tab clicks within one open and resets on every fresh open
  // (showBrowse picks a default — see below).
  let currentMode = 'tetris';

  // Reflect the active mode in the tab strip (gold pill on the
  // matching tab) and update the "Lines" / "Chains" column header
  // so the table reads correctly. Pure DOM toggle, no fetch — the
  // caller decides when to refetch.
  function syncTabs(mode) {
    if (!bTabs$) return;
    for (const btn of bTabs$.querySelectorAll('.lb-tab')) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }
    if (bLinesHeader$) {
      bLinesHeader$.textContent = COL_LABEL_BY_MODE[mode] ?? 'Lines';
    }
  }

  // Fetch + render whichever mode is active. Pulled out of
  // showBrowse so a tab click can refresh the table without
  // re-running the modal-open ceremony.
  async function loadMode(mode) {
    currentMode = mode;
    syncTabs(mode);

    bStatus$.textContent = 'Loading…';
    bStatus$.className   = 'leaderboard-status';
    bRows$.innerHTML     = '';

    const result = await fetchTopScores(25, mode);
    // The user might close the overlay or click a different tab
    // before the request returns — bail in either case so we don't
    // paint stale data into the visible table.
    if (!browseOpen()) return;
    if (currentMode !== mode) return;

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

  async function showBrowse({ highlightId, mode } = {}) {
    if (!isEnabled()) {
      // Surface the missing-config case directly in the overlay
      // rather than silently no-op'ing — clearest path for someone
      // who's just cloned the repo and hit the button.
      bStatus$.textContent = 'Leaderboard not configured (see LEADERBOARD.md)';
      bStatus$.className   = 'leaderboard-status error';
      bRows$.innerHTML     = '';
      browse$.classList.remove('hidden');
      playMenuOpenSound();
      requestAnimationFrame(() => bClose$.focus());
      return;
    }
    if (typeof highlightId === 'number') highlightedId = highlightId;

    // Default tab on open: explicit `mode` arg wins (used by the
    // post-submit "view top scores" link to land on the run's
    // mode), then game.mode.id if a run is in progress, then
    // Tetris. Splash always starts on Tetris because game.mode.id
    // is set to TETRIS_MODE in the constructor before the player
    // picks a mode.
    const initialMode = mode ?? game.mode?.id ?? 'tetris';

    browse$.classList.remove('hidden');
    playMenuOpenSound();
    // Focus the CLOSE button so it's visually selected (gold focus
    // ring) and Enter / Space close the overlay without the player
    // having to mouse over to it. Deferred a frame so the modal-open
    // animation has already started — focusing mid-paint can cause
    // the page to scroll oddly.
    requestAnimationFrame(() => bClose$.focus());

    await loadMode(initialMode);
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

  // Tab clicks — re-route the table to whichever mode the player
  // picked. The active tab's gold pop comes from the .active class
  // we toggle in syncTabs (called from loadMode). Wired via
  // delegation on the tab strip so we don't have to grab each
  // button individually; keeps adding a third tab a one-line
  // change in index.html.
  if (bTabs$) {
    for (const btn of bTabs$.querySelectorAll('.lb-tab')) {
      wireMenuSounds(btn, { shouldPlay: browseOpen });
    }
    bTabs$.addEventListener('click', (e) => {
      const btn = e.target.closest('.lb-tab');
      if (!btn) return;
      const mode = btn.dataset.mode;
      if (!mode || mode === currentMode) return;
      // Drop the run-row highlight when switching modes — it only
      // makes sense in the table the run was actually submitted to.
      highlightedId = null;
      loadMode(mode);
    });
  }

  bClose$.addEventListener('click', () => {
    browse$.classList.add('hidden');
  });

  // Keyboard handling while the browse overlay is up. Capture phase
  // + stopImmediatePropagation so keys don't leak to the splash
  // navigator, the gameplay handler, or the "first key starts the
  // game" fallback in input.js.
  //   • Esc / Enter / Space  → close
  //   • Arrow keys / WASD    → re-focus the CLOSE button (the only
  //                            interactive control on the overlay,
  //                            so there's nowhere else to navigate
  //                            to — but the player still expects
  //                            the gold focus ring to land somewhere
  //                            when they hit an arrow key)
  document.addEventListener('keydown', (e) => {
    if (!browseOpen()) return;
    switch (e.key) {
      case 'Escape':
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopImmediatePropagation();
        bClose$.click();
        return;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'w': case 'W':
      case 'a': case 'A':
      case 's': case 'S':
      case 'd': case 'D':
        e.preventDefault();
        e.stopImmediatePropagation();
        if (document.activeElement !== bClose$) {
          bClose$.focus();
          playCycleSound();
        }
        return;
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
