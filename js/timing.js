/**
 * Turning a sequence of sounds into a sequence of timed mouth shapes.
 *
 * Pure: no DOM, no globals.
 *
 * This is the part Rhubarb Lip Sync does by listening to a recording. With no recording
 * to listen to, the timing is *modelled* instead: every phoneme is given a natural
 * length from its articulatory class, the whole line is then scaled so it is spoken at
 * the rate you asked for, and punctuation buys the pauses.
 *
 * The output is deliberately the same shape as Rhubarb's - a contiguous run of cues,
 * each one a shape and the span it is held for - so the exports drop straight into the
 * same pipelines. What differs is the honesty of the numbers: a modelled track is a
 * good first pass that you then nudge, not a measurement. If you have the recording,
 * `fitToDuration` and `alignToSilences` in `js/envelope.js` pull the model onto it.
 *
 * Four rules do most of the visible work:
 *
 *   1. Neighbouring sounds that look the same are one shape, not two. `test` is
 *      T-EH-S-T but only three pictures, because the S and the final T are identical.
 *   2. No shape is shown for less than `minHold`. Below about two frames the eye reads
 *      a flicker rather than a movement.
 *   3. The closed mouth is never dropped. A missing P reads as broken dubbing, so it
 *      borrows time from its neighbours rather than being absorbed by them.
 *   4. Short pauses hold the last shape; only a real gap returns to rest. Nobody
 *      resets their face to neutral for a comma.
 */

import { PHONEMES, isVowel } from './g2p.js';
import { visemeFor, restViseme, expressionViseme, getScheme } from './visemes.js';
import { quantiseToFrame } from './timecode.js';

/** Floating-point slack, in seconds. Well below one frame at any sane rate. */
const EPS = 1e-6;

/**
 * The speaking rate the natural durations below are written for. Everything is scaled
 * from here, so changing a number in `CLASS_MS` changes a shape's *proportion* of the
 * line rather than the length of the line.
 */
export const REFERENCE_WPM = 150;

/** Natural length in milliseconds, by articulatory class, at the reference rate. */
const CLASS_MS = {
  vowel: 105,
  diphthong: 150,
  stop: 60,
  affricate: 95,
  fricative: 95,
  nasal: 75,
  liquid: 70,
  glide: 65,
  silence: 200,
};

/**
 * Per-phoneme corrections. A schwa is the shortest vowel in English and `AA` is one of
 * the longest; treating them both as "a vowel" makes every line sound metronomic.
 */
const PHONEME_MS = {
  AH: 70, IH: 80, UH: 85, EH: 95, AE: 115, AA: 130, AO: 125, ER: 130,
  IY: 115, UW: 120,
  // A held S or SH is much longer than a brief F.
  S: 110, SH: 115, Z: 100, F: 85, V: 80, TH: 85, DH: 70, HH: 55,
  // Voiced stops are shorter than voiceless ones.
  B: 55, D: 50, G: 55, P: 70, T: 65, K: 70,
};

export const TIMING_DEFAULTS = Object.freeze({
  /** Speaking rate. 150 is conversational; a voice-over read is nearer 130. */
  wpm: 150,
  /** Frame rate the cues are snapped to. */
  fps: 24,
  /** Shortest a shape may be held. Two frames at 24fps. */
  minHold: 0.083,
  /** Snap every boundary onto the frame grid. */
  quantise: true,
  /** Silence at the head of the track, so the character does not open mid-word. */
  leadIn: 0.2,
  /** Silence at the tail, so the track ends on the rest pose rather than mid-vowel. */
  tailOut: 0.25,
  /** A pause longer than this returns to the rest pose; shorter ones hold. */
  restAfter: 0.3,
  /** How long each kind of punctuation is worth, in seconds. */
  pauses: Object.freeze({ clause: 0.18, sentence: 0.42, line: 0.3, paragraph: 0.7 }),
  /** The vowel before a pause is drawn out by this factor. */
  emphasiseFinal: 1.3,
});

