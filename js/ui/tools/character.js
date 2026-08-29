/**
 * The character editor: upload a drawing, put the parts where they belong.
 *
 * The stage is the editor. You drag the mouth onto the face rather than typing
 * coordinates at it, and the numeric fields are there for the last two pixels and for
 * saying what the drag did — the same bidirectional pattern the rest of the app uses,
 * where the picture and the number edit one object in either direction.
 *
 * One deliberate choice worth naming: the pose being previewed is a control, not a
 * consequence. Positioning a mouth against the *closed* pose is misleading, because the
 * closed pose is the smallest one; you want to check the widest and the narrowest before
 * calling it placed. So the preview pose is a row of chips, and the drag handles stay
 * live whichever one is showing.
 */

import { el, toast, infoIcon } from '../dom.js';
import { capDiagramScale } from '../patterns.js';
import { slider, section, buttonRow, filePicker, stat, toggle } from '../controls.js';
import { compositeSvg } from '../face-svg.js';
import { explainPanel } from '../explain.js';
import { loadImageFile, downloadPng } from '../export.js';
import {
  SLOTS, SLOT_INFO, slotStates, withBase, withPlacement, withSlotImage, withoutSlotImage,
  emptyCharacter, duplicateCharacter, canvasFor, characterCoverage, characterWarnings,
  estimateCharacterBytes, initialPlacement,
  distance, scaleAfterDrag, rotationFromPointer, snapRotation,
  resolveSlot, effectivePlacement, adjustFromPlacement, withAdjust, withoutAdjust,
  clearAdjusts, adjustedStates, slotAdjust, hasAdjust,
} from '../../character.js';
import { visemeInfo, mouthVisemesOf, getScheme } from '../../visemes.js';
import { activeCharacter, updateActiveCharacter } from '../../state.js';

export const id = 'character';
export const label = 'Character';
export const shortLabel = 'Rig';

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/**
 * Editor-only view state.
 *
 * `perPose` is the one that matters: with it off a drag moves the whole slot, with it on
 * the same drag moves only the pose being previewed. Two modes rather than two sets of
 * handles, because the gesture is identical and only its destination differs.
 */
let editing = { slot: 'mouth', viseme: null, expression: 'neutral', perPose: false };

const current = (app) => activeCharacter(app.state);

/**
 * What the editor is currently showing for one slot: the slot's own placement, the
 * placement actually drawn once this pose's adjustment is folded in, and which pose that
 * is. Read through `resolveSlot` rather than recomputed, so the editor can only ever
 * adjust the pose that is genuinely on screen - including when an undrawn expression has
 * fallen back to neutral.
 */
function slotView(app, slot) {
  const character = current(app);
  const resolved = resolveSlot(character, slot, {
    viseme: previewViseme(app),
    expression: editing.expression === 'neutral' ? null : editing.expression,
    includeEmpty: true,
  });
  return {
    character,
    base: character.slots[slot].placement,
    effective: resolved.placement ?? character.slots[slot].placement,
    stateKey: resolved.stateKey ?? null,
  };
}

/**
 * Write a placement produced by a gesture to wherever it belongs.
 *
 * `wanted` is a partial *effective* placement - what should now be on screen. In whole-
 * slot mode the same movement is applied to the slot's own placement, so every pose
 * shifts together; in per-pose mode only this pose's delta changes.
 */
function commitPlacement(app, slot, wanted) {
  const { character, base, effective, stateKey } = slotView(app, slot);
  const target = { ...effective, ...wanted };
  const delta = adjustFromPlacement(effective, target);

  if (editing.perPose && stateKey) {
    updateActiveCharacter(withAdjust(character, slot, stateKey,
      adjustFromPlacement(base, target)));
  } else {
    updateActiveCharacter(withPlacement(character, slot,
      effectivePlacement(base, delta, canvasFor(character))));
  }
}

function previewViseme(app) {
  const scheme = getScheme(app.state.schemeId);
  if (editing.viseme && scheme.byId[editing.viseme]) return editing.viseme;
  // Default to the widest mouth: a part that fits the widest pose fits them all.
  return mouthVisemesOf(scheme.id).reduce(
    (widest, v) => (v.shape.open > (scheme.byId[widest]?.shape.open ?? -1) ? v.id : widest),
    scheme.rest,
  );
}

