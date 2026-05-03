// ============================================================
// State-sync plugin — broadcast our field to the opponent
// ============================================================
//
// Sister to garbage-plugin: same mode gate (`puyo-versus`), same
// match-controller dependency. While garbage-plugin sends *events*
// (chain attacks), this plugin sends *snapshots* — periodic shots
// of the local board state so the opponent's tab can render a
// mini-version of our field next to theirs.
//
// Tick-based ~10 Hz throttle (SEND_INTERVAL_MS) is the cheapest
// thing that gives the opponent's view a smooth update cadence
// without flooding the channel. BroadcastChannel can handle 60 Hz
// fine, but Phase 3 (Supabase Realtime) will move bytes per
// message — 100 ms cadence keeps that under any reasonable budget
// while still feeling live.
//
// Game-over fires an immediate send so the win/lose signal isn't
// delayed by up to 100 ms of throttle latency.
//
// Snapshot shape (kept minimal for tomorrow's network swap):
//   {
//     board: 2D array, null | color-letter per cell
//     piece: { kind, pivot?, satellite?, type?, rot, x, y } | null
//     score: number
//     chain: number   (current chain step, mostly mid-cascade)
//     gameOver: boolean
//   }
//
// We do NOT send the cascade's intermediate fall steps — the
// opponent's view jumps to the post-cascade state. Keeps the
// snapshot count low and matches arcade Mean Bean Machine's
// "see settled board, not falling debris" feel.

const SEND_INTERVAL_MS = 100;

let _matchController = null;
let _timeSinceLastSend = 0;

export function attachStateSync(controller) {
  _matchController = controller;
  _timeSinceLastSend = 0;
}

export function detachStateSync() {
  _matchController = null;
}

// Compact a piece object into something safe to JSON. Pair pieces
// carry pivot/satellite color letters; tetris pieces carry the
// type string. Both share rot/x/y so a single shape works for
// both modes — the opponent renderer dispatches via piece.kind /
// piece.type just like the main renderer does.
function snapshotPiece(piece) {
  if (!piece) return null;
  if (piece.kind === 'pair') {
    return {
      kind: 'pair',
      pivot:     piece.pivot,
      satellite: piece.satellite,
      rot:       piece.rot,
      x:         piece.x,
      y:         piece.y,
    };
  }
  return {
    type:    piece.type,
    rot:     piece.rot,
    x:       piece.x,
    y:       piece.y,
    flipped: !!piece.flipped,
  };
}

// Deep-clone the board so post-send mutations on our side don't
// bleed into the snapshot mid-flight (BroadcastChannel uses
// structured clone so this is double-safe; the explicit copy is
// for the network transport coming in Phase 3).
function snapshotBoard(board) {
  return board.map(row => row.slice());
}

function sendNow(game) {
  if (!_matchController) return;
  _matchController.send('state', {
    board:    snapshotBoard(game.board),
    piece:    snapshotPiece(game.current),
    score:    game.score,
    chain:    game.combo | 0,
    gameOver: !!game.gameOver,
  });
}

// Game.tick early-returns when game.gameOver is true, so the
// plugin's `tick` hook never fires after death. Expose a manual
// send so the game-over wiring in local-vs can flush a final
// snapshot — otherwise the opponent's last view of our field
// would be a frame or two before the loss, not the moment of
// loss itself.
export function sendFinalState(game) {
  sendNow(game);
}

export default {
  id: 'state-sync',
  modes: ['puyo-versus'],

  reset(_game) {
    _timeSinceLastSend = 0;
  },

  // Throttled streaming snapshot — accumulates dt and ships when
  // we've passed the interval. Skips when no controller is
  // attached (e.g., between matches).
  tick(game, dt) {
    if (!_matchController) return;
    _timeSinceLastSend += dt;
    if (_timeSinceLastSend < SEND_INTERVAL_MS) return;
    _timeSinceLastSend = 0;
    sendNow(game);
  },

  // Immediate send on key transitions so the opponent's view never
  // misses the moment a piece spawns / locks / a chain ends. Also
  // resets the throttle so we don't double-send 5 ms later.
  onSpawn(game)  { sendNow(game); _timeSinceLastSend = 0; },
  onLock(game)   { sendNow(game); _timeSinceLastSend = 0; },
  onClear(game)  { sendNow(game); _timeSinceLastSend = 0; },
};
