import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rmsFrames,
  toMono,
  detectSilences,
  speechBounds,
  restSpans,
  matchAnchors,
  makeWarp,
  warpCues,
  applyWarp,
  fitToDuration,
  fitToAudio,
  describeFit,
} from '../js/envelope.js';
import { buildTrack } from '../js/lipsync.js';

const EPS = 1e-6;
const RATE = 8000;

/** A synthetic take: alternating loud and quiet stretches, in seconds. */
function synth(pattern, rate = RATE) {
  const out = [];
  for (const [seconds, level] of pattern) {
    const count = Math.round(seconds * rate);
    for (let i = 0; i < count; i += 1) out.push(level * Math.sin(i * 0.7));
  }
  return out;
}

/* --- the envelope ------------------------------------------------------- */

test('RMS frames cover the signal at the requested rate', () => {
  const frames = rmsFrames(synth([[1, 0.5]]), RATE, 0.02);
  assert.equal(frames.length, 50);
  assert.ok(frames.every((f) => f >= 0), 'RMS cannot be negative');
});

test('a louder signal gives a higher RMS', () => {
  const quiet = rmsFrames(synth([[0.2, 0.1]]), RATE)[3];
  const loud = rmsFrames(synth([[0.2, 0.9]]), RATE)[3];
  assert.ok(loud > quiet * 5, `${loud} was not much louder than ${quiet}`);
});

test('silence measures as very nearly zero', () => {
  assert.ok(Math.max(...rmsFrames(synth([[0.5, 0]]), RATE)) < 1e-9);
});

test('bad input gives an empty envelope, not a crash', () => {
  assert.deepEqual(rmsFrames([], RATE), []);
  assert.deepEqual(rmsFrames(null, RATE), []);
  assert.deepEqual(rmsFrames(synth([[1, 0.5]]), 0), []);
  assert.deepEqual(rmsFrames(synth([[1, 0.5]]), -100), []);
});

test('stereo mixes down to one channel', () => {
  const left = Float32Array.from([1, 1, 1]);
  const right = Float32Array.from([-1, 0, 1]);
  assert.deepEqual([...toMono([left, right])], [0, 0.5, 1]);
  assert.equal(toMono([left]), left);
  assert.deepEqual(toMono([]), []);
});

test('mixing down uses the shorter channel rather than reading past the end', () => {
  const mono = toMono([Float32Array.from([1, 1, 1, 1]), Float32Array.from([1, 1])]);
  assert.equal(mono.length, 2);
  assert.ok([...mono].every(Number.isFinite));
});

/* --- silence detection -------------------------------------------------- */

const TAKE = synth([[0.4, 0.6], [0.5, 0], [0.6, 0.6], [0.3, 0], [0.4, 0.6]]);

test('silences are found where they were put', () => {
  const silences = detectSilences(rmsFrames(TAKE, RATE), 0.02);
  assert.equal(silences.length, 2);
  assert.ok(Math.abs(silences[0].start - 0.4) < 0.05, `first gap at ${silences[0].start}`);
  assert.ok(Math.abs(silences[0].end - 0.9) < 0.05);
  assert.ok(Math.abs(silences[1].start - 1.5) < 0.05);
});

test('silences are in order, do not overlap and have positive length', () => {
  const silences = detectSilences(rmsFrames(TAKE, RATE), 0.02);
  for (let i = 0; i < silences.length; i += 1) {
    assert.ok(silences[i].end > silences[i].start);
    assert.ok(Math.abs(silences[i].seconds - (silences[i].end - silences[i].start)) < EPS);
    if (i) assert.ok(silences[i].start >= silences[i - 1].end, 'silences overlap');
  }
});

test('a gap shorter than the minimum is not a pause', () => {
  const frames = rmsFrames(synth([[0.4, 0.6], [0.05, 0], [0.4, 0.6]]), RATE);
  assert.deepEqual(detectSilences(frames, 0.02, { minSilence: 0.12 }), []);
  assert.equal(detectSilences(frames, 0.02, { minSilence: 0.03 }).length, 1);
});

