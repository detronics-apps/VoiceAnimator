import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TIMING_DEFAULTS,
  REFERENCE_WPM,
  withDefaults,
  naturalSeconds,
  speechScale,
  mergeAdjacent,
  enforceMinHold,
  quantiseTrack,
  layout,
  cueAt,
  expressionAt,
  speakerAt,
  trackStats,
} from '../js/timing.js';
import { PHONEME_LIST } from '../js/g2p.js';
import { SCHEME_IDS, visemeFor, restViseme } from '../js/visemes.js';

const EPS = 1e-6;

/** A unit stream for `word`, spelled straight out as phonemes. */
const phonemes = (list, wordIndex = 0) =>
  list.map((phoneme) => ({ kind: 'phoneme', phoneme, wordIndex, raw: 'x', charStart: 0, charEnd: 1 }));

const cue = (start, end, viseme, kind = 'speech') =>
  ({ start, end, viseme, kind, phonemes: ['X'] });

/* --- settings ----------------------------------------------------------- */

test('defaults are complete and sane', () => {
  assert.ok(TIMING_DEFAULTS.wpm > 0 && TIMING_DEFAULTS.fps > 0);
  assert.ok(TIMING_DEFAULTS.minHold > 0);
  for (const cause of ['clause', 'sentence', 'line', 'paragraph']) {
    assert.ok(TIMING_DEFAULTS.pauses[cause] > 0, `no pause length for ${cause}`);
  }
});

// pitfalls.md #8: spreading an incoming slice must not erase a good default.
test('an explicitly undefined setting does not erase its default', () => {
  const merged = withDefaults({ wpm: undefined, fps: null, minHold: 0.1 });
  assert.equal(merged.wpm, TIMING_DEFAULTS.wpm);
  assert.equal(merged.fps, TIMING_DEFAULTS.fps);
  assert.equal(merged.minHold, 0.1);
});

test('a partial pause map keeps the causes it does not mention', () => {
  const merged = withDefaults({ pauses: { sentence: 1 } });
  assert.equal(merged.pauses.sentence, 1);
  assert.equal(merged.pauses.clause, TIMING_DEFAULTS.pauses.clause);
});

/* --- natural durations -------------------------------------------------- */

test('every phoneme has a positive natural length', () => {
  for (const p of PHONEME_LIST) {
    assert.ok(naturalSeconds(p) > 0, `${p} has no duration`);
    assert.ok(naturalSeconds(p) < 1, `${p} is implausibly long`);
  }
});

test('the duration model reflects how sounds are actually made', () => {
  assert.ok(naturalSeconds('OW') > naturalSeconds('AH'), 'a diphthong outlasts a schwa');
  assert.ok(naturalSeconds('S') > naturalSeconds('T'), 'a fricative outlasts a stop');
  assert.ok(naturalSeconds('AA') > naturalSeconds('IH'), 'an open vowel outlasts a short one');
  assert.ok(naturalSeconds('D') < naturalSeconds('K'), 'a voiced stop is briefer');
});

test('an unknown phoneme still gets a length rather than NaN', () => {
  assert.ok(Number.isFinite(naturalSeconds('QQ')) && naturalSeconds('QQ') > 0);
});

/* --- rate scaling ------------------------------------------------------- */

test('the reference rate needs roughly no scaling', () => {
  const units = [...phonemes(['HH', 'EH', 'L', 'OW'], 0), ...phonemes(['W', 'ER', 'L', 'D'], 1)];
  const measured = units.map((u) => ({ ...u, seconds: naturalSeconds(u.phoneme) }));
  const scale = speechScale(measured, withDefaults({ wpm: REFERENCE_WPM }));
  assert.ok(scale > 0.6 && scale < 1.6, `scale was ${scale}, expected near 1`);
});

test('a faster rate compresses and a slower one stretches', () => {
  const units = phonemes(['HH', 'EH', 'L', 'OW']);
  const measured = units.map((u) => ({ ...u, seconds: naturalSeconds(u.phoneme) }));
  const fast = speechScale(measured, withDefaults({ wpm: 240 }));
  const slow = speechScale(measured, withDefaults({ wpm: 90 }));
  assert.ok(fast < slow, 'faster speech should compress relative to slower');
});

