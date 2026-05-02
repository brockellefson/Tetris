// ============================================================
// Sound — synthesized audio cues, no asset files required
// ============================================================
//
// Uses the Web Audio API to generate pleasant tones on the fly.
// The AudioContext is created lazily on first use (browsers
// require a user gesture before audio can start — the first
// keypress that starts the game qualifies).
//
// To add new sounds, write another exported function following
// the same pattern: get the context, build a node graph, schedule
// start/stop times, and let the gain envelope handle the fade.
// ============================================================

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Pentatonic scale (C major pentatonic). Any combination of these
// notes is consonant, so any random sequence sounds musical.
const PENTATONIC = [
  261.63, // C4
  293.66, // D4
  329.63, // E4
  392.00, // G4
  440.00, // A4
  523.25, // C5
];

// Soft, warm tone played when a piece locks into the board.
// Each call picks a random note from the pentatonic — the ear
// hears the unpredictable sequence as a wandering, ambient melody
// rather than a fixed pattern.
export function playLockSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  const freq = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];

  // Master envelope — quick soft attack, long gentle decay.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.12, now + 0.015);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

  // Low-pass filter rounds off the harshness — this is what
  // makes the tone "soothing" rather than chiptune-bright.
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 1800;
  lpf.Q.value = 0.7;

  // Main carrier — sine for purity.
  const carrier = ac.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.value = freq;

  // Sub-octave below for warmth and body.
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = freq / 2;
  const subGain = ac.createGain();
  subGain.gain.value = 0.4;

  // Wire it up: carrier + sub → filter → envelope → speakers
  carrier.connect(lpf);
  sub.connect(subGain);
  subGain.connect(lpf);
  lpf.connect(env);
  env.connect(ac.destination);

  carrier.start(now);
  sub.start(now);
  carrier.stop(now + 0.6);
  sub.stop(now + 0.6);
}

// Shimmering chord played when one or more lines clear.
// More lines = bigger chord, longer tail, slightly brighter filter.
// Built from a C-major-pentatonic stack so all clear counts harmonize
// with each other and with the lock-sound notes.
const CLEAR_CHORDS = {
  1: [523.25],                                       // C5            — Single
  2: [523.25, 659.25],                               // C5 + E5       — Double
  3: [523.25, 659.25, 783.99],                       // C5 + E5 + G5  — Triple
  4: [523.25, 659.25, 783.99, 880.00, 1046.50],     // C5 E G A C6   — TETRIS
};

// Short blippy "tick" played as the player cycles through power-up
// cards. Always the same low C — a steady, neutral UI click that
// stays out of the way of the select chime that follows. Very short
// envelope so rapid arrow presses don't pile up.
export function playCycleSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  const freq = PENTATONIC[0]; // C4

  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.08, now + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  // Light low-pass keeps it from being clicky.
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 3200;
  lpf.Q.value = 0.5;

  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;

  osc.connect(lpf);
  lpf.connect(env);
  env.connect(ac.destination);

  osc.start(now);
  osc.stop(now + 0.15);
}

// Soft "whoosh chime" played when the power-up menu opens. A quick
// upward filter sweep on a major-fifth dyad (C5 + G5) signals
// "something arrived, your attention is needed" without sounding like
// the decisive picked-a-card chime that comes later. Distinct from
// playSelectSound (descending vs. ascending feel, no third note,
// breathier filter envelope).
export function playMenuOpenSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.55;

  // Master envelope — gentle swell up, slow tail.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.11, now + 0.08);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  // Low-pass filter sweeps from dark → bright over the swell, giving
  // the cue its "opening up" quality without a sharp transient.
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.Q.value = 0.7;
  lpf.frequency.setValueAtTime(600, now);
  lpf.frequency.exponentialRampToValueAtTime(3000, now + 0.25);
  lpf.connect(env);
  env.connect(ac.destination);

  // Two stacked sines — root + perfect fifth. Each is doubled with a
  // slight detune for a soft chorus shimmer (same trick as the clear
  // sound, scaled down for UI use).
  const dyad = [523.25, 783.99]; // C5, G5
  for (const freq of dyad) {
    const osc1 = ac.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc1.connect(lpf);

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.005;
    const detune = ac.createGain();
    detune.gain.value = 0.5;
    osc2.connect(detune);
    detune.connect(lpf);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + dur + 0.05);
    osc2.stop(now + dur + 0.05);
  }
}

// Confirmation chime played when the player picks a power-up card.
// A quick ascending two-note arpeggio (C5 → G5) — recognizably
// "decisive" without overpowering the gameplay sounds that follow.
export function playSelectSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  const notes = [
    { freq: 523.25, t: 0.00 },  // C5
    { freq: 783.99, t: 0.06 },  // G5
    { freq: 1046.50, t: 0.12 }, // C6
  ];

  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.14, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 3200;
  lpf.Q.value = 0.7;
  lpf.connect(env);
  env.connect(ac.destination);

  for (const { freq, t } of notes) {
    // Pair of detuned sines per note for the same shimmer the clear
    // sound uses — keeps the menu chime sonically related to the
    // line-clear celebration without mimicking it.
    const osc1 = ac.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.005;
    const detune = ac.createGain();
    detune.gain.value = 0.5;

    osc1.connect(lpf);
    osc2.connect(detune);
    detune.connect(lpf);

    osc1.start(now + t);
    osc2.start(now + t);
    osc1.stop(now + t + 0.4);
    osc2.stop(now + t + 0.4);
  }
}