test('a quiet recording is not one long silence', () => {
  const frames = rmsFrames(synth([[0.4, 0.02], [0.4, 0], [0.4, 0.02]]), RATE);
  assert.equal(detectSilences(frames, 0.02).length, 1, 'the threshold should be relative');
});

test('a recording of nothing but hiss is not one long word', () => {
  const frames = rmsFrames(synth([[1, 0.0005]]), RATE);
  assert.equal(detectSilences(frames, 0.02).length, 1, 'the absolute floor should catch this');
});

test('an empty envelope has no silences and no bounds', () => {
  assert.deepEqual(detectSilences([], 0.02), []);
  assert.deepEqual(speechBounds([], 0.02), { start: 0, end: 0 });
});

test('speech bounds trim room tone at either end', () => {
  const frames = rmsFrames(synth([[0.5, 0], [1, 0.6], [0.5, 0]]), RATE);
  const bounds = speechBounds(frames, 0.02);
  assert.ok(Math.abs(bounds.start - 0.5) < 0.05, `start was ${bounds.start}`);
  assert.ok(Math.abs(bounds.end - 1.5) < 0.05, `end was ${bounds.end}`);
});

test('a completely silent recording bounds to the whole of itself', () => {
  const frames = rmsFrames(synth([[1, 0]]), RATE);
  const bounds = speechBounds(frames, 0.02);
  assert.equal(bounds.start, 0);
  assert.ok(bounds.end > 0.9);
});

/* --- warping ------------------------------------------------------------ */

test('a warp through two anchors is a plain scale', () => {
  const warp = makeWarp([{ from: 0, to: 0 }, { from: 2, to: 4 }]);
  assert.ok(Math.abs(warp(0) - 0) < EPS);
  assert.ok(Math.abs(warp(1) - 2) < EPS);
  assert.ok(Math.abs(warp(2) - 4) < EPS);
});

test('a warp is monotonic however the anchors are ordered', () => {
  const warp = makeWarp([
    { from: 2, to: 1.5 }, { from: 0, to: 0 }, { from: 5, to: 6 }, { from: 1, to: 0.4 },
  ]);
  let previous = -Infinity;
  for (let t = -1; t <= 7; t += 0.05) {
    const value = warp(t);
    assert.ok(value >= previous - EPS, `warp went backwards at ${t}`);
    assert.ok(Number.isFinite(value), `warp produced ${value} at ${t}`);
    previous = value;
  }
});

test('a warp interpolates between anchors and extends beyond them', () => {
  const warp = makeWarp([{ from: 0, to: 0 }, { from: 1, to: 2 }, { from: 2, to: 2.5 }]);
  assert.ok(Math.abs(warp(0.5) - 1) < EPS);
  assert.ok(Math.abs(warp(1.5) - 2.25) < EPS);
  assert.ok(warp(3) > warp(2), 'past the last anchor the warp should keep going');
  assert.ok(warp(-1) < warp(0), 'before the first anchor the warp should keep going');
});

test('contradictory anchors are discarded rather than inverting the warp', () => {
  const warp = makeWarp([{ from: 0, to: 0 }, { from: 2, to: 5 }, { from: 3, to: 1 }, { from: 4, to: 8 }]);
  assert.ok(warp(4) > warp(2), 'the backwards anchor should have been dropped');
});

test('a degenerate anchor list still gives a usable warp', () => {
  assert.equal(makeWarp([])(3), 3);
  assert.equal(makeWarp([{ from: 0, to: 0 }])(3), 3);
  assert.ok(Math.abs(makeWarp([{ from: 2, to: 4 }])(1) - 2) < EPS);
});

test('warping cues keeps them contiguous and in order', () => {
  const { cues } = buildTrack('Hello there. This is a test, with pauses.');
  const warped = warpCues(cues, makeWarp([{ from: 0, to: 0 }, { from: 1, to: 0.5 }, { from: 3, to: 6 }]));
  assert.equal(warped.length, cues.length);
  assert.equal(warped[0].start, 0);
  for (let i = 1; i < warped.length; i += 1) {
    assert.equal(warped[i].start, warped[i - 1].end, `gap at cue ${i}`);
    assert.ok(warped[i].end >= warped[i].start, `cue ${i} runs backwards`);
  }
});