test('scaling is clamped rather than allowed to reach zero', () => {
  const units = phonemes(['HH', 'EH', 'L', 'OW']);
  const measured = units.map((u) => ({ ...u, seconds: naturalSeconds(u.phoneme) }));
  assert.ok(speechScale(measured, withDefaults({ wpm: 9999 })) >= 0.35);
  assert.ok(speechScale(measured, withDefaults({ wpm: 1 })) <= 3);
});

test('an empty or silent stream scales by one rather than dividing by zero', () => {
  assert.equal(speechScale([], withDefaults({})), 1);
  assert.equal(speechScale([{ kind: 'pause', seconds: 1 }], withDefaults({})), 1);
});

/* --- rule 1: merging ---------------------------------------------------- */

test('neighbouring cues with the same shape become one', () => {
  const merged = mergeAdjacent([cue(0, 1, 'B'), cue(1, 2, 'B'), cue(2, 3, 'C')]);
  assert.equal(merged.length, 2);
  assert.deepEqual([merged[0].start, merged[0].end], [0, 2]);
  assert.deepEqual(merged[0].phonemes, ['X', 'X']);
});

test('merging does not join cues that are not actually touching', () => {
  const merged = mergeAdjacent([cue(0, 1, 'B'), cue(1.5, 2, 'B')]);
  assert.equal(merged.length, 2);
});

test('merging is idempotent', () => {
  const once = mergeAdjacent([cue(0, 1, 'B'), cue(1, 2, 'B'), cue(2, 3, 'B')]);
  assert.deepEqual(mergeAdjacent(once), once);
});

/* --- rules 2 and 3: minimum hold, and the protected closed mouth --------- */

test('a flickering cue is absorbed by its longer neighbour', () => {
  const held = enforceMinHold([cue(0, 0.5, 'B'), cue(0.5, 0.52, 'C'), cue(0.52, 0.6, 'D')], 0.08);
  assert.ok(!held.some((c) => c.viseme === 'C'), 'the 20ms cue should be gone');
  assert.equal(held[0].start, 0);
  assert.equal(held[held.length - 1].end, 0.6, 'the track length is unchanged');
});

test('absorbing never leaves a gap or an overlap', () => {
  const held = enforceMinHold(
    [cue(0, 0.5, 'B'), cue(0.5, 0.52, 'C'), cue(0.52, 0.54, 'D'), cue(0.54, 1, 'E')], 0.08);
  for (let i = 1; i < held.length; i += 1) {
    assert.ok(Math.abs(held[i].start - held[i - 1].end) < EPS,
      `gap between cue ${i - 1} and ${i}`);
  }
});

test('the closed mouth is never absorbed, however brief', () => {
  const protectedSet = new Set(['A']);
  const held = enforceMinHold(
    [cue(0, 0.5, 'B'), cue(0.5, 0.51, 'A'), cue(0.51, 1, 'C')], 0.08, protectedSet);
  const closed = held.find((c) => c.viseme === 'A');
  assert.ok(closed, 'the closed mouth was dropped');
  assert.ok(closed.end - closed.start >= 0.08 - EPS,
    `closed mouth is only ${closed.end - closed.start}s`);
});

test('borrowing time for a closed mouth takes it from both sides and keeps the total', () => {
  const held = enforceMinHold(
    [cue(0, 0.5, 'B'), cue(0.5, 0.51, 'A'), cue(0.51, 1, 'C')], 0.08, new Set(['A']));
  assert.equal(held[0].start, 0);
  assert.equal(held[held.length - 1].end, 1);
  for (let i = 1; i < held.length; i += 1) {
    assert.ok(Math.abs(held[i].start - held[i - 1].end) < EPS, 'boundary broke');
  }
});

test('a single cue is left alone however short it is', () => {
  const held = enforceMinHold([cue(0, 0.01, 'A')], 0.08, new Set(['A']));
  assert.equal(held.length, 1);
  assert.equal(held[0].end, 0.01);
});

