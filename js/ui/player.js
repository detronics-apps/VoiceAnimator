/**
 * The playback clock.
 *
 * One `requestAnimationFrame` loop drives everything on screen. It exists rather than a
 * `setInterval` because the frame the browser is about to paint is the only moment worth
 * updating for: at 24fps a track has 24 distinct pictures a second, but the screen may
 * be showing 120, and stepping the clock in time with the paint is what keeps the mouth
 * from stuttering on the ones in between.
 *
 * When a recording is loaded the audio element becomes the clock instead - a media
 * element's `currentTime` is the only thing guaranteed to agree with what is audible.
 */

export function createPlayer({ onFrame, onStop } = {}) {
  let raf = null;
  let startedAt = 0;
  let offset = 0;
  let duration = 0;
  let playing = false;
  let loop = false;
  let audio = null;

  const now = () => (typeof performance === 'undefined' ? Date.now() : performance.now()) / 1000;

  const currentTime = () => {
    if (audio) return audio.currentTime;
    return playing ? offset + (now() - startedAt) : offset;
  };

  function tick() {
    if (!playing) return;
    let time = currentTime();

    if (time >= duration) {
      if (loop && duration > 0) {
        seek(0);
        if (audio) audio.currentTime = 0;
        time = 0;
      } else {
        pause();
        // Rest on the final frame rather than snapping back: the last pose is part of
        // the performance.
        onFrame?.(duration);
        onStop?.();
        return;
      }
    }

    onFrame?.(time);
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (playing || duration <= 0) return;
    if (offset >= duration) offset = 0;
    playing = true;
    startedAt = now();
    if (audio) {
      audio.currentTime = offset;
      audio.play().catch(() => { /* a browser that will not autoplay is not an error */ });
    }
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    offset = currentTime();
    playing = false;
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
    audio?.pause();
  }

  function seek(seconds) {
    const time = Math.max(0, Math.min(duration, Number(seconds) || 0));
    offset = time;
    startedAt = now();
    if (audio) audio.currentTime = time;
    onFrame?.(time);
  }

  return {
    play,
    pause,
    seek,
    toggle: () => (playing ? pause() : play()),
    stop: () => { pause(); seek(0); },
    get playing() { return playing; },
    get time() { return currentTime(); },
    setDuration(seconds) {
      duration = Math.max(0, Number(seconds) || 0);
      if (offset > duration) seek(duration);
    },
    setLoop(value) { loop = value === true; },
    /** Hand the clock over to an audio element, or take it back with `null`. */
    setAudio(element) {
      const wasPlaying = playing;
      pause();
      audio = element ?? null;
      if (wasPlaying) play();
    },
    /** Step exactly one frame, for checking a single pose. */
    step(frames, fps) {
      pause();
      seek(currentTime() + frames / Math.max(1, fps));
    },
    destroy() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      playing = false;
    },
  };
}
