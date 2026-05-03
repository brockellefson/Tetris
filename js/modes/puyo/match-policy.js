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

function chainPower(step) {
  if (step <= 0) return 0;
  if (step > CHAIN_POWER.length) return CHAIN_POWER[CHAIN_POWER.length - 1];
  return CHAIN_POWER[step - 1];
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
// idiom. Returns `{ cells, groups }` otherwise.
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
      const group = [];
      const stack = [[r, c]];
      while (stack.length) {
        const [cr, cc] = stack.pop();
        if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) continue;
        if (visited[cr][cc]) continue;
        if (board[cr][cc] !== color) continue;
        visited[cr][cc] = true;
        group.push({ x: cc, y: cr });
        stack.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
      }

      if (group.length >= MIN_GROUP) {
        groups.push(group);
        for (const cell of group) cells.push(cell);
      }
    }
  }

  if (cells.length === 0) return null;
  return { cells, groups };
}

// Null the matched cells. Cell-gravity (dropping the puyos that
// were sitting on top of the holes we just punched) is the cascade
// engine's job — we leave the holes in place and the next 'fall'
// phase fills them.
function removeClears(board, result) {
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

  // Multiplier from the chain power table — see CHAIN_POWER above.
  // Step 1 pays 1× the cells (so a stand-alone 4-match still feels
  // worth setting up); step 2 jumps to 8×, then 16×, 32×, … The
  // exponential growth past step 3 is what turns "I built a real
  // chain" into a real score event.
  const points = cleared * CHAIN_BASE * chainPower(chainStep) * game.level;
  game.score += points;

  // Treat each chain step as one "line" so the existing
  // level-up curve (level = floor(lines/10) + 1) and the gravity
  // table do the right thing for Puyo too. This deliberately
  // doesn't scale by group count or chain step — leveling should
  // feel like steady progression, not like a dial-up of difficulty
  // that punishes good chains.
  game.lines += 1;
  game.level = Math.floor(game.lines / 10) + 1;

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
  // Tetris's onClear ordering. No power-up callback yet — Puyo's
  // card pool will land in a later step alongside puyo-specific
  // blessings.
  game._notifyPlugins('onClear', cleared);
}

export const PUYO_MATCH = {
  findClears,
  removeClears,
  afterLock,
  applyClearEffects,
};
