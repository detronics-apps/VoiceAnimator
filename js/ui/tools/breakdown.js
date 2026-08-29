/**
 * The breakdown: every word, the sounds it was read as, and the shapes those become.
 *
 * This is where the tool admits what it cannot know. English spelling is not a function
 * of its pronunciation, so a rule-based reading of a script will get some words wrong;
 * the design answer is not a bigger rule table but a visible, editable row per word and
 * a correction that is remembered with the project.
 *
 * Every row is therefore both an explanation and a control.
 */

import { el, toast } from '../dom.js';
import { section, buttonRow, stat } from '../controls.js';
import { mouthOnly, MOUTH_BOX } from '../face-svg.js';
import { explainBreakdown } from '../explain.js';
import { visemeInfo } from '../../visemes.js';
import { PHONEMES, parsePhonemeString } from '../../g2p.js';
import { formatSeconds, formatDuration } from '../../timecode.js';
import { setOverride, clearOverride } from '../../state.js';

export const id = 'breakdown';
export const label = 'Breakdown';
export const shortLabel = 'Words';

const CHIP_WIDTH = 38;
const NEUTRAL_SHAPE = { open: 0, width: 0.5, round: 0.2, teeth: 0, tongue: 0, lipBite: 0, corner: 0.5 };

/** One mouth at chip size, letterboxed so a pucker and a wide vowel stay comparable. */
function mouthChip(shape) {
  const node = mouthOnly(shape ?? NEUTRAL_SHAPE);
  node.setAttribute('width', String(CHIP_WIDTH));
  node.setAttribute('height', String(Math.round(CHIP_WIDTH * MOUTH_BOX.height / MOUTH_BOX.width)));
  return node;
}

const SOURCE_LABEL = {
  override: 'yours',
  lexicon: 'exception list',
  rules: 'spelling rules',
};

export function stage(app) {
  const { track, state } = app;

  if (!track.words.length) {
    return el('div', { class: 'empty' }, [
      el('p', { text: 'Nothing to break down yet — type a script in the panel on the right.' }),
    ]);
  }

  const host = el('div', { class: 'breakdown' });

  const table = el('table', { class: 'table breakdown__table' });
  table.appendChild(el('thead', {}, [
    el('tr', {}, [
      el('th', { text: 'Word' }),
      el('th', { text: 'Sounds' }),
      el('th', { text: 'Mouth shapes' }),
      el('th', { class: 'num', text: 'Start' }),
      el('th', { class: 'num', text: 'Held' }),
      el('th', { text: 'Read from' }),
    ]),
  ]));

  const body = el('tbody', {});
  for (const word of track.words) body.appendChild(wordRow(app, word));
  table.appendChild(body);

  host.appendChild(el('div', { class: 'table-scroll' }, [table]));
  return host;
}

function wordRow(app, word) {
  const { state, player } = app;

  const shapes = el('div', { class: 'shape-row' });
  for (const [i, viseme] of word.visemes.entries()) {
    // Consecutive identical shapes are one picture on screen, so show them that way
    // here too - it is the single most useful thing this table teaches.
    if (i > 0 && word.visemes[i - 1] === viseme) continue;
    const info = visemeInfo(app.state.schemeId, viseme);
    const chip = el('span', {
      class: 'shape-chip',
      title: `${info?.title ?? viseme} — ${word.phonemes[i]}`,
    }, [
      mouthChip(info?.shape),
      el('span', { class: 'shape-chip__label', text: info?.label ?? viseme }),
    ]);
    shapes.appendChild(chip);
  }

  const sounds = el('input', {
    class: 'input input--phonemes value',
    value: word.phonemes.join(' '),
    'aria-label': `Sounds for “${word.raw}”`,
    spellcheck: 'false',
  });

  const commit = () => {
    const parsed = parsePhonemeString(sounds.value);

    if (!parsed.length) {
      sounds.value = word.phonemes.join(' ');
      sounds.classList.add('is-rejected');
      setTimeout(() => sounds.classList.remove('is-rejected'), 900);
      toast('Use ARPAbet sounds, like K AE T. Unknown ones are ignored.');
      return;
    }
    if (parsed.join(' ') === word.phonemes.join(' ')) return;

    // A word with several spoken parts - `1990` - can only be corrected as a whole, so
    // the override is keyed on the first spoken word of the group.
    setOverride(word.spoken[0], parsed);
    app.refresh();
    toast(`“${word.raw}” will be read as ${parsed.join(' ')} from now on`);
  };

  sounds.addEventListener('blur', commit);
  sounds.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); sounds.blur(); }
    if (event.key === 'Escape') { sounds.value = word.phonemes.join(' '); sounds.blur(); }
  });

  const row = el('tr', { class: word.source === 'override' ? 'is-overridden' : '' }, [
    el('td', {}, [
      el('button', {
        class: 'linkish',
        type: 'button',
        text: word.raw,
        title: 'Play from here',
        on: { click: () => { if (word.start !== null) player.seek(word.start); } },
      }),
      word.spoken.join(' ') !== word.raw.toLowerCase()
        ? el('div', { class: 'muted small', text: word.spoken.join(' ') })
        : null,
    ]),
    el('td', {}, [sounds]),
    el('td', {}, [shapes]),
    el('td', { class: 'num value', text: word.start === null ? '—' : `${formatSeconds(word.start)}s` }),
    el('td', { class: 'num value', text: word.start === null ? '—' : formatDuration(word.end - word.start) }),
    el('td', {}, [
      el('span', { class: `tag tag--${word.source}`, text: SOURCE_LABEL[word.source] }),
      word.source === 'override'
        ? el('button', {
          class: 'linkish small', type: 'button', text: 'reset',
          title: 'Go back to the built-in reading of this word',
          on: {
            click: () => {
              clearOverride(word.spoken[0]);
              app.refresh();
            },
          },
        })
        : null,
    ]),
  ]);

  return row;
}