export function playClearSound(lineCount) {
  const ac = getCtx();
  const now = ac.currentTime;

  const notes = CLEAR_CHORDS[lineCount] || CLEAR_CHORDS[1];
  const duration = 0.7 + lineCount * 0.25; // longer celebration for more lines

  // Master envelope — soft swell, long bell-like decay.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.10, now + 0.04);
  env.gain.exponentialRampToValueAtTime(0.001, now + duration);

  // Filter opens up a bit more than the lock sound for sparkle,
  // but still rolled off to stay in the "soothing" range.
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 2400 + lineCount * 200;
  lpf.Q.value = 0.7;
  lpf.connect(env);
  env.connect(ac.destination);

  // Each chord note is a pair of slightly-detuned sines — the
  // gentle phasing between them creates a shimmery chorus effect.
  for (const freq of notes) {
    const osc1 = ac.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc1.connect(lpf);

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.005; // +0.5% detune
    const detuneGain = ac.createGain();
    detuneGain.gain.value = 0.5;
    osc2.connect(detuneGain);
    detuneGain.connect(lpf);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration + 0.1);
    osc2.stop(now + duration + 0.1);
  }
}

// Soft "ping" played when the mouse hovers over the main-menu Play
// button. A single short triangle blip at G5 with a tiny detuned partner
// for shimmer — quieter and higher than the in-menu cycle blip so the
// two cues can't be confused. Very short envelope so swiping the cursor
// across the button doesn't pile up a buzz.
export function playMenuHoverSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.18;

  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.06, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 4000;
  lpf.Q.value = 0.6;
  lpf.connect(env);
  env.connect(ac.destination);

  // Pair of detuned triangles for a soft shimmery ping.
  const freq = 783.99; // G5
  const osc1 = ac.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = freq;
  osc1.connect(lpf);

  const osc2 = ac.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = freq * 1.005;
  const detune = ac.createGain();
  detune.gain.value = 0.5;
  osc2.connect(detune);
  detune.connect(lpf);

  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + dur + 0.02);
  osc2.stop(now + dur + 0.02);
}

// Big "GO" chime played when the player clicks Play (or hits Enter on
// the splash). A confident ascending three-note arpeggio (C5 → E5 → G5
// → C6) with a sub-bass thump underneath — bigger than the power-up
// select chime, so starting the game feels like an event rather than a
// menu confirmation. Sits alongside playTheme() kicking in, so the gain
// stays moderate to leave room for the music swell.
export function playMenuStartSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.55;

  // ----- Master tone path -----
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.16, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  // Sweep brighter as the chord opens — adds the "lift-off" feel.
  lpf.frequency.setValueAtTime(1200, now);
  lpf.frequency.exponentialRampToValueAtTime(4000, now + 0.25);
  lpf.Q.value = 0.7;
  lpf.connect(env);
  env.connect(ac.destination);

  // Ascending C-major arpeggio — the same pentatonic family used
  // everywhere else, so this chime is sonically related to the
  // gameplay sounds.
  const notes = [
    { freq: 523.25,  t: 0.00 },  // C5
    { freq: 659.25,  t: 0.07 },  // E5
    { freq: 783.99,  t: 0.14 },  // G5
    { freq: 1046.50, t: 0.22 },  // C6
  ];
  for (const { freq, t } of notes) {
    const osc1 = ac.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc1.connect(lpf);

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.005;
    const detune = ac.createGain();
    detune.gain.value = 0.5;
    osc2.connect(detune);
    detune.connect(lpf);

    osc1.start(now + t);
    osc2.start(now + t);
    osc1.stop(now + t + 0.4);
    osc2.stop(now + t + 0.4);
  }

  // ----- Sub-bass thump for weight -----
  // Quick A2 → A1 drop on a sine — gives the chime a launchy bottom
  // end without competing with the gameplay tones.
  const subEnv = ac.createGain();
  subEnv.gain.setValueAtTime(0, now);
  subEnv.gain.linearRampToValueAtTime(0.18, now + 0.01);
  subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, now);
  sub.frequency.exponentialRampToValueAtTime(55, now + 0.18);
  sub.connect(subEnv);
  subEnv.connect(ac.destination);

  sub.start(now);
  sub.stop(now + 0.3);
}

// Sharp "crack" played when a chisel removes a block. A short bandpass
// noise burst gives the chip-of-stone texture, and a fast downward
// pitch sweep on a square wave adds the percussive "snap" so the cue
// reads as breakage rather than just static.
export function playChiselSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.18;

  // ----- Noise burst (the "chip") -----
  // Build a short buffer of white noise and play it through a bandpass
  // — bandpassing white noise around 3 kHz gives a crisp "tick"
  // without the harshness of unfiltered noise.
  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 3000;
  noiseBP.Q.value = 1.2;

  const noiseEnv = ac.createGain();
  noiseEnv.gain.setValueAtTime(0.18, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);

  noise.connect(noiseBP);
  noiseBP.connect(noiseEnv);
  noiseEnv.connect(ac.destination);

  // ----- Pitched "snap" -----
  // Square wave that drops from 800 Hz to 200 Hz in ~80 ms — the fast
  // downward glide is what the ear reads as "something broke off."
  const snap = ac.createOscillator();
  snap.type = 'square';
  snap.frequency.setValueAtTime(800, now);
  snap.frequency.exponentialRampToValueAtTime(200, now + 0.08);

  const snapLPF = ac.createBiquadFilter();
  snapLPF.type = 'lowpass';
  snapLPF.frequency.value = 1500;

  const snapEnv = ac.createGain();
  snapEnv.gain.setValueAtTime(0, now);
  snapEnv.gain.linearRampToValueAtTime(0.12, now + 0.005);
  snapEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  snap.connect(snapLPF);
  snapLPF.connect(snapEnv);
  snapEnv.connect(ac.destination);

  noise.start(now);
  noise.stop(now + dur);
  snap.start(now);
  snap.stop(now + 0.13);
}

