/**
 * Fitting a modelled track onto a real recording.
 *
 * Pure: no DOM, no globals. Decoding an audio file needs a `AudioContext` and lives in
 * `js/ui/audio.js`; everything from the raw samples onwards is here, because that is
 * the part with arithmetic in it worth testing.
 *
 * The model in `js/timing.js` gets the *order* of the mouth shapes right - that comes
 * from the words, and the words are known exactly. What it can only estimate is *when*.
 * A recording fixes that, in two steps of increasing ambition:
 *
 *   **Fit the length.** Scale the whole track so it ends when the recording does. One
 *   number, always safe, and usually most of the improvement.
 *
 *   **Fit the pauses.** Find the silences in the recording, match them to the pauses the
 *   punctuation produced, and stretch each phrase between them independently. This is
 *   what stops a track drifting further out of step the longer it runs.
 *
 * This is not speech recognition, and it does not pretend to be: it never changes which
 * shape is shown, only when. Rhubarb Lip Sync recognises the sounds themselves, and
 * where you need that level of accuracy it remains the right tool. What this buys is a
 * track that lines up with a real take without leaving the browser.
 */

/** Anything below this is silence regardless of how quiet the recording is overall. */
const ABSOLUTE_FLOOR = 0.002;

/**
 * The loudness envelope: root-mean-square amplitude over short frames.
 *
 * RMS rather than peak, because a plosive spike is one sample and a held vowel is
 * thousands - peak would call them equally loud.
 *
 * @param {ArrayLike<number>} samples mono PCM in -1..1
 * @param {number} sampleRate
 * @param {number} [frameSeconds] analysis window; 20ms is the usual speech figure
 * @returns {number[]} one RMS value per frame
 */
export function rmsFrames(samples, sampleRate, frameSeconds = 0.02) {
  const rate = Number(sampleRate);
  const size = Math.max(1, Math.round(rate * frameSeconds));
  if (!samples?.length || !Number.isFinite(rate) || rate <= 0) return [];

  const frames = [];
  for (let start = 0; start + size <= samples.length; start += size) {
    let sum = 0;
    for (let i = start; i < start + size; i += 1) sum += samples[i] * samples[i];
    frames.push(Math.sqrt(sum / size));
  }
  return frames;
}

/** Mix an array of channels down to one. A stereo take is not two performances. */
export function toMono(channels) {
  if (!channels?.length) return [];
  if (channels.length === 1) return channels[0];

  const length = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i];
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Where the recording goes quiet.
 *
 * The threshold is relative to the loudest frame, so a quietly recorded take is not one
 * long silence, with an absolute floor underneath so a track of pure hiss is not one
 * long word.
 *
 * @returns {Array<{start:number, end:number, seconds:number}>} in time order
 */
export function detectSilences(frames, frameSeconds = 0.02, options = {}) {
  const { threshold = 0.08, minSilence = 0.12 } = options;
  if (!frames.length) return [];

  const peak = Math.max(...frames);
  const level = Math.max(peak * threshold, ABSOLUTE_FLOOR);

  const silences = [];
  let runStart = null;

  for (let i = 0; i <= frames.length; i += 1) {
    const quiet = i < frames.length && frames[i] < level;
    if (quiet && runStart === null) runStart = i;
    if (!quiet && runStart !== null) {
      const start = runStart * frameSeconds;
      const end = i * frameSeconds;
      if (end - start >= minSilence) silences.push({ start, end, seconds: end - start });
      runStart = null;
    }
  }

  return silences;
}

/**
 * The first and last instant anything is actually said, so a recording with three
 * seconds of room tone at the front does not push the whole performance late.
 */
export function speechBounds(frames, frameSeconds = 0.02, options = {}) {
  const { threshold = 0.08 } = options;
  if (!frames.length) return { start: 0, end: 0 };

  const level = Math.max(Math.max(...frames) * threshold, ABSOLUTE_FLOOR);
  let first = frames.findIndex((f) => f >= level);
  if (first === -1) return { start: 0, end: frames.length * frameSeconds };

  let last = frames.length - 1;
  while (last > first && frames[last] < level) last -= 1;

  return { start: first * frameSeconds, end: (last + 1) * frameSeconds };
}

/* ---------------------------------------------------------------------------- *
 * Warping the track onto the recording
 * ---------------------------------------------------------------------------- */

/** The rests in a track: where the model thinks the speaker stopped. */
export function restSpans(track) {
  return track.cues
    .filter((cue) => cue.kind === 'rest')
    .map((cue) => ({ start: cue.start, end: cue.end, mid: (cue.start + cue.end) / 2 }));
}

/**
 * Pair the model's pauses with the recording's silences, in order.
 *
 * Order is the whole difficulty. A greedy nearest-neighbour match can pair the model's
 * third pause with the recording's first, which produces a warp that runs backwards. So
 * candidates are only ever taken from *after* whatever was matched last, and the
 * endpoints are always anchored.
 *
 * @returns {Array<{from:number, to:number}>} strictly increasing in both coordinates
 */