/* ---------------------------------------------------------------------------- *
 * The stage
 * ---------------------------------------------------------------------------- */

export function stage(app) {
  const character = current(app);
  const host = el('div', { class: 'rig' });

  if (!character.base && character.kind !== 'layers') {
    host.appendChild(emptyState(app));
    return host;
  }

  const viseme = previewViseme(app);
  const canvas = canvasFor(character);

  const svgNode = compositeSvg({
    viseme,
    schemeId: app.state.schemeId,
    character,
    expression: editing.expression === 'neutral' ? null : editing.expression,
    editable: true,
    selectedSlot: editing.slot,
  });
  svgNode.classList.add('rig__canvas');

  for (const group of svgNode.querySelectorAll('[data-slot]')) {
    if (group.dataset.slot === editing.slot) group.classList.add('is-selected');
  }

  attachDragging(app, svgNode, canvas);

  host.appendChild(partPicker(app, character));
  host.appendChild(svgNode);
  const { stateKey } = slotView(app, editing.slot);
  host.appendChild(el('p', {
    class: 'stage__caption',
    text: editing.perPose
      ? `Drag, resize or rotate to change the ${stateKey ?? 'current'} pose only. Every other pose stays where it is.`
      : `Drag ${SLOT_INFO[editing.slot].label.toLowerCase()} to move it, the corners to resize, the handle above to rotate. `
        + `Arrow keys nudge, + and − resize. Showing the ${visemeInfo(app.state.schemeId, viseme)?.title?.toLowerCase() ?? viseme} pose.`,
  }));

  capDiagramScale(host);
  return host;
}

/**
 * Which part is being edited.
 *
 * A row of chips rather than only click-to-select, because a slot with no artwork and
 * nothing drawn has nothing on the stage to click - and positioning the brows *before*
 * uploading them is exactly when you want to.
 */
function partPicker(app, character) {
  return el('div', { class: 'rig__parts' }, SLOTS.slice().reverse().map((slot) => {
    const count = Object.keys(character.slots[slot].images).length;
    const hidden = character.slots[slot].placement.visible === false;
    return el('button', {
      class: 'chip', type: 'button',
      'aria-pressed': String(slot === editing.slot),
      title: SLOT_INFO[slot].note,
      text: `${SLOT_INFO[slot].label}${count ? ` · ${count}` : ''}${hidden ? ' · off' : ''}`,
      on: {
        click: () => { editing.slot = slot; app.rerender(); },
      },
    });
  }));
}

function emptyState(app) {
  return el('div', { class: 'empty rig__empty' }, [
    el('p', { text: 'No character drawing yet.' }),
    el('p', {
      class: 'muted',
      text: 'Upload a picture of your character — a drawing, an export from anywhere, a photograph — and a mouth is placed on it straight away. It will speak before you have drawn a single mouth of your own.',
    }),
    filePicker({
      label: 'Upload a character…',
      accept: IMAGE_ACCEPT,
      onFiles: ([file]) => uploadBase(app, file),
    }),
  ]);
}

/* ---------------------------------------------------------------------------- *
 * Dragging
 * ---------------------------------------------------------------------------- */

/**
 * Convert a pointer position to canvas coordinates.
 *
 * The SVG is scaled to fit the panel, so a client pixel is not a canvas unit. Reading
 * the ratio from the rendered box each time - rather than caching it - is what keeps the
 * drag correct after a window resize or a scroll.
 */
function toCanvas(event, svgNode, canvas) {
  const box = svgNode.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return {
    x: ((event.clientX - box.left) / box.width) * canvas.width,
    y: ((event.clientY - box.top) / box.height) * canvas.height,
  };
}

/**
 * One pointer handler for three gestures.
 *
 * Which one it is depends on what was grabbed: a corner resizes, the handle above
 * rotates, anything else moves. They share a body because they share everything that is
 * awkward - pointer capture, converting to canvas units, and committing once at the end
 * rather than on every pointer event.
 *
 * Nothing is written to the character until the gesture finishes. During the drag only
 * the one SVG group's transform is touched, so a resize does not rebuild the sidebar
 * sixty times a second.
 */