// Quick "swoosh" played when the Flip power-up mirrors the active
// piece. Two simultaneous pitch sweeps moving in opposite directions
// — one rising, one falling — sonically mirror each other, which is
// the same gesture the power-up performs on the piece. A bandpassed
// noise tail adds a soft air-whoosh so the cue reads as motion rather
// than just a tone.
export function playFlipSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.22;

  // Master envelope — crisp attack, fast tail. Flip is instant, the
  // sound shouldn't linger past the visual.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.13, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 3200;
  lpf.Q.value = 0.7;
  lpf.connect(env);
  env.connect(ac.destination);

  // Rising voice: G4 → C6. Triangle for a softer body than square.
  const up = ac.createOscillator();
  up.type = 'triangle';
  up.frequency.setValueAtTime(392.00, now);
  up.frequency.exponentialRampToValueAtTime(1046.50, now + 0.16);
  up.connect(lpf);

  // Falling voice: C6 → G4. The two voices cross at the midpoint,
  // which is what makes the cue read as "mirrored."
  const down = ac.createOscillator();
  down.type = 'triangle';
  down.frequency.setValueAtTime(1046.50, now);
  down.frequency.exponentialRampToValueAtTime(392.00, now + 0.16);
  down.connect(lpf);

  up.start(now);
  down.start(now);
  up.stop(now + dur + 0.02);
  down.stop(now + dur + 0.02);

  // Short bandpassed-noise breath underneath — air moving past the piece.
  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 2200;
  noiseBP.Q.value = 0.9;

  const noiseEnv = ac.createGain();
  noiseEnv.gain.setValueAtTime(0.05, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + dur);

  noise.connect(noiseBP);
  noiseBP.connect(noiseEnv);
  noiseEnv.connect(ac.destination);

  noise.start(now);
  noise.stop(now + dur);
}

// ============================================================
// UI sound helper
// ============================================================
//
// `wireMenuSounds(el, opts)` attaches the project's standard menu
// audio cues (cycle blip on hover, select chime on click) to any
// element with a single call. Used by every interactive surface in
// the debug menu, the splash buttons, and any future menu — see
// CLAUDE.md → "UI conventions" for the rationale and when to pick
// which sound for which kind of button.
//
// Options (all optional):
//   hover       — function called on mouseenter (default: playCycleSound).
//                 Pass null to skip the hover binding entirely. Pass
//                 playMenuHoverSound for primary launcher buttons,
//                 playCycleSound for items inside a list/grid.
//   click       — function called on click (default: playSelectSound).
//                 Pass null to skip. Pass playSelectSound for commits,
//                 playCycleSound for incremental nudges, or
//                 playMenuOpenSound when the click opens a new modal.
//   shouldPlay  — predicate gating both cues; return false to suppress
//                 sounds (e.g. while the menu is hidden) so stale
//                 mouseenter events from a closing modal can't ping.
//                 Defaults to () => true (always play).
export function wireMenuSounds(el, {
  hover = playCycleSound,
  click = playSelectSound,
  shouldPlay = () => true,
} = {}) {
  if (hover) {
    el.addEventListener('mouseenter', () => { if (shouldPlay()) hover(); });
  }
  if (click) {
    el.addEventListener('click', () => { if (shouldPlay()) click(); });
  }
}