/** Merge user settings over the defaults without letting an absent key erase one. */
export function withDefaults(settings = {}) {
  const merged = { ...TIMING_DEFAULTS, ...settings };
  for (const [key, value] of Object.entries(TIMING_DEFAULTS)) {
    if (merged[key] === undefined || merged[key] === null) merged[key] = value;
  }
  merged.pauses = { ...TIMING_DEFAULTS.pauses, ...(settings.pauses ?? {}) };
  return merged;
}

/** Natural length of one phoneme in seconds, before the line is scaled. */
export function naturalSeconds(phoneme) {
  const specific = PHONEME_MS[phoneme];
  if (specific) return specific / 1000;
  const info = PHONEMES[phoneme];
  return (CLASS_MS[info?.class] ?? CLASS_MS.vowel) / 1000;
}

/* ---------------------------------------------------------------------------- *
 * Step 1 - natural durations
 * ---------------------------------------------------------------------------- */

/**
 * How long each pause token is worth. An explicit `[pause 1.5]` says so; punctuation
 * looks its cause up in the settings.
 */
function pauseSeconds(unit, settings) {
  if (Number.isFinite(unit.seconds)) return Math.max(0, unit.seconds);
  return settings.pauses[unit.cause] ?? settings.pauses.clause;
}

/**
 * Assign every unit its natural, unscaled length, and mark the last vowel before each
 * pause so it can be drawn out.
 */
function measure(units, settings) {
  const measured = units.map((unit) => {
    if (unit.kind === 'phoneme') return { ...unit, seconds: naturalSeconds(unit.phoneme) };
    if (unit.kind === 'pause') return { ...unit, seconds: pauseSeconds(unit, settings) };
    return { ...unit, seconds: 0 };
  });

  // Phrase-final lengthening: search back from each pause for the nearest vowel.
  const factor = Math.max(1, Number(settings.emphasiseFinal) || 1);
  if (factor > 1) {
    for (let i = 0; i < measured.length; i += 1) {
      const isFinal = measured[i].kind === 'pause' || i === measured.length - 1;
      if (!isFinal) continue;
      for (let j = i - (measured[i].kind === 'pause' ? 1 : 0); j >= 0; j -= 1) {
        if (measured[j].kind !== 'phoneme') break;
        if (isVowel(measured[j].phoneme)) { measured[j].seconds *= factor; break; }
      }
    }
  }

  return measured;
}

/**
 * Scale speech - but not pauses - so the whole thing lands on the requested rate.
 *
 * Words per minute is understood the way a presenter means it: pauses included. So the
 * target total is `words x 60 / wpm`, the pauses are subtracted from it, and whatever
 * is left is what the speech gets.
 */
export function speechScale(measured, settings) {
  const wpm = Math.max(20, Math.min(400, Number(settings.wpm) || REFERENCE_WPM));

  const words = new Set(
    measured.filter((u) => u.kind === 'phoneme' && u.wordIndex !== undefined)
      .map((u) => u.wordIndex),
  ).size;
  if (!words) return 1;

  const speech = measured.reduce((sum, u) => sum + (u.kind === 'phoneme' ? u.seconds : 0), 0);
  if (speech <= 0) return 1;

  const pauses = measured.reduce((sum, u) => sum + (u.kind === 'pause' ? u.seconds : 0), 0);
  const target = (words * 60) / wpm;

  // A script that is mostly pauses cannot also hit its words-per-minute target. Speech
  // is clamped to a readable range rather than being squeezed to nothing.
  return Math.max(0.35, Math.min(3, (target - pauses) / speech));
}

/* ---------------------------------------------------------------------------- *
 * Step 2 - lay the units out as cues
 * ---------------------------------------------------------------------------- */

/**
 * @typedef {object} Cue
 * @property {number} start seconds
 * @property {number} end seconds
 * @property {string} viseme
 * @property {'speech'|'rest'} kind
 * @property {string[]} phonemes every sound drawn with this shape
 * @property {string} [word] the written word it came from
 * @property {number} [charStart] offset into the original script, for highlighting
 * @property {number} [charEnd]
 */