function attachDragging(app, svgNode, canvas) {
  svgNode.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const group = event.target.closest('[data-slot]');
    if (!group) return;

    const slot = group.dataset.slot;
    const start = toCanvas(event, svgNode, canvas);
    if (!start) return;

    const origin = { ...slotView(app, slot).effective };
    const handle = event.target.dataset?.handle ?? null;
    const mode = handle === 'rotate' ? 'rotate' : (handle ? 'scale' : 'move');
    const centre = { x: origin.x, y: origin.y };
    const startDistance = distance(centre, start);

    editing.slot = slot;
    let changed = null;

    svgNode.setPointerCapture?.(event.pointerId);
    event.preventDefault();

    const paint = (next) => {
      group.setAttribute('transform',
        `translate(${next.x.toFixed(1)} ${next.y.toFixed(1)}) rotate(${next.rotation.toFixed(1)})`);
    };

    const move = (e) => {
      const point = toCanvas(e, svgNode, canvas);
      if (!point) return;

      if (mode === 'move') {
        changed = { x: origin.x + (point.x - start.x), y: origin.y + (point.y - start.y) };
        paint({ ...origin, ...changed });
      } else if (mode === 'scale') {
        changed = { scale: scaleAfterDrag(origin.scale, startDistance, distance(centre, point)) };
        // Scale is on the parts inside the group, so the live preview scales the group
        // itself and the commit re-renders it properly.
        group.setAttribute('transform',
          `translate(${origin.x.toFixed(1)} ${origin.y.toFixed(1)}) rotate(${origin.rotation.toFixed(1)}) scale(${(changed.scale / origin.scale).toFixed(4)})`);
      } else {
        const raw = rotationFromPointer(centre, point);
        changed = { rotation: e.shiftKey ? snapRotation(raw, 15) : raw };
        paint({ ...origin, ...changed });
      }
    };

    const up = () => {
      svgNode.removeEventListener('pointermove', move);
      svgNode.removeEventListener('pointerup', up);
      svgNode.removeEventListener('pointercancel', up);

      if (changed) commitPlacement(app, slot, changed);
      // Even a click with no movement selects the part, which is how you pick one.
      app.refresh();
    };

    svgNode.addEventListener('pointermove', move);
    svgNode.addEventListener('pointerup', up);
    svgNode.addEventListener('pointercancel', up);
  });

  // Keyboard nudging, for the last pixel that a pointer will not give you.
  svgNode.setAttribute('tabindex', '0');
  svgNode.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 10 : 1;
    const placement = slotView(app, editing.slot).effective;
    const patch = {};

    if (event.key === 'ArrowLeft') patch.x = placement.x - step;
    else if (event.key === 'ArrowRight') patch.x = placement.x + step;
    else if (event.key === 'ArrowUp') patch.y = placement.y - step;
    else if (event.key === 'ArrowDown') patch.y = placement.y + step;
    else if (event.key === '+' || event.key === '=') patch.scale = placement.scale * 1.05;
    else if (event.key === '-' || event.key === '_') patch.scale = placement.scale / 1.05;
    else if (event.key === '[') patch.rotation = placement.rotation - step;
    else if (event.key === ']') patch.rotation = placement.rotation + step;
    else return;

    event.preventDefault();
    commitPlacement(app, editing.slot, patch);
    app.refresh();
    document.querySelector('.rig__canvas')?.focus();
  });
}

/* ---------------------------------------------------------------------------- *
 * Uploads
 * ---------------------------------------------------------------------------- */

async function uploadBase(app, file) {
  if (!file) return;
  try {
    const { image, src, name } = await loadImageFile(file);
    updateActiveCharacter(withBase(current(app), {
      src, width: image.naturalWidth, height: image.naturalHeight, name,
    }));
    editing.slot = 'mouth';
    app.refresh();
    toast(`${name} loaded — drag the mouth onto the face`);
  } catch (error) {
    toast(error.message);
  }
}

