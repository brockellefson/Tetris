// ============================================================
// Seedable PRNG — mulberry32
// ============================================================
//
// Tiny deterministic random-number generator. Given the same seed,
// produces the same sequence on every machine, on every run,
// forever. That's the property versus mode needs — both players'
// tabs feed the same seed in and get the same sequence of puyo
// pairs out, so the match is fair (skill, not piece luck).
//
// mulberry32 is a 32-bit-state generator with good statistical
// properties for game use (pieces, dice, RNG-driven effects). It
// is NOT cryptographically secure — don't use it for anything
// security-sensitive. For our use case (which colors fall next),
// the speed and seeded-determinism matter and the bits-of-entropy
// don't.
//
// Usage:
//
//   import { mulberry32, randomSeed } from './util/rng.js';
//
//   const rng = mulberry32(0xdeadbeef);
//   rng();   // → 0.something, deterministic
//
// API mirrors Math.random — call site gets a () => number that
// returns values in [0, 1). Drop-in replacement.

// Generate a 32-bit unsigned random integer using the platform RNG.
// Used to bootstrap a fresh seed when starting a match — each tab
// generates one and they negotiate which one to use via the
// handshake (smaller playerId's seed wins). 32 bits is enough
// entropy that two simultaneous matches won't collide.
export function randomSeed() {
  // Math.random() yields a 53-bit double in [0, 1); shift into
  // 0..0xffffffff and unsigned-coerce so the seed reads as a
  // proper u32 (negatives would still work but JSON-serialize
  // ugly).
  return (Math.random() * 0x100000000) >>> 0;
}

// Build a seeded random generator. Returns a function that
// produces values in [0, 1) just like Math.random(). State is
// closed over the returned fn — call sites can hold multiple
// independent generators if they want.
//
// The implementation is the canonical mulberry32 (a fast 32-bit
// state generator by Tommy Ettinger). 7 lines of math, well
// within the budget of a one-line "random next color" call.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