test('warping never produces a negative time', () => {
  const { cues } = buildTrack('Hello there.');
  for (const cue of warpCues(cues, (t) => t - 5)) {
    assert.ok(cue.start >= 0 && cue.end >= 0);
  }
});

test('warping an empty track is empty', () => {
  assert.deepEqual(warpCues([], (t) => t), []);
});

/* --- fitting to a length ------------------------------------------------ */

const TRACK = buildTrack('Hello there. This is the animator, and it works well.');

test('fitting to a duration lands on that duration exactly', () => {
  for (const target of [1, 4.5, 30]) {
    const fitted = fitToDuration(TRACK, target);
    assert.ok(Math.abs(fitted.duration - target) < 1e-6, `got ${fitted.duration}, wanted ${target}`);
    assert.ok(Math.abs(fitted.cues.at(-1).end - target) < 1e-6);
  }
});

test('fitting preserves the shapes and their order', () => {
  const fitted = fitToDuration(TRACK, 9);
  assert.deepEqual(fitted.cues.map((c) => c.viseme), TRACK.cues.map((c) => c.viseme));
});

test('fitting to nothing, or fitting nothing, changes nothing', () => {
  assert.equal(fitToDuration(TRACK, 0), TRACK);
  assert.equal(fitToDuration(TRACK, -1), TRACK);
  const empty = buildTrack('');
  assert.equal(fitToDuration(empty, 5), empty);
});

test('word spans and expression spans are carried along by a fit', () => {
  const source = buildTrack('Hello [smile] there, and welcome.');
  const fitted = fitToDuration(source, source.duration * 2);
  for (const word of fitted.words) {
    assert.ok(word.end <= fitted.duration + EPS, `"${word.raw}" runs past the end`);
    assert.ok(word.start >= 0);
  }
  for (const span of fitted.expressions) {
    assert.ok(span.start >= 0 && span.end <= fitted.duration + EPS);
    assert.ok(span.end >= span.start);
  }
});

/* --- matching pauses to silences ---------------------------------------- */

test('rest spans are the rests, in order', () => {
  const spans = restSpans(TRACK);
  assert.ok(spans.length >= 2, 'a lead-in and a tail at minimum');
  for (let i = 1; i < spans.length; i += 1) assert.ok(spans[i].start >= spans[i - 1].start);
  for (const span of spans) assert.ok(span.mid > span.start && span.mid < span.end);
});

test('anchors always include both endpoints', () => {
  const anchors = matchAnchors(restSpans(TRACK), [], TRACK.duration, 10);
  assert.deepEqual(anchors[0], { from: 0, to: 0 });
  assert.deepEqual(anchors.at(-1), { from: TRACK.duration, to: 10 });
});

test('anchors are strictly increasing in both coordinates', () => {
  const silences = [
    { start: 1, end: 1.4, seconds: 0.4 },
    { start: 3, end: 3.3, seconds: 0.3 },
    { start: 5, end: 5.5, seconds: 0.5 },
  ];
  const anchors = matchAnchors(restSpans(TRACK), silences, TRACK.duration, 7);
  for (let i = 1; i < anchors.length; i += 1) {
    assert.ok(anchors[i].from > anchors[i - 1].from, `from went backwards at ${i}`);
    assert.ok(anchors[i].to > anchors[i - 1].to, `to went backwards at ${i}`);
  }
});

test('a silence nowhere near any pause is left unmatched rather than forced', () => {
  const track = buildTrack('One. Two.');
  const audioDuration = 20;

  // Find a position in the recording that is far from every pause in the model. Doing
  // it this way rather than hard-coding a number keeps the test honest if the default
  // pause lengths ever change.
  const rests = restSpans(track).map((r) => r.mid / track.duration);
  let wanted = null;
  for (let p = 0.02; p < 1 && wanted === null; p += 0.01) {
    if (rests.every((r) => Math.abs(r - p) > 0.2)) wanted = p;
  }
  assert.ok(wanted !== null, 'no isolated position exists to test with');

  const mid = wanted * audioDuration;
  const anchors = matchAnchors(
    restSpans(track), [{ start: mid - 0.05, end: mid + 0.05, seconds: 0.1 }],
    track.duration, audioDuration,
  );
  assert.equal(anchors.length, 2, 'only the endpoints should have been anchored');
});