function layoutCues(measured, scale, settings, schemeId) {
  const rest = restViseme(schemeId);
  const cues = [];
  const expressions = [];

  let time = Math.max(0, Number(settings.leadIn) || 0);
  let expression = null;
  let speaker = null;

  if (time > 0) {
    cues.push({ start: 0, end: time, viseme: rest, kind: 'rest', phonemes: ['sil'] });
  }

  const openExpression = (name, at) => {
    if (expressions.length) expressions[expressions.length - 1].end = at;
    if (name) expressions.push({ start: at, end: at, name });
    expression = name;
  };

  const speakers = [];
  const openSpeaker = (name, at) => {
    if (speakers.length) speakers[speakers.length - 1].end = at;
    if (name) speakers.push({ start: at, end: at, name });
    speaker = name;
  };

  for (const unit of measured) {
    if (unit.kind === 'character') {
      openSpeaker(unit.name, time);
      continue;
    }
    if (unit.kind === 'expression') {
      // `neutral` and `rest` clear whatever was set.
      const name = unit.name === 'neutral' || unit.name === 'rest' ? null : unit.name;
      openExpression(name, time);
      continue;
    }

    const seconds = unit.seconds * (unit.kind === 'phoneme' ? scale : 1);
    if (seconds <= 0) continue;

    if (unit.kind === 'pause') {
      const previous = cues[cues.length - 1];
      // Rule 4: a short pause holds the shape you were already making.
      const holds = seconds < settings.restAfter && previous;
      const viseme = holds
        ? previous.viseme
        : (expressionViseme(expression, schemeId) ?? rest);

      cues.push({
        start: time,
        end: time + seconds,
        viseme,
        kind: holds ? 'speech' : 'rest',
        phonemes: ['sil'],
        cause: unit.cause,
      });
    } else {
      cues.push({
        start: time,
        end: time + seconds,
        viseme: visemeFor(unit.phoneme, schemeId),
        kind: 'speech',
        phonemes: [unit.phoneme],
        word: unit.raw,
        wordIndex: unit.wordIndex,
        charStart: unit.charStart,
        charEnd: unit.charEnd,
      });
    }

    time += seconds;
  }

  // Close on the rest pose. A track that stops mid-vowel leaves the character frozen
  // with its mouth open, which reads as a crash rather than an ending.
  const tail = Math.max(0, Number(settings.tailOut) || 0);
  if (tail > 0 && cues.length) {
    cues.push({
      start: time,
      end: time + tail,
      viseme: expressionViseme(expression, schemeId) ?? rest,
      kind: 'rest',
      phonemes: ['sil'],
      cause: 'end',
    });
    time += tail;
  }

  // Only an expression that is still running at the end runs to the end. A span closed
  // by [neutral] keeps the end it was given.
  if (expression && expressions.length) expressions[expressions.length - 1].end = time;
  if (speaker && speakers.length) speakers[speakers.length - 1].end = time;

  return { cues, expressions, speakers, duration: time };
}

/* ---------------------------------------------------------------------------- *
 * Step 3 - the four rules
 * ---------------------------------------------------------------------------- */

/** Rule 1: neighbouring cues drawn with the same picture are one cue. */
export function mergeAdjacent(cues) {
  const out = [];
  for (const cue of cues) {
    const previous = out[out.length - 1];
    if (previous && previous.viseme === cue.viseme &&
        Math.abs(previous.end - cue.start) < EPS) {
      previous.end = cue.end;
      previous.phonemes = [...previous.phonemes, ...cue.phonemes];
      // A merged cue keeps the first word it belonged to, so highlighting does not
      // jump backwards, but it stops claiming to be pure speech if a rest joined it.
      if (cue.kind === 'rest') previous.kind = previous.kind === 'rest' ? 'rest' : 'speech';
      if (previous.charEnd !== undefined && cue.charEnd !== undefined) {
        previous.charEnd = cue.charEnd;
      }
      continue;
    }
    out.push({ ...cue });
  }
  return out;
}