async function uploadSlotImage(app, slot, stateKey, file) {
  if (!file) return;
  try {
    const { image, src, name } = await loadImageFile(file);
    updateActiveCharacter(withSlotImage(current(app), slot, stateKey, {
      src, width: image.naturalWidth, height: image.naturalHeight, name,
    }));
    app.refresh();
    toast(`${name} → ${SLOT_INFO[slot].label} · ${stateKey}`);
  } catch (error) {
    toast(error.message);
  }
}

/* ---------------------------------------------------------------------------- *
 * Readout, warnings, explanation
 * ---------------------------------------------------------------------------- */

export function readout(app) {
  const character = current(app);
  const cover = characterCoverage(character, app.state.schemeId);
  const canvas = canvasFor(character);
  const bytes = estimateCharacterBytes(character);

  return el('div', { class: 'readout' }, [
    stat('Character', character.name),
    stat('Kind', { drawn: 'built-in drawing', frames: 'whole frames', layers: 'layered' }[cover.kind]),
    stat('Canvas', `${Math.round(canvas.width)} × ${Math.round(canvas.height)}`),
    stat('Mouths drawn', `${cover.assigned.length} of ${cover.total}`,
      { tone: cover.complete ? 'ok' : null }),
    stat('Brows / eyes', `${cover.brows} / ${cover.eyes}`),
    stat('Size', bytes ? `${(bytes / 1024).toFixed(0)} kB` : '—'),
  ]);
}

export function warnings(app) {
  return characterWarnings(current(app), app.state.schemeId);
}

export function explain(app) {
  const character = current(app);
  const cover = characterCoverage(character, app.state.schemeId);
  const mouth = character.slots.mouth.placement;
  const canvas = canvasFor(character);

  return el('div', { class: 'explain-stack' }, [
    explainPanel({
      title: 'How a character is put together',
      plain:
        'A still drawing of your character, with a mouth placed on top of it that is swapped once per sound. ' +
        'That is the whole trick — the head never moves, only the parts you have layered onto it. ' +
        'Brows and eyes work the same way but are swapped by expression rather than by sound, which is why ' +
        'a character with nothing but a base image and the built-in mouths already reads as speaking.',
      formula: [
        'base image            drawn once, never changes',
        '  + eyes    [expression, or closed for a blink]',
        '  + brows   [expression]',
        '  + mouth   [viseme]   <- swapped every cue',
        '',
        'each part:  translate(x, y) rotate(r) scale(s), centred on its own middle',
      ].join('\n'),
      worked: [
        `${character.name} · ${cover.kind} · canvas ${Math.round(canvas.width)} × ${Math.round(canvas.height)}`,
        `mouth at (${Math.round(mouth.x)}, ${Math.round(mouth.y)}) at ${Math.round(mouth.scale * 100)}%${mouth.rotation ? `, rotated ${Math.round(mouth.rotation)}°` : ''}`,
        cover.assigned.length
          ? `${cover.assigned.length} of ${cover.total} mouths are your artwork; the rest are drawn by the app`
          : `all ${cover.total} mouths are drawn by the app — upload your own to replace them one at a time`,
      ].join('\n'),
    }, { open: true }),

    explainPanel({
      title: 'Getting the mouth in the right place',
      plain:
        'Position against the widest pose, not the closed one. The closed mouth is the smallest thing in the ' +
        'set, so a mouth that looks right on it will be too small on everything else and the character will ' +
        'appear to mumble. Set the preview to the wide open pose, size it to the face, then check the pucker ' +
        'and the closed pose look sane at that size.',
      formula: [
        '1  preview the widest pose  (A E I)',
        '2  drag the mouth onto the face',
        '3  size it until it fits that pose',
        '4  check the closed pose still reads as closed',
      ].join('\n'),
      worked: 'Nothing here is baked in — the placement is one set of numbers, and moving it later re-times nothing.',
    }),
  ]);
}

/* ---------------------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------------------- */

