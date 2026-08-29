import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FPS_CHOICES,
  framesToSeconds,
  secondsToFrames,
  quantiseToFrame,
  formatSeconds,
  formatDuration,
  formatTimecode,
  formatClock,
  parseTime,
  parseTimeOr,
} from '../js/timecode.js';

test('frame rates offered are all positive integers', () => {
  for (const fps of FPS_CHOICES) {
    assert.ok(Number.isInteger(fps) && fps > 0, `${fps} is not a usable frame rate`);
  }
});

test('frames and seconds convert both ways', () => {
  assert.equal(framesToSeconds(24, 24), 1);
  assert.equal(framesToSeconds(12, 24), 0.5);
  assert.equal(secondsToFrames(1, 25), 25);
  assert.equal(secondsToFrames(0.51, 25), 13);
});

test('a bad frame rate cannot produce Infinity or NaN', () => {
  assert.equal(framesToSeconds(24, 0), 0);
  assert.equal(framesToSeconds(24, -5), 0);
  assert.equal(secondsToFrames(1, undefined), 0);
});

test('quantising lands exactly on the frame grid', () => {
  for (const fps of FPS_CHOICES) {
    for (const t of [0, 0.017, 0.4999, 1.234, 9.87]) {
      const snapped = quantiseToFrame(t, fps);
      const frames = snapped * fps;
      assert.ok(Math.abs(frames - Math.round(frames)) < 1e-9,
        `${t}s at ${fps}fps snapped to ${snapped}, which is not a whole frame`);
      assert.ok(Math.abs(snapped - t) <= 0.5 / fps + 1e-9, 'snapped further than half a frame');
    }
  }
});

test('quantising is idempotent', () => {
  const once = quantiseToFrame(1.2345, 30);
  assert.equal(quantiseToFrame(once, 30), once);
});

// pitfalls.md #9: full-precision numbers must never reach prose.
test('durations read as prose, not as raw floats', () => {
  assert.equal(formatDuration(0.0637), '64 ms');
  assert.equal(formatDuration(1.23456), '1.23 s');
  assert.equal(formatDuration(12.3456), '12.3 s');
  assert.equal(formatDuration(95), '1m 35.0s');
  assert.equal(formatDuration(NaN), '—');
});

test('seconds format to a fixed width so a scrubbing readout does not jitter', () => {
  assert.equal(formatSeconds(1), '1.00');
  assert.equal(formatSeconds(1.239, 2), '1.24');
  assert.equal(formatSeconds(1.239, 3), '1.239');
  assert.equal(formatSeconds('nope'), '—');
});

test('timecode is SMPTE HH:MM:SS:FF', () => {
  assert.equal(formatTimecode(0, 24), '00:00:00:00');
  assert.equal(formatTimecode(1.5, 24), '00:00:01:12');
  assert.equal(formatTimecode(61.04, 25), '00:01:01:01');
  assert.equal(formatTimecode(3661, 30), '01:01:01:00');
});

test('timecode never emits a frame number equal to the frame rate', () => {
  // 0.9999s at 24fps rounds to 24 frames, which must roll over into the next second.
  assert.equal(formatTimecode(0.9999, 24), '00:00:01:00');
  assert.equal(formatTimecode(59.999, 30), '00:01:00:00');
});

test('clock format is minutes and seconds', () => {
  assert.equal(formatClock(0), '00:00.00');
  assert.equal(formatClock(9.5), '00:09.50');
  assert.equal(formatClock(75.25), '01:15.25');
});

test('parseTime reads every form a person might type', () => {
  assert.equal(parseTime('1.5'), 1.5);
  assert.equal(parseTime('1.5s'), 1.5);
  assert.equal(parseTime('1.5 seconds'), 1.5);
  assert.equal(parseTime('1500ms'), 1.5);
  assert.equal(parseTime('36f', 24), 1.5);
  assert.equal(parseTime('36 frames', 24), 1.5);
  assert.equal(parseTime('2 min'), 120);
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('1:23.5'), 83.5);
  assert.equal(parseTime('00:01:23'), 83);
  assert.equal(parseTime('00:00:01:12', 24), 1.5);
});

test('parseTime returns null rather than guessing', () => {
  assert.equal(parseTime(''), null);
  assert.equal(parseTime('   '), null);
  assert.equal(parseTime(null), null);
  assert.equal(parseTime('soon'), null);
  assert.equal(parseTime('1.5 furlongs'), null);
  assert.equal(parseTime('1::2'), null);
  assert.equal(parseTime('1:2:3:4:5'), null);
});

test('parseTime round-trips its own timecode output', () => {
  for (const fps of FPS_CHOICES) {
    for (const t of [0, 1.5, 12.75, 3661.2]) {
      const snapped = quantiseToFrame(t, fps);
      assert.ok(Math.abs(parseTime(formatTimecode(snapped, fps), fps) - snapped) < 1e-9,
        `${t}s at ${fps}fps did not survive a timecode round trip`);
    }
  }
});

test('parseTimeOr keeps a control usable mid-keystroke', () => {
  assert.equal(parseTimeOr('', 0.4), 0.4);
  assert.equal(parseTimeOr('abc', 0.4), 0.4);
  assert.equal(parseTimeOr('-3', 0.4, { min: 0 }), 0);
  assert.equal(parseTimeOr('99', 0.4, { max: 10 }), 10);
  assert.equal(parseTimeOr('2.5', 0.4), 2.5);
});
