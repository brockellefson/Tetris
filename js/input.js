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
//   P           pause
//   R           restart
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

    // After game over, only R restarts
    if (game.gameOver) {
      if (e.key === 'r' || e.key === 'R') {
        game.start();
        callbacks.onStart?.();
      }
      return;
    }

    // While paused, only P resumes
    if (game.paused) {
      if (e.key === 'p' || e.key === 'P') {
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
    // IMPORTANT: this branch runs *before* the pendingChoices/Curses
    // early-return below. Chisel freezes the menu queue (showNextChoice
    // bails while chisel is active), so pendingChoices can still be > 0
    // here even though no modal is on screen — and we still need to
    // handle keys.
    if (game.chisel.active || game.chisel.target) {
      // R (restart) still works so a stuck player can recover.
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        game.start();
        callbacks.onStart?.();
        return;
      }
      // Cursor-driven selection only applies while we're awaiting a pick.
      if (game.chisel.active) {
        switch (e.key) {
          case 'ArrowLeft':
          case 'a': case 'A':
            e.preventDefault();
            game.chiselMoveCursor(-1, 0);
            return;
          case 'ArrowRight':
          case 'd': case 'D':
            e.preventDefault();
            game.chiselMoveCursor(1, 0);
            return;
          case 'ArrowUp':
          case 'w': case 'W':
            e.preventDefault();
            game.chiselMoveCursor(0, -1);
            return;
          case 'ArrowDown':
          case 's': case 'S':
            e.preventDefault();
            game.chiselMoveCursor(0, 1);
            return;
          case 'Enter':
          case ' ':
            e.preventDefault();
            game.chiselConfirm();
            return;
        }
      }
      return;
    }

    // Polish power-up: same UX surface as chisel. Gameplay keys are
    // inert while polish.active or polish.target is set, and the
    // arrow / WASD cursor is driven through game.polishMoveCursor.
    if (game.polish.active || game.polish.target) {
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        game.start();
        callbacks.onStart?.();
        return;
      }
      if (game.polish.active) {
        switch (e.key) {
          case 'ArrowLeft':
          case 'a': case 'A':
            e.preventDefault();
            game.polishMoveCursor(-1, 0);
            return;
          case 'ArrowRight':
          case 'd': case 'D':
            e.preventDefault();
            game.polishMoveCursor(1, 0);
            return;
          case 'ArrowUp':
          case 'w': case 'W':
            e.preventDefault();
            game.polishMoveCursor(0, -1);
            return;
          case 'ArrowDown':
          case 's': case 'S':
            e.preventDefault();
            game.polishMoveCursor(0, 1);
            return;
          case 'Enter':
          case ' ':
            e.preventDefault();
            game.polishConfirm();
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
      case 'p': case 'P':
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
