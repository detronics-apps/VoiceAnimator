/**
 * The pipeline: script text in, a timed track of mouth shapes out.
 *
 * Pure: no DOM, no globals.
 *
 *   text  --parseScript-->  tokens
 *         --wordToPhonemes--> units      (one per sound, plus pauses and cues)
 *         --layout-->        cues        (one per picture, with a start and an end)
 *
 * Everything above this module is one job each and testable on its own; this is the
 * only place that knows the order they go in. `buildTrack` is what the UI calls, and
 * the only thing it needs to hand back besides the cues is enough cross-referencing to
 * highlight the script as it plays and to explain itself in the teaching panel.
 */

import { parseScript } from './scriptparse.js';
import { wordToPhonemes, syllableCount } from './g2p.js';
import { layout, withDefaults, trackStats, REFERENCE_WPM } from './timing.js';
import { visemeFor, getScheme, visemeInfo } from './visemes.js';
import { formatDuration, formatSeconds } from './timecode.js';

/**
 * Flatten a parsed script into the unit stream the timing engine consumes.
 *
 * A written word may be several spoken ones - `1990` is two - but it stays one span in
 * the original text, so every phoneme it produces carries the same character offsets.
 * That is what lets the player highlight `1990` while saying "ninety".
 */
export function buildUnits(parsed, { overrides = {} } = {}) {
  const units = [];
  const words = [];

  for (const [tokenIndex, token] of parsed.tokens.entries()) {
    if (token.type === 'pause') {
      units.push({ kind: 'pause', cause: token.cause, seconds: token.seconds, tokenIndex });
      continue;
    }
    if (token.type === 'expression') {
      units.push({ kind: 'expression', name: token.name, tokenIndex });
      continue;
    }
    if (token.type === 'character') {
      units.push({ kind: 'character', name: token.name, tokenIndex });
      continue;
    }

    const phonemes = [];
    const sources = [];
    for (const spoken of token.words) {
      const result = wordToPhonemes(spoken, { overrides });
      phonemes.push(...result.phonemes);
      sources.push(result.source);
    }

    if (!phonemes.length) continue;

    const wordIndex = words.length;
    words.push({
      index: wordIndex,
      tokenIndex,
      raw: token.raw,
      spoken: token.words,
      phonemes,
      // `override` wherever any part of the word was corrected by hand.
      source: sources.includes('override') ? 'override'
        : sources.every((s) => s === 'lexicon') ? 'lexicon' : 'rules',
      syllables: syllableCount(phonemes),
      charStart: token.start,
      charEnd: token.end,
      line: token.line,
    });

    for (const phoneme of phonemes) {
      units.push({
        kind: 'phoneme',
        phoneme,
        wordIndex,
        tokenIndex,
        raw: token.raw,
        charStart: token.start,
        charEnd: token.end,
      });
    }
  }

  return { units, words };
}

/**
 * Build the whole track.
 *
 * @param {string} text the script
 * @param {object} [options]
 * @param {object} [options.settings] overrides for TIMING_DEFAULTS
 * @param {string} [options.schemeId] which viseme scheme to draw with
 * @param {Record<string,string|string[]>} [options.overrides] pronunciation corrections
 * @returns {object} cues, expressions, duration, plus the words and warnings behind them
 */
export function buildTrack(text, { settings: raw = {}, schemeId = 'chart', overrides = {} } = {}) {
  const settings = withDefaults(raw);
  const scheme = getScheme(schemeId);

  const parsed = parseScript(text);
  const { units, words } = buildUnits(parsed, { overrides });
  const track = layout(units, { settings, schemeId: scheme.id });

  // Give every word the span of the cues that came from it, so clicking a word in the
  // script can seek to it and playback can highlight it.
  const spans = new Map();
  for (const cue of track.cues) {
    if (cue.wordIndex === undefined) continue;
    const span = spans.get(cue.wordIndex);
    if (span) { span.end = Math.max(span.end, cue.end); span.start = Math.min(span.start, cue.start); }
    else spans.set(cue.wordIndex, { start: cue.start, end: cue.end });
  }

  const timedWords = words.map((word) => ({
    ...word,
    visemes: word.phonemes.map((p) => visemeFor(p, scheme.id)),
    start: spans.get(word.index)?.start ?? null,
    end: spans.get(word.index)?.end ?? null,
  }));

  return {
    ...track,
    schemeId: scheme.id,
    settings,
    words: timedWords,
    warnings: parsed.warnings,
    wordCount: parsed.wordCount,
    spokenWordCount: parsed.spokenWordCount,
    stats: trackStats(track),
  };
}

/** An empty track, so the UI has something valid to render before anything is typed. */
export function emptyTrack(schemeId = 'chart', settings = {}) {
  return buildTrack('', { schemeId, settings });
}

/* ---------------------------------------------------------------------------- *
 * Live warnings
 *
 * The house style is to warn as a value crosses a threshold, not to refuse a value at
 * submit time. These are the thresholds that actually matter for lip sync.
 * ---------------------------------------------------------------------------- */

