# Extending Tetris

A guide to the codebase's architecture and where to make common changes.

## File structure

```
Tetris/
├── index.html        ← markup only
├── styles.css        ← all styling
└── js/
    ├── main.js       ← entry point (boots everything, runs the rAF loop, registers plugins)
    ├── constants.js  ← board size, colors, gravity table, timing, charge caps
    ├── pieces.js     ← tetromino shapes, SRS kick tables, 7-bag (filterable)
    ├── board.js      ← board grid, collision, line-clear (pure functions)
    ├── piece.js      ← spawn / move / rotate / flip / ghost (pure functions)
    ├── game.js       ← Game class — owns state, exposes actions, plugin runtime
    ├── render.js     ← canvas drawing (no game state mutation)
    ├── input.js      ← keyboard → game action mapping
    ├── sound.js      ← Web Audio SFX
    ├── powerups/
    │   ├── index.js  ← ALL_POWERUPS registry + pickChoices()
    │   ├── hold.js, ghost.js, psychic.js, mercy.js, tired.js, dispell.js   ← simple flag-mutators
    │   └── slick.js, whoops.js, chisel.js, fill.js, gravity.js, flip.js    ← plugins (lifecycle hooks)
    └── curses/
        ├── index.js  ← ALL_CURSES registry + pickCurseChoices()
        ├── junk.js, rain.js   ← one-shot mutations
        └── growth.js, hyped.js, cruel.js   ← plugins (lifecycle hooks)
```

## Architectural principles

- **`game.js` owns state.** All mutable game state (board, current piece, score, timers, plugin state slots) lives on the `Game` instance.
- **`render.js` reads, never writes.** The renderer takes a `Game` and paints pixels. It never mutates state, so you can swap renderers (WebGL, DOM, ASCII) without touching gameplay.
- **`piece.js` and `board.js` are pure.** Move/rotate/collision functions return new values or `null` when blocked. The `Game` decides whether to accept the result.
- **`input.js` translates keys to actions.** It calls high-level methods on `Game` or dispatches actions through the plugin bus (`game._interceptInput('flip:activate')`). Side-effects (overlays, sounds) are passed in as callbacks.
- **`constants.js` is the tuning knob.** Most numerical balance changes happen here.
- **Power-ups and curses are plugins.** Anything beyond a flag-mutation lives in its own file under `js/powerups/` or `js/curses/`. Game dispatches into them through a fixed set of lifecycle hooks; nothing in `game.js` knows the names of any specific power-up or curse.

## The plugin system

Each non-trivial power-up or curse exports a single object with a card definition (`id`, `name`, `description`, `available`, `apply`) plus any subset of the lifecycle-hook methods below. `main.js` calls `game.registerPlugin(plugin)` at boot. After registration, Game dispatches into the plugin at fixed call sites and otherwise stays ignorant of its existence.

**Hook contract** — every hook receives `game` as the first arg.

| Hook                              | Fired when                                                                                                                                      |
|-----------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `init(game)`                      | Once on `registerPlugin`.                                                                                                                       |
| `reset(game)`                     | On every `Game.reset()` (start / restart). Clear any module-level state here.                                                                   |
| `tick(game, dt)`                  | Every frame, **before** the freeze check. Plugins manage their own animation timers even while another plugin freezes the main loop.            |
| `freezesGameplay(game)`           | Return `true` to skip the rest of `tick()` (DAS / falling gravity / standard line-clear). Used by modal plugins (Chisel, Fill, Gravity).        |
| `onSpawn(game)`                   | After `spawnNext()` installs a new current piece. Whoops snapshots here.                                                                        |
| `onLock(game)`                    | At the top of `lockCurrent()`, before the board mutation. Whoops promotes its pre-spawn snapshot here.                                          |
| `onClear(game, cleared)`          | At the end of `completeClear()`, after score/level have been updated.                                                                           |
| `onPlayerAdjustment(game, kind)`  | Successful `move` / `rotate` / `flip`. Slick uses this for its step-reset; Flip fires it explicitly after a successful mirror.                  |
| `beforeHoldSwap(game)` / `afterHoldSwap(game)` | Around `holdPiece`'s internal `spawnNext` on the first-hold branch. Whoops uses these to preserve its undo target across the swap. |
| `shouldDeferLock(game)`           | Return `true` to skip `softDrop()`'s immediate lock-on-collision. Slick gates locking behind its lock-delay window via this.                    |
| `interceptInput(game, action, ...args)` | Return `true` to claim the action. Used by Chisel/Fill/Whoops/Flip for their key spends, by cell-pick cursors for `cursor:*`, and by the board click handler for `boardClick(col, row)`. |
| `modifyGravityIndex(game, idx)`   | Modifier hook, threaded through `_reduceHookValue`. Hyped adds `+1` per stack so pieces fall faster.                                            |
| `allowsBagPiece(game, type)`      | Veto hook, polled via `_allowedByAllPlugins`. Returning `false` for a type drops it from the next bag refill. Cruel uses this to forbid I-pieces. |