export function sidebar(app) {
  const character = current(app);
  const host = el('div', { class: 'sidebar__body' });

  host.appendChild(librarySection(app));
  host.appendChild(baseSection(app, character));

  if (character.base) {
    host.appendChild(previewSection(app));
    for (const slot of [...SLOTS].reverse()) host.appendChild(slotSection(app, character, slot));
    host.appendChild(blinkSection(app));
  }

  return host;
}

/* --- the library ------------------------------------------------------- */

function librarySection(app) {
  const { characters, activeCharacterId } = app.state;
  const character = current(app);

  const nameInput = el('input', {
    class: 'input',
    value: character.name,
    'aria-label': 'Character name',
    on: {
      change: (event) => {
        const name = event.target.value.trim().slice(0, 60) || 'Character';
        updateActiveCharacter({ ...current(app), name });
        app.refresh();
      },
    },
  });

  return section('Characters', [
    el('div', { class: 'chipset chipset--stack' }, characters.map((entry) => el('button', {
      class: 'chip', type: 'button',
      'aria-pressed': String(entry.id === activeCharacterId),
      text: `${entry.name}${entry.kind === 'drawn' ? ' · undrawn' : ''}`,
      on: {
        click: () => {
          app.state.activeCharacterId = entry.id;
          editing = { ...editing, slot: 'mouth' };
          app.refresh();
        },
      },
    }))),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Name' }),
      nameInput,
      el('div', { class: 'field__hint' }, [
        'Write ', el('code', { text: `[as ${character.name.toLowerCase()}]` }),
        ' in the script to hand the next lines to this character.',
      ]),
    ]),

    buttonRow([
      {
        label: 'Add',
        onClick: () => {
          const added = emptyCharacter(`Character ${app.state.characters.length + 1}`, app.state.schemeId);
          app.state.characters = [...app.state.characters, added];
          app.state.activeCharacterId = added.id;
          app.refresh();
        },
      },
      {
        label: 'Duplicate',
        onClick: () => {
          const copy = duplicateCharacter(current(app), `${current(app).name} copy`);
          app.state.characters = [...app.state.characters, copy];
          app.state.activeCharacterId = copy.id;
          app.refresh();
          toast('Duplicated — the artwork and the placement came with it');
        },
      },
      {
        label: 'Remove',
        disabled: characters.length < 2,
        title: characters.length < 2 ? 'There is always at least one character' : null,
        onClick: () => {
          const removed = current(app);
          app.state.characters = app.state.characters.filter((c) => c.id !== removed.id);
          app.state.activeCharacterId = app.state.characters[0].id;
          app.refresh();
          toast(`${removed.name} removed`);
        },
      },
    ]),
  ]);
}

/* --- the base image ---------------------------------------------------- */

function baseSection(app, character) {
  const body = [
    el('p', {
      class: 'field__hint',
      text: 'The still picture everything else is layered onto. Nothing is uploaded — the file is read by this browser and kept with the project.',
    }),
    filePicker({
      label: character.base ? 'Replace character…' : 'Upload a character…',
      accept: IMAGE_ACCEPT,
      onFiles: ([file]) => uploadBase(app, file),
    }),
  ];

  if (character.base) {
    body.push(
      el('p', { class: 'field__hint' }, [
        el('strong', { text: character.base.name || 'image' }), ' · ',
        `${character.base.width} × ${character.base.height}`,
      ]),
      buttonRow([
        {
          label: 'Remove picture',
          onClick: () => {
            updateActiveCharacter(withBase(current(app), null));
            app.refresh();
          },
        },
        {
          label: 'Export a frame',
          title: 'Save the character as it stands, composited, as a PNG',
          onClick: async () => {
            const node = document.querySelector('.rig__canvas');
            if (node) await downloadPng(node, `${current(app).name}-frame`);
          },
        },
      ]),
    );
  }

  return section('Character picture', body);
}

/* --- which pose the editor is showing ----------------------------------- */