export function trackWarnings(track) {
  const out = [];
  const { settings, stats, cues } = track;

  for (const warning of track.warnings ?? []) {
    out.push({
      level: 'warn',
      text: warning.type === 'unknown-marker'
        ? `${warning.text} is not a cue this app knows, so it was skipped. Try [smile], [angry], [sad], [laughing], [neutral], [pause 0.5] or [as name].`
        : `A “[” on line ${warning.line + 1} is never closed, so it was read as ordinary text.`,
    });
  }

  if (!cues.length) return out;

  const frame = 1 / settings.fps;
  if (settings.minHold < frame * 1.5) {
    out.push({
      level: 'warn',
      text: `A minimum hold of ${formatDuration(settings.minHold)} is under two frames at ${settings.fps} fps. Shapes that brief read as a flicker rather than a movement.`,
    });
  }

  if (track.scale <= 0.36) {
    out.push({
      level: 'danger',
      text: `The script cannot be spoken this fast: at ${settings.wpm} words per minute the sounds would have to be compressed past the point of being readable, so the track is longer than the rate you asked for.`,
    });
  } else if (track.scale >= 2.9) {
    out.push({
      level: 'warn',
      text: `At ${settings.wpm} words per minute every sound is stretched close to three times its natural length. The mouth will look slow rather than slowed.`,
    });
  }

  const restShare = stats.duration > 0 ? stats.restTime / stats.duration : 0;
  if (restShare > 0.5 && stats.duration > 1) {
    out.push({
      level: 'warn',
      text: `${Math.round(restShare * 100)}% of this track is the rest pose. Check the pause settings, or whether the script is mostly blank lines.`,
    });
  }

  if (stats.distinctShapes <= 2 && stats.cueCount > 4) {
    out.push({
      level: 'warn',
      text: 'Only two mouth shapes are used in the whole track. That usually means a pronunciation override has gone wrong.',
    });
  }

  return out;
}

/* ---------------------------------------------------------------------------- *
 * The teaching panel
 *
 * Pure, and therefore testable: the "How this works" text is generated from the track
 * that is actually on screen, not written out by hand and left to go stale.
 * ---------------------------------------------------------------------------- */

/**
 * Work the timing model through with the values currently on screen.
 * @returns {{plain: string, formula: string, worked: string}}
 */
export function explainTiming(track) {
  const { settings, stats, words, scale } = track;
  const wpm = settings.wpm;
  const target = words.length ? (words.length * 60) / wpm : 0;

  const plain =
    'Rhubarb Lip Sync works out its timing by listening to a recording. With no recording to listen to, ' +
    'this tool models it instead. Every sound gets a natural length from the way it is made - a stop like P ' +
    'is brief, a diphthong like OW is long - punctuation buys a pause, and the speech either side is then ' +
    'stretched or squeezed until the whole thing is spoken at the rate you asked for.';

  const formula = [
    'target      = words x 60 / wpm',
    'speechScale = (target - pauses) / naturalSpeech',
    'cue         = phoneme duration x speechScale, snapped to 1 / fps',
    'shapes that repeat merge; nothing is held for less than minHold',
  ].join('\n');

  if (!words.length) {
    return { plain, formula, worked: 'Type a script and this fills in with its own numbers.' };
  }

  const sample = words.find((w) => w.phonemes.length >= 3) ?? words[0];
  const shapes = sample.visemes.map((v) => visemeInfo(track.schemeId, v)?.label ?? v);

  const worked = [
    `${words.length} words at ${wpm} wpm  ->  target ${formatSeconds(target)} s`,
    `pauses ${formatSeconds(stats.restTime)} s  ->  speechScale ${scale.toFixed(2)}x`,
    '',
    `"${sample.raw}"  ->  ${sample.phonemes.join(' ')}`,
    `                 ->  ${shapes.join(' ')}`,
    `                 ->  ${sample.start === null ? 'not timed' : `${formatSeconds(sample.start)} s to ${formatSeconds(sample.end)} s`}`,
    '',
    `${stats.cueCount} cues over ${formatDuration(stats.duration)}, ${stats.distinctShapes} distinct shapes`,
    `shortest cue ${formatDuration(stats.shortestCue)} (minimum ${formatDuration(settings.minHold)}, one frame = ${formatDuration(1 / settings.fps)})`,
  ].join('\n');

  return { plain, formula, worked };
}

/** Why lip sync is tractable at all, in one sentence with this scheme's numbers. */
export function explainVisemes(schemeId) {
  const scheme = getScheme(schemeId);
  const mouths = scheme.visemes.filter((v) => v.kind === 'mouth').length;

  return {
    plain:
      'English has around forty distinguishable sounds and only a handful of distinguishable mouth shapes, ' +
      'because most of the work is done by the tongue and the camera cannot see it. P, B and M are three ' +
      'different sounds and one identical picture. That collapse is what makes lip sync possible: you draw ' +
      `${mouths} pictures, not forty.`,
    formula: `40 phonemes  ->  ${mouths} mouth shapes  (${scheme.name})`,
    worked: scheme.visemes
      .filter((v) => v.kind === 'mouth')
      .map((v) => `${String(v.label).padEnd(10)} ${v.title}${v.letters ? `  (${v.letters})` : ''}`)
      .join('\n'),
  };
}

export { REFERENCE_WPM };