**State slots stay on `Game`** for things the renderer/HUD needs to read:
- `game.unlocks.{hold, ghost, slick, nextCount, chiselCharges, fillCharges, flipCharges, whoopsCharges}` — flags & charge counters
- `game.curses.{junk, hyped, cruelUntilLevel, extraCols}` — active-curse state for the HUD
- `game.chisel`, `game.fill`, `game.gravity` — plugin state slots that the renderer reads to paint cursors / animations / hide the parked piece during cascades
- `game.lockDelayTimer` — Slick's timer (Game initializes it; Slick reads/writes it)

The decoupling is on the **behavior** side: the engine holds the data, plugins hold the logic.

## Where to extend

| You want to add…                                          | Edit…                                                                 |
|-----------------------------------------------------------|-----------------------------------------------------------------------|
| New piece shapes / colors                                 | `pieces.js` and the colors block in `constants.js`                    |
| Different scoring or level curves                         | `LINE_SCORES` and `GRAVITY` in `constants.js`                         |
| New power-up (blessing)                                   | New file in `js/powerups/`, register in `js/powerups/index.js`         |
| New curse                                                 | New file in `js/curses/`, register in `js/curses/index.js`             |
| New gameplay mechanic (T-spins, combos, garbage rows)     | Usually a new plugin. Only touch `game.js` if you need to add a new dispatch site or hook. |
| Game modes (sprint, marathon, zen)                        | Add a `mode` field to `Game`, branch logic in `tick()` and `lockCurrent()` |
| Different keys, gamepad, touch                            | `input.js` only                                                       |
| Themes, animations, particles                             | `render.js` only                                                      |
| New sound effects                                         | `sound.js` plus a callback wire-up in `main.js`                       |
| High-score persistence                                    | New `storage.js` module wrapping `localStorage`                       |

The cleanest seam is `game.js` ↔ `render.js`: rendering reads from the game but never writes to it, so you can rip out the renderer entirely without breaking gameplay. The second-cleanest is the plugin bus: a new mechanic that fits the hook contract is a single new file plus one `registerPlugin` line in `main.js`.

## Worked examples

### Add a new piece shape

1. In `pieces.js`, add a new entry to `PIECES` with all four rotation matrices.
2. In `constants.js`, add a color for the new piece type in `COLORS`.
3. In `pieces.js`, add the piece's letter to the array inside `bagShuffle()` so it appears in the queue.
4. If it has unusual rotation behavior, you may need a kick table; otherwise it'll use `KICKS_JLSTZ`.

### Add a trivial power-up (just flips a flag)

Hold, Ghost, Mercy, Tired, and Dispell all follow this pattern. No plugin registration needed.

1. Create `js/powerups/foo.js` exporting a default object with `id`, `name`, `description`, `available(game)`, `apply(game)`.
2. `apply()` mutates `game.unlocks.*` (or whatever state slot is appropriate).
3. Import and add it to `ALL_POWERUPS` in `js/powerups/index.js`.
4. The renderer / HUD / gameplay code reads the new state slot wherever it's relevant.

### Add a power-up that needs lifecycle hooks

Slick, Whoops, Chisel, Fill, Gravity, Flip all follow this pattern.

