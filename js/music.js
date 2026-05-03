// ============================================================
// Music — background-music controller
// ============================================================
//
// Owns the three <audio> elements (menu + two game themes) and
// handles three things the rest of the code shouldn't have to
// think about:
//
//   1. Crossfading between tracks. menu→game, game→menu, and
//      pause/resume all run the volume on a rAF ramp instead of
//      cutting hard. The brief is "no sudden hard cuts" — even a
//      ~250 ms ramp on pause is enough to round the edge.
//
//   2. Alternating the in-game tracks. The first time the game
//      starts, we randomly pick theme1 or theme2 (so each run
//      feels different). When that track ends, we play the OTHER
//      one, and so on, forever. NEITHER track carries the `loop`
//      attribute — with `loop` set, the `ended` event never
//      fires, which would silently pin the player to a single
//      track for the entire run. We hand-ride the alternation
//      via the `ended` listener instead.
//
//   3. The browser-autoplay dance. Browsers refuse to start audio
//      before a user gesture, so the very first playMenu() call
//      may be silently blocked. The .play() promise rejects in
//      that case; we swallow the rejection and the FIRST keydown
//      / mousedown / pointerdown anywhere in the document retries
//      the menu fade-in (registered by the caller via the public
//      `kick()` method).
//
// State machine — modes only change via the public API:
//
//   idle    →  menu     via playMenu()
//   menu    ↔  game     via playGame() / playMenu()
//   game    →  game'    via the `ended` event (auto, internal)
//   any     →  paused   via pause()
//   paused  →  prev     via resume()
//
// Volumes live on the <audio> elements directly (HTMLMediaElement.
// volume is a 0..1 float). We don't route through Web Audio because
// the rest of the game's SFX use a separate AudioContext and
// crossfading three tracks doesn't need anything Web Audio adds —
// `audio.volume` is exactly the right knob.
// ============================================================

const MENU_GAME_FADE_MS = 700;  // bigger transition, longer ramp
const PAUSE_FADE_MS     = 250;  // pause/resume should feel responsive

