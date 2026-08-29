/**
 * The animator: the character, the transport, the timeline and the script.
 *
 * The one performance decision worth naming is that playback does not re-render. The
 * stage, the timeline and the script trail are built once per track; the frame loop then
 * only swaps the face when the *shape* changes, moves the playhead, and moves one
 * highlight. Rebuilding a hundred timeline blocks sixty times a second would drop frames
 * on exactly the machines this is most likely to be used on.
 */

import { el, clear, toast } from '../dom.js';
import { capDiagramScale } from '../patterns.js';
import { slider, timeField, toggle, section, buttonRow, filePicker, stat } from '../controls.js';
import { stageFor } from '../face-svg.js';
import { timelineSvg, movePlayhead, scriptTrail, markWord, wordAt } from '../timeline-svg.js';
import { explainAnimate } from '../explain.js';
import { cueAt, expressionAt, TIMING_DEFAULTS } from '../../timing.js';
import { visemeInfo, SCHEMES, SCHEME_IDS } from '../../visemes.js';
import { formatDuration, formatTimecode, FPS_CHOICES } from '../../timecode.js';
import { analyseAudioFile, releaseAudio, remeasure, AUDIO_ACCEPT } from '../audio.js';
import { describeFit } from '../../envelope.js';
import { setScheme } from '../../state.js';

export const id = 'animate';
export const label = 'Animate';
export const shortLabel = 'Anim';

/** Per-render references, so the frame loop can touch four nodes and nothing else. */
let live = null;

export function stage(app) {
  const { track, state } = app;
  const host = el('div', { class: 'animate' });

  const faceHost = el('div', { class: 'animate__face' });
  const nowLabel = el('div', { class: 'animate__now value' });
  const nowSub = el('div', { class: 'animate__now-sub' });

  host.append(faceHost, el('div', { class: 'animate__caption' }, [nowLabel, nowSub]));

  live = {
    faceHost, nowLabel, nowSub,
    viseme: null, expression: null, characterId: null, eyesClosed: null, wordIndex: -2,
  };
  paintFace(app, 0);

  return host;
}

/** Everything below the stage: transport, timeline and the script. */
export function extra(app) {
  const { track, state, player } = app;
  const host = el('div', { class: 'below' });

  /* --- transport ------------------------------------------------------- */

  const clock = el('span', { class: 'transport__clock value', text: formatTimecode(0, state.settings.fps) });

  const playButton = el('button', {
    class: 'btn btn-primary transport__play', type: 'button',
    text: player.playing ? 'Pause' : 'Play',
    'aria-label': 'Play or pause',
    on: { click: () => { player.toggle(); syncPlayButton(); } },
  });

  const syncPlayButton = () => { playButton.textContent = player.playing ? 'Pause' : 'Play'; };
  app.onPlayStateChange = syncPlayButton;

  const transport = el('div', { class: 'transport' }, [
    playButton,
    el('button', {
      class: 'btn', type: 'button', text: '⏮', title: 'Back to the start',
      on: { click: () => { player.stop(); syncPlayButton(); } },
    }),
    el('button', {
      class: 'btn', type: 'button', text: '◀', title: 'Back one frame',
      on: { click: () => { player.step(-1, state.settings.fps); syncPlayButton(); } },
    }),
    el('button', {
      class: 'btn', type: 'button', text: '▶', title: 'Forward one frame',
      on: { click: () => { player.step(1, state.settings.fps); syncPlayButton(); } },
    }),
    clock,
    el('span', { class: 'transport__total muted', text: `/ ${formatDuration(track.duration)}` }),
    el('label', { class: 'toggle transport__loop' }, [
      el('input', {
        type: 'checkbox', class: 'toggle__input', checked: state.loop,
        on: { change: (e) => { state.loop = e.target.checked; player.setLoop(state.loop); app.save(); } },
      }),
      el('span', { class: 'toggle__label', text: 'Loop' }),
    ]),
  ]);

  /* --- timeline -------------------------------------------------------- */

  const { node: timeline, pps } = timelineSvg(track, {
    zoom: app.zoom,
    schemeId: state.schemeId,
    onSeek: (seconds) => { player.seek(seconds); },
  });

  const scroller = el('div', { class: 'timeline-scroll' }, [timeline]);

  const zoomRow = el('div', { class: 'timeline-bar' }, [
    el('span', { class: 'timeline-bar__title', text: 'Timeline' }),
    el('span', { class: 'muted', text: `${track.cues.length} cues · ${track.stats.distinctShapes} shapes` }),
    el('div', { class: 'timeline-bar__zoom' }, [
      el('button', {
        class: 'btn', type: 'button', text: '−', title: 'Zoom out',
        on: { click: () => { app.zoom = Math.max(0.25, app.zoom / 1.5); app.rerender(); } },
      }),
      el('button', {
        class: 'btn', type: 'button', text: '+', title: 'Zoom in',
        on: { click: () => { app.zoom = Math.min(8, app.zoom * 1.5); app.rerender(); } },
      }),
    ]),
  ]);

  /* --- script trail ---------------------------------------------------- */

  const trail = scriptTrail(state.script, track.words);
  trail.addEventListener('click', (event) => {
    const node = event.target.closest('.trail__word');
    if (!node) return;
    const word = track.words[Number(node.dataset.word)];
    if (word?.start !== null && word !== undefined) player.seek(word.start);
  });

  host.append(transport, zoomRow, scroller, el('div', { class: 'trail-wrap' }, [trail]));

  live = { ...live, timeline, pps, trail, clock, scroller };
  return host;
}

