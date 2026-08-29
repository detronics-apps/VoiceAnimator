/**
 * Time, frames and timecode.
 *
 * Pure: no DOM, no globals. Everything the rest of the app needs to turn a number of
 * seconds into something a human reads, and to read a human's typing back.
 *
 * Forgiving input is the house style. The Bench accepts `4k7` for a resistor; here the
 * equivalent is accepting `1.5`, `1500ms`, `36f` and `00:00:01:12` for the same instant.
 */

/** Frame rates offered in the UI. 25 is PAL, 24 is film, 30/60 are the usual video rates. */
export const FPS_CHOICES = [12, 15, 24, 25, 30, 50, 60];

const clean = (value) => String(value ?? '').trim().toLowerCase();

/** @returns {number} seconds, given a whole or fractional frame count */
export function framesToSeconds(frames, fps) {
  const rate = Number(fps);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Number(frames) / rate;
}

/** @returns {number} the nearest whole frame to `seconds` */
export function secondsToFrames(seconds, fps) {
  const rate = Number(fps);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round(Number(seconds) * rate);
}

/**
 * Snap an instant onto the frame grid.
 *
 * Every exported cue boundary goes through this, so a track handed to an animation
 * package never asks it to change a drawing halfway through a frame.
 */
export function quantiseToFrame(seconds, fps) {
  const rate = Number(fps);
  if (!Number.isFinite(rate) || rate <= 0) return Number(seconds) || 0;
  return Math.round(Number(seconds) * rate) / rate;
}

const pad = (n, width = 2) => String(Math.trunc(Math.abs(n))).padStart(width, '0');

/** `1.2345` -> `1.23`. Fixed decimals, because a scrubbing readout must not jitter in width. */
export function formatSeconds(seconds, decimals = 2) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/**
 * A duration in prose. Never interpolate a raw number into a sentence: sub-second
 * durations read as milliseconds, longer ones as seconds, both to three significant
 * figures at most.
 */
export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs < 1) return `${Math.round(value * 1000)} ms`;
  if (abs < 10) return `${value.toFixed(2)} s`;
  if (abs < 60) return `${value.toFixed(1)} s`;
  const mins = Math.floor(abs / 60);
  const secs = abs - mins * 60;
  return `${value < 0 ? '-' : ''}${mins}m ${secs.toFixed(1)}s`;
}

/** `HH:MM:SS:FF`, the SMPTE form every animation package understands. */
export function formatTimecode(seconds, fps = 24) {
  const rate = Number(fps) > 0 ? Number(fps) : 24;
  const value = Number(seconds) || 0;
  const sign = value < 0 ? '-' : '';
  let frames = Math.round(Math.abs(value) * rate);

  const totalSeconds = Math.floor(frames / rate);
  frames -= totalSeconds * rate;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  return `${sign}${pad(hours)}:${pad(minutes)}:${pad(secs)}:${pad(frames)}`;
}

/** `MM:SS.mmm` — friendlier than SMPTE for a script that is a few minutes long. */
export function formatClock(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(value / 60);
  const secs = value - mins * 60;
  return `${pad(mins)}:${secs < 10 ? '0' : ''}${secs.toFixed(2)}`;
}

/**
 * Read a time the way a person typed it.
 *
 * Accepted: `1.5` · `1.5s` · `1500ms` · `36f` / `36 frames` · `1:23` · `1:23.5` ·
 * `00:01:23` · `00:00:01:12` (SMPTE, four parts, last is frames).
 *
 * @returns {number|null} seconds, or null when the input cannot be read at all.
 */
export function parseTime(input, fps = 24) {
  const text = clean(input);
  if (!text) return null;

  // Colon forms first: they are unambiguous and a bare number inside one would
  // otherwise be read as seconds.
  if (text.includes(':')) {
    const parts = text.split(':').map((p) => p.trim());
    if (parts.some((p) => p === '' || !/^\d*\.?\d*$/.test(p))) return null;
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return null;

    if (nums.length === 2) return nums[0] * 60 + nums[1];
    if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2];
    if (nums.length === 4) {
      return nums[0] * 3600 + nums[1] * 60 + nums[2] + framesToSeconds(nums[3], fps);
    }
    return null;
  }

  const match = text.match(/^(-?\d*\.?\d+)\s*([a-z]*)$/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2];

  if (unit === '' || unit === 's' || unit === 'sec' || unit === 'secs' ||
      unit === 'second' || unit === 'seconds') return value;
  if (unit === 'ms' || unit === 'msec' || unit === 'msecs' ||
      unit === 'millisecond' || unit === 'milliseconds') return value / 1000;
  if (unit === 'f' || unit === 'fr' || unit === 'frame' || unit === 'frames') {
    return framesToSeconds(value, fps);
  }
  if (unit === 'm' || unit === 'min' || unit === 'mins' ||
      unit === 'minute' || unit === 'minutes') return value * 60;

  return null;
}

/**
 * Clamp a parsed time into a usable range, falling back to `fallback` when the input
 * was unreadable. Used by every numeric field so a half-typed value never blanks a
 * control mid-keystroke.
 */
export function parseTimeOr(input, fallback, { min = 0, max = Infinity, fps = 24 } = {}) {
  const parsed = parseTime(input, fps);
  if (parsed === null) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
