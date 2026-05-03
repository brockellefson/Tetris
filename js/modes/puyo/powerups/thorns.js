// ============================================================
// Thorns (Puyo versus blessing)
// ============================================================
//
// Effect: each pick adds 3 charges. The next 3 incoming attacks
// reflect 25% back to the opponent. You take only 75% of the
// reflected attacks; once charges run out, attacks pass through
// at full strength again. Stackable — picking twice gives 6
// charges, etc.
//
// Why it's strong:
//   • Counter-pressure. Picking up Thorns mid-match makes the
//     opponent regret their next big attack instead of just
//     enduring it.
//   • Doesn't require timing — passive while charged.
//
// Why it's not broken:
//   • Limited window. After 3 attacks (or 6 if stacked) the card
//     is done; you can't sit on it forever.
//   • Math.floor rounding means small attacks (≤ 3 incoming)
//     reflect 0, so the card doesn't shine on tiny pokes.
//   • Stacks linearly — no exponential snowball.
//
// Implementation: modifyIncomingGarbage hook decrements a charges
// counter and reflects on each call. Once charges hit 0 the hook
// is a pass-through. Charges live in plugin-state so a Whoops
// rewind (forward-compat) round-trips them.

import { sendGarbageNow } from '../versus/garbage-plugin.js';

const REFLECT_RATIO = 0.25;
const CHARGES_PER_PICK = 3;

export default {
  id: 'thorns',
  name: 'Thorns',
  description: 'Reflect 25% of next 3 incoming attacks. Stacks.',

  modes: ['puyo-versus'],

  // ---- Card shape ----

  // Stackable — always available. Each pick adds charges.
  available: () => true,

  apply(game) {
    if (!game._pluginState.thorns) {
      game._pluginState.thorns = { charges: 0 };
    }
    game._pluginState.thorns.charges += CHARGES_PER_PICK;
  },

  // ---- Plugin lifecycle ----

  reset(game) {
    game._pluginState.thorns = { charges: 0 };
  },

  // Hook order with Shield matters: Shield runs first (in
  // registration order), absorbing half. Thorns then reflects
  // 25% of what's left — so if both are active and you eat a
  // 12-incoming attack, Shield halves to 6, Thorns reflects 1
  // (floor(6 * 0.25)), and you take 5. The chain order is set
  // in main.js's registerPlugin call — register Shield before
  // Thorns to keep this layering.
  //
  // Charge accounting: a charge is consumed on EVERY hook call
  // where Thorns is active and there's incoming garbage to
  // process — even if the reflected count rounds down to zero
  // (a 1-2 incoming attack still uses the charge but reflects
  // nothing). Tunable later if it feels off.
  modifyIncomingGarbage(game, count) {
    const s = game._pluginState.thorns;
    if (!s || s.charges <= 0 || count <= 0) return count;
    s.charges -= 1;
    const reflected = Math.floor(count * REFLECT_RATIO);
    if (reflected <= 0) return count;
    sendGarbageNow(reflected);
    return count - reflected;
  },
};
