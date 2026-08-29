/**
 * Reading a local recording.
 *
 * The file is read by the browser and decoded in the browser. Nothing is uploaded, and
 * the object URL handed to the `<audio>` element is a reference to memory on this
 * machine, not an address anywhere. That is the whole reason the analysis in
 * `js/envelope.js` is arithmetic on samples rather than a call to a speech service.
 *
 * The decode itself needs an `AudioContext`, which is why this is the one part of the
 * audio path that cannot be a pure module.
 */

import { rmsFrames, toMono, detectSilences, speechBounds } from '../envelope.js';

export const FRAME_SECONDS = 0.02;

/** Created on demand: constructing one before a user gesture is refused by some browsers. */
let context = null;

function audioContext() {
  if (!context) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  }
  return context;
}

/**
 * Decode a file and measure it.
 *
 * @param {File} file
 * @returns {Promise<{duration:number, frames:number[], silences:object[], bounds:object,
 *                    peaks:number[], url:string, name:string}>}
 */
export async function analyseAudioFile(file, { threshold = 0.08, minSilence = 0.12 } = {}) {
  const ctx = audioContext();
  if (!ctx) throw new Error('This browser cannot decode audio.');

  const bytes = await file.arrayBuffer();
  const buffer = await ctx.decodeAudioData(bytes);

  const channels = [];
  for (let i = 0; i < buffer.numberOfChannels; i += 1) channels.push(buffer.getChannelData(i));

  const mono = toMono(channels);
  const frames = rmsFrames(mono, buffer.sampleRate, FRAME_SECONDS);

  return {
    name: file.name,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    frames,
    silences: detectSilences(frames, FRAME_SECONDS, { threshold, minSilence }),
    bounds: speechBounds(frames, FRAME_SECONDS, { threshold }),
    peaks: downsample(frames, 900),
    url: URL.createObjectURL(file),
  };
}

/** Re-measure an already decoded file when the threshold is dragged. No second decode. */
export function remeasure(analysis, { threshold, minSilence }) {
  return {
    ...analysis,
    silences: detectSilences(analysis.frames, FRAME_SECONDS, { threshold, minSilence }),
    bounds: speechBounds(analysis.frames, FRAME_SECONDS, { threshold }),
  };
}

/** Thin the envelope down to something a waveform strip can draw without a canvas. */
function downsample(frames, target) {
  if (frames.length <= target) return [...frames];
  const step = frames.length / target;
  const out = [];
  for (let i = 0; i < target; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    let peak = 0;
    for (let j = from; j < to && j < frames.length; j += 1) peak = Math.max(peak, frames[j]);
    out.push(peak);
  }
  return out;
}

/** Release the object URL when a recording is swapped out or cleared. */
export function releaseAudio(analysis) {
  if (analysis?.url) {
    try { URL.revokeObjectURL(analysis.url); } catch { /* already gone */ }
  }
}

export const AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.webm';
