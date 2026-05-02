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