1. Create `js/powerups/foo.js`. Export the same card object as above, plus the relevant hooks (`tick`, `freezesGameplay`, `onSpawn`, `interceptInput`, etc.).
2. If the power-up has a key binding, dispatch from `input.js` via `game._interceptInput('foo:activate')`. The plugin's `interceptInput` claims the action and does its work.
3. If the power-up freezes gameplay (modal pick, cascade), return `true` from `freezesGameplay(game)` while the modal is up. `Game.tick()` will skip its standard body for you; your `tick` hook still runs to advance any animation timers.
4. Register the plugin from `main.js`: `import fooPlugin from './powerups/foo.js'; game.registerPlugin(fooPlugin);`.
5. Add it to `ALL_POWERUPS` in `js/powerups/index.js` so it can roll in the choice menu.

### Add a "no-curse" blessing

Dispell is the example. The choice-menu pairs each card with a random bundled curse by default.

1. In your power-up file, set `noCurse: true` on the exported object.
2. `main.js`'s `showPowerUpMenu` reads the flag and renders the card without the pink curse half; `applyPowerUp` fires alone with no `applyCurse`.

### Add a new curse

1. Create `js/curses/foo.js` exporting `id`, `name`, `description`, `available(game)`, `apply(game)`.
2. If the curse needs ongoing effects (modify gravity, filter the bag, etc.), expose modifier hooks (`modifyGravityIndex`, `allowsBagPiece`, …) on the same object and register the plugin in `main.js`. See `curses/hyped.js` and `curses/cruel.js`.
3. If the curse just mutates the board once, do that in `apply()` — no plugin registration needed. See `curses/junk.js` and `curses/rain.js`.
4. Add it to `ALL_CURSES` in `js/curses/index.js`.
5. If the curse has persistent state, add a HUD tag in `main.js`'s `syncCursesUI` and (if Dispell-able) extend `dispell.js`'s `activeCurseKeys` and `apply` switch.

### Add lock delay to all pieces (real example: Slick)

Already implemented as a power-up. To make it baseline behavior:

1. Remove the `available` gate in `js/powerups/slick.js` (or change `unlocks.slick` to default `true` in `Game.reset()`).
2. The plugin's `tick`, `shouldDeferLock`, `onSpawn`, and `onPlayerAdjustment` hooks already do the rest.

### Add T-spin detection (bonus points)

This belongs in a plugin, not in `game.js`.

1. Track the last successful action via the existing `onPlayerAdjustment(game, kind)` hook — the `kind` arg already distinguishes `'move'` / `'rotate'` / `'flip'`.
2. Use `onLock(game)` to check, after a T-piece rotation-lock, the four corners of its 3×3 bounding box on the board.
3. If 3+ corners are filled, mutate `game.score` (T-spin Single = 800 × level) and fire a notification via a custom callback.

### Add a sprint mode (clear 40 lines as fast as possible)

This is engine-level so it lives in `game.js`.

1. Add `this.mode = 'marathon'` and `this.elapsedMs = 0` in `Game.reset()`.
2. In `tick()`, accumulate `elapsedMs += dt` while playing.
3. In `lockCurrent()`, if `mode === 'sprint'` and `lines >= 40`, set `this.gameOver = true` and store the time.
4. In `render.js` (or `main.js`), display `elapsedMs` instead of the level when in sprint mode.

### Add touch controls for mobile

1. Create `js/touch.js` exporting `setupTouch(game)`.
2. Listen for `touchstart` / `touchend` / `touchmove` on the board canvas.
3. Map gestures to existing `Game` methods: tap = `rotate`, swipe left/right = `move`, swipe down = `softDrop`, long swipe down = `hardDrop`.
4. For board-click intercepts (Chisel, Fill cell-pick), the existing `game._interceptInput('boardClick', col, row)` dispatch already works on touch — `click` events fire from taps for free.
5. Import and call `setupTouch(game)` from `main.js`.

## Local development

ES modules don't work via `file://` — you need an HTTP server. From the project root:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. For Node users: `npx serve`.

## Deployment

Push to a GitHub repo and enable Pages (Settings → Pages → deploy from `main`, root). The game will be live at `https://<username>.github.io/<repo>/`.
