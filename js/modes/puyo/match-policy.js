// ============================================================
// PuyoMatchPolicy — flood-fill clears + chain scoring for Puyo
// ============================================================
//
// Same four-method interface as TetrisMatchPolicy:
//   findClears(board)         — group ≥ 4 same-color puyos
//   removeClears(board, r)    — null the matched cells
//   afterLock(game)           — kick the cascade engine
//   applyClearEffects(game,r) — score + level + hooks per chain step
//
// The big architectural win is that we DON'T own the chain loop —
// the gravity-cascade engine does. Its phase machine (fall → check
// for clears → if clears, animate then apply, loop; otherwise end)
// is exactly Puyo's chain mechanic. We just plug into it through
// the policy methods and let it drive.
//
// Result shape returned by findClears:
//   { cells: [{x, y}], groups: [[{x, y}, ...], ...] }
//
// `cells` is the flat list (used by removeClears, the renderer's
// per-cell wipe overlay, and any future onCellRemoved consumers).
// `groups` keeps the connected-component partitioning for callers
// that want to score by group size separately (e.g., a "biggest
// chain group" metric for the HUD).
//
// Score formula (intentionally simple for v1):
//   points = cells × CHAIN_BASE × chainStep × level
//
// Real Puyo uses a chain-power table that scales per step (e.g.,
// step 4 pays 32, step 5 pays 64, step 6 pays 96…), plus group-
// size bonuses and color-count multipliers. We're approximating
// the "chains pay disproportionately more" feel with a linear
// `chainStep` multiplier — easy to tune, easy to read in code,
// good enough for a first-cut Puyo mode. Swapping in the real
// table is a one-line change in this file.

import { startGravityCascade } from '../../effects/gravity-cascade.js';
import { isPuyoColor } from './pieces.js';
import { MENU_SETTLE_MS } from '../../constants.js';

// Minimum group size to count as a clear. Standard Puyo uses 4.
const MIN_GROUP = 4;

// Base points per cleared cell. Multiplied by the chain power for
// the current step (CHAIN_POWER below) and game.level, so chains
// and late-game both matter — and big chains pay disproportionately
// more than a string of singles.
const CHAIN_BASE = 10;

// Chain power table — multiplier applied to (cells × CHAIN_BASE ×
// level) for each step of the chain. Closely follows the canonical
// arcade-Puyo curve: step 1 pays 1× (a single 4-match feels "fair"),
// step 2 jumps to 8× (the first sign of a real combo), and the
// table doubles at step 3-4 before settling into a +32-per-step
// growth. This is what makes "build a 4-chain instead of three
// 1-chains" the right strategic answer — three 1-chains pay 3 ×
// the cells, a 4-chain pays 1+8+16+32 = 57 × the cells.
//
// Index = chainStep - 1. Past the table length the multiplier
// clamps to the last entry (game ends long before that's reachable
// anyway, but the clamp keeps `score += NaN` impossible).
const CHAIN_POWER = [
  1, 8, 16, 32, 64, 96, 128, 160, 192, 224, 256, 288,
  320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672,
];

// Exported so other puyo subsystems (the garbage plugin in
// `versus/garbage-plugin.js` is the current consumer) can compute
// chain-step contributions without re-declaring the table. Tiny
// coupling but it keeps the table as a single source of truth —
// re-tuning the curve is a one-file change.
export function chainPower(step) {
  if (step <= 0) return 0;
  if (step > CHAIN_POWER.length) return CHAIN_POWER[CHAIN_POWER.length - 1];
  return CHAIN_POWER[step - 1];
}

// Same — exported for consumers that want the per-cell base
// (currently the garbage plugin's nuisance-from-score conversion).
export const CHAIN_BASE_POINTS = CHAIN_BASE;