// Bright "shimmer-pop" played when a special block is triggered (line
// clear, chisel — anything that fires the special's onTrigger). The
// cue has to read as "something powerful just went off" without
// stepping on the line-clear chord that's also playing in the
// line-clear path. Three voices stacked:
//
//   1. A fast upward arpeggio in C-major pentatonic (G5 → C6 → E6),
//      sitting an octave above the playClearSound's top note so it
//      cuts through the chord rather than blurring with it.
//   2. A high bandpassed-noise sparkle that fades fast — adds the
//      "magic dust" texture without ringing out long enough to mask
//      the cascade footsteps that follow for Gravity.
//   3. A short sub-bass pulse for weight (E2 → E1) so chiseling a
//      special block has a satisfying low-end thump alongside the
//      regular chisel "crack."
//
// Pentatonic notes keep this consonant with everything else in the
// game's audio palette — a cascade triggered mid-clear stacks
// shimmer-pop on top of clear-chord on top of cascade-tick without
// any dissonance.
export function playSpecialTriggerSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.55;

  // Master envelope — fast attack so the trigger feels instant,
  // moderate tail so the shimmer rings just past the visual flash.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.13, now + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  // Sweep brighter on the swell — same "opening up" trick the menu-
  // open chime uses, scaled for a punchier transient.
  lpf.frequency.setValueAtTime(2400, now);
  lpf.frequency.exponentialRampToValueAtTime(6000, now + 0.18);
  lpf.Q.value = 0.7;
  lpf.connect(env);
  env.connect(ac.destination);

  // ----- Voice 1: ascending pentatonic arpeggio -----
  // G5 → C6 → E6. The detuned sine pair per note gives the same
  // chorus shimmer the clear sound has, so the two cues feel like
  // they belong together.
  const notes = [
    { freq: 783.99,  t: 0.00 },  // G5
    { freq: 1046.50, t: 0.05 },  // C6
    { freq: 1318.51, t: 0.10 },  // E6
  ];
  for (const { freq, t } of notes) {
    const osc1 = ac.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = freq;
    osc1.connect(lpf);

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.005;
    const detune = ac.createGain();
    detune.gain.value = 0.5;
    osc2.connect(detune);
    detune.connect(lpf);

    osc1.start(now + t);
    osc2.start(now + t);
    osc1.stop(now + t + 0.45);
    osc2.stop(now + t + 0.45);
  }

  // ----- Voice 2: high sparkle (bandpassed noise) -----
  // Short noise burst centered around 5 kHz — the "magic dust" layer.
  // Fades faster than the arpeggio so the tail is melodic, not hissy.
  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.3), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 5000;
  noiseBP.Q.value = 1.4;

  const noiseEnv = ac.createGain();
  noiseEnv.gain.setValueAtTime(0.08, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  noise.connect(noiseBP);
  noiseBP.connect(noiseEnv);
  noiseEnv.connect(ac.destination);

  // ----- Voice 3: sub-bass pulse -----
  // Quick E2 → E1 thump on its own envelope so the rest of the cue
  // can stay bright without the lows muddying the master gain.
  const subEnv = ac.createGain();
  subEnv.gain.setValueAtTime(0, now);
  subEnv.gain.linearRampToValueAtTime(0.14, now + 0.01);
  subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(82.41, now);          // E2
  sub.frequency.exponentialRampToValueAtTime(41.20, now + 0.16);  // E1
  sub.connect(subEnv);
  subEnv.connect(ac.destination);

  noise.start(now);
  noise.stop(now + 0.3);
  sub.start(now);
  sub.stop(now + 0.25);
}

// Sharp "electric jolt" played when a piece carrying a special block
// spawns onto the board. The cue has to read as "ALERT, this one is
// different" without being so loud it competes with the lock chord
// the player will hear ~1 second later. Three layers:
//
//   1. A bandpassed-noise crackle (5 kHz center, ~50 ms) — the spark.
//      Hard transient, no swell, mimics the snap of a static discharge.
//   2. A square-wave "arc" that flickers between two close pitches
//      (G6 ⇄ A6) over 90 ms via setValueAtTime steps. The fast
//      alternation is what reads as electricity arcing rather than
//      just a tone.
//   3. A high pure-sine ring (C7) on a fast decay — the after-tone
//      that makes the cue feel "magical" rather than purely electrical.
//      Pentatonic-family note so it harmonizes with everything else.
//
// Total duration ~200 ms — short enough that rapid spawns (debug
// menu spam, an unlucky run of three specials in a row) don't pile
// into a buzz.
export function playSpecialSpawnSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  // ----- Voice 1: bandpassed noise crackle (the spark) -----
  const noiseDur = 0.05;
  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * noiseDur), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 5000;
  noiseBP.Q.value = 2.0;

  const noiseEnv = ac.createGain();
  noiseEnv.gain.setValueAtTime(0.18, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

  noise.connect(noiseBP);
  noiseBP.connect(noiseEnv);
  noiseEnv.connect(ac.destination);

  // ----- Voice 2: arcing square wave (the electric flicker) -----
  // Step the frequency between G6 and A6 every 15 ms — the rapid
  // alternation is what gives the cue its "electricity arcing" feel.
  // Square wave's harsh harmonics are what sells the electrical
  // quality (vs. the soft sines used elsewhere).
  const arc = ac.createOscillator();
  arc.type = 'square';
  const f1 = 1567.98; // G6
  const f2 = 1760.00; // A6
  for (let t = 0; t < 0.09; t += 0.015) {
    arc.frequency.setValueAtTime((Math.floor(t / 0.015) % 2) ? f2 : f1, now + t);
  }

  // Bandpass tames the square's harshness — keeps the buzz from being
  // grating without losing the harmonic richness that makes it read
  // as electrical.
  const arcBP = ac.createBiquadFilter();
  arcBP.type = 'bandpass';
  arcBP.frequency.value = 2400;
  arcBP.Q.value = 1.8;

  const arcEnv = ac.createGain();
  arcEnv.gain.setValueAtTime(0, now);
  arcEnv.gain.linearRampToValueAtTime(0.10, now + 0.005);
  arcEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.10);

  arc.connect(arcBP);
  arcBP.connect(arcEnv);
  arcEnv.connect(ac.destination);

  // ----- Voice 3: high sine ring (the after-shimmer) -----
  // C7 sine that lands as the arc dies, fades fast. Brings the cue
  // back into the game's pentatonic palette so the electrical layer
  // doesn't sound out of place against the soft synth tones around it.
  const ring = ac.createOscillator();
  ring.type = 'sine';
  ring.frequency.value = 2093.00; // C7

  const ringEnv = ac.createGain();
  ringEnv.gain.setValueAtTime(0, now + 0.06);
  ringEnv.gain.linearRampToValueAtTime(0.08, now + 0.07);
  ringEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

  ring.connect(ringEnv);
  ringEnv.connect(ac.destination);

  noise.start(now);
  noise.stop(now + noiseDur);
  arc.start(now);
  arc.stop(now + 0.11);
  ring.start(now + 0.06);
  ring.stop(now + 0.22);
}

