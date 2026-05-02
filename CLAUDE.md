# Extending Tetris

A guide to the codebase's architecture and where to make common changes.

## File structure

```
Tetris/
├── index.html        ← markup only
├── styles.css        ← all styling
└── js/
    ├── main.js       ← entry point — wires modules, runs the rAF loop, registers plugins
    ├── constants.js  ← board size, colors, gravity table, timing, charge caps
    ├── pieces.js     ← tetromino shapes, SRS kick tables, 7-bag (filterable)
    ├── board.js      ← board grid, collision, line-clear (pure functions)
    ├── piece.js      ← spawn / move / rotate / flip / ghost (pure functions)
    ├── game.js       ← Game class — owns state, exposes actions, plugin runtime
    ├── render.js     ← canvas drawing (no game state mutation)
    ├── input.js      ← keyboard → game action mapping
    ├── sound.js      ← Web Audio SFX + wireMenuSounds() UI helper
    ├── hud.js        ← score panel, blessing/curse tags, overlays, notifications, chisel-hint banner
    ├── debug.js      ← pause-only developer panel (force blessings/curses, set level)
    ├── menus/
    │   └── powerup.js  ← power-up + bundled-curse choice modal
    ├── powerups/
    │   ├── index.js    ← ALL_POWERUPS registry + pickChoices()
    │   ├── hold.js, ghost.js, psychic.js, mercy.js, tired.js, dispell.js   ← simple flag-mutators
    │   ├── slick.js, whoops.js, chisel.js, fill.js, flip.js                ← plugins (lifecycle hooks)
    │   ├── specials.js  ← Bomb I-III + Lightning I-III blessing-card tiers
    │   │                 — picking a tier raises game.unlocks.specials[id]
    │   └── lucky.js     ← Lucky I-III stack-card tiers (boost spawn rate)
    ├── curses/
    │   ├── index.js    ← ALL_CURSES registry + pickCurseChoices()
    │   ├── junk.js, rain.js   ← one-shot mutations
    │   └── growth.js, hyped.js, cruel.js   ← plugins (lifecycle hooks)
    ├── specials/
    │   ├── index.js    ← ALL_SPECIALS registry + weighted picker + the
    │   │                 specials plugin (decoratePiece + beforeClear +
    │   │                 onClear + onCellRemoved + reset). Picker filters
    │   │                 by `unlocks.specials[id] > 0` so unpicked specials
    │   │                 don't spawn; specialChanceForLevel(level, lucky)
    │   │                 factors in Lucky stacks.
    │   ├── bomb.js     ← Bomb special — onTrigger reads its level from
    │   │                 unlocks and carves a 3×3 / 4×4 / 5×5 square,
    │   │                 then kicks the gravity cascade
    │   ├── lightning.js ← Lightning special — onTrigger reads its level
    │   │                  and strikes column-above (L1) / full column
    │   │                  (L2) / column + row (L3)
    │   └── welder.js   ← Welder special — onTrigger reads its level
    │                      and fills the deepest hole (L1) / 3 deepest
    │                      (L2) / every 3-sides-covered empty cell (L3)
    └── effects/
        └── gravity-cascade.js  ← board-compaction engine. Pure — no card
                                  metadata, just freezesGameplay/tick hooks.
                                  Triggered today by Bomb detonations and
                                  the debug menu's "Gravity Cascade" pill.
```

**`main.js` is a wiring file.** All concrete UI logic — HUD sync, the power-up modal, the debug panel — lives in dedicated modules. main.js just imports them, calls `setupHUD()` / `setupPowerupMenu(game)` / `setupDebug(game)` once at boot, and routes engine callbacks (`game.onTetris`, `game.onPowerUpChoice`, etc.) into the appropriate module method. Adding a new UI surface (e.g. a settings menu, a stats overlay) should follow the same pattern: a new file under `js/` or `js/menus/`, a `setupX(game?)` factory returning a small control object, and a couple of lines of wiring in main.js.

## Architectural principles

