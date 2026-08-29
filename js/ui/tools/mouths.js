/**
 * The mouth set: your artwork, mapped onto the poses.
 *
 * Two ways in, because character artwork arrives as one or the other. Separate files get
 * matched by name; one contact sheet gets cut into cells. Both end up in the same place —
 * a data URL per pose, held in this browser and written into the project file if you save
 * one.
 *
 * The chart is the editor and the preview at once: a pose with artwork shows the artwork,
 * a pose without shows the built-in drawing, so a half-finished set is legible as a
 * half-finished set rather than as a broken one.
 */

import { el, toast } from '../dom.js';
import { capDiagramScale } from '../patterns.js';
import { slider, section, buttonRow, filePicker, stat } from '../controls.js';
import { chartSvg } from '../face-svg.js';
import { explainMouths } from '../explain.js';
import { downloadSvg, downloadPng, loadImageFile, cropCell } from '../export.js';
import { renderWarnings } from '../warnings.js';
import { planAssignment, sheetGrid, defaultCellAssignment } from '../../mouthset.js';
import {
  characterCoverage, characterWarnings, estimateCharacterBytes,
  withFrame, withoutFrame, withSlotImage, withoutSlotImage,
} from '../../character.js';
import { visemesOf, visemeInfo, getScheme } from '../../visemes.js';
import { activeCharacter, updateActiveCharacter, LIBRARY_STORAGE_LIMIT } from '../../state.js';

/**
 * Where a mouth picture goes depends on what kind of character it is.
 *
 * A layered character wants the mouth *layer*, which is composited onto its base at a
 * position. A character with no base image wants a whole frame, which replaces the
 * picture outright. Same drop, same filenames, different destination - so the tool does
 * not make the user think about which.
 */
const target = (character) => (character.base ? 'layer' : 'frame');

const putImage = (character, visemeId, image) => (target(character) === 'layer'
  ? withSlotImage(character, 'mouth', visemeId, image)
  : withFrame(character, visemeId, image));

const dropImage = (character, visemeId) => (target(character) === 'layer'
  ? withoutSlotImage(character, 'mouth', visemeId)
  : withoutFrame(character, visemeId));

const imagesOf = (character) => (target(character) === 'layer'
  ? character.slots.mouth.images
  : character.frames);

export const id = 'mouths';
export const label = 'Mouth set';
export const shortLabel = 'Mouths';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/** The sheet currently loaded for slicing, if any. Lives here, not in saved state. */
let sheet = null;

export function stage(app) {
  const { state } = app;
  const character = activeCharacter(state);
  const host = el('div', { class: 'mouths' });

  if (sheet) {
    host.appendChild(sheetStage(app));
    return host;
  }

  const chart = chartSvg(state.schemeId, {
    mouthSet: { images: imagesOf(character) },
    cols: 4,
    onPick: (visemeId) => pickForViseme(app, visemeId),
  });

  host.appendChild(chart);
  host.appendChild(el('p', {
    class: 'stage__caption',
    text: target(character) === 'layer'
      ? `Mouth pictures for ${character.name}, composited onto its face. Click a pose to give it one.`
      : `Whole-frame pictures for ${character.name}. Click a pose to give it one, or add a character picture on the Character tab to layer instead.`,
  }));

  capDiagramScale(host);
  return host;
}

/* ---------------------------------------------------------------------------- *
 * Cutting up a contact sheet
 * ---------------------------------------------------------------------------- */

