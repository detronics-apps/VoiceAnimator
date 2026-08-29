/**
 * Control builders, in the house pattern: the slider and the number field edit the same
 * value, in either direction, and the typed one is forgiving.
 *
 * The Bench accepts `4k7` for a resistor. The equivalent here is a time field that
 * accepts `1.5`, `1500ms`, `36f` or `00:00:01:12` and means the same instant by all of
 * them, which is `parseTime` in js/timecode.js doing the work.
 */

import { el, field, infoIcon } from './dom.js';
import { parseTime, formatDuration } from '../timecode.js';

/**
 * A slider paired with a live readout.
 *
 * @param {object} spec
 * @param {string} spec.label
 * @param {number} spec.value
 * @param {(value:number)=>void} spec.onChange fired live while dragging
 * @param {(value:number)=>string} [spec.format] how the readout reads
 */
export function slider({
  label, value, min, max, step = 1, onChange, format = String, info, hint,
}) {
  const readout = el('output', { class: 'control__readout value', text: format(value) });

  const input = el('input', {
    type: 'range',
    class: 'control__range',
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    on: {
      input: (event) => {
        const next = Number(event.target.value);
        readout.textContent = format(next);
        onChange(next);
      },
    },
  });

  return el('div', { class: 'control' }, [
    el('div', { class: 'control__head' }, [
      el('label', { class: 'control__label', for: input.id || undefined }, [
        label, info ? infoIcon(info) : null,
      ]),
      readout,
    ]),
    input,
    hint ? el('div', { class: 'field__hint', text: hint }) : null,
  ]);
}

/**
 * A time field that accepts every way a person writes a duration.
 *
 * Commits on blur and on Enter rather than on every keystroke: committing mid-type turns
 * `1.5` into `1` for one frame, which resets the track and moves the playhead under the
 * user's hands.
 */
export function timeField({ label, value, onChange, fps = 24, min = 0, max = 60, info, hint }) {
  const input = el('input', {
    type: 'text',
    class: 'input input--time value',
    inputmode: 'decimal',
    value: formatDuration(value),
    'aria-label': label,
  });

  const commit = () => {
    const parsed = parseTime(input.value, fps);
    if (parsed === null) {
      input.value = formatDuration(value);            // unreadable: put back what was there
      input.classList.add('is-rejected');
      setTimeout(() => input.classList.remove('is-rejected'), 900);
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    input.value = formatDuration(clamped);
    onChange(clamped);
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); input.blur(); }
  });

  return field(label, input, { info, hint });
}

/** A labelled checkbox. */
export function toggle({ label, checked, onChange, info, hint }) {
  const input = el('input', {
    type: 'checkbox',
    class: 'toggle__input',
    checked: checked === true,
    on: { change: (event) => onChange(event.target.checked) },
  });

  return el('div', { class: 'field' }, [
    el('label', { class: 'toggle' }, [
      input,
      el('span', { class: 'toggle__label' }, [label, info ? infoIcon(info) : null]),
    ]),
    hint ? el('div', { class: 'field__hint', text: hint }) : null,
  ]);
}

/** A collapsible group of controls. Open by default; the state is remembered by the DOM. */
export function section(title, children, { open = true, info } = {}) {
  return el('details', { class: 'section', open }, [
    el('summary', { class: 'section__summary' }, [title, info ? infoIcon(info) : null]),
    el('div', { class: 'section__body' }, children),
  ]);
}

/** A row of buttons. */
export function buttonRow(buttons) {
  return el('div', { class: 'button-row' }, buttons.map((spec) => el('button', {
    class: `btn${spec.primary ? ' btn-primary' : ''}`,
    type: 'button',
    title: spec.title ?? null,
    disabled: spec.disabled === true,
    text: spec.label,
    on: { click: spec.onClick },
  })));
}

/** A file input dressed as a button, because the native one cannot be styled. */
export function filePicker({ label, accept, multiple = false, onFiles, title }) {
  const input = el('input', {
    type: 'file',
    accept,
    multiple,
    class: 'visually-hidden',
    on: {
      change: (event) => {
        const files = [...event.target.files];
        event.target.value = '';                      // so the same file can be picked twice
        if (files.length) onFiles(files);
      },
    },
  });

  const button = el('button', {
    class: 'btn', type: 'button', text: label, title: title ?? null,
    on: { click: () => input.click() },
  });

  return el('span', { class: 'file-picker' }, [button, input]);
}

/** A read-only value with a label, for the readout strip. */
export function stat(label, value, { tone = null } = {}) {
  return el('div', { class: `stat${tone ? ` stat--${tone}` : ''}` }, [
    el('div', { class: 'stat__label', text: label }),
    el('div', { class: 'stat__value value', text: value }),
  ]);
}
