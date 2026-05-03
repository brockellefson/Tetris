// ============================================================
// Match-end menu (Puyo versus)
// ============================================================
//
// Modal that pops over the board when a versus match resolves.
// Two actions:
//
//   REMATCH       — caller's onRematch(). Typically: hide menu,
//                   restart the local versus run on the same
//                   match controller. The opponent restarts on
//                   their own click — for v1 we don't try to
//                   coordinate (whoever's faster gets a brief
//                   solo moment until the other restarts).
//   EXIT TO MENU  — caller's onExit(). Typically: hide menu,
//                   tear down the channel, return to the splash
//                   so the player can pick a different mode.
//
// Keyboard:
//   ↑ / ↓ / ← / → / WASD  — navigate via wireArrowNav
//   Enter / Space         — click the focused button
//   Esc                   — fire onExit (treated as "back out")
//
// Setup once at boot — the menu's show()/hide() are idempotent
// so re-opening it for a second match doesn't double-bind
// listeners.
import { wireArrowNav } from '../../../menus/keynav.js';
import {
  playCycleSound,
  playSelectSound,
  playMenuOpenSound,
  playMenuHoverSound,
  wireMenuSounds,
} from '../../../sound.js';

export function setupMatchEndMenu() {
  const overlay$  = document.getElementById('versus-end');
  const title$    = document.getElementById('versus-end-title');
  const rematch$  = document.getElementById('versus-end-rematch');
  const exit$     = document.getElementById('versus-end-exit');
  const status$   = document.getElementById('versus-end-status');
  if (!overlay$ || !rematch$ || !exit$) {
    // Defensive — if the page somehow doesn't have the markup
    // the methods become no-ops.
    return {
      show: () => {}, hide: () => {}, isOpen: () => false,
      setStatus: () => {}, setRematchEnabled: () => {},
    };
  }

  // Per-show callbacks. Re-pinned every time show() is called so
  // a stale REMATCH from a previous match can't fire after EXIT.
  let onRematch = null;
  let onExit    = null;

  function isOpen() {
    return !overlay$.classList.contains('hidden');
  }

  function show(title, callbacks = {}) {
    title$.textContent = title || 'MATCH OVER';
    onRematch = callbacks.onRematch || null;
    onExit    = callbacks.onExit    || null;
    // Reset to default state — REMATCH enabled, status empty.
    // Caller may override via setStatus / setRematchEnabled
    // afterwards (e.g., if the opponent already signaled left
    // before this menu opened).
    setRematchEnabled(true);
    setStatus('');
    overlay$.classList.remove('hidden');
    playMenuOpenSound();
    // Focus REMATCH first — the most likely action. Deferred a
    // frame so the modal-open transition has started before the
    // browser resolves focus, which prevents a brief visual jump.
    requestAnimationFrame(() => rematch$.focus());
  }

  function hide() {
    overlay$.classList.add('hidden');
  }

  // Update the status line under the buttons. Called by local-vs
  // as the rematch handshake progresses ("WAITING FOR OPPONENT…",
  // "OPPONENT IS READY", "OPPONENT LEFT", etc.). Pass an empty
  // string to clear. The `warning` flag swaps the color to pink
  // for messages that signal a problem (opponent left, etc.).
  function setStatus(text, { warning = false } = {}) {
    if (!status$) return;
    status$.textContent = text || '';
    status$.classList.toggle('warning', !!warning);
  }

  // Enable / disable the REMATCH button. Disabled state grays it
  // out and refuses clicks (the click handler also defends, in
  // case keyboard navigation lands the focus on a disabled
  // button somehow). EXIT stays enabled in every state — the
  // player should always be able to back out.
  function setRematchEnabled(enabled) {
    if (enabled) {
      rematch$.removeAttribute('disabled');
    } else {
      rematch$.setAttribute('disabled', 'disabled');
      // If the disabled button currently has focus, move it to
      // EXIT so keyboard nav doesn't get stuck on a dead button.
      if (document.activeElement === rematch$) exit$.focus();
    }
  }

  // Click handlers fire the caller's callback then close the
  // menu. The menu doesn't know what "rematch" or "exit" mean
  // structurally — it just delegates.
  rematch$.addEventListener('click', () => {
    if (!isOpen()) return;
    // Browsers swallow clicks on `disabled` buttons by default,
    // but keyboard-Enter on a disabled button can still fire if
    // focus somehow landed there. Defensive guard.
    if (rematch$.hasAttribute('disabled')) return;
    playSelectSound();
    const cb = onRematch;
    // DON'T hide on rematch — local-vs needs to show the
    // "WAITING FOR OPPONENT" status while we wait for the peer's
    // ready event. local-vs hides the menu when both sides are
    // confirmed ready and the new match is starting.
    cb?.();
  });
  exit$.addEventListener('click', () => {
    if (!isOpen()) return;
    playSelectSound();
    const cb = onExit;
    hide();
    cb?.();
  });

  // Hover sounds — only ping while the menu is actually visible
  // so a stale hover after dismissal stays silent.
  wireMenuSounds(rematch$, { hover: playMenuHoverSound, click: null, shouldPlay: isOpen });
  wireMenuSounds(exit$,    { hover: playMenuHoverSound, click: null, shouldPlay: isOpen });

  // Arrow-key navigation between the two buttons. Reused
  // wireArrowNav helper handles row/column geometry — for a 2-
  // button stack it just toggles up/down.
  wireArrowNav({
    getButtons: () => isOpen() ? [rematch$, exit$] : [],
    isOpen,
    onMove: playCycleSound,
  });

  // Keyboard handler — Enter / Space triggers the focused button
  // (browsers do this natively for <button>, but explicit
  // handling here lets us swallow the event and stop it from
  // bubbling into other listeners — input.js would otherwise
  // think Space = hard-drop). Esc fires exit.
  //
  // P is also swallowed so input.js's pause-toggle can't unpause
  // the game underneath the menu. The match-end menu pins
  // game.paused = true; we don't want a stray P press to release
  // that and let the winner's pieces start falling again behind
  // the modal.
  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopImmediatePropagation();
        document.activeElement?.click?.();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopImmediatePropagation();
        playSelectSound();
        const cb = onExit;
        hide();
        cb?.();
        return;
      case 'p':
      case 'P':
        // Swallow silently — the menu owns the game's paused
        // state right now; pause-toggle from input.js would
        // unpause and resume the (already-over) match.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
  }, true); // capture phase so we beat the global gameplay handlers

  return { show, hide, isOpen, setStatus, setRematchEnabled };
}