function sheetStage(app) {
  const { state } = app;
  const { image, src, name } = sheet;
  const cells = sheetGrid(image.naturalWidth, image.naturalHeight, state.sheet);

  const host = el('div', { class: 'sheet' });

  // The overlay is an SVG in the image's own coordinates, so a cell drawn here is
  // exactly the pixels that will be cut.
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  overlay.setAttribute('viewBox', `0 0 ${image.naturalWidth} ${image.naturalHeight}`);
  overlay.setAttribute('class', 'sheet__overlay');

  const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  img.setAttribute('href', src);
  img.setAttribute('x', '0');
  img.setAttribute('y', '0');
  img.setAttribute('width', String(image.naturalWidth));
  img.setAttribute('height', String(image.naturalHeight));
  overlay.appendChild(img);

  const assignment = sheet.assignment;
  const byCell = new Map();
  for (const [visemeId, index] of Object.entries(assignment)) byCell.set(index, visemeId);

  for (const cell of cells) {
    const visemeId = byCell.get(cell.index);
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `sheet__cell${visemeId ? ' is-assigned' : ''}`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', String(cell.x));
    rect.setAttribute('y', String(cell.y));
    rect.setAttribute('width', String(cell.width));
    rect.setAttribute('height', String(cell.height));
    group.appendChild(rect);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(cell.x + 8));
    text.setAttribute('y', String(cell.y + 26));
    text.setAttribute('class', 'sheet__cell-label');
    text.textContent = visemeId
      ? `${cell.index + 1} · ${visemeInfo(state.schemeId, visemeId)?.label ?? visemeId}`
      : String(cell.index + 1);
    group.appendChild(text);

    overlay.appendChild(group);
  }

  host.appendChild(overlay);
  host.appendChild(el('p', {
    class: 'stage__caption',
    text: `${name} · ${image.naturalWidth}×${image.naturalHeight} · ${cells.length} cells. `
      + 'Set the grid on the right so each box lands on one pose, then cut.',
  }));

  return host;
}

async function cutSheet(app) {
  const { state } = app;
  const cells = sheetGrid(sheet.image.naturalWidth, sheet.image.naturalHeight, state.sheet);
  const byIndex = new Map(cells.map((cell) => [cell.index, cell]));

  let character = activeCharacter(state);
  let cut = 0;

  for (const [visemeId, index] of Object.entries(sheet.assignment)) {
    const cell = byIndex.get(index);
    if (!cell) continue;
    const image = cropCell(sheet.image, cell);
    character = putImage(character, visemeId, { ...image, name: `${sheet.name} · cell ${index + 1}` });
    cut += 1;
  }

  updateActiveCharacter(character);
  sheet = null;
  app.refresh();
  toast(`${cut} pose${cut === 1 ? '' : 's'} cut from the sheet`);
}

/* ---------------------------------------------------------------------------- *
 * Assigning one pose
 * ---------------------------------------------------------------------------- */

