/**
 * The timeline: every cue as a block, with a playhead over it.
 *
 * This is the view that makes the timing model legible. A track that reads correctly
 * here - the closed mouths present, no shape held absurdly long, the rests where the
 * punctuation is - will read correctly on the character.
 *
 * The width is fixed rather than sized to the track, so a long script scrolls inside its
 * own container instead of shrinking every cue to a hairline. pitfalls.md #3 caps the
 * scale; here the cap is the point, not the problem.
 */

import { svg, el } from './dom.js';
import { visemeInfo } from '../visemes.js';
import { formatSeconds } from '../timecode.js';

const HEIGHT = 96;
const LANE_Y = 22;
const LANE_H = 44;
const RULER_Y = 82;

/** Pixels per second at zoom 1. A comfortable read for a sentence or two. */
export const BASE_PPS = 160;

/** Distinct fills, cycled by shape so neighbouring cues never look like one block. */
const SHAPE_CLASS_COUNT = 6;

/**
 * @param {object} track
 * @param {object} options
 * @param {number} options.zoom
 * @param {(seconds:number)=>void} [options.onSeek] called when the strip is clicked
 */
export function timelineSvg(track, { zoom = 1, onSeek = null, schemeId = 'chart' } = {}) {
  const pps = BASE_PPS * zoom;
  const width = Math.max(320, Math.ceil(track.duration * pps) + 2);

  const node = svg('svg', {
    viewBox: `0 0 ${width} ${HEIGHT}`,
    class: 'timeline',
    role: 'group',
    'aria-label': `Timeline, ${formatSeconds(track.duration)} seconds, ${track.cues.length} cues`,
    style: { width: `${width}px` },
  });

  node.appendChild(svg('rect', { x: 0, y: 0, width, height: HEIGHT, class: 'timeline__ground' }));

  // Expression spans run behind the cues, because they are a state, not an event.
  for (const span of track.expressions ?? []) {
    const x = span.start * pps;
    const w = Math.max(1, (span.end - span.start) * pps);
    node.appendChild(svg('rect', {
      x, y: 6, width: w, height: HEIGHT - 20, rx: 6,
      class: 'timeline__expression',
    }));
    node.appendChild(svg('text', {
      x: x + 6, y: 17, class: 'timeline__expression-label',
    }, [span.name]));
  }

  // Cues
  const shapeIndex = new Map();
  for (const cue of track.cues) {
    if (!shapeIndex.has(cue.viseme)) shapeIndex.set(cue.viseme, shapeIndex.size);
  }

  for (const cue of track.cues) {
    const x = cue.start * pps;
    const w = Math.max(1, (cue.end - cue.start) * pps);
    const tone = shapeIndex.get(cue.viseme) % SHAPE_CLASS_COUNT;

    const group = svg('g', { class: 'timeline__cue', 'data-viseme': cue.viseme });
    group.appendChild(svg('rect', {
      x, y: LANE_Y, width: w, height: LANE_H, rx: 3,
      class: `timeline__block timeline__block--${tone}${cue.kind === 'rest' ? ' timeline__block--rest' : ''}`,
    }));

    // A label only where it fits. A clipped word is worse than none. pitfalls.md #4.
    if (w > 22) {
      const info = visemeInfo(schemeId, cue.viseme);
      const text = info?.label ?? cue.viseme;
      const fits = Math.floor(w / 7.2);
      group.appendChild(svg('text', {
        x: x + w / 2, y: LANE_Y + 27, 'text-anchor': 'middle', class: 'timeline__cue-label',
      }, [text.length > fits ? text.slice(0, Math.max(1, fits)) : text]));
    }

    group.appendChild(svg('title', {}, [
      `${cueTitle(cue, schemeId)}\n${formatSeconds(cue.start)}s – ${formatSeconds(cue.end)}s`,
    ]));

    node.appendChild(group);
  }

  // Ruler: one tick a second, labelled, plus half-second ticks when there is room.
  const step = pps >= 90 ? 0.5 : 1;
  for (let t = 0; t <= track.duration + 1e-6; t += step) {
    const x = Math.round(t * pps) + 0.5;
    const major = Math.abs(t - Math.round(t)) < 1e-6;
    node.appendChild(svg('line', {
      x1: x, y1: major ? RULER_Y - 8 : RULER_Y - 4, x2: x, y2: RULER_Y,
      class: 'timeline__tick',
    }));
    if (major) {
      node.appendChild(svg('text', {
        x: x + 3, y: HEIGHT - 3, class: 'timeline__time',
      }, [`${Math.round(t)}s`]));
    }
  }

  // Playhead, moved by the player rather than redrawn.
  const head = svg('g', { class: 'timeline__head', 'data-role': 'playhead' });
  head.appendChild(svg('line', { x1: 0, y1: 4, x2: 0, y2: RULER_Y, class: 'timeline__head-line' }));
  head.appendChild(svg('path', { d: 'M -6 0 L 6 0 L 0 9 Z', class: 'timeline__head-grip' }));
  node.appendChild(head);

  if (onSeek) {
    node.classList.add('timeline--seekable');
    const seek = (event) => {
      const box = node.getBoundingClientRect();
      if (!box.width) return;
      // The SVG is scaled to fit, so a click has to be converted back to viewBox units
      // before it means anything in seconds.
      const viewX = ((event.clientX - box.left) / box.width) * width;
      onSeek(Math.max(0, Math.min(track.duration, viewX / pps)));
    };
    node.addEventListener('click', seek);
    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      const move = (e) => seek(e);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  return { node, pps, width };
}

function cueTitle(cue, schemeId) {
  const info = visemeInfo(schemeId, cue.viseme);
  const sounds = cue.phonemes.filter((p) => p !== 'sil').join(' ');
  const parts = [info?.title ?? cue.viseme];
  if (sounds) parts.push(sounds);
  if (cue.word) parts.push(`“${cue.word}”`);
  return parts.join(' · ');
}

/** Move the playhead without redrawing the strip. Called every frame during playback. */
export function movePlayhead(node, seconds, pps) {
  const head = node?.querySelector('[data-role="playhead"]');
  if (head) head.setAttribute('transform', `translate(${seconds * pps} 0)`);
}

/**
 * The script, with the word currently being spoken marked.
 *
 * Rebuilding this every frame would be wasteful, so it is built once per track and only
 * the `is-now` class moves.
 */
export function scriptTrail(text, words) {
  const host = el('div', { class: 'trail', role: 'group', 'aria-label': 'Script' });
  let cursor = 0;

  for (const word of words) {
    if (word.charStart > cursor) {
      host.appendChild(el('span', { class: 'trail__gap', text: text.slice(cursor, word.charStart) }));
    }
    host.appendChild(el('span', {
      class: 'trail__word',
      dataset: { word: String(word.index) },
      text: text.slice(word.charStart, word.charEnd),
      title: `${word.phonemes.join(' ')} · ${formatSeconds(word.start ?? 0)}s`,
    }));
    cursor = word.charEnd;
  }

  if (cursor < text.length) {
    host.appendChild(el('span', { class: 'trail__gap', text: text.slice(cursor) }));
  }

  return host;
}

/** Highlight the word being spoken. Index -1 clears it. */
export function markWord(host, index) {
  const current = host?.querySelector('.trail__word.is-now');
  if (current) current.classList.remove('is-now');
  if (index < 0) return;
  const next = host?.querySelector(`.trail__word[data-word="${index}"]`);
  if (next) next.classList.add('is-now');
}

/** Which word is being spoken at `time`, or -1. */
export function wordAt(words, time) {
  for (const word of words) {
    if (word.start === null) continue;
    if (time >= word.start && time < word.end) return word.index;
  }
  return -1;
}
