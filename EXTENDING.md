# Extending Tetris

A guide to the codebase's architecture and where to make common changes.

## File structure

```
Tetris/
├── index.html        ← markup only
├── styles.css        ← all styling
└── js/
    ├── main.js       ← entry point (boots everything, runs the rAF loop)
    ├── constants.js  ← board size, colors, gravity table, timing
    ├── pieces.js     ← tetromino shapes, SRS kick tables, 7-bag
    ├── board.js      ← board grid, collision, line-clear
    ├── piece.js     ← spawn / move / rotate / ghost (pure functions)
    ├── game.js       ← Game class — owns all state, exposes actions
    ├── render.js     ← canvas drawing (no game state mutation)
    └── input.js      ← keyboard → game action mapping
```

## Architectural principles

- **`game.js` owns state.** All mutable game state (board, current piece, score, timers) lives on the `Game` instance.
- **`render.js` reads, never writes.** The renderer takes a `Game` and paints pixels. It never mutates state, so you can swap renderers (WebGL, DOM, ASCII) without touching gameplay.
- **`piece.js` is pure.** Move/rotate functions return a new piece if legal, or `null` if blocked. The `Game` decides whether to accept the result.
- **`input.js` translates keys to actions.** It calls high-level methods on `Game`. Side-effects (overlays, sounds) are passed in as callbacks.
- **`constants.js` is the tuning knob.** Most numerical balance changes happen here.

## Where to extend

| You want to add…                                          | Edit…                                                                 |
|-----------------------------------------------------------|-----------------------------------------------------------------------|
| New piece shapes / colors                                 | `pieces.js` and the colors block in `constants.js`                    |
| Different scoring or level curves                         | `LINE_SCORES` and `GRAVITY` in `constants.js`                         |
| New mechanics (T-spins, combos, garbage rows, lock delay) | `game.js` — add fields in `reset()`, hook into `lockCurrent()`        |
| Game modes (sprint, marathon, zen)                        | Add a `mode` field to `Game`, branch logic in `tick()` and `lockCurrent()` |
| Different keys, gamepad, touch                            | `input.js` only                                                       |
| Themes, animations, particles                             | `render.js` only                                                      |
| Sound effects                                             | Add a `sound.js` module, call it from `game.js` actions or via callbacks |
| High-score persistence                                    | New `storage.js` module wrapping `localStorage`                       |

The cleanest seam is `game.js` ↔ `render.js`: rendering reads from the game but never writes to it, so you can rip out the renderer entirely without breaking gameplay.

## Worked examples

### Add a new piece shape

1. In `pieces.js`, add a new entry to `PIECES` with all four rotation matrices.
2. In `constants.js`, add a color for the new piece type in `COLORS`.
3. In `pieces.js`, add the piece's letter to the array inside `bagShuffle()` so it appears in the queue.
4. If it has unusual rotation behavior, you may need a kick table; otherwise it'll use `KICKS_JLSTZ`.

### Add lock delay (piece can sit briefly before locking)

1. In `game.js` `reset()`, add `this.lockTimer = 0; this.lockDelay = 500;`.
2. In `softDrop()`, instead of immediately calling `lockCurrent()` on collision, start incrementing `lockTimer` in `tick()`.
3. Reset `lockTimer` to 0 whenever a successful `move()` or `rotate()` happens.
4. When `lockTimer >= lockDelay`, call `lockCurrent()`.

### Add T-spin detection (bonus points)

1. In `game.js`, track the last successful action (`this.lastAction = 'move' | 'rotate'`).
2. In `lockCurrent()`, after a T piece locks via rotation, check the four corners of its 3×3 bounding box on the board.
3. If 3+ corners are filled, it's a T-spin — award bonus score (e.g. T-spin Single = 800 × level).

### Add a sprint mode (clear 40 lines as fast as possible)

1. Add `this.mode = 'marathon'` and `this.elapsedMs = 0` in `Game.reset()`.
2. In `tick()`, accumulate `elapsedMs += dt` while playing.
3. In `lockCurrent()`, if `mode === 'sprint'` and `lines >= 40`, set `this.gameOver = true` and store the time.
4. In `render.js` (or `main.js`), display `elapsedMs` instead of the level when in sprint mode.

### Add touch controls for mobile

1. Create `js/touch.js` exporting `setupTouch(game)`.
2. Listen for `touchstart` / `touchend` / `touchmove` on the board canvas.
3. Map gestures: tap = rotate, swipe left/right = move, swipe down = soft drop, long swipe down = hard drop.
4. Import and call `setupTouch(game)` from `main.js`.

## Local development

ES modules don't work via `file://` — you need an HTTP server. From the project root:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. For Node users: `npx serve`.

## Deployment

Push to a GitHub repo and enable Pages (Settings → Pages → deploy from `main`, root). The game will be live at `https://<username>.github.io/<repo>/`.
