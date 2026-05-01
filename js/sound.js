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