/* ---------------------------------------------------------------------------- *
 * The frame loop
 * ---------------------------------------------------------------------------- */

function paintFace(app, time) {
  const { track, state } = app;
  const cue = cueAt(track.cues, time);
  const viseme = cue?.viseme ?? SCHEMES[state.schemeId].rest;
  const expression = expressionAt(track.expressions, time);
  const character = app.characterAt(time);
  const eyesClosed = app.blinkingAt(time);

  // Redraw only when something visible actually changed. A blink is two redraws, not
  // sixty a second, and switching speaker mid-script is one.
  if (live.viseme === viseme && live.expression === expression
      && live.characterId === character?.id && live.eyesClosed === eyesClosed) return;

  live.viseme = viseme;
  live.expression = expression;
  live.characterId = character?.id;
  live.eyesClosed = eyesClosed;

  clear(live.faceHost).appendChild(stageFor(viseme, {
    schemeId: state.schemeId,
    character,
    expression,
    eyesClosed,
  }));
  capDiagramScale(live.faceHost);

  const info = visemeInfo(state.schemeId, viseme);
  live.nowLabel.textContent = info?.label ?? viseme;

  const sounds = (cue?.phonemes ?? []).filter((p) => p !== 'sil');
  live.nowSub.textContent = [
    character && state.characters.length > 1 ? character.name : null,
    info?.title,
    sounds.length ? sounds.join(' ') : 'silence',
    cue?.word ? `“${cue.word}”` : null,
    expression ? `[${expression}]` : null,
  ].filter(Boolean).join(' · ');
}

/** Called on every animation frame. Four DOM touches at most. */
export function frame(app, time) {
  if (!live) return;
  paintFace(app, time);
  if (live.timeline) movePlayhead(live.timeline, time, live.pps);
  if (live.clock) live.clock.textContent = formatTimecode(time, app.state.settings.fps);

  if (live.trail) {
    const index = wordAt(app.track.words, time);
    if (index !== live.wordIndex) {
      live.wordIndex = index;
      markWord(live.trail, index);
      keepVisible(live.scroller, live.timeline, time, live.pps);
    }
  }
}

/** Scroll the timeline so the playhead stays in view, without fighting a manual scroll. */
function keepVisible(scroller, timeline, time, pps) {
  if (!scroller || !timeline) return;
  const box = timeline.getBoundingClientRect();
  const viewBoxWidth = Number(timeline.getAttribute('viewBox').split(/\s+/)[2]);
  if (!box.width || !viewBoxWidth) return;

  const x = (time * pps) * (box.width / viewBoxWidth);
  const left = scroller.scrollLeft;
  const width = scroller.clientWidth;
  if (x < left + width * 0.1 || x > left + width * 0.85) {
    scroller.scrollLeft = Math.max(0, x - width * 0.4);
  }
}

/* ---------------------------------------------------------------------------- *
 * The readout strip
 * ---------------------------------------------------------------------------- */

export function readout(app) {
  const { track } = app;
  const s = track.stats;
  return el('div', { class: 'readout' }, [
    stat('Length', formatDuration(track.duration)),
    stat('Cues', String(s.cueCount)),
    stat('Shapes used', `${s.distinctShapes} of ${SCHEMES[track.schemeId].visemes.length}`),
    stat('Words', String(track.wordCount)),
    stat('Shortest cue', formatDuration(s.shortestCue),
      { tone: s.shortestCue < 1 / track.settings.fps - 1e-9 ? 'warn' : null }),
    stat('Speech', `${Math.round((s.speechTime / Math.max(s.duration, 1e-9)) * 100)}%`),
  ]);
}

