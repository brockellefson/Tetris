// ============================================================
// Input — translates keyboard events into game actions
// ============================================================
//
// setupInput() wires window key listeners to the Game instance.
// Use the `callbacks` parameter to drive UI side-effects
// (showing/hiding the overlay, playing sounds, etc.) without
// putting DOM concerns into the Game class.
//
// Default key bindings:
//   ←/→         move
//   ↓           soft drop
//   ↑ / X       rotate clockwise
//   Z           rotate counter-clockwise
//   Space       hard drop
//   C / Shift   hold
//   A           spend a Chisel charge (if banked)
//   S           spend a Fill charge (if banked)
//   F           spend a Flip charge (if banked) — mirrors the active piece
//   W           spend the Whoops charge (if banked) — undoes the last piece
//   P / Esc     pause / unpause
//   R           restart
//
// Note: while a chisel or fill session is active, A/S/W/D shift
// the on-board cursor for the cell pick (handled in the early-return
// branch below). The "spend a charge" binding only fires from the
// normal-gameplay switch at the bottom. Esc during a chisel/fill
// session cancels the pick (refunding the charge); Esc during the
// debug menu closes it (handled in debug.js with stopPropagation
// so the same keypress doesn't also unpause).
// ============================================================

export function setupInput(game, callbacks = {}) {
  document.addEventListener('keydown', (e) => {
    if (e.repeat) return;

    // First key press starts the game
    if (!game.started && !['F5', 'F12', 'Tab'].includes(e.key)) {
      e.preventDefault();
      game.start();
      callbacks.onStart?.();
      return;
    }

    // After game over, R restarts and W revives (if the player has
    // a banked Whoops charge — undoes the lock that triggered the
    // spawn-collision death). All other keys are inert.
    if (game.gameOver) {
      if (e.key === 'r' || e.key === 'R') {
        game.start();
        callbacks.onStart?.();
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault();
        game._interceptInput('whoops');
      }
      return;
    }

    // While paused, P or Esc resumes. (When the debug menu is open
    // its capture-phase Esc handler swallows the event before it
    // reaches us, so closing the debug menu doesn't also unpause.)
    if (game.paused) {
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
        e.preventDefault();
        game.togglePause();
        callbacks.onResume?.();
      }
      return;
    }

    // Chisel power-up: while waiting for a pick (or while the shatter
    // animation plays), gameplay keys are inert. Arrow keys / WASD
    // drive a keyboard cursor so the player can pick a block without
    // a mouse, with Enter/Space confirming the highlighted cell.
    //
    // The cursor & confirm actions are dispatched generically as
    // 'cursor:*' so the same wiring serves Fill (and any future
    // cell-picker) — only the active plugin claims the action.
    //
    // IMPORTANT: this branch runs *before* the pendingChoices/Curses
    // early-return below. Chisel freezes the menu queue (showNextChoice
    // bails while chisel is active), so pendingChoices can still be > 0
    // here even though no modal is on screen — and we still need to
    // handle keys.
    const chiselS = game._pluginState.chisel;
    if (chiselS?.active || chiselS?.target) {
      // R (restart) still works so a stuck player can recover.
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        game.start();
        callbacks.onStart?.();
        return;
      }
      // Cursor-driven selection only applies while we're awaiting a pick.
      if (chiselS?.active) {
        switch (e.key) {
          case 'ArrowLeft':
          case 'a': case 'A':
            e.preventDefault();
            game._interceptInput('cursor:left');
            return;
          case 'ArrowRight':
          case 'd': case 'D':
            e.preventDefault();
            game._interceptInput('cursor:right');
            return;
          case 'ArrowUp':
          case 'w': case 'W':
            e.preventDefault();
            game._interceptInput('cursor:up');
            return;
          case 'ArrowDown':
          case 's': case 'S':
            e.preventDefault();
            game._interceptInput('cursor:down');
            return;
          case 'Enter':
          case ' ':
            e.preventDefault();
            game._interceptInput('cursor:confirm');
            return;
          case 'Escape':
            // Cancel the pick — the plugin refunds the charge and
            // fires onPluginIdle on the next tick so the menu queue resumes.
            e.preventDefault();
            game._interceptInput('cursor:cancel');
            return;
        }
      }
      return;
    }

    // Fill power-up: same UX surface as chisel. Gameplay keys are
    // inert while fill.active or fill.target is set, and the
    // arrow / WASD cursor dispatches the same generic 'cursor:*'
    // actions chisel uses — only the active plugin claims them.
    const fillS = game._pluginState.fill;
    if (fillS?.active || fillS?.target) {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        game.start();
        callbacks.onStart?.();
        return;
      }
      if (fillS?.active) {
        switch (e.key) {
          case 'ArrowLeft':
          case 'a': case 'A':
            e.preventDefault();
            game._interceptInput('cursor:left');
            return;
          case 'ArrowRight':
          case 'd': case 'D':
            e.preventDefault();
            game._interceptInput('cursor:right');
            return;
          case 'ArrowUp':
          case 'w': case 'W':
            e.preventDefault();
            game._interceptInput('cursor:up');
            return;
          case 'ArrowDown':
          case 's': case 'S':
            e.preventDefault();
            game._interceptInput('cursor:down');
            return;
          case 'Enter':
          case ' ':
            e.preventDefault();
            game._interceptInput('cursor:confirm');
            return;
          case 'Escape':
            // Cancel the pick — the plugin refunds the charge and
            // fires onPluginIdle on the next tick so the menu queue resumes.
            e.preventDefault();
            game._interceptInput('cursor:cancel');
            return;
        }
      }
      return;
    }

    // Power-up choice menu open — game inputs are ignored. The menu
    // owns its own keyboard listener (arrows/Enter/1-2-3) in main.js.
    if (game.pendingChoices > 0) return;

    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        game.move(-1);
        game.startMove(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        game.move(1);
        game.startMove(1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        game.startSoftDrop();
        break;
      case 'ArrowUp':
      case 'x': case 'X':
        e.preventDefault();
        game.rotate(1);
        break;
      case 'z': case 'Z':
        e.preventDefault();
        game.rotate(-1);
        break;
      case ' ':
        e.preventDefault();
        game.hardDrop();
        break;
      case 'c': case 'C':
      case 'Shift':
        e.preventDefault();
        game.holdPiece();
        break;
      case 'a': case 'A':
        // Spend a banked Chisel charge. The plugin's interceptInput
        // refuses when the player has no charges, when gameplay is
        // otherwise frozen, or when the board has nothing to chisel,
        // so this keypress is safe to fire unconditionally.
        e.preventDefault();
        game._interceptInput('chisel:activate');
        break;
      case 's': case 'S':
        // Spend a banked Fill charge. Same gating as Chisel —
        // dispatched via the plugin's interceptInput.
        e.preventDefault();
        game._interceptInput('fill:activate');
        break;
      case 'f': case 'F':
        // Spend a banked Flip charge — horizontally mirrors the
        // active piece. The plugin's interceptInput refuses (no
        // charge spent) if there's no current piece or the mirrored
        // shape would collide at the current position.
        e.preventDefault();
        game._interceptInput('flip:activate');
        break;
      case 'w': case 'W':
        // Spend the banked Whoops charge — rewinds to before the
        // most recently locked piece and respawns it. The Whoops
        // plugin (js/powerups/whoops.js) handles the dispatch via
        // its interceptInput hook, refusing (no charge spent) if
        // the player has no charge, no lock has happened yet this
        // run, or gameplay is otherwise frozen by a menu / plugin
        // modal.
        e.preventDefault();
        game._interceptInput('whoops');
        break;
      case 'p': case 'P':
      case 'Escape':
        e.preventDefault();
        game.togglePause();
        callbacks.onPause?.();
        break;
      case 'r': case 'R':
        e.preventDefault();
        game.start();
        callbacks.onStart?.();
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.key) {
      case 'ArrowLeft':  game.stopMove(-1); break;
      case 'ArrowRight': game.stopMove(1);  break;
      case 'ArrowDown':  game.stopSoftDrop(); break;
    }
  });
}