function previewSection(app) {
  const scheme = getScheme(app.state.schemeId);
  const viseme = previewViseme(app);

  return section('Preview pose', [
    el('p', {
      class: 'field__hint',
      text: 'Which mouth the editor is showing. Position against the widest one, then check the closed one.',
    }),
    el('div', { class: 'chipset' }, mouthVisemesOf(scheme.id).map((v) => {
      const tuned = hasAdjust(slotAdjust(current(app), 'mouth', v.id));
      return el('button', {
        class: `chip${tuned ? ' is-tuned' : ''}`,
        type: 'button',
        'aria-pressed': String(v.id === viseme),
        text: tuned ? `${v.label} ✦` : v.label,
        title: tuned ? `${v.title} — this pose has its own position and size` : v.title,
        on: { click: () => { editing.viseme = v.id; app.rerender(); } },
      });
    })),
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Expression' }),
      el('div', { class: 'chipset' }, ['neutral', 'angry', 'sad', 'smile', 'laughing'].map((name) => el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(name === editing.expression),
        text: name,
        on: { click: () => { editing.expression = name; app.rerender(); } },
      }))),
    ]),
  ], { open: false });
}

/* --- one part ----------------------------------------------------------- */

function slotSection(app, character, slot) {
  const entry = character.slots[slot];
  const canvas = canvasFor(character);
  const info = SLOT_INFO[slot];

  // The sliders show what is drawn, which is the slot placement plus whatever this pose
  // has been nudged by - the same numbers the handles on the picture are showing.
  const view = slotView(app, slot);
  const placement = slot === editing.slot ? view.effective : entry.placement;
  const stateKey = slot === editing.slot ? view.stateKey : null;
  const tuned = adjustedStates(character, slot, app.state.schemeId);

  const set = (patch) => {
    if (slot !== editing.slot) editing.slot = slot;
    commitPlacement(app, slot, patch);
    app.refresh();
  };

  const states = slotStates(slot, app.state.schemeId);
  const assigned = states.filter((key) => entry.images[key]);

  const body = [
    el('p', { class: 'field__hint', text: info.note }),

    buttonRow([{
      label: `Edit ${info.label.toLowerCase()} on the picture`,
      primary: slot === editing.slot,
      onClick: () => { editing.slot = slot; app.rerender(); },
    }]),

    slot === editing.slot ? el('div', { class: 'field' }, [
      el('label', { class: 'field__label' }, [
        'What a change affects',
        infoIcon('Every pose of a part shares one position and size. A pose that needs its own — a wide open mouth usually sits lower and larger than a closed one — can be given a nudge of its own, and that nudge is kept relative to the part, so moving the whole mouth later carries it along.'),
      ]),
      el('div', { class: 'chipset' }, [
        el('button', {
          class: 'chip', type: 'button',
          'aria-pressed': String(!editing.perPose),
          text: 'Every pose',
          on: { click: () => { editing.perPose = false; app.rerender(); } },
        }),
        el('button', {
          class: 'chip', type: 'button',
          'aria-pressed': String(editing.perPose),
          text: stateKey ? `Just ${stateKey}` : 'Just this pose',
          disabled: !stateKey,
          on: { click: () => { editing.perPose = true; app.rerender(); } },
        }),
      ]),
      el('div', {
        class: 'field__hint',
        text: tuned.length
          ? `${tuned.length} pose${tuned.length === 1 ? '' : 's'} adjusted: ${tuned.join(', ')}`
          : 'No pose has its own adjustment yet.',
      }),
      (stateKey && hasAdjust(slotAdjust(character, slot, stateKey))) || tuned.length
        ? buttonRow([
          stateKey && hasAdjust(slotAdjust(character, slot, stateKey))
            ? {
              label: `Reset ${stateKey}`,
              onClick: () => {
                updateActiveCharacter(withoutAdjust(current(app), slot, stateKey));
                app.refresh();
                toast(`${stateKey} is back on the shared position`);
              },
            }
            : null,
          tuned.length
            ? {
              label: 'Reset every pose',
              onClick: () => {
                updateActiveCharacter(clearAdjusts(current(app), slot));
                app.refresh();
                toast('Every pose is back on the shared position');
              },
            }
            : null,
        ].filter(Boolean))
        : null,
    ]) : null,

    toggle({
      label: `Show ${info.label.toLowerCase()}`,
      checked: placement.visible !== false,
      onChange: (v) => set({ visible: v }),
    }),

    slider({
      label: 'Across', value: Math.round(placement.x), min: 0, max: Math.round(canvas.width), step: 1,
      format: (v) => `${v} px`, onChange: (v) => set({ x: v }),
    }),
    slider({
      label: 'Down', value: Math.round(placement.y), min: 0, max: Math.round(canvas.height), step: 1,
      format: (v) => `${v} px`, onChange: (v) => set({ y: v }),
    }),
    slider({
      label: 'Size', value: placement.scale, min: 0.05, max: 4, step: 0.01,
      format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => set({ scale: v }),
    }),
    slider({
      label: 'Rotation', value: placement.rotation, min: -45, max: 45, step: 1,
      format: (v) => `${v}°`, onChange: (v) => set({ rotation: v }),
      info: 'For a character whose head is not upright in the picture.',
    }),
    slider({
      label: 'Opacity', value: placement.opacity, min: 0.1, max: 1, step: 0.05,
      format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => set({ opacity: v }),
    }),

    buttonRow([
      {
        label: 'Reset position',
        title: 'Put this part back where it started, and clear every pose adjustment',
        onClick: () => {
          let next = withPlacement(current(app), slot, initialPlacement(slot, canvas));
          next = clearAdjusts(next, slot);
          updateActiveCharacter(next);
          app.refresh();
        },
      },
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: `${info.label} artwork (${assigned.length} of ${states.length})` }),
      el('div', { class: 'slot-grid' }, states.map((key) => slotImageButton(app, slot, key, entry.images[key]))),
      el('div', {
        class: 'field__hint',
        text: slot === 'mouth'
          ? 'Poses with no artwork use the built-in mouth at this position, so the character speaks either way.'
          : 'With no artwork this part is simply not drawn — leave it off if the base picture already has one.',
      }),
    ]),
  ];

  return section(info.label, body, { open: slot === editing.slot });
}