export function explain(app) {
  return explainAnimate(app.track);
}

/* ---------------------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------------------- */

export function sidebar(app) {
  const { state, track } = app;
  const host = el('div', { class: 'sidebar__body' });

  /* --- the script ------------------------------------------------------ */

  const script = el('textarea', {
    class: 'script-input',
    rows: '10',
    spellcheck: 'true',
    'aria-label': 'Script',
    value: state.script,
  });

  // Rebuilding the whole track on every keystroke is fine for a paragraph and not for a
  // screenplay, so the rebuild waits for a pause in typing.
  let typingTimer = null;
  script.addEventListener('input', () => {
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      state.script = script.value;
      app.refresh();
    }, 220);
  });

  host.appendChild(section('Script', [
    script,
    el('div', { class: 'field__hint' }, [
      'Punctuation buys the pauses. Cues: ',
      el('code', { text: '[smile]' }), ' ',
      el('code', { text: '[angry]' }), ' ',
      el('code', { text: '[sad]' }), ' ',
      el('code', { text: '[laughing]' }), ' ',
      el('code', { text: '[neutral]' }), ' ',
      el('code', { text: '[pause 0.8]' }), '. Hand the next lines to another character with ',
      el('code', { text: '[as name]' }), '.',
    ]),
    buttonRow([
      { label: 'Clear', onClick: () => { state.script = ''; script.value = ''; app.refresh(); } },
    ]),
  ]));

  /* --- the mouth set --------------------------------------------------- */

  host.appendChild(section('Mouth shapes', [
    el('div', { class: 'chipset' }, SCHEME_IDS.map((schemeId) => el('button', {
      class: 'chip', type: 'button',
      'aria-pressed': String(schemeId === state.schemeId),
      text: SCHEMES[schemeId].name,
      title: SCHEMES[schemeId].note,
      on: { click: () => switchScheme(app, schemeId) },
    }))),
    el('p', { class: 'field__hint', text: SCHEMES[state.schemeId].note }),
  ], { info: 'A viseme scheme is the set of pictures your character is drawn in. Changing it re-maps every sound onto the new set.' }));

  /* --- timing ---------------------------------------------------------- */

  const set = (key, value) => { state.settings[key] = value; app.refresh(); };

  host.appendChild(section('Timing', [
    slider({
      label: 'Speaking rate',
      value: state.settings.wpm, min: 60, max: 300, step: 5,
      format: (v) => `${v} wpm`,
      onChange: (v) => set('wpm', v),
      info: 'Words per minute, pauses included. A conversational read is around 150; a voice-over is nearer 130.',
      hint: `${track.wordCount} word${track.wordCount === 1 ? '' : 's'} · ${formatDuration(track.duration)}`,
    }),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Frame rate' }),
      el('div', { class: 'chipset' }, FPS_CHOICES.map((fps) => el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(fps === state.settings.fps),
        text: String(fps),
        on: { click: () => set('fps', fps) },
      }))),
      el('div', { class: 'field__hint', text: `One frame is ${formatDuration(1 / state.settings.fps)}` }),
    ]),
    timeField({
      label: 'Minimum hold',
      value: state.settings.minHold,
      fps: state.settings.fps,
      max: 1,
      onChange: (v) => set('minHold', v),
      info: 'The shortest a shape may be shown. Below about two frames the eye reads a flicker rather than a movement.',
      hint: `${(state.settings.minHold * state.settings.fps).toFixed(1)} frames at ${state.settings.fps} fps`,
    }),
    toggle({
      label: 'Snap to the frame grid',
      checked: state.settings.quantise,
      onChange: (v) => set('quantise', v),
      info: 'Every cue boundary lands on a whole frame, so an animation package is never asked to change a drawing halfway through one.',
    }),
    slider({
      label: 'Phrase-final stretch',
      value: state.settings.emphasiseFinal, min: 1, max: 2, step: 0.05,
      format: (v) => `${v.toFixed(2)}×`,
      onChange: (v) => set('emphasiseFinal', v),
      info: 'How much the last vowel before a pause is drawn out. Real speech does this; a track without it sounds metronomic even though there is no sound.',
    }),
  ]));

  /* --- pauses ---------------------------------------------------------- */

  const setPause = (key, value) => {
    state.settings.pauses = { ...state.settings.pauses, [key]: value };
    app.refresh();
  };

  host.appendChild(section('Pauses', [
    ...[
      ['clause', 'Comma, semicolon, dash'],
      ['sentence', 'Full stop, question, exclamation'],
      ['line', 'Line break'],
      ['paragraph', 'Blank line'],
    ].map(([key, name]) => timeField({
      label: name,
      value: state.settings.pauses[key],
      fps: state.settings.fps,
      max: 10,
      onChange: (v) => setPause(key, v),
    })),
    timeField({
      label: 'Return to rest after',
      value: state.settings.restAfter,
      fps: state.settings.fps,
      max: 10,
      onChange: (v) => set('restAfter', v),
      info: 'A pause longer than this returns the character to the rest pose. A shorter one holds the shape it was already making — which is what people actually do at a comma.',
    }),
    timeField({
      label: 'Lead-in',
      value: state.settings.leadIn,
      fps: state.settings.fps, max: 10,
      onChange: (v) => set('leadIn', v),
    }),
    timeField({
      label: 'Tail',
      value: state.settings.tailOut,
      fps: state.settings.fps, max: 10,
      onChange: (v) => set('tailOut', v),
    }),
  ], { open: false }));

  /* --- audio ----------------------------------------------------------- */

  host.appendChild(audioSection(app));

  host.appendChild(section('This session', [
    buttonRow([
      {
        label: 'Reset timing',
        title: 'Put every timing setting back to its default. The script is left alone.',
        onClick: () => {
          state.settings = { ...TIMING_DEFAULTS, pauses: { ...TIMING_DEFAULTS.pauses } };
          app.refresh();
          toast('Timing reset');
        },
      },
    ]),
  ], { open: false }));

  return host;
}

