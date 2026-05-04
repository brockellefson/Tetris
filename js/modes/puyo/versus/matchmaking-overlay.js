// ============================================================
// Matchmaking overlay (Puyo versus, network mode)
// ============================================================
//
// The "FINDING OPPONENT…" modal that pops the moment the player
// clicks VS NETWORK and stays up until either the lobby pairs us or
// the player cancels. Owns its own DOM (markup in index.html under
// #matchmaking-overlay), CANCEL button wiring, Esc-to-cancel, and
// the menu sounds the rest of the UI uses.
//
// API mirrors match-end-menu.js — same factory shape, same
// hide/show idempotency, same setStatus contract — so a future
// refactor that consolidates these "modal over the splash" surfaces
// into a generic Modal class only needs to touch one shape.
//
// The setup function takes nothing and returns:
//
//   show({ onCancel })  → reveal the overlay, store the callback
//   hide()              → hide it
//   isOpen()            → boolean
//   setStatus(text, opts) → rewrite the status line. opts.warning
//                            swaps the color to pink for "things
//                            went wrong" messages (e.g. CONNECTION
//                            FAILED before the auto-clear timer
//                            kicks in).
//   setOnlineCount(n)     → show "<n> PLAYER(S) ONLINE" under the
//                            status line. Pass null/undefined to
//                            hide the line. Network-vs.js calls this
//                            from the lobby's presence-sync hook so
//                            the player can see the lobby is alive.
// ============================================================

import {
  playCycleSound,
  playSelectSound,
  playMenuOpenSound,
  playMenuHoverSound,
  wireMenuSounds,
} from '../../../sound.js';

export function setupMatchmakingOverlay() {
  const overlay$ = document.getElementById('matchmaking-overlay');
  const status$  = document.getElementById('matchmaking-status');
  const online$  = document.getElementById('matchmaking-online');
  const cancel$  = document.getElementById('matchmaking-cancel-btn');
  if (!overlay$ || !cancel$) {
    // Defensive — older index.html without the markup degrades to
    // a no-op overlay. The splash flow still works; it just won't
    // surface a visual cue while waiting.
    return {
      show: () => {}, hide: () => {}, isOpen: () => false,
      setStatus: () => {}, setOnlineCount: () => {},
    };
  }

  // Per-show callback. Re-pinned every time show() is called so
  // a stale CANCEL handler from a previous matchmaking attempt
  // can't fire after a successful pair.
  let onCancel = null;

  function isOpen() {
    return !overlay$.classList.contains('hidden');
  }

  function show(callbacks = {}) {
    onCancel = callbacks.onCancel || null;
    // Reset to the default status line. Caller may override via
    // setStatus immediately after show() if they want a custom
    // first message (e.g. "RECONNECTING…").
    setStatus('SEARCHING THE LOBBY…');
    // Clear any leftover count from a previous attempt — the lobby
    // hasn't surfaced its first presence sync yet, so we shouldn't
    // be displaying a stale "3 PLAYERS ONLINE" tag.
    setOnlineCount(null);
    overlay$.classList.remove('hidden');
    playMenuOpenSound();
    // Focus CANCEL after a frame so the modal-open transition
    // has begun before the browser resolves focus — matches
    // match-end-menu.js's pattern. CANCEL is the only actionable
    // element in the overlay so it's the unambiguous focus target.
    requestAnimationFrame(() => cancel$.focus());
  }

  function hide() {
    overlay$.classList.add('hidden');
    // Drop the count line at the same time the overlay disappears
    // so a re-open starts in the "no count yet" state. Stale counts
    // from a previous matchmaking attempt would otherwise flash for
    // a frame before the next presence sync arrived.
    setOnlineCount(null);
  }

  function setStatus(text, { warning = false } = {}) {
    if (!status$) return;
    status$.textContent = text || '';
    status$.classList.toggle('warning', !!warning);
  }

  // Pass an integer (>=1) to display the count, or null/undefined
  // to hide the line entirely (e.g. before the first presence sync,
  // or after we've left the lobby). Singular/plural is handled here
  // so callers don't have to think about it.
  function setOnlineCount(n) {
    if (!online$) return;
    if (n == null || !Number.isFinite(n) || n < 1) {
      online$.textContent = '';
      online$.classList.add('hidden');
      return;
    }
    const label = n === 1 ? 'PLAYER ONLINE' : 'PLAYERS ONLINE';
    online$.textContent = `${n} ${label}`;
    online$.classList.remove('hidden');
  }

  cancel$.addEventListener('click', () => {
    if (!isOpen()) return;
    playSelectSound();
    const cb = onCancel;
    hide();
    cb?.();
  });

  // Hover ping — only while the overlay is up so a lingering
  // hover after dismissal stays silent. Same shouldPlay guard the
  // match-end menu uses.
  wireMenuSounds(cancel$, {
    hover: playMenuHoverSound,
    click: null,
    shouldPlay: isOpen,
  });

  // Keyboard handlers in capture phase so we beat the splash menu's
  // global keydown handler (which would otherwise interpret Enter /
  // Space as "click the focused splash button" — confusing when the
  // matchmaking overlay is on top of the splash).
  //
  //   Esc / Enter / Space → CANCEL
  //
  // We deliberately don't wire arrow nav (one button means there's
  // nowhere to navigate to) and we swallow P so input.js's pause
  // toggle can't fire underneath the modal.
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    switch (e.key) {
      case 'Escape':
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopImmediatePropagation();
        playSelectSound();
        const cb = onCancel;
        hide();
        cb?.();
        return;
      case 'p':
      case 'P':
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
  }, true);

  return { show, hide, isOpen, setStatus, setOnlineCount };
}