// Group-size bonus. Clearing a connected group bigger than the
// minimum 4 pays a multiplier ON TOP OF the chain power. Real
// arcade Puyo's table — 4-cell groups give +0 (they're the
// baseline), and the bonus grows mostly linearly until it caps
// at +10 for groups of 11+. Encourages "build bigger groups
// before popping" as a strategic alternative to "build longer
// chains."
//
// Index 0 = group of size MIN_GROUP (4), so groups of size n use
// GROUP_BONUS[Math.min(n - MIN_GROUP, table.length - 1)].
const GROUP_BONUS = [0, 2, 3, 4, 5, 6, 7, 10];

function bonusForGroupSize(size) {
  const idx = Math.max(0, size - MIN_GROUP);
  return GROUP_BONUS[Math.min(idx, GROUP_BONUS.length - 1)];
}

// Color-count bonus. Clearing groups of multiple distinct colors
// in the SAME chain step pays a bigger multiplier — rewards
// setups that pop two or three colors simultaneously rather than
// one-color-per-step. Real arcade values: 1 color = +0, 2 = +3,
// 3 = +6, 4 = +12, 5 = +24.
const COLOR_BONUS = [0, 0, 3, 6, 12, 24];

function bonusForColorCount(count) {
  return COLOR_BONUS[Math.min(count, COLOR_BONUS.length - 1)];
}

// Compute the group-size bonus for a clear result — sum across
// every group's individual bonus. Two groups of 4 and one of 6
// pays 0 + 0 + 3 = 3.
export function groupBonus(result) {
  let total = 0;
  for (const g of result.groups) total += bonusForGroupSize(g.cells.length);
  return total;
}

// Compute the color-count bonus — based on the number of DISTINCT
// colors among the cleared groups. Two G-groups + one R-group
// counts as 2 colors, not 3.
export function colorBonus(result) {
  const colors = new Set();
  for (const g of result.groups) colors.add(g.color);
  return bonusForColorCount(colors.size);
}

// Single source of truth for "what does this clear pay?" Both
// applyClearEffects (game.score) and the garbage plugin
// (outgoing nuisance count) call this so a future formula tweak
// is a one-file change. The arcade-canonical formula is:
//
//   points = cells × CHAIN_BASE × (chainPower + groupBonus + colorBonus) × level
//
// We keep the level multiplier (Tetris-style progression) on top
// of the arcade pieces — pure arcade Puyo doesn't scale by level,
// but our roguelite needs late-game payouts to grow.
export function pointsForStep(result, step, level) {
  const cells = result.cells.length;
  const power = chainPower(step);
  const gBonus = groupBonus(result);
  const cBonus = colorBonus(result);
  return cells * CHAIN_BASE * (power + gBonus + cBonus) * level;
}

// Chain step at which the all-clear bonus reads as "actually
// impressive." Mirrors Tetris's PERFECT_CLEAR_BONUS but tuned
// to Puyo's smaller per-clear point values.
const ALL_CLEAR_BONUS = 1500;

// Find every connected component of same-color puyos and return
// the ones with at least MIN_GROUP cells. Adjacency is 4-way
// (orthogonal). Cells whose value isn't a puyo color are ignored
// — junk / fill / debris from a future curse won't accidentally
// chain into a match.
//
// Returns null when nothing cleared (so the caller can short-
// circuit with `if (!result)`), matching TetrisMatchPolicy's
// idiom. Returns `{ cells, groups }` otherwise, where each group
// is `{ color, cells: [{x, y}, ...] }` — the color is needed for
// the color-count bonus, and the per-group cell-count is needed
// for the group-size bonus.
function findClears(board) {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  if (!rows || !cols) return null;

  const visited = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const groups  = [];
  const cells   = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (visited[r][c]) continue;
      const color = board[r][c];
      if (!isPuyoColor(color)) {
        visited[r][c] = true;
        continue;
      }

      // BFS / DFS — pop-stack flood-fill. Iterative (not recursive)
      // to keep the stack budget under control on a fully-connected
      // board (worst case 6 × 12 = 72 cells per group, fine either
      // way, but iterative is the right habit).
      const groupCells = [];
      const stack = [[r, c]];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) continue;
        if (visited[cr][cc]) continue;
        if (board[cr][cc] !== color) continue;
        visited[cr][cc] = true;
        groupCells.push({ x: cc, y: cr });
        stack.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
      }

      if (groupCells.length >= MIN_GROUP) {
        groups.push({ color, cells: groupCells });
        for (const cell of groupCells) cells.push(cell);
      }
    }
  }

  if (cells.length === 0) return null;
  return { cells, groups };
}

