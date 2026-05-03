// ============================================================
// Shield (Puyo versus blessing)
// ============================================================
//
// Effect: the next incoming attack hits for half. Charges are
// stackable — picking Shield twice gives you two charges, the
// next two attacks each get halved.
//
// Why it's strong:
//   • Defensive panic button. Saved up and timed against a big
//     incoming attack, it can absorb half a board-filling chain.
//   • Stacks, so the player can hoard them across milestones if
//     they're playing a control style.
//
// Why it's not broken:
//   • One-shot per charge — doesn't block forever.
//   • Doesn't help against chains the player can't see coming;
//     reactive only.
//
// Implementation: modifyIncomingGarbage hook. The garbage plugin
// calls _reduceHookValue('modifyIncomingGarbage', count) when a
// 'garbage' event lands; this card halves the count and consumes
// one charge per call. Versus-only — the hook never fires in SP,
// so the card is also gated out of SP picks via the modes field.

export default {
  id: 'shield',
  name: 'Shield',
  description: 'Halve next incoming attack. Stacks.',

  modes: ['puyo-versus'],

  // ---- Card shape ----

  // Always available — stackable. Each pick increments charges.
  available: () => true,

  apply(game) {
    if (!game._pluginState.shield) {
      game._pluginState.shield = { charges: 0 };
    }
    game._pluginState.shield.charges += 1;
  },

  // ---- Plugin lifecycle ----

  reset(game) {
    game._pluginState.shield = { charges: 0 };
  },

  // Halve the incoming count and burn one charge per attack.
  // Math.floor so a 1-incoming attack with one charge absorbs
  // entirely (1 * 0.5 = 0.5 → 0). That's intended: the smallest
  // attacks are the ones a defensive card should fully absorb.
  modifyIncomingGarbage(game, count) {
    const s = game._pluginState.shield;
    if (!s || s.charges <= 0 || count <= 0) return count;
    s.charges -= 1;
    return Math.floor(count * 0.5);
  },
};