/**
 * Rules 2 and 3: nothing flickers, and the closed mouth survives.
 *
 * Two passes, and the split between them matters more than it looks.
 *
 * **Pass 1 absorbs**, but only cues below `absorbBelow` - genuinely sub-frame artefacts.
 * Absorbing everything under `minHold` looks equivalent and is not: on a script the
 * requested rate cannot accommodate, every cue is under the minimum, and each absorption
 * makes its neighbour longer and therefore a better target for the next one. The whole
 * track cascades into a single held shape. Three guards stop that:
 *
 *   - a protected shape is never absorbed at all;
 *   - a cue whose neighbours are the same shape is never absorbed, because removing it
 *     would silently merge two shapes that were deliberately separate - the vowel
 *     between two P's is exactly this case;
 *   - nothing is ever absorbed *into* a rest. Silence must not eat speech.
 *
 * **Pass 2 borrows.** Anything still short takes time from neighbours that can spare it.
 * Where there is no slack the cue simply stays short, and quantisation gives it a frame.
 */
export function enforceMinHold(cues, minHold, protectedVisemes = new Set(), absorbBelow = null) {
  const hold = Math.max(0, Number(minHold) || 0);
  if (hold <= 0 || cues.length < 2) return cues.map((c) => ({ ...c }));

  const floor = Number.isFinite(absorbBelow) ? absorbBelow : hold / 3;
  let work = cues.map((c) => ({ ...c }));
  const length = (cue) => cue.end - cue.start;

  // Pass 1 - absorb.
  let changed = true;
  let guard = work.length * 4;
  while (changed && work.length > 1 && guard > 0) {
    changed = false;
    guard -= 1;
    for (let i = 0; i < work.length; i += 1) {
      if (length(work[i]) >= floor - EPS) continue;
      if (protectedVisemes.has(work[i].viseme)) continue;

      const left = work[i - 1];
      const right = work[i + 1];
      if (!left && !right) break;
      // Removing this cue would join two cues drawn with the same picture.
      if (left && right && left.viseme === right.viseme) continue;

      // Silence never swallows speech.
      const leftOk = left && !(left.kind === 'rest' && work[i].kind !== 'rest');
      const rightOk = right && !(right.kind === 'rest' && work[i].kind !== 'rest');
      if (!leftOk && !rightOk) continue;

      const intoLeft = leftOk && (!rightOk || length(left) >= length(right));
      if (intoLeft) {
        left.end = work[i].end;
        left.phonemes = [...left.phonemes, ...work[i].phonemes];
      } else {
        right.start = work[i].start;
        right.phonemes = [...work[i].phonemes, ...right.phonemes];
      }
      work.splice(i, 1);
      changed = true;
      break;
    }
  }

  work = mergeAdjacent(work);

  // Pass 2 - borrow, for whatever is still too short.
  for (let i = 0; i < work.length; i += 1) {
    const need = hold - length(work[i]);
    if (need <= EPS) continue;

    const left = work[i - 1];
    const right = work[i + 1];
    const leftSlack = left ? Math.max(0, length(left) - hold) : 0;
    const rightSlack = right ? Math.max(0, length(right) - hold) : 0;
    const slack = leftSlack + rightSlack;
    if (slack <= EPS) continue;

    const take = Math.min(need, slack);
    const fromLeft = take * (leftSlack / slack);
    const fromRight = take - fromLeft;

    if (fromLeft > 0) { left.end -= fromLeft; work[i].start -= fromLeft; }
    if (fromRight > 0) { right.start += fromRight; work[i].end += fromRight; }
  }

  return work;
}

/**
 * Snap every boundary onto the frame grid.
 *
 * Every cue that reached this point survived the minimum-hold pass on purpose, so none
 * of them is allowed to round away to nothing: each gets at least one whole frame and
 * the rest of the track shuffles along behind it. A track one or two frames longer than
 * the model predicted is invisible; a missing closed mouth is not.
 */