export function setupMusic({ menuEl, themeEls, baseVolume = 0.5 } = {}) {
  // ---- Element prep -------------------------------------------------
  // Menu track loops natively — the browser handles seamless wrap-
  // around so the splash hum stays steady while the player thinks.
  menuEl.loop = true;
  menuEl.volume = 0;

  // Game tracks must NOT loop — see the header comment. Initial
  // volume zero so a misfired play() can't ever blast the player.
  themeEls.forEach(el => { el.loop = false; el.volume = 0; });

  // Pick which theme plays first. Random so each session is a
  // different opener; once chosen the alternation is deterministic
  // (B follows A follows B follows A …) for the rest of the run.
  let currentThemeIdx = Math.floor(Math.random() * themeEls.length);
  const otherIdx = i => (i + 1) % themeEls.length;

  // When a theme ends, kick off the OTHER one. We do an instant cut
  // here (no fade) — between back-to-back same-genre tracks an
  // audible crossfade isn't needed, and a real crossfade would
  // require keeping the just-ended track playing past its end,
  // which the audio element doesn't support without preloading
  // both into Web Audio. The `mode` guard is belt-and-suspenders:
  // a paused track shouldn't fire `ended`, but if some browser
  // quirk does, we don't want to override a paused/menu state.
  themeEls.forEach((el, idx) => {
    el.addEventListener('ended', () => {
      if (mode !== 'game') return;
      const next = otherIdx(idx);
      currentThemeIdx = next;
      const target = themeEls[next];
      target.currentTime = 0;
      target.volume = baseVolume;
      safePlay(target);
    });
  });

  // ---- Fade engine --------------------------------------------------
  // One in-flight fade per element. Cancellable so a fast pause→
  // resume burst doesn't leave dueling rAF ramps fighting each
  // other for the volume knob.
  const fades = new Map();

  function cancelFade(el) {
    const f = fades.get(el);
    if (f) {
      cancelAnimationFrame(f.rafId);
      fades.delete(el);
    }
  }

  // Linear volume ramp on rAF. `pauseOnZero` lets the caller stop
  // the audio element once it's fully silent — saves a tiny bit
  // of decoder work and lets `currentTime` freeze cleanly so the
  // resume path picks up exactly where the fade-out started.
  function fadeTo(el, target, durMs, { pauseOnZero = false } = {}) {
    cancelFade(el);
    const start = el.volume;
    const delta = target - start;
    if (Math.abs(delta) < 0.001) {
      if (pauseOnZero && target === 0) el.pause();
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / durMs);
      el.volume = Math.max(0, Math.min(1, start + delta * t));
      if (t >= 1) {
        fades.delete(el);
        if (pauseOnZero && target === 0) el.pause();
        return;
      }
      const rafId = requestAnimationFrame(tick);
      fades.set(el, { rafId });
    };
    const rafId = requestAnimationFrame(tick);
    fades.set(el, { rafId });
  }

  // .play() returns a promise that rejects when the browser refuses
  // (autoplay policy, focus loss). Always swallow — the controller
  // re-attempts on the next interaction via kick().
  function safePlay(el) {
    const p = el.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  // ---- State machine ------------------------------------------------
  // 'idle'   — boot state, nothing playing yet
  // 'menu'   — menuEl playing
  // 'game'   — themeEls[currentThemeIdx] playing
  // 'paused' — last mode (menu/game) is paused; resume() restores it
  let mode = 'idle';
  let preMute = null;  // 'menu' or 'game' — what to restore on resume()

  function silenceThemes(durMs = MENU_GAME_FADE_MS) {
    themeEls.forEach(el => fadeTo(el, 0, durMs, { pauseOnZero: true }));
  }

  function playMenu() {
    mode = 'menu';
    silenceThemes();
    safePlay(menuEl);
    fadeTo(menuEl, baseVolume, MENU_GAME_FADE_MS);
  }

  function playGame() {
    mode = 'game';
    fadeTo(menuEl, 0, MENU_GAME_FADE_MS, { pauseOnZero: true });

    // Bring up the currently-selected game track. If the player has
    // already heard part of it (e.g. game→pause→resume routes through
    // playGame), .play() resumes from the saved currentTime so the
    // music continues where it left off. The OTHER track is force-
    // silenced in case a recent fade-out hasn't fully completed.
    const target = themeEls[currentThemeIdx];
    safePlay(target);
    fadeTo(target, baseVolume, MENU_GAME_FADE_MS);
    themeEls.forEach((el, i) => {
      if (i !== currentThemeIdx) fadeTo(el, 0, MENU_GAME_FADE_MS, { pauseOnZero: true });
    });
  }

  // Fast fade-out + pause. Save what we were playing so resume() can
  // bring it back with the same fade-in shape.
  function pause() {
    if (mode === 'paused' || mode === 'idle') return;
    preMute = mode;
    mode = 'paused';
    if (preMute === 'menu') {
      fadeTo(menuEl, 0, PAUSE_FADE_MS, { pauseOnZero: true });
    } else {
      themeEls.forEach(el => {
        if (!el.paused) fadeTo(el, 0, PAUSE_FADE_MS, { pauseOnZero: true });
      });
    }
  }

  function resume() {
    if (mode !== 'paused') return;
    // Use the slow ramp on resume so the music swells back in
    // rather than slapping back at full volume. Re-routing through
    // playMenu / playGame is cheap and reuses all the cross-track
    // silencing logic for free.
    if (preMute === 'menu') playMenu();
    else                    playGame();
  }

  // Called by main.js after wiring; attempts the menu fade-in once,
  // and registers a one-shot fallback so the FIRST user interaction
  // (anywhere in the document) retries playMenu() if the autoplay
  // policy blocked us. {once: true} means we don't have to remove
  // the listeners by hand.
  function kick() {
    playMenu();
    const retry = () => {
      // If the menu element actually started, the fade engine has
      // already pushed its volume above zero — skip the retry.
      if (!menuEl.paused && menuEl.volume > 0.01) return;
      if (mode === 'menu') playMenu();
    };
    document.addEventListener('keydown',     retry, { once: true });
    document.addEventListener('mousedown',   retry, { once: true });
    document.addEventListener('pointerdown', retry, { once: true });
  }

  return { playMenu, playGame, pause, resume, kick };
}