test('a track with no slack anywhere still terminates', () => {
  const cues = Array.from({ length: 20 }, (_, i) => cue(i * 0.01, (i + 1) * 0.01, `V${i}`));
  const held = enforceMinHold(cues, 0.5);
  assert.ok(held.length >= 1);
  assert.equal(held[0].start, 0);
  assert.equal(held[held.length - 1].end, 0.2);
});

/* --- quantisation ------------------------------------------------------- */

test('every boundary lands on the frame grid', () => {
  const fps = 24;
  const snapped = quantiseTrack(
    [cue(0, 0.137, 'B'), cue(0.137, 0.402, 'C'), cue(0.402, 0.913, 'D')], fps);
  for (const c of snapped) {
    for (const t of [c.start, c.end]) {
      assert.ok(Math.abs(t * fps - Math.round(t * fps)) < 1e-9, `${t} is not on the grid`);
    }
  }
});

test('quantised cues stay contiguous and in order', () => {
  const snapped = quantiseTrack(
    [cue(0, 0.02, 'B'), cue(0.02, 0.05, 'C'), cue(0.05, 0.9, 'D')], 24);
  for (let i = 1; i < snapped.length; i += 1) {
    assert.equal(snapped[i].start, snapped[i - 1].end);
  }
  assert.ok(snapped.every((c) => c.end > c.start), 'a zero-length cue survived');
});

test('no cue rounds away to nothing - each keeps a whole frame', () => {
  const snapped = quantiseTrack(
    [cue(0, 0.5, 'B'), cue(0.5, 0.505, 'A'), cue(0.505, 1, 'C')], 24);
  assert.equal(snapped.length, 3, 'a shape was lost to rounding');
  for (const c of snapped) {
    assert.ok(c.end - c.start >= 1 / 24 - 1e-9, `${c.viseme} is under a frame`);
  }
});

test('quantising an empty track is an empty track', () => {
  assert.deepEqual(quantiseTrack([], 24), []);
});

/* --- layout, end to end ------------------------------------------------- */

const HELLO = [
  ...phonemes(['HH', 'EH', 'L', 'OW'], 0),
  { kind: 'pause', cause: 'clause' },
  ...phonemes(['W', 'ER', 'L', 'D'], 1),
];

test('an empty unit stream lays out as an empty track', () => {
  const track = layout([]);
  assert.deepEqual(track.cues, []);
  assert.equal(track.duration, 0);
});

test('a laid-out track is contiguous, ordered and non-empty', () => {
  for (const schemeId of SCHEME_IDS) {
    const { cues, duration } = layout(HELLO, { schemeId });
    assert.ok(cues.length > 0, `${schemeId} produced no cues`);
    assert.equal(cues[0].start, 0, `${schemeId} does not start at zero`);
    assert.ok(Math.abs(cues[cues.length - 1].end - duration) < EPS, `${schemeId} duration mismatch`);
    for (let i = 1; i < cues.length; i += 1) {
      assert.ok(Math.abs(cues[i].start - cues[i - 1].end) < EPS, `${schemeId} gap at cue ${i}`);
      assert.ok(cues[i].end > cues[i].start, `${schemeId} zero-length cue at ${i}`);
    }
  }
});

test('the track opens and closes on the rest pose', () => {
  for (const schemeId of SCHEME_IDS) {
    const { cues } = layout(HELLO, { schemeId });
    assert.equal(cues[0].viseme, restViseme(schemeId), `${schemeId} does not open at rest`);
    assert.equal(cues[cues.length - 1].viseme, restViseme(schemeId), `${schemeId} does not close at rest`);
  }
});

test('every cue names a shape the scheme can actually draw', () => {
  for (const schemeId of SCHEME_IDS) {
    const scheme = SCHEME_IDS.includes(schemeId);
    assert.ok(scheme);
    for (const c of layout(HELLO, { schemeId }).cues) {
      assert.ok(c.viseme, 'a cue has no shape');
    }
  }
});

