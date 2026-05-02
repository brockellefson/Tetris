// Power-up: Gravity — one-shot board compaction. Picking the card
// pauses the active piece, then makes every locked block fall into
// any empty space below it. When the cascade settles, full rows are
// cleared (with the standard line-clear animation, score, and
// combo / B2B / perfect-clear bonuses). The fall-then-clear loop
// repeats until no more blocks can fall and no more lines complete,
// at which point the active piece is restored and play resumes.
//
// All the heavy lifting lives on Game.startGravity() — see js/game.js
// for the per-step fall logic, the line-clear handoff, and the
// power-up-menu deferral that keeps any milestones earned mid-cascade
// from popping a modal until the animation finishes.
//
// One-shot: there's no charge to bank, so `available()` is always
// true and the card can re-roll into the menu on later milestones.

export default {
  id: 'gravity',
  name: 'Gravity',
  description: 'All blocks fall to fill empty space below, clearing any lines they form.',
  available: () => true,
  apply: (game) => { game.startGravity(); },
};