// Null the matched cells AND any nuisance puyos directly adjacent
// to a matched cell — the "splash damage" mechanic that lets the
// player dig out from under nuisance by clearing groups next to
// it. Splash damage only fires off MATCHED cells (not chained
// nuisance clearing more nuisance), so the radius is exactly one
// step from the original group.
//
// Cell-gravity (dropping the puyos that were sitting on top of
// the holes we just punched) is the cascade engine's job — we
// leave the holes in place and the next 'fall' phase fills them.
//
// Score-wise, splash-damaged nuisance is "free" cleanup: the
// match policy's applyClearEffects scores by `result.cells.length`
// (the matched group), which we don't mutate here. The splashed
// nuisance gets nulled and falls out of the board without
// affecting the chain payout.
function removeClears(board, result) {
  const rows = board.length;
  const cols = board[0]?.length ?? 0;
  // Splash first — collect the nuisance neighbors BEFORE nulling
  // the matched cells so we don't have to track which cells were
  // matched-vs-already-empty during the lookup.
  for (const { x, y } of result.cells) {
    const neighbors = [
      [x, y - 1],
      [x, y + 1],
      [x - 1, y],
      [x + 1, y],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      if (board[ny][nx] === 'N') board[ny][nx] = null;
    }
  }
  // Then null the matched cells themselves.
  for (const { x, y } of result.cells) {
    board[y][x] = null;
  }
}

// Called by Game.lockCurrent after the pair's cells are written.
// Two responsibilities:
//
//   1. Reset the chain-step counter (game.combo) — each piece's
//      chain starts at zero and accumulates as the cascade fires
//      successive applyClearEffects calls.
//   2. Hand control to the cascade engine. It nulls game.current,
//      runs cell-gravity until nothing falls, asks findClears, and
//      either kicks off a clear animation (looping back into
//      gravity afterward) or ends the cascade and spawns the next
//      piece.
//
// We DO NOT call findClears immediately here — even when the
// player's lock produces an instant match, we still want the
// cascade to drive it so the timing (CLEAR_DURATION animation,
// fall step cadence) feels consistent across "click clears" and
// "chain-step clears." Players couldn't tell the two apart from
// the cascade's perspective anyway, and routing both through the
// same engine keeps the score and combo math in one place.
function afterLock(game) {
  game.combo = 0;
  game.current = null;
  startGravityCascade(game);
}