function slotImageButton(app, slot, stateKey, image) {
  const scheme = getScheme(app.state.schemeId);
  const label = slot === 'mouth' ? (visemeInfo(scheme.id, stateKey)?.label ?? stateKey) : stateKey;

  const button = el('button', {
    class: `slot-chip${image ? ' is-filled' : ''}`,
    type: 'button',
    title: image ? `${image.name || 'image'} — click to replace, shift-click to remove` : `Add artwork for ${label}`,
    on: {
      click: (event) => {
        if (event.shiftKey && image) {
          updateActiveCharacter(withoutSlotImage(current(app), slot, stateKey));
          app.refresh();
          return;
        }
        const input = el('input', { type: 'file', accept: IMAGE_ACCEPT, class: 'visually-hidden' });
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const [file] = input.files ?? [];
          input.remove();
          uploadSlotImage(app, slot, stateKey, file);
        });
        input.click();
      },
    },
  });

  if (image) {
    button.appendChild(el('img', { class: 'slot-chip__thumb', src: image.src, alt: '' }));
  } else {
    button.appendChild(el('span', { class: 'slot-chip__plus', text: '+' }));
  }
  button.appendChild(el('span', { class: 'slot-chip__label', text: label }));
  return button;
}

/* --- blinking ----------------------------------------------------------- */

function blinkSection(app) {
  const character = current(app);
  const hasClosedEyes = Boolean(character.slots.eyes.images.closed);

  return section('Blinking', [
    el('p', {
      class: 'field__hint',
      text: hasClosedEyes
        ? 'A character that never blinks reads as a photograph with a moving mouth.'
        : 'Add a closed-eyes picture in the Eyes section above and the character will blink.',
    }),
    toggle({
      label: 'Blink',
      checked: app.state.blink.enabled,
      onChange: (v) => { app.state.blink.enabled = v; app.refresh(); },
    }),
    slider({
      label: 'About every',
      value: app.state.blink.everySeconds, min: 1, max: 12, step: 0.2,
      format: (v) => `${v.toFixed(1)} s`,
      onChange: (v) => { app.state.blink.everySeconds = v; app.refresh(); },
      info: 'Blinks are spaced irregularly around this figure — a character blinking on a perfect metronome reads as a machine.',
    }),
  ], { open: false });
}
