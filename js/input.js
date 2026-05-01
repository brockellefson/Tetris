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