function switchScheme(app, schemeId) {
  if (schemeId === app.state.schemeId) return;

  // Carry every character's artwork across rather than throwing it away, and say what
  // could not come.
  const { dropped } = setScheme(schemeId);
  app.refresh();

  if (dropped.length) {
    toast(`${dropped.length} pose${dropped.length === 1 ? '' : 's'} had no equivalent and were not carried over`);
  }
}

/* ---------------------------------------------------------------------------- *
 * Fitting to a recording
 * ---------------------------------------------------------------------------- */

function audioSection(app) {
  const { state } = app;
  const analysis = app.audio;

  const body = [];

  if (!analysis) {
    body.push(
      el('p', {
        class: 'field__hint',
        text: 'Load a recording of the line and the modelled timing is fitted onto the real take. The file is decoded in this browser and never uploaded.',
      }),
      filePicker({
        label: 'Load a recording…',
        accept: AUDIO_ACCEPT,
        onFiles: async ([file]) => {
          try {
            app.setAudio(await analyseAudioFile(file, {
              threshold: app.audioThreshold, minSilence: app.audioMinSilence,
            }));
            toast(`${file.name} loaded`);
          } catch (error) {
            toast(error.message || 'That file could not be decoded.');
          }
        },
      }),
    );
  } else {
    body.push(
      el('p', { class: 'field__hint' }, [
        el('strong', { text: analysis.name }), ' · ',
        formatDuration(analysis.duration), ' · ',
        `${analysis.silences.length} gaps heard`,
      ]),
      toggle({
        label: 'Fit to the recording',
        checked: app.fitAudio,
        onChange: (v) => { app.fitAudio = v; app.refresh(); },
        info: 'Off, the recording just plays alongside the modelled timing. On, the track is stretched onto it.',
      }),
      toggle({
        label: 'Match the pauses too',
        checked: app.fitPauses,
        onChange: (v) => { app.fitPauses = v; app.refresh(); },
        info: 'Beyond matching the overall length, match each gap heard in the recording to a pause in the script and fit each phrase separately.',
      }),
      slider({
        label: 'Silence threshold',
        value: app.audioThreshold, min: 0.01, max: 0.4, step: 0.01,
        format: (v) => `${Math.round(v * 100)}% of peak`,
        onChange: (v) => {
          app.audioThreshold = v;
          app.setAudio(remeasure(app.audio, { threshold: v, minSilence: app.audioMinSilence }));
        },
        info: 'How quiet counts as quiet. Raise it for a noisy recording, lower it if pauses are being missed.',
      }),
      el('p', { class: 'field__hint', text: app.fitDescription || '' }),
      buttonRow([
        {
          label: 'Remove recording',
          onClick: () => { releaseAudio(app.audio); app.setAudio(null); },
        },
      ]),
    );
  }

  return section('Recording', body, { open: Boolean(analysis) });
}

export { describeFit };