export function readout(app) {
  const { track } = app;
  const counts = { override: 0, lexicon: 0, rules: 0 };
  for (const word of track.words) counts[word.source] += 1;

  return el('div', { class: 'readout' }, [
    stat('Words', String(track.words.length)),
    stat('Sounds', String(track.words.reduce((n, w) => n + w.phonemes.length, 0))),
    stat('Syllables', String(track.words.reduce((n, w) => n + w.syllables, 0))),
    stat('From the exception list', String(counts.lexicon)),
    stat('From the spelling rules', String(counts.rules)),
    stat('Corrected by you', String(counts.override), { tone: counts.override ? 'ok' : null }),
  ]);
}

export function explain(app) {
  return explainBreakdown(app.track);
}

/* ---------------------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------------------- */

export function sidebar(app) {
  const { state } = app;
  const host = el('div', { class: 'sidebar__body' });

  host.appendChild(section('Correcting a word', [
    el('p', { class: 'field__hint' }, [
      'Edit the ', el('strong', { text: 'Sounds' }),
      ' column and press Enter. The correction is kept with the project and applies ',
      'everywhere that word appears.',
    ]),
    el('p', { class: 'field__hint', text: 'Sounds are written in ARPAbet — the same notation Rhubarb and the CMU dictionary use.' }),
  ]));

  /* --- the phoneme reference ------------------------------------------- */

  const byClass = new Map();
  for (const [name, info] of Object.entries(PHONEMES)) {
    if (name === 'sil') continue;
    if (!byClass.has(info.class)) byClass.set(info.class, []);
    byClass.get(info.class).push([name, info]);
  }

  const reference = [...byClass].map(([className, list]) =>
    el('div', { class: 'phoneme-group' }, [
      el('div', { class: 'phoneme-group__title', text: className }),
      el('div', { class: 'phoneme-grid' }, list.map(([name, info]) => el('span', {
        class: 'phoneme-key',
        title: `${name} as in “${info.example}”`,
      }, [
        el('span', { class: 'phoneme-key__name value', text: name }),
        el('span', { class: 'phoneme-key__example', text: info.example }),
      ]))),
    ]));

  host.appendChild(section('Sounds you can use', reference, { open: false }));

  /* --- the override list ----------------------------------------------- */

  const overrides = Object.entries(state.overrides);
  host.appendChild(section(`Your corrections (${overrides.length})`, [
    overrides.length
      ? el('ul', { class: 'override-list' }, overrides.map(([word, phonemes]) =>
        el('li', { class: 'override-list__item' }, [
          el('span', { class: 'override-list__word', text: word }),
          el('span', { class: 'override-list__sounds value', text: phonemes }),
          el('button', {
            class: 'linkish small', type: 'button', text: 'remove',
            on: { click: () => { clearOverride(word); app.refresh(); } },
          }),
        ])))
      : el('p', { class: 'field__hint', text: 'None yet. Any word this tool reads wrongly can be corrected in the table.' }),
    overrides.length
      ? buttonRow([{
        label: 'Remove all corrections',
        onClick: () => {
          state.overrides = {};
          app.refresh();
          toast('Corrections cleared');
        },
      }])
      : null,
  ], { open: overrides.length > 0 }));

  return host;
}