- **`game.js` owns state.** All mutable game state (board, current piece, score, timers, plugin state slots) lives on the `Game` instance.
- **`render.js` reads, never writes.** The renderer takes a `Game` and paints pixels. It never mutates state, so you can swap renderers (WebGL, DOM, ASCII) without touching gameplay.
- **`piece.js` and `board.js` are pure.** Move/rotate/collision functions return new values or `null` when blocked. The `Game` decides whether to accept the result.
- **`input.js` translates keys to actions.** It calls high-level methods on `Game` or dispatches actions through the plugin bus (`game._interceptInput('flip:activate')`). Side-effects (overlays, sounds) are passed in as callbacks.
- **`constants.js` is the tuning knob.** Most numerical balance changes happen here.
- **Power-ups, curses, and specials are plugins.** Anything beyond a flag-mutation lives in its own file under `js/powerups/`, `js/curses/`, or `js/specials/`. Game dispatches into them through a fixed set of lifecycle hooks; nothing in `game.js` knows the names of any specific power-up, curse, or special block.

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
| `onLock(game)`                    | At the top of `lockCurrent()`, before the board mutation. Whoops promotes its pre-spawn snapshot here. Specials writes piece-bound tags onto its boardGrid here. |
| `onClear(game, cleared)`          | At the end of `completeClear()`, after score/level have been updated. Specials fires the captured triggers here.                                |
| `onPlayerAdjustment(game, kind)`  | Successful `move` / `rotate` / `flip`. Slick uses this for its step-reset; Flip fires it explicitly after a successful mirror.                  |
| `beforeHoldSwap(game)` / `afterHoldSwap(game)` | Around `holdPiece`'s swap (BOTH branches now). Whoops uses them to preserve its undo target across the first-hold spawnNext; Specials uses them to preserve a tagged mino's metadata in/out of its hold slot. |
| `shouldDeferLock(game)`           | Return `true` to skip `softDrop()`'s immediate lock-on-collision. Slick gates locking behind its lock-delay window via this.                    |
| `interceptInput(game, action, ...args)` | Return `true` to claim the action. Used by Chisel/Fill/Whoops/Flip for their key spends, by cell-pick cursors for `cursor:*`, and by the board click handler for `boardClick(col, row)`. |
| `modifyGravityIndex(game, idx)`   | Modifier hook, threaded through `_reduceHookValue`. Hyped adds `+1` per stack so pieces fall faster.                                            |
| `allowsBagPiece(game, type)`      | Veto hook, polled via `_allowedByAllPlugins`. Returning `false` for a type drops it from the next bag refill. Cruel uses this to forbid I-pieces. |
| `decoratePiece(game, piece)`      | Modifier hook, threaded through `_reduceHookValue`, fired inside `spawnNext()` between `spawn(type)` and the assignment to `current`. Specials uses this to possibly attach a tagged mino. |
| `beforeClear(game, rows)`         | Fires inside `completeClear()` and `completeCascadeClear()` immediately before `removeRows`, with the row indices about to be removed. Specials captures triggers and shifts its parallel grid here. |
| `onCellRemoved(game, x, y, source)` | Fires from single-cell removers (Chisel, Bomb blasts, Lightning column) AFTER the board cell is nulled. `source` distinguishes call sites. Specials fires the cell's trigger here AND awards `SPECIAL_DESTROY_POINTS × level` for every removed cell. |
| `serialize(game)` / `restore(game, snap)` | Optional pair. If a plugin owns state that should round-trip a Whoops rewind, `serialize` returns a deep-clonable snapshot and `restore` re-installs it. Whoops's snapshot iterates every plugin with these hooks — adding a new plugin's state to Whoops requires zero changes to Whoops itself. |

### Plugin-state bag

Mutable per-plugin state lives at `game._pluginState[pluginId]` — a generic bag, NOT named slots on Game. Each plugin claims its slot from its `reset(game)` hook:

```js
reset(game) {
  game._pluginState.chisel = { active: false, target: null, cursor: null };
}
```

Renderer/HUD/menus read it via the bag:

```js
const chiselState = game._pluginState.chisel;
if (chiselState?.target) drawChiselShatter(...);
```

This replaced the old per-feature named slots (`game.chisel`, `game.fill`, `game.gravity`, `game.boardSpecials`, `game.holdSpecials`, `game._forceNextSpecial`, `game._pendingSpecialTriggers`). Adding a new modal feature now requires zero edits to Game's surface — the plugin just claims a slot.

A few things genuinely belong on Game (engine-level, not plugin-owned):
- `game.unlocks.{hold, ghost, slick, nextCount, chiselCharges, fillCharges, flipCharges, whoopsCharges}` — flags & charge counters consumed by many systems
- `game.curses.{junk, hyped, cruelUntilLevel, extraCols}` — active-curse state for the HUD
- `game.lockDelayTimer` — Slick's timer (Game initializes it; Slick reads/writes it)

### `onPluginIdle`