// "Heavy descending pulse" cue played when a piece carrying a Gravity
// special spawns. The brief is "you can feel the weight loaded onto
// the board" — a low sine that drops a fifth in pitch as a high
// overtone rings on top, finishing with a soft sub thud. Reads as
// portentous / heavy without being aggressive (unlike Bomb, which
// SHOULD feel a bit dangerous on spawn).
export function playGravitySpawnSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  // ----- Voice 1: low descending body (the weight) -----
  const bodyEnv = ac.createGain();
  bodyEnv.gain.setValueAtTime(0, now);
  bodyEnv.gain.linearRampToValueAtTime(0.16, now + 0.02);
  bodyEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

  const bodyLPF = ac.createBiquadFilter();
  bodyLPF.type = 'lowpass';
  bodyLPF.frequency.value = 1200;
  bodyLPF.Q.value = 0.7;

  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(196.00, now);                // G3
  body.frequency.exponentialRampToValueAtTime(98.00, now + 0.16); // G2
  body.connect(bodyLPF);
  bodyLPF.connect(bodyEnv);
  bodyEnv.connect(ac.destination);

  // ----- Voice 2: high ringing overtone (the gravitational signature) -----
  // Two octaves above the body's resolved pitch — sounds like a soft
  // bell sympathetically excited by the heavy descending tone.
  const ringEnv = ac.createGain();
  ringEnv.gain.setValueAtTime(0, now);
  ringEnv.gain.linearRampToValueAtTime(0.06, now + 0.01);
  ringEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

  const ring = ac.createOscillator();
  ring.type = 'sine';
  ring.frequency.value = 1567.98; // G6
  ring.connect(ringEnv);
  ringEnv.connect(ac.destination);

  // ----- Voice 3: sub-thud at the bottom -----
  const subEnv = ac.createGain();
  subEnv.gain.setValueAtTime(0, now + 0.12);
  subEnv.gain.linearRampToValueAtTime(0.14, now + 0.14);
  subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(65.41, now + 0.12);  // C2
  sub.frequency.exponentialRampToValueAtTime(41.20, now + 0.22); // E1
  sub.connect(subEnv);
  subEnv.connect(ac.destination);

  body.start(now);
  body.stop(now + 0.34);
  ring.start(now);
  ring.stop(now + 0.32);
  sub.start(now + 0.12);
  sub.stop(now + 0.32);
}

// "Fuse-lit sizzle" cue played when a piece carrying a Bomb special
// spawns. Three layers — a sharp match-strike at the front, a
// continuous high-frequency sizzle that fades over ~280 ms, and a
// low ominous undertone. The sizzle is what makes the cue read as
// "burning fuse" rather than just a one-shot tick. Total ~280 ms.
export function playBombSpawnSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  // ----- Voice 1: match-strike tick (the spark of ignition) -----
  const tickDur = 0.025;
  const tickBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * tickDur), ac.sampleRate);
  const tdata = tickBuf.getChannelData(0);
  for (let i = 0; i < tdata.length; i++) tdata[i] = Math.random() * 2 - 1;
  const tick = ac.createBufferSource();
  tick.buffer = tickBuf;

  const tickBP = ac.createBiquadFilter();
  tickBP.type = 'bandpass';
  tickBP.frequency.value = 4500;
  tickBP.Q.value = 1.0;

  const tickEnv = ac.createGain();
  tickEnv.gain.setValueAtTime(0.20, now);
  tickEnv.gain.exponentialRampToValueAtTime(0.001, now + tickDur);

  tick.connect(tickBP);
  tickBP.connect(tickEnv);
  tickEnv.connect(ac.destination);

  // ----- Voice 2: continuous sizzle (the fuse burning) -----
  // Filtered noise that fades from steady to silence — the steady
  // attack-and-decay shape is what reads as "burning" rather than a
  // single transient. Slightly delayed start so it follows the tick
  // (you strike the match, THEN it sizzles).
  const sizzleDur = 0.26;
  const sizzleBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * sizzleDur), ac.sampleRate);
  const sdata = sizzleBuf.getChannelData(0);
  for (let i = 0; i < sdata.length; i++) sdata[i] = Math.random() * 2 - 1;
  const sizzle = ac.createBufferSource();
  sizzle.buffer = sizzleBuf;

  const sizzleBP = ac.createBiquadFilter();
  sizzleBP.type = 'bandpass';
  sizzleBP.frequency.value = 3200;
  sizzleBP.Q.value = 0.9;

  const sizzleEnv = ac.createGain();
  sizzleEnv.gain.setValueAtTime(0, now + 0.02);
  sizzleEnv.gain.linearRampToValueAtTime(0.07, now + 0.05);
  sizzleEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  sizzle.connect(sizzleBP);
  sizzleBP.connect(sizzleEnv);
  sizzleEnv.connect(ac.destination);

  // ----- Voice 3: low ominous undertone (something dangerous arrived) -----
  // E2 sine with a slow decay — sub-bass color that gives the cue
  // weight without making it sound like a hit.
  const omenEnv = ac.createGain();
  omenEnv.gain.setValueAtTime(0, now);
  omenEnv.gain.linearRampToValueAtTime(0.08, now + 0.04);
  omenEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

  const omen = ac.createOscillator();
  omen.type = 'sine';
  omen.frequency.value = 82.41;  // E2
  omen.connect(omenEnv);
  omenEnv.connect(ac.destination);

  tick.start(now);
  tick.stop(now + tickDur);
  sizzle.start(now + 0.02);
  sizzle.stop(now + 0.02 + sizzleDur);
  omen.start(now);
  omen.stop(now + 0.32);
}