export function matchAnchors(rests, silences, trackDuration, audioDuration) {
  const anchors = [{ from: 0, to: 0 }];

  const model = rests.filter((r) => r.mid > 0 && r.mid < trackDuration);
  const heard = silences
    .map((s) => ({ mid: (s.start + s.end) / 2, seconds: s.seconds }))
    .filter((s) => s.mid > 0 && s.mid < audioDuration);

  let nextModel = 0;
  let previousFrom = 0;
  let previousTo = 0;

  for (const silence of heard) {
    // Position within the performance, so the two timelines are comparable even when
    // one is twice as long as the other.
    const wanted = silence.mid / audioDuration;

    let best = -1;
    let bestGap = Infinity;
    for (let i = nextModel; i < model.length; i += 1) {
      const gap = Math.abs(model[i].mid / trackDuration - wanted);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best === -1) break;

    // A pairing that is nowhere near is worse than no pairing: leave that stretch to
    // be interpolated between the anchors either side of it.
    if (bestGap > 0.12) continue;

    const from = model[best].mid;
    const to = silence.mid;
    if (from <= previousFrom || to <= previousTo) continue;

    anchors.push({ from, to });
    previousFrom = from;
    previousTo = to;
    nextModel = best + 1;
  }

  anchors.push({ from: trackDuration, to: audioDuration });
  return anchors;
}

/**
 * A piecewise-linear map from model time to recording time.
 *
 * Monotonic by construction: each segment has a positive slope, so no two cues can ever
 * swap places however badly the anchors were chosen. Outside the anchored range it
 * extends with the slope of the nearest segment rather than flattening, so a cue past
 * the end still moves in the right direction.
 */
export function makeWarp(anchors) {
  const points = [...anchors]
    .sort((a, b) => a.from - b.from)
    .filter((p, i, all) => i === 0 || (p.from > all[i - 1].from && p.to > all[i - 1].to));

  if (points.length < 2) {
    const scale = points.length === 1 && points[0].from > 0 ? points[0].to / points[0].from : 1;
    return (t) => t * scale;
  }

  return (time) => {
    if (time <= points[0].from) {
      const slope = (points[1].to - points[0].to) / (points[1].from - points[0].from);
      return points[0].to + (time - points[0].from) * slope;
    }
    for (let i = 1; i < points.length; i += 1) {
      if (time > points[i].from) continue;
      const a = points[i - 1];
      const b = points[i];
      return a.to + ((time - a.from) / (b.from - a.from)) * (b.to - a.to);
    }
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    const slope = (b.to - a.to) / (b.from - a.from);
    return b.to + (time - b.from) * slope;
  };
}

/**
 * Move every cue through a warp, keeping the track contiguous.
 *
 * Boundaries are warped rather than cues, so a cue's end and the next cue's start stay
 * the same number - there is no way for a gap to open up between them.
 */
export function warpCues(cues, warp) {
  if (!cues.length) return [];

  const bounds = [cues[0].start, ...cues.map((c) => c.end)].map((t) => Math.max(0, warp(t)));
  for (let i = 1; i < bounds.length; i += 1) {
    if (bounds[i] < bounds[i - 1]) bounds[i] = bounds[i - 1];
  }

  return cues.map((cue, i) => ({ ...cue, start: bounds[i], end: bounds[i + 1] }));
}

/**
 * Fit a track to a recording's length and nothing more. One multiplication, no
 * assumptions, and the right thing to reach for when the silence detection is confused
 * by music or room tone.
 */
export function fitToDuration(track, audioDuration) {
  const target = Math.max(0, Number(audioDuration) || 0);
  if (!track.cues.length || track.duration <= 0 || target <= 0) return track;
  return applyWarp(track, makeWarp([{ from: 0, to: 0 }, { from: track.duration, to: target }]));
}

/** Move a whole track - cues and expression spans alike - through a warp. */
export function applyWarp(track, warp) {
  const cues = warpCues(track.cues, warp);
  const expressions = (track.expressions ?? []).map((span) => ({
    ...span,
    start: Math.max(0, warp(span.start)),
    end: Math.max(0, warp(span.end)),
  }));

  const duration = cues.length ? cues[cues.length - 1].end : 0;
  for (const span of expressions) {
    span.start = Math.min(span.start, duration);
    span.end = Math.min(Math.max(span.end, span.start), duration);
  }

  const words = (track.words ?? []).map((word) => ({
    ...word,
    start: word.start === null ? null : Math.max(0, warp(word.start)),
    end: word.end === null ? null : Math.max(0, warp(word.end)),
  }));

  return { ...track, cues, expressions, words, duration };
}

/**
 * The whole audio fit: match the pauses, warp, and report what it managed.
 *
 * @param {object} track from `buildTrack`
 * @param {object} analysis `{duration, silences}` from the decoded audio
 * @param {object} [options]
 * @param {boolean} [options.usePauses] false to fit the length only
 * @returns {{track: object, anchors: object[], matched: number}}
 */
export function fitToAudio(track, analysis, { usePauses = true } = {}) {
  const audioDuration = Math.max(0, Number(analysis?.duration) || 0);
  if (!track.cues.length || track.duration <= 0 || audioDuration <= 0) {
    return { track, anchors: [], matched: 0 };
  }

  if (!usePauses || !analysis?.silences?.length) {
    return { track: fitToDuration(track, audioDuration), anchors: [], matched: 0 };
  }

  const anchors = matchAnchors(restSpans(track), analysis.silences, track.duration, audioDuration);
  return {
    track: applyWarp(track, makeWarp(anchors)),
    anchors,
    matched: Math.max(0, anchors.length - 2),           // the endpoints are not matches
  };
}

/** How well the fit went, in words rather than numbers. */
export function describeFit({ anchors, matched }, analysis) {
  const heard = analysis?.silences?.length ?? 0;
  if (!anchors.length) return 'The track was scaled to the length of the recording.';
  if (!matched) {
    return heard
      ? `No pause in the script lined up with any of the ${heard} gaps heard in the recording, so only the overall length was matched.`
      : 'No gaps were heard in the recording, so only the overall length was matched.';
  }
  return `${matched} of the ${heard} gaps heard in the recording were matched to pauses in the script, and each phrase between them was fitted separately.`;
}