Fires once when "any plugin freezing OR a clear animating" transitions to "everything settled." `main.js` wires it to `powerupMenu.showNext` so the menu auto-resumes after any modal interaction (Chisel pick, Fill pick, Gravity cascade, future bombs that take time, etc.) finishes — no need for plugins to fire their own per-feature completion callback. A new modal plugin gets menu-resume behavior for free as long as `freezesGameplay` returns `true` while it's busy.

The decoupling is on the **behavior** side: the bag holds plugin data, plugins hold the logic, and Whoops + main.js iterate plugins generically rather than knowing each one by name.

## Special blocks

A **special block** is metadata attached to a single mino. While the piece is falling, the special travels with it (anchored by piece-local rot-0 coords + the `transformLocalCoord` helper in `pieces.js`). When the piece locks, the special anchors to a board cell in the parallel grid at `game._pluginState.specials.boardGrid` (owned by the specials plugin). When that cell is removed — by a line clear, by Chisel, by a Bomb blast, by a Lightning strike, or by any future single-cell remover that fires `onCellRemoved` — the special's `onTrigger(game, x, y, source)` runs and decides what happens.

Each special exports the same shape the power-ups and curses do, plus visual identity:

```js
export default {
  id: 'bomb',
  name: 'Bomb',
  description: 'When this block breaks, every cell in the surrounding square is destroyed.',
  rarity: 'common',                                 // common|uncommon|rare|legendary
  palette: ['#ff1f3a', '#ff7a1a', '#ffe066'],       // colors to cycle through
  animation: { speed: 2.4, glowBoost: 0.7 },        // cycles/sec + extra halo
  available: () => true,
  onTrigger: (game, x, y, source) => { /* … */ },
};
```

The renderer reads `palette` and `animation` generically — no per-special branching anywhere outside the special's own file. `rarity` drives both the spawn weight (via `SPECIAL_RARITY_WEIGHTS` in `constants.js`) and the visual amplification (via `RARITY_VFX` in `render.js`), so rarer specials look louder and spawn less often.

**Specials are gated behind blessings.** Until the player picks the matching blessing card (Bomb / Lightning / Welder), `game.unlocks.specials[id]` is `0` and the spawn picker filters that special out — no Bomb-tagged minos roll on the board until Bomb has been picked at least once. Picking the same special's card again upgrades the unlock LEVEL (capped at `SPECIAL_MAX_LEVEL`):

- **Bomb** — L1: 3×3 detonation. L2: 4×4. L3: 5×5.
- **Lightning** — L1: column above. L2: full column. L3: full column + entire row.
- **Welder** — L1: fills the single deepest hole. L2: fills 3 deepest holes. L3: fills every empty cell with 3+ sides covered.

Each special's `onTrigger` reads its own current level from `game.unlocks.specials[id]` (defaulting to 1 if the slot is 0, which only happens via the debug "Force <Name>" pill). Upgrades retroactively buff every special-tagged cell already on the board, not just future spawns — picking Bomb III mid-run instantly turns suspended Bomb-tags into 5×5 detonations.

**Spawn policy** is one constant curve (`SPECIAL_BLOCK_BASE_CHANCE` + `PER_LEVEL_BONUS` capped at `MAX_CHANCE`) plus weighted random over the *eligible* registry (specials with `unlocks.specials[id] > 0`). The roll happens once per spawn inside the specials plugin's `decoratePiece` hook. The **Lucky** blessing (3 stacks max) lifts each of the three knobs by `LUCKY_*_PER_STACK`, so a fully-stacked Lucky run feels rolling-in-specials. Lucky's card `available()` requires at least one special blessing to be unlocked first — Lucky alone does nothing, so the menu refuses to surface it before there's something to be lucky about.

**Triggering on chisel** falls out of `onCellRemoved` — the chisel plugin fires the hook after nulling the cell, and the specials plugin's listener fires the cell's trigger. Bombs / lightning / any future single-cell special gets chisel-triggering for free.

**Cascading triggers** — if a Bomb's blast clears a row that contains a Lightning-tagged cell, the Lightning fires off as part of the same trigger chain. The cascade engine (`js/effects/gravity-cascade.js`) is idempotent (refuses to re-enter when one is already running). The cascade runs through the same `beforeClear` → `removeRows` → `onClear` pipeline as a player-driven clear, so chained specials work without special handling.

## UI conventions

**Every interactive button must wire navigation and selection sounds.** The game leans heavily on synth audio cues, and a silent button feels broken. When adding a new button (in any menu, modal, HUD panel, or pause overlay), follow the same pattern the splash and power-up menus already use:

- **Hover (`mouseenter`)** — call `playMenuHoverSound()` for primary launcher buttons (e.g. the `Play` button, `Debug` button) or `playCycleSound()` for items inside a list/grid the user is navigating through (e.g. power-up cards, debug pills, queue choices). Hover sounds should fire only when the menu is actually visible — guard with the relevant `.hidden` check so stale hovers stay silent.
- **Click (or keyboard equivalent)** — call `playSelectSound()` for confirmations that commit a choice (picking a card, applying a debug action, hitting `SET`). Use `playMenuOpenSound()` when the click opens a new modal, and `playCycleSound()` for incremental nudges (`+`/`−` steppers, page-through controls) that don't commit anything.

Sounds live in `js/sound.js` and are imported by `js/main.js`. If a new cue is needed, add it to `sound.js` following the existing Web-Audio-graph pattern (envelope + filter + oscillators) so it sits in the same pentatonic family as the rest of the game.

**Show selected/active state visually.** Any toggle, multi-select, or "applied" state in a menu should mark the active option with the gold/yellow highlight (`var(--neon-yellow)` border + glow). The eye should never have to scan a long list to figure out what's already on. The debug menu's `.debug-pill.active` style is the canonical example — copy that visual when adding similar surfaces. Re-evaluate the active set whenever the menu opens AND after every click that could change it (e.g. Dispell removing a curse should drop the curse's highlight without the user needing to reopen the modal).

## Where to extend

| You want to add…                                          | Edit…                                                                 |
|-----------------------------------------------------------|-----------------------------------------------------------------------|
| New piece shapes / colors                                 | `pieces.js` and the colors block in `constants.js`                    |
| Different scoring or level curves                         | `LINE_SCORES` and `GRAVITY` in `constants.js`                         |
| New power-up (blessing)                                   | New file in `js/powerups/`, register in `js/powerups/index.js`         |
| New curse                                                 | New file in `js/curses/`, register in `js/curses/index.js`             |
| New special block                                         | New file in `js/specials/`, register in `js/specials/index.js`. If the trigger needs ongoing per-frame logic (cascades, timers), put the engine in `js/effects/` and have the special's `onTrigger` call into it. |
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

Slick, Whoops, Chisel, Fill, Flip all follow this pattern.

1. Create `js/powerups/foo.js`. Export the same card object as above, plus the relevant hooks (`tick`, `freezesGameplay`, `onSpawn`, `interceptInput`, etc.).
2. If the power-up has a key binding, dispatch from `input.js` via `game._interceptInput('foo:activate')`. The plugin's `interceptInput` claims the action and does its work.
3. If the power-up freezes gameplay (modal pick, cascade), return `true` from `freezesGameplay(game)` while the modal is up. `Game.tick()` will skip its standard body for you; your `tick` hook still runs to advance any animation timers.
4. Register the plugin from `main.js`: `import fooPlugin from './powerups/foo.js'; game.registerPlugin(fooPlugin);`.
5. Add it to `ALL_POWERUPS` in `js/powerups/index.js` so it can roll in the choice menu.

### Add a new special block

Bomb, lightning, multiplier — anything that "fires when its block breaks." Pattern:

1. Create `js/specials/foo.js`. Export a default object with `id`, `name`, `description`, `rarity` (`common` / `uncommon` / `rare` / `legendary`), `palette` (1+ hex colors to cycle through), `animation` (`{ speed, glowBoost }`), `available(game)`, and `onTrigger(game, x, y, source)`.
2. Add the import + an entry in `ALL_SPECIALS` in `js/specials/index.js`. The special now renders with its palette + glow and fires on both line clears and chisel — but it WON'T spawn yet, because nothing has picked the matching blessing.
3. Wire up the unlock: add the new id to `game.unlocks.specials` in `Game.reset()` (initial value `0`), and add per-level blessing cards in `js/powerups/specials.js` following the `bomb1/2/3` pattern. Register the cards in `ALL_POWERUPS`. The picker auto-filters by `unlocks.specials[id] > 0`, so once the L1 card is picked the special starts spawning.
4. If the special is leveled, have `onTrigger` read `game.unlocks.specials[id]` and branch on the level. Default to level 1 when the slot is 0 so the debug "Force <Name>" pill always produces a visible effect.
5. If `onTrigger` needs ongoing per-frame logic (a multi-step animation, a cascade), put the engine in a new file under `js/effects/` and register it as a plugin from `main.js` exactly like `gravity-cascade.js`. The special itself stays a tiny adapter that just calls into the engine.
6. Add a "Force <Name>" pill to the debug menu — actually, you don't have to. The debug `Specials` grid auto-builds from `ALL_SPECIALS`, so the pill appears automatically.

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