// "Static-charge crackle" cue played when a piece carrying a Lightning
// special spawns. Sharp electrical character — a bandpassed noise
// burst (the static) plus a fast rising sine sweep (a tesla coil
// charging up) that resolves on a high C7. Shorter than the other
// spawn cues (~180 ms) so it reads as instantaneous and bright.
export function playLightningSpawnSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  // ----- Voice 1: static burst (the crackle) -----
  const staticDur = 0.06;
  const staticBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * staticDur), ac.sampleRate);
  const sdata = staticBuf.getChannelData(0);
  for (let i = 0; i < sdata.length; i++) sdata[i] = Math.random() * 2 - 1;
  const stat = ac.createBufferSource();
  stat.buffer = staticBuf;

  const staticBP = ac.createBiquadFilter();
  staticBP.type = 'bandpass';
  staticBP.frequency.value = 5500;
  staticBP.Q.value = 1.4;

  const staticEnv = ac.createGain();
  staticEnv.gain.setValueAtTime(0.18, now);
  staticEnv.gain.exponentialRampToValueAtTime(0.001, now + staticDur);

  stat.connect(staticBP);
  staticBP.connect(staticEnv);
  staticEnv.connect(ac.destination);

  // ----- Voice 2: rising charge sweep (tesla coil winding up) -----
  // Triangle wave swept from C5 up to C7 — the rising motion sells
  // the "energy building" feel. Triangle's hollow harmonic content
  // reads more "electric coil" than a pure sine would.
  const sweep = ac.createOscillator();
  sweep.type = 'triangle';
  sweep.frequency.setValueAtTime(523.25, now);                  // C5
  sweep.frequency.exponentialRampToValueAtTime(2093.00, now + 0.12); // C7

  const sweepLPF = ac.createBiquadFilter();
  sweepLPF.type = 'lowpass';
  sweepLPF.frequency.value = 4000;
  sweepLPF.Q.value = 1.2;

  const sweepEnv = ac.createGain();
  sweepEnv.gain.setValueAtTime(0, now);
  sweepEnv.gain.linearRampToValueAtTime(0.10, now + 0.02);
  sweepEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

  sweep.connect(sweepLPF);
  sweepLPF.connect(sweepEnv);
  sweepEnv.connect(ac.destination);

  // ----- Voice 3: high resolution ping (charge held) -----
  // Brief sine ping at C7 right as the sweep arrives — the "fully
  // charged, ready to fire" punctuation.
  const ping = ac.createOscillator();
  ping.type = 'sine';
  ping.frequency.value = 2093.00; // C7

  const pingEnv = ac.createGain();
  pingEnv.gain.setValueAtTime(0, now + 0.12);
  pingEnv.gain.linearRampToValueAtTime(0.06, now + 0.13);
  pingEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

  ping.connect(pingEnv);
  pingEnv.connect(ac.destination);

  stat.start(now);
  stat.stop(now + staticDur);
  sweep.start(now);
  sweep.stop(now + 0.18);
  ping.start(now + 0.12);
  ping.stop(now + 0.22);
}