export function quantiseTrack(cues, fps) {
  if (!cues.length) return [];
  const rate = Number(fps) > 0 ? Number(fps) : 24;
  const frame = 1 / rate;

  const bounds = [cues[0].start, ...cues.map((c) => c.end)].map((t) => quantiseToFrame(t, rate));

  for (let i = 1; i < bounds.length; i += 1) {
    if (bounds[i] - bounds[i - 1] < frame - EPS) bounds[i] = bounds[i - 1] + frame;
  }

  const out = cues.map((c, i) => ({ ...c, start: bounds[i], end: bounds[i + 1] }));

  // Snapping can bring two identical shapes flush against each other.
  return mergeAdjacent(out);
}

/* ---------------------------------------------------------------------------- *
 * The public entry point
 * ---------------------------------------------------------------------------- */

/**
 * Lay a unit stream out as a timed track.
 *
 * @param {object[]} units `{kind:'phoneme'|'pause'|'expression', ...}` from js/lipsync.js
 * @param {object} [options]
 * @param {object} [options.settings] overrides for TIMING_DEFAULTS
 * @param {string} [options.schemeId] which viseme scheme to draw with
 * @returns {{cues: Cue[], expressions: object[], duration: number, scale: number}}
 */
export function layout(units, { settings: raw = {}, schemeId = 'chart' } = {}) {
  const settings = withDefaults(raw);
  const scheme = getScheme(schemeId);

  if (!units.length) return { cues: [], expressions: [], speakers: [], duration: 0, scale: 1 };

  // Rule 3's protected set: whatever this scheme draws a P with.
  const protectedVisemes = new Set([visemeFor('P', scheme.id)]);

  const measured = measure(units, settings);
  const scale = speechScale(measured, settings);

  let { cues, expressions, speakers, duration } = layoutCues(measured, scale, settings, scheme.id);

  // Below half a frame a cue is an artefact of the model, not a shape anyone will see.
  const absorbBelow = Math.min(settings.minHold / 3, 0.5 / settings.fps);

  cues = mergeAdjacent(cues);
  cues = enforceMinHold(cues, settings.minHold, protectedVisemes, absorbBelow);
  if (settings.quantise) cues = quantiseTrack(cues, settings.fps);

  duration = cues.length ? cues[cues.length - 1].end : 0;
  for (const span of [...expressions, ...speakers]) span.end = Math.min(span.end, duration);

  return { cues, expressions, speakers, duration, scale };
}

/* ---------------------------------------------------------------------------- *
 * Reading a track back
 * ---------------------------------------------------------------------------- */

/** Which cue is on screen at `time`. Binary search: the player calls this every frame. */
export function cueAt(cues, time) {
  let low = 0;
  let high = cues.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (time < cues[mid].start) high = mid - 1;
    else if (time >= cues[mid].end) low = mid + 1;
    else return cues[mid];
  }
  // Past the end, hold the last shape rather than blanking the face.
  if (cues.length && time >= cues[cues.length - 1].end) return cues[cues.length - 1];
  return cues[0] ?? null;
}

/** Which expression is running at `time`, if any. */
export function expressionAt(expressions, time) {
  for (const span of expressions) {
    if (time >= span.start && time < span.end) return span.name;
  }
  return null;
}

/** Which character is speaking at `time`, if the script named one. */
export function speakerAt(speakers, time) {
  for (const span of speakers ?? []) {
    if (time >= span.start && time < span.end) return span.name;
  }
  return null;
}

/** Summary numbers for the readout and the teaching panel. */
export function trackStats(track) {
  const { cues, duration } = track;
  const speech = cues.filter((c) => c.kind === 'speech');
  const held = cues.reduce((sum, c) => sum + (c.end - c.start), 0);
  const shapes = new Set(cues.map((c) => c.viseme));

  const shortest = cues.reduce((min, c) => Math.min(min, c.end - c.start), Infinity);

  return {
    cueCount: cues.length,
    speechCues: speech.length,
    restCues: cues.length - speech.length,
    distinctShapes: shapes.size,
    duration,
    speechTime: speech.reduce((sum, c) => sum + (c.end - c.start), 0),
    restTime: held - speech.reduce((sum, c) => sum + (c.end - c.start), 0),
    shortestCue: Number.isFinite(shortest) ? shortest : 0,
    averageCue: cues.length ? held / cues.length : 0,
  };
}