test('a take with room tone at the front anchors it to the lead-in', () => {
  const track = buildTrack('One. Two.');
  const leadIn = restSpans(track)[0];
  const audioDuration = track.duration;
  const mid = leadIn.mid;

  const anchors = matchAnchors(
    restSpans(track), [{ start: mid - 0.05, end: mid + 0.05, seconds: 0.1 }],
    track.duration, audioDuration,
  );
  assert.equal(anchors.length, 3, 'the opening silence should have matched the lead-in');
});

/* --- the whole fit ------------------------------------------------------ */

test('fitting to audio lands on the recording length and stays contiguous', () => {
  const analysis = {
    duration: 6,
    silences: [{ start: 1.5, end: 2, seconds: 0.5 }, { start: 3.8, end: 4.2, seconds: 0.4 }],
  };
  const { track, matched } = fitToAudio(TRACK, analysis);

  assert.ok(Math.abs(track.duration - 6) < 1e-6, `duration was ${track.duration}`);
  assert.ok(matched >= 0);
  assert.deepEqual(track.cues.map((c) => c.viseme), TRACK.cues.map((c) => c.viseme));
  for (let i = 1; i < track.cues.length; i += 1) {
    assert.equal(track.cues[i].start, track.cues[i - 1].end);
  }
});

test('with pauses switched off it is a plain length fit', () => {
  const analysis = { duration: 6, silences: [{ start: 1.5, end: 2, seconds: 0.5 }] };
  const { track, matched } = fitToAudio(TRACK, analysis, { usePauses: false });
  assert.equal(matched, 0);
  assert.deepEqual(track.cues.map((c) => c.start), fitToDuration(TRACK, 6).cues.map((c) => c.start));
});

test('a recording with no silences still fits its length', () => {
  const { track, matched } = fitToAudio(TRACK, { duration: 5, silences: [] });
  assert.equal(matched, 0);
  assert.ok(Math.abs(track.duration - 5) < 1e-6);
});

test('fitting an empty track or an empty recording is a no-op', () => {
  assert.equal(fitToAudio(buildTrack(''), { duration: 5, silences: [] }).track.cues.length, 0);
  assert.equal(fitToAudio(TRACK, { duration: 0, silences: [] }).track, TRACK);
  assert.equal(fitToAudio(TRACK, null).track, TRACK);
});

test('a real envelope drives a real fit end to end', () => {
  const frames = rmsFrames(TAKE, RATE);
  const analysis = { duration: 2.2, silences: detectSilences(frames, 0.02) };
  const { track, matched } = fitToAudio(TRACK, analysis);

  assert.ok(Math.abs(track.duration - 2.2) < 1e-6);
  assert.ok(matched >= 1, 'at least one of the two gaps should have matched');
  for (let i = 1; i < track.cues.length; i += 1) {
    assert.equal(track.cues[i].start, track.cues[i - 1].end);
    assert.ok(track.cues[i].end >= track.cues[i].start);
  }
});

/* --- what it says about itself ------------------------------------------ */

test('the fit describes itself honestly in every case', () => {
  // Gaps heard and matched.
  const analysis = { duration: 6, silences: [{ start: 1.5, end: 2, seconds: 0.5 }] };
  const matched = fitToAudio(TRACK, analysis);
  assert.match(describeFit(matched, analysis), /matched/);

  // No gaps heard at all: only the length could be used.
  const silent = { duration: 6, silences: [] };
  assert.match(describeFit(fitToAudio(TRACK, silent), silent), /length of the recording/);

  // Gaps heard, but none of them near a pause in the script.
  const wild = { duration: 600, silences: [{ start: 300, end: 300.2, seconds: 0.2 }] };
  const unmatched = fitToAudio(TRACK, wild);
  assert.equal(unmatched.matched, 0);
  assert.match(describeFit(unmatched, wild), /No pause in the script lined up/);

  for (const [result, source] of [[matched, analysis], [unmatched, wild]]) {
    assert.doesNotMatch(describeFit(result, source), /NaN|undefined|\d\.\d{4,}/);
  }
});