test('the closed mouth in a P survives the whole pipeline', () => {
  const units = phonemes(['P', 'AA', 'P', 'AA', 'P']);
  for (const schemeId of SCHEME_IDS) {
    const closed = visemeFor('P', schemeId);
    const { cues } = layout(units, { schemeId, settings: { wpm: 300 } });
    const count = cues.filter((c) => c.viseme === closed).length;
    assert.ok(count >= 3, `${schemeId} kept only ${count} of the three closed mouths`);
  }
});

test('no cue in a quantised track is shorter than one frame', () => {
  const settings = { fps: 24, quantise: true };
  const { cues } = layout(HELLO, { settings });
  for (const c of cues) {
    assert.ok(c.end - c.start >= 1 / 24 - 1e-9, `a cue is only ${c.end - c.start}s`);
  }
});

test('a faster rate produces a shorter track', () => {
  const slow = layout(HELLO, { settings: { wpm: 100 } }).duration;
  const fast = layout(HELLO, { settings: { wpm: 220 } }).duration;
  assert.ok(fast < slow, `${fast} was not shorter than ${slow}`);
});

test('a longer pause setting produces a longer track', () => {
  const base = layout(HELLO, { settings: { pauses: { clause: 0.1 } } }).duration;
  const roomy = layout(HELLO, { settings: { pauses: { clause: 1.5 } } }).duration;
  assert.ok(roomy > base);
});

test('a short pause holds the last shape; a long one returns to rest', () => {
  const schemeId = 'chart';
  const rest = restViseme(schemeId);
  const short = layout(HELLO, { schemeId, settings: { restAfter: 5, pauses: { clause: 0.2 } } });
  const long = layout(HELLO, { schemeId, settings: { restAfter: 0.05, pauses: { clause: 1 } } });

  // Interior rest cues only - the lead-in and tail are always rest.
  const interiorRests = (track) =>
    track.cues.slice(1, -1).filter((c) => c.kind === 'rest' && c.viseme === rest).length;

  assert.equal(interiorRests(short), 0, 'a short pause should not return to rest');
  assert.ok(interiorRests(long) > 0, 'a long pause should return to rest');
});

test('the lead-in and tail can be switched off', () => {
  const { cues } = layout(HELLO, { settings: { leadIn: 0, tailOut: 0 } });
  assert.notEqual(cues[0].kind, 'rest');
});

/* --- expressions -------------------------------------------------------- */

test('an expression cue opens a span that runs to the end', () => {
  const units = [
    { kind: 'expression', name: 'smile' },
    ...phonemes(['HH', 'EH', 'L', 'OW']),
  ];
  const { expressions, duration } = layout(units, { schemeId: 'chart' });
  assert.equal(expressions.length, 1);
  assert.equal(expressions[0].name, 'smile');
  assert.ok(Math.abs(expressions[0].end - duration) < 0.1);
});

test('neutral closes an expression rather than opening one', () => {
  const units = [
    { kind: 'expression', name: 'smile' },
    ...phonemes(['HH', 'EH'], 0),
    { kind: 'expression', name: 'neutral' },
    ...phonemes(['L', 'OW'], 1),
  ];
  const { expressions } = layout(units, { schemeId: 'chart' });
  assert.equal(expressions.length, 1);
  assert.ok(expressions[0].end < layout(units, { schemeId: 'chart' }).duration);
});

test('no expression span outlives the track', () => {
  const units = [{ kind: 'expression', name: 'angry' }, ...phonemes(['AA'])];
  const track = layout(units, { schemeId: 'chart' });
  for (const span of track.expressions) {
    assert.ok(span.end <= track.duration + EPS);
    assert.ok(span.start >= 0);
  }
});

/* --- reading a track back ----------------------------------------------- */

test('cueAt finds the cue covering an instant', () => {
  const cues = [cue(0, 1, 'A'), cue(1, 2, 'B'), cue(2, 3, 'C')];
  assert.equal(cueAt(cues, 0).viseme, 'A');
  assert.equal(cueAt(cues, 0.999).viseme, 'A');
  assert.equal(cueAt(cues, 1).viseme, 'B');
  assert.equal(cueAt(cues, 2.5).viseme, 'C');
});