function pickForViseme(app, visemeId) {
  const input = el('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'visually-hidden' });
  document.body.appendChild(input);

  input.addEventListener('change', async () => {
    const [file] = input.files ?? [];
    input.remove();
    if (!file) return;
    try {
      const { image, src, name } = await loadImageFile(file);
      updateActiveCharacter(putImage(activeCharacter(app.state), visemeId, {
        src, width: image.naturalWidth, height: image.naturalHeight, name,
      }));
      app.refresh();
      toast(`${name} → ${visemeInfo(app.state.schemeId, visemeId)?.title ?? visemeId}`);
    } catch (error) {
      toast(error.message);
    }
  });

  input.click();
}

async function dropFiles(app, files) {
  const { state } = app;
  const plan = planAssignment(files, state.schemeId);

  let character = activeCharacter(state);
  let placed = 0;

  for (const match of plan.matches) {
    try {
      const { image, src, name } = await loadImageFile(files[match.index]);
      character = putImage(character, match.viseme, {
        src, width: image.naturalWidth, height: image.naturalHeight, name,
      });
      placed += 1;
    } catch (error) {
      toast(error.message);
    }
  }

  updateActiveCharacter(character);
  app.refresh();

  const notes = [`${placed} pose${placed === 1 ? '' : 's'} assigned`];
  if (plan.unmatched.length) notes.push(`${plan.unmatched.length} not recognised by name`);
  if (plan.clashes.length) notes.push(`${plan.clashes.length} clash${plan.clashes.length === 1 ? '' : 'es'}`);
  toast(notes.join(' · '));
}

/* ---------------------------------------------------------------------------- *
 * Readout, explanation and controls
 * ---------------------------------------------------------------------------- */

export function readout(app) {
  const { state } = app;
  const character = activeCharacter(state);
  const cover = characterCoverage(character, state.schemeId);
  const bytes = estimateCharacterBytes(character);
  const fits = bytes <= LIBRARY_STORAGE_LIMIT;

  return el('div', { class: 'readout' }, [
    stat('Character', character.name),
    stat('Goes to', target(character) === 'layer' ? 'the mouth layer' : 'whole frames'),
    stat('Mouth shapes drawn', `${cover.assigned.length} of ${cover.total}`,
      { tone: cover.complete ? 'ok' : null }),
    stat('Set size', bytes ? `${(bytes / 1024).toFixed(0)} kB` : '—',
      { tone: bytes && !fits ? 'warn' : null }),
    stat('Kept between visits', fits ? 'yes' : 'save a project file'),
  ]);
}

export function warnings(app) {
  return characterWarnings(activeCharacter(app.state), app.state.schemeId);
}

export function explain(app) {
  const character = activeCharacter(app.state);
  return explainMouths(app.state.schemeId, { images: imagesOf(character) },
    characterCoverage(character, app.state.schemeId));
}

export function sidebar(app) {
  const { state } = app;
  const host = el('div', { class: 'sidebar__body' });
  const scheme = getScheme(state.schemeId);

  /* --- separate files --------------------------------------------------- */

  host.appendChild(section('Separate files', [
    el('p', { class: 'field__hint' }, [
      'Drop in one image per pose. Files named after the pose — ',
      el('code', { text: 'MBP.png' }), ', ', el('code', { text: 'AI.png' }), ', ',
      el('code', { text: 'smile.png' }),
      ' — land in the right slot on their own. Nothing is uploaded.',
    ]),
    filePicker({
      label: 'Choose images…',
      accept: IMAGE_ACCEPT,
      multiple: true,
      onFiles: (files) => dropFiles(app, files),
    }),
  ]));

  /* --- a contact sheet -------------------------------------------------- */

  const sheetBody = [];

  if (!sheet) {
    sheetBody.push(
      el('p', {
        class: 'field__hint',
        text: 'Or load one image with every pose on it, set the grid, and cut it into poses.',
      }),
      filePicker({
        label: 'Load a sheet…',
        accept: IMAGE_ACCEPT,
        onFiles: async ([file]) => {
          try {
            const loaded = await loadImageFile(file);
            const cells = sheetGrid(
              loaded.image.naturalWidth, loaded.image.naturalHeight, state.sheet,
            );
            sheet = {
              ...loaded,
              assignment: defaultCellAssignment(state.schemeId, cells.length),
            };
            app.rerender();
          } catch (error) {
            toast(error.message);
          }
        },
      }),
    );
  } else {
    const setGrid = (key, value) => {
      state.sheet = { ...state.sheet, [key]: value };
      const cells = sheetGrid(sheet.image.naturalWidth, sheet.image.naturalHeight, state.sheet);
      sheet.assignment = defaultCellAssignment(state.schemeId, cells.length);
      app.rerender();
    };

    sheetBody.push(
      slider({
        label: 'Columns', value: state.sheet.cols, min: 1, max: 12, step: 1,
        format: String, onChange: (v) => setGrid('cols', v),
      }),
      slider({
        label: 'Rows', value: state.sheet.rows, min: 1, max: 12, step: 1,
        format: String, onChange: (v) => setGrid('rows', v),
      }),
      slider({
        label: 'Outer margin', value: state.sheet.padding, min: 0, max: 200, step: 2,
        format: (v) => `${v} px`, onChange: (v) => setGrid('padding', v),
      }),
      slider({
        label: 'Gap between cells', value: state.sheet.gap, min: 0, max: 200, step: 2,
        format: (v) => `${v} px`, onChange: (v) => setGrid('gap', v),
      }),
      slider({
        label: 'Caption strip', value: state.sheet.labelHeight, min: 0, max: 200, step: 2,
        format: (v) => `${v} px`, onChange: (v) => setGrid('labelHeight', v),
        info: 'Most sheets print a label under each pose. Trim it off here, or it is baked into every mouth.',
      }),
      cellAssignmentList(app),
      buttonRow([
        { label: 'Cut into poses', primary: true, onClick: () => cutSheet(app) },
        { label: 'Cancel', onClick: () => { sheet = null; app.rerender(); } },
      ]),
    );
  }

  host.appendChild(section('One contact sheet', sheetBody, { open: Boolean(sheet) }));

  /* --- what is in the set ----------------------------------------------- */

  const character = activeCharacter(state);
  const images = imagesOf(character);
  const assigned = visemesOf(state.schemeId).filter((v) => images[v.id]);

  host.appendChild(section(`In this set (${assigned.length})`, [
    assigned.length
      ? el('ul', { class: 'set-list' }, assigned.map((viseme) => el('li', { class: 'set-list__item' }, [
        el('span', { class: 'set-list__pose', text: viseme.label }),
        el('span', { class: 'set-list__file muted small', text: images[viseme.id].name || 'image' }),
        el('button', {
          class: 'linkish small', type: 'button', text: 'remove',
          on: {
            click: () => {
              updateActiveCharacter(dropImage(activeCharacter(state), viseme.id));
              app.refresh();
            },
          },
        }),
      ])))
      : el('p', { class: 'field__hint', text: 'Nothing yet. Every pose is drawn by the app until you add artwork.' }),
    assigned.length
      ? buttonRow([{
        label: 'Remove all mouth artwork',
        onClick: () => {
          let next = activeCharacter(state);
          for (const viseme of assigned) next = dropImage(next, viseme.id);
          updateActiveCharacter(next);
          app.refresh();
          toast('Mouth artwork removed');
        },
      }])
      : null,
  ], { open: assigned.length > 0 }));

  /* --- exporting the chart ---------------------------------------------- */

  host.appendChild(section('Export the chart', [
    el('p', {
      class: 'field__hint',
      text: 'A blank chart is a useful thing to hand an illustrator: it names every pose and shows what each one is.',
    }),
    buttonRow([
      {
        label: 'SVG',
        onClick: () => {
          const node = document.querySelector('.mouths .chart');
          if (node) downloadSvg(node, `${scheme.id}-chart`);
        },
      },
      {
        label: 'PNG',
        onClick: async () => {
          const node = document.querySelector('.mouths .chart');
          if (node) await downloadPng(node, `${scheme.id}-chart`);
        },
      },
    ]),
  ], { open: false }));

  return host;
}

/** Which cell goes with which pose, when the default sheet order is not right. */
function cellAssignmentList(app) {
  const { state } = app;
  const cells = sheetGrid(sheet.image.naturalWidth, sheet.image.naturalHeight, state.sheet);
  const options = [{ value: '', label: '— none —' }, ...cells.map((cell) => ({
    value: String(cell.index), label: `Cell ${cell.index + 1}`,
  }))];

  return el('div', { class: 'cell-map' }, visemesOf(state.schemeId).map((viseme) => {
    const current = sheet.assignment[viseme.id];
    const select = el('select', {
      class: 'select select--small',
      on: {
        change: (event) => {
          const value = event.target.value;
          if (value === '') delete sheet.assignment[viseme.id];
          else sheet.assignment[viseme.id] = Number(value);
          app.rerender();
        },
      },
    });
    for (const option of options) {
      select.appendChild(el('option', {
        value: option.value,
        text: option.label,
        selected: option.value === (current === undefined ? '' : String(current)),
      }));
    }
    select.value = current === undefined ? '' : String(current);

    return el('div', { class: 'cell-map__row' }, [
      el('span', { class: 'cell-map__pose', text: viseme.label }),
      select,
    ]);
  }));
}

export { renderWarnings };