// "Suction" cue played when the Gravity special block triggers. The
// brief feels like the entire board is being inhaled toward a
// singularity — three layers do the work:
//
//   1. Overlapping sine sweeps that all start HIGH and resolve LOW.
//      Three voices entering on staggered onsets at different starting
//      pitches (1600 → 1100 → 700 Hz) all converge to E1, which the
//      ear reads as "many particles falling inward toward one point."
//      Downward exponential sweeps are what give the cue its pull.
//   2. A bandpassed-noise wash whose center frequency sweeps from
//      bright (5 kHz) DOWN to muffled (200 Hz) — the high frequencies
//      "getting swallowed" past the listener's ear is what makes it
//      sound like the noise itself is being absorbed.
//   3. A short low-bass impact at the end (E1 thump, ~80 ms decay) —
//      the moment everything arrives at the bottom and slams home.
//
// Notes are picked from the same pentatonic family the rest of the
// game uses (E1 / E2 are octaves of E4 in C-major-pentatonic), so the
// cue stays in the synthwave palette even though it's bass-heavy.
export function playGravitySuckSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.55;

  // Master envelope — slow swell IN, then a sharp peak at the impact,
  // then quick decay. The slow attack is critical: a fast attack would
  // sound like a hit, but suction is an in-drawn pull, so the gain
  // ramps in over the same interval the pitch sweeps are descending.
  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.16, now + 0.32);    // build up
  env.gain.linearRampToValueAtTime(0.20, now + 0.36);    // peak at impact
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  // ----- Voice 1: converging sine sweeps -----
  // Three voices, staggered onset, different starting pitches, all
  // sweeping DOWN to E1 (~41 Hz). Listen to them and you hear a swarm
  // collapsing into a point.
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  // Filter also closes as the sweep progresses — high partials drop
  // out faster than the fundamentals, which sells the "sucked away"
  // feeling for the higher voices.
  lpf.frequency.setValueAtTime(4000, now);
  lpf.frequency.exponentialRampToValueAtTime(400, now + 0.36);
  lpf.Q.value = 0.7;
  lpf.connect(env);
  env.connect(ac.destination);

  const sweeps = [
    { startFreq: 1600, t: 0.00, sweepDur: 0.34 },
    { startFreq: 1100, t: 0.04, sweepDur: 0.30 },
    { startFreq:  700, t: 0.08, sweepDur: 0.26 },
  ];
  const targetFreq = 41.20; // E1
  for (const { startFreq, t, sweepDur } of sweeps) {
    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now + t);
    osc.frequency.exponentialRampToValueAtTime(targetFreq, now + t + sweepDur);
    osc.connect(lpf);
    osc.start(now + t);
    osc.stop(now + t + sweepDur + 0.05);
  }

  // ----- Voice 2: noise wash with closing bandpass -----
  // White noise through a bandpass whose center sweeps from 5 kHz to
  // 200 Hz over the inhale. The high frequencies vanishing first is
  // what gives the cue its "being absorbed past the listener" quality.
  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.45), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.setValueAtTime(5000, now);
  noiseBP.frequency.exponentialRampToValueAtTime(200, now + 0.36);
  noiseBP.Q.value = 1.6;

  const noiseEnv = ac.createGain();
  noiseEnv.gain.setValueAtTime(0, now);
  noiseEnv.gain.linearRampToValueAtTime(0.10, now + 0.20);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

  noise.connect(noiseBP);
  noiseBP.connect(noiseEnv);
  noiseEnv.connect(ac.destination);

  // ----- Voice 3: low-bass impact at the bottom -----
  // The moment of arrival — a quick E1 thump that lands AS the sweeps
  // resolve, so the ear reads "they got there." Stays out of the way
  // of any cascade footsteps that follow because it's fully decayed
  // before the cascade's first fall step (GRAVITY_POWER_STEP = 120 ms).
  const impactEnv = ac.createGain();
  impactEnv.gain.setValueAtTime(0, now + 0.32);
  impactEnv.gain.linearRampToValueAtTime(0.18, now + 0.34);
  impactEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.50);

  const impact = ac.createOscillator();
  impact.type = 'sine';
  impact.frequency.setValueAtTime(82.41, now + 0.32);          // E2
  impact.frequency.exponentialRampToValueAtTime(41.20, now + 0.42); // E1
  impact.connect(impactEnv);
  impactEnv.connect(ac.destination);

  noise.start(now);
  noise.stop(now + 0.45);
  impact.start(now + 0.32);
  impact.stop(now + 0.50);
}

// "Boom" cue for the Bomb special. Concussive low-end thump plus a
// short noise wash, with a fast filter sweep that opens then closes.
// Three layers:
//
//   1. Sub-bass impact — quick A1 → A0 sine drop on its own envelope.
//      That's what gives the cue its weight; a bomb without bottom
//      end sounds like a popped balloon.
//   2. Mid-range "thump" — square wave at 110 Hz with a fast pitch
//      drop to 55 Hz. Square's harmonics give the boom a "punchy"
//      edge over a pure sine, without going full noise.
//   3. Noise burst — bandpassed at 2 kHz, fades over ~150 ms. The
//      "debris" texture so the cue reads as breakage and not just a
//      drum hit.
//
// Total ~280 ms — long enough to feel substantial, short enough that
// a chained-bomb cluster doesn't bleed into one continuous rumble.
export function playBombSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  // ----- Voice 1: sub-bass impact -----
  const subEnv = ac.createGain();
  subEnv.gain.setValueAtTime(0, now);
  subEnv.gain.linearRampToValueAtTime(0.32, now + 0.005);
  subEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, now);            // A2
  sub.frequency.exponentialRampToValueAtTime(28, now + 0.20); // ≈ A0
  sub.connect(subEnv);
  subEnv.connect(ac.destination);

  // ----- Voice 2: mid-range punch -----
  const midEnv = ac.createGain();
  midEnv.gain.setValueAtTime(0, now);
  midEnv.gain.linearRampToValueAtTime(0.16, now + 0.008);
  midEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

  const midLPF = ac.createBiquadFilter();
  midLPF.type = 'lowpass';
  midLPF.frequency.value = 1200;
  midLPF.Q.value = 0.7;

  const mid = ac.createOscillator();
  mid.type = 'square';
  mid.frequency.setValueAtTime(220, now);
  mid.frequency.exponentialRampToValueAtTime(55, now + 0.14);
  mid.connect(midLPF);
  midLPF.connect(midEnv);
  midEnv.connect(ac.destination);

  // ----- Voice 3: bandpassed noise debris -----
  const noiseDur = 0.18;
  const noiseBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * noiseDur), ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;

  const noiseBP = ac.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 2000;
  noiseBP.Q.value = 0.9;

  const noiseEnv = ac.createGain();
  noiseEnv.gain.setValueAtTime(0.20, now);
  noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + noiseDur);

  noise.connect(noiseBP);
  noiseBP.connect(noiseEnv);
  noiseEnv.connect(ac.destination);

  sub.start(now);
  sub.stop(now + 0.32);
  mid.start(now);
  mid.stop(now + 0.20);
  noise.start(now);
  noise.stop(now + noiseDur);
}

