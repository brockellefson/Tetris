// Power-ups: Foresight I-V — sequentially reveal next-piece preview slots.
//
// Each tier requires the previous one. So "Foresight III" is only
// offered once the player already has "Foresight II". This keeps the
// progression linear rather than letting players unlock slot 3 with
// slots 1 and 2 still hidden (which would look weird in the UI).

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

function makeNextSlot(n) {
  return {
    id: `foresight-${n}`,
    name: `Foresight ${ROMAN[n - 1]}`,
    description: n === 1
      ? 'See your next piece in the queue.'
      : `See ${n} pieces ahead in the queue.`,
    // Available only when the previous tier has been taken.
    available: (game) => game.unlocks.nextCount === n - 1,
    apply:     (game) => { game.unlocks.nextCount = n; },
  };
}

export const next1 = makeNextSlot(1);
export const next2 = makeNextSlot(2);
export const next3 = makeNextSlot(3);
export const next4 = makeNextSlot(4);
export const next5 = makeNextSlot(5);