// Score + progression + plugin notifications for one chain step.
// The cascade engine calls us once per cleared group-set (the full
// flood-fill result for that fall-settle phase). Multiple chain
// steps just means we get called multiple times per piece, with
// game.combo incrementing each time.
function applyClearEffects(game, result) {
  const cleared = result.cells.length;

  // Plugin hook fires BEFORE removal so future puyo plugins can
  // inspect the result before the cells are gone. (No plugins
  // consume this in step 4; the hook is plumbed for symmetry with
  // Tetris and so a "garbage attack" plugin can sit here later.)
  game._notifyPlugins('beforeClear', result);
  removeClears(game.board, result);

  // Chain step — increments per call. game.combo got reset to 0
  // in afterLock, so the first clear after a lock is chainStep=1,
  // the next chain link is 2, and so on. The HUD / sound layer
  // can read this exactly the way it reads Tetris's combo.
  game.combo += 1;
  const chainStep = game.combo;

  // Single-source-of-truth formula:
  //   cells × CHAIN_BASE × (chainPower + groupBonus + colorBonus) × level
  //
  // Step 1 pays 1× the cells (so a stand-alone 4-match still feels
  // worth setting up); step 2 jumps to 8×, then 16×, 32×, … plus
  // group-size and color-count bonuses pile on for big groups and
  // multi-color steps. The garbage plugin uses the same helper to
  // convert points → outgoing nuisance, so any tuning lands in
  // both score and versus pressure simultaneously.
  const points = pointsForStep(result, chainStep, game.level);
  game.score += points;

  // Treat each chain step as one "line" so the existing
  // level-up curve (level = floor(lines/10) + 1) and the gravity
  // table do the right thing for Puyo too. This deliberately
  // doesn't scale by group count or chain step — leveling should
  // feel like steady progression, not like a dial-up of difficulty
  // that punishes good chains.
  const linesBefore = game.lines;
  game.lines += 1;
  game.level = Math.floor(game.lines / 10) + 1;

  // Hybrid milestone trigger for the roguelite card menu:
  //   1. CUMULATIVE — every `milestoneInterval` chain steps the
  //      player survives earns a card. Mirrors Tetris's "every 5
  //      lines" exactly — Math.floor diff catches the boundary
  //      crossing without double-counting.
  //   2. BONUS — a chain that reaches `chainThreshold` earns one
  //      extra card on the step that crosses the threshold.
  //      Fires once per chain regardless of how much further the
  //      chain goes (the >= 4 trigger only matches when
  //      chainStep === 4, so step 5+ doesn't keep firing).
  // Both arm the universal menu-settle so the score / line / chain
  // banner pops finish before the menu surfaces.
  const cards = game.mode?.cards;
  let milestonesEarned = 0;
  const interval = cards?.milestoneInterval | 0;
  if (interval > 0) {
    milestonesEarned += Math.floor(game.lines / interval) - Math.floor(linesBefore / interval);
  }
  const threshold = cards?.chainThreshold;
  if (typeof threshold === 'number' && chainStep === threshold) {
    milestonesEarned += 1;
  }
  game.pendingChoices += milestonesEarned;
  if (milestonesEarned > 0) {
    game._menuSettleTimer = MENU_SETTLE_MS;
  }

  // All-clear bonus. Puyo's analog of Tetris's perfect clear —
  // empty the board after a chain and pocket a flat reward.
  const allClear = game.board.every(row => row.every(cell => cell === null));
  if (allClear) game.score += ALL_CLEAR_BONUS;

  // Visual / sound hooks. onPerfectClear is shared with Tetris (same
  // "you cleared the whole board" semantic). For chain steps we fire
  // a DEDICATED game.onChain hook rather than reusing Tetris's
  // onCombo — combo and chain represent different game concepts:
  //   • Tetris combo: consecutive line clears across multiple piece
  //     locks. Survives lock-without-clear breaks it.
  //   • Puyo chain:   consecutive matches WITHIN one piece's settle
  //     pass. Resets every lock, by definition.
  // Splitting the events keeps main.js's banner / sound wiring
  // mode-aware without a single `if (mode.id === 'puyo')` anywhere.
  if (allClear)        game.onPerfectClear?.();
  if (chainStep >= 2)  game.onChain?.(chainStep);

  // Settle the clear-animation slot. Same canonical reset point
  // Tetris's applyClearEffects uses, so the cascade engine and
  // game.tick's clear-animation gate flip back to "idle" cleanly.
  game.clearingResult = null;
  game.clearingRows   = [];
  game.clearTimer     = 0;

  // Plugin hook fires AFTER scoring is fully applied. Mirrors
  // Tetris's onClear ordering. The third arg is the full result
  // — the garbage plugin needs it to compute outgoing nuisance
  // via the same pointsForStep formula score uses, so versus
  // pressure stays in lockstep with displayed score.
  game._notifyPlugins('onClear', cleared, result);

  // Power-up menu callback — fires AFTER plugin onClear so any
  // freezing plugin started by triggers (none in Puyo today, but
  // the hook is here for symmetry with Tetris's specials path)
  // gets to flip its gate before the menu opens. The actual
  // menu-show is gated through game._isBusy() at the powerup-menu
  // module — this callback just signals "a card is pending."
  if (milestonesEarned > 0) {
    game.onPowerUpChoice?.(game.pendingChoices);
  }
}

export const PUYO_MATCH = {
  findClears,
  removeClears,
  afterLock,
  applyClearEffects,
};