// "Crack" cue for the Lightning special. Sharp, bright, fast — the
// audio analog of an electric arc striking the column. Layers:
//
//   1. Front-loaded noise burst (~30 ms) bandpassed high (6 kHz) —
//      the "snap" of the strike. Pure transient, no decay envelope
//      shape beyond an instant exponential drop.
//   2. A descending sawtooth zap (1800 → 200 Hz over 80 ms) — the
//      "zzzzap" body. Sawtooth's bright harmonics carry the
//      electrical character that a sine couldn't.
//   3. A high sine ring (E7 ~2637 Hz) on a 250 ms tail — the
//      after-tone that makes the cue feel "magical electric" instead
//      of "industrial buzz."
//
// Shorter overall than the bomb (~260 ms) so chained-Lightning
// triggers down a column don't blur into white noise.
export function playLightningSound() {
  const ac = getCtx();
  const now = ac.currentTime;

  // ----- Voice 1: front-loaded noise crack -----
  const crackDur = 0.04;
  const crackBuf = ac.createBuffer(1, Math.floor(ac.sampleRate * crackDur), ac.sampleRate);
  const cdata = crackBuf.getChannelData(0);
  for (let i = 0; i < cdata.length; i++) cdata[i] = Math.random() * 2 - 1;
  const crack = ac.createBufferSource();
  crack.buffer = crackBuf;

  const crackBP = ac.createBiquadFilter();
  crackBP.type = 'bandpass';
  crackBP.frequency.value = 6000;
  crackBP.Q.value = 1.6;

  const crackEnv = ac.createGain();
  crackEnv.gain.setValueAtTime(0.22, now);
  crackEnv.gain.exponentialRampToValueAtTime(0.001, now + crackDur);

  crack.connect(crackBP);
  crackBP.connect(crackEnv);
  crackEnv.connect(ac.destination);

  // ----- Voice 2: descending sawtooth zap -----
  const zap = ac.createOscillator();
  zap.type = 'sawtooth';
  zap.frequency.setValueAtTime(1800, now);
  zap.frequency.exponentialRampToValueAtTime(200, now + 0.08);

  const zapLPF = ac.createBiquadFilter();
  zapLPF.type = 'lowpass';
  zapLPF.frequency.value = 3200;
  zapLPF.Q.value = 0.8;

  const zapEnv = ac.createGain();
  zapEnv.gain.setValueAtTime(0, now);
  zapEnv.gain.linearRampToValueAtTime(0.15, now + 0.005);
  zapEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

  zap.connect(zapLPF);
  zapLPF.connect(zapEnv);
  zapEnv.connect(ac.destination);

  // ----- Voice 3: high sine ring -----
  const ring = ac.createOscillator();
  ring.type = 'sine';
  ring.frequency.value = 2637.02; // E7

  const ringEnv = ac.createGain();
  ringEnv.gain.setValueAtTime(0, now + 0.04);
  ringEnv.gain.linearRampToValueAtTime(0.07, now + 0.05);
  ringEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

  ring.connect(ringEnv);
  ringEnv.connect(ac.destination);

  crack.start(now);
  crack.stop(now + crackDur);
  zap.start(now);
  zap.stop(now + 0.13);
  ring.start(now + 0.04);
  ring.stop(now + 0.28);
}

// Soft low "thump" played when a fill power-up materializes a block.
// A short sine drop from 220 Hz to 110 Hz reads as something solid
// settling into place — opposite character from the chisel "crack."
export function playFillSound() {
  const ac = getCtx();
  const now = ac.currentTime;
  const dur = 0.22;

  // Pitched body: A3 → A2 quick downward sweep on a sine. Lower than
  // the lock sound so the player can tell them apart in a busy moment.
  const body = ac.createOscillator();
  body.type = 'sine';
  body.frequency.setValueAtTime(220, now);
  body.frequency.exponentialRampToValueAtTime(110, now + 0.09);

  // Sub-octave sine for weight — gives the thump its body.
  const sub = ac.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(110, now);
  sub.frequency.exponentialRampToValueAtTime(55, now + 0.09);
  const subGain = ac.createGain();
  subGain.gain.value = 0.5;

  // Low-pass keeps it soft and rounded — no clicky high end.
  const lpf = ac.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 900;
  lpf.Q.value = 0.6;

  const env = ac.createGain();
  env.gain.setValueAtTime(0, now);
  env.gain.linearRampToValueAtTime(0.18, now + 0.008);
  env.gain.exponentialRampToValueAtTime(0.001, now + dur);

  body.connect(lpf);
  sub.connect(subGain);
  subGain.connect(lpf);
  lpf.connect(env);
  env.connect(ac.destination);

  body.start(now);
  sub.start(now);
  body.stop(now + dur + 0.05);
  sub.stop(now + dur + 0.05);
}