test('cueAt holds the last shape past the end and the first before the start', () => {
  const cues = [cue(0, 1, 'A'), cue(1, 2, 'B')];
  assert.equal(cueAt(cues, 99).viseme, 'B');
  assert.equal(cueAt(cues, -5).viseme, 'A');
  assert.equal(cueAt([], 0), null);
});

test('cueAt agrees with a linear scan at every frame of a real track', () => {
  const track = layout(HELLO, { schemeId: 'chart' });
  const linear = (t) => track.cues.find((c) => t >= c.start && t < c.end) ?? null;
  for (let f = 0; f < track.duration * 24; f += 1) {
    const t = f / 24 + 1e-9;
    const expected = linear(t);
    if (!expected) continue;
    assert.equal(cueAt(track.cues, t), expected, `disagreement at frame ${f}`);
  }
});

test('expressionAt reports the running expression', () => {
  const spans = [{ start: 0, end: 1, name: 'smile' }, { start: 2, end: 3, name: 'sad' }];
  assert.equal(expressionAt(spans, 0.5), 'smile');
  assert.equal(expressionAt(spans, 1.5), null);
  assert.equal(expressionAt(spans, 2.5), 'sad');
  assert.equal(expressionAt([], 0), null);
});

/* --- stats -------------------------------------------------------------- */

test('the stats add up to the track', () => {
  const track = layout(HELLO, { schemeId: 'chart' });
  const stats = trackStats(track);
  assert.equal(stats.cueCount, track.cues.length);
  assert.equal(stats.speechCues + stats.restCues, stats.cueCount);
  assert.ok(Math.abs(stats.speechTime + stats.restTime - stats.duration) < 1e-6);
  assert.ok(stats.shortestCue > 0);
  assert.ok(stats.averageCue >= stats.shortestCue - EPS);
});

test('stats on an empty track are zeroes, not NaN', () => {
  const stats = trackStats({ cues: [], duration: 0 });
  assert.equal(stats.cueCount, 0);
  assert.equal(stats.averageCue, 0);
  assert.equal(stats.shortestCue, 0);
});

/* --- speaker spans ------------------------------------------------------- */

test('a speaker cue opens a span that runs to the end', () => {
  const units = [{ kind: 'character', name: 'bob' }, ...phonemes(['HH', 'EH', 'L', 'OW'])];
  const { speakers, duration } = layout(units, { schemeId: 'chart' });
  assert.equal(speakers.length, 1);
  assert.equal(speakers[0].name, 'bob');
  assert.ok(Math.abs(speakers[0].end - duration) < 0.1);
});

test('two speakers divide the track between them without overlapping', () => {
  const units = [
    { kind: 'character', name: 'bob' },
    ...phonemes(['HH', 'EH', 'L', 'OW'], 0),
    { kind: 'pause', cause: 'sentence' },
    { kind: 'character', name: 'alice' },
    ...phonemes(['HH', 'AY'], 1),
  ];
  const track = layout(units, { schemeId: 'chart' });
  assert.deepEqual(track.speakers.map((s) => s.name), ['bob', 'alice']);
  assert.ok(track.speakers[0].end <= track.speakers[1].start + EPS, 'speakers overlap');
  for (const span of track.speakers) {
    assert.ok(span.start >= 0 && span.end <= track.duration + EPS);
    assert.ok(span.end > span.start);
  }
});

test('a track with no speaker cue has no speaker spans', () => {
  assert.deepEqual(layout(HELLO, { schemeId: 'chart' }).speakers, []);
  assert.deepEqual(layout([]).speakers, []);
});

test('speakerAt reports who is talking', () => {
  const spans = [{ start: 0, end: 1, name: 'bob' }, { start: 1, end: 2, name: 'alice' }];
  assert.equal(speakerAt(spans, 0.5), 'bob');
  assert.equal(speakerAt(spans, 1.5), 'alice');
  assert.equal(speakerAt(spans, 9), null);
  assert.equal(speakerAt([], 0), null);
  assert.equal(speakerAt(undefined, 0), null);
});
