/**
 * Drawing the character.
 *
 * Two ways to fill the stage, and the choice is made per pose rather than per session:
 *
 *   - if the mouth set has artwork for the shape being shown, that image is drawn;
 *   - otherwise the built-in face is drawn from the shape's seven numbers.
 *
 * That mixture is deliberate. A half-finished set of drawings still animates - the poses
 * you have drawn appear, the ones you have not fall back to the built-in shape - so you
 * can see whether a set is working before you have finished making it.
 *
 * Every colour is a token, so the face follows light and dark like everything else, and
 * every coordinate stays inside the viewBox at every combination of the seven shape
 * parameters. See pitfalls.md #4: the export is the honest test of that, not the screen.
 */

import { svg, el } from './dom.js';
import { visemeInfo, getScheme } from '../visemes.js';
import { composeFrame, placementBox, handleAnchors, SLOT_INFO, SLOT_BOX } from '../character.js';

/** One drawing unit is one pixel. pitfalls.md #3 caps the display at this. */
export const FACE_WIDTH = 420;
export const FACE_HEIGHT = 420;

const CX = FACE_WIDTH / 2;
const MOUTH_Y = 288;

let clipSeq = 0;

const round1 = (n) => Math.round(n * 10) / 10;

/* ---------------------------------------------------------------------------- *
 * The mouth
 * ---------------------------------------------------------------------------- */

/**
 * The mouth outline, as a closed path.
 *
 * Built from four cubic segments so the corners stay sharp while the lips curve, and
 * scaled entirely from the shape parameters - there is no per-viseme special case
 * anywhere in here, which is what keeps a new pose a matter of seven numbers.
 */
export function mouthPath(shape, { cx = CX, cy = MOUTH_Y, scale = 1 } = {}) {
  const { open, width, round, corner = 0.5 } = shape;

  // Rounding pulls the corners in as well as curving them: a pucker is narrow.
  const halfWidth = (22 + width * 40) * (1 - round * 0.42) * scale;
  // The jaw drops further than the top lip rises, which is why these differ. Both are
  // larger than they look: a mouth drawn only 52 units tall against 124 wide reads as a
  // letterbox rather than a mouth.
  const upper = open * 40 * scale;
  const lower = open * 30 * scale;
  const lift = (corner - 0.5) * 26 * scale;

  const leftX = round1(cx - halfWidth);
  const rightX = round1(cx + halfWidth);
  const cornerY = round1(cy - lift);

  // Control-point spread. A rounder mouth needs its handles further out to read as a
  // circle rather than a lens.
  const k = halfWidth * (0.52 + round * 0.28);
  const topY = round1(cy - upper);
  const bottomY = round1(cy + lower);

  return [
    `M ${leftX} ${cornerY}`,
    `C ${round1(cx - k)} ${round1(topY - lift * 0.5)} ${round1(cx + k)} ${round1(topY - lift * 0.5)} ${rightX} ${cornerY}`,
    `C ${round1(cx + k)} ${round1(bottomY - lift * 0.2)} ${round1(cx - k)} ${round1(bottomY - lift * 0.2)} ${leftX} ${cornerY}`,
    'Z',
  ].join(' ');
}

/** The mouth, its teeth, its tongue, and the lip-bite overlay if the shape wants one. */
function drawMouth(shape, options = {}) {
  const { cx = CX, cy = MOUTH_Y, scale = 1 } = options;
  const { open, width, round, teeth, tongue, lipBite, corner = 0.5 } = shape;

  const clipId = `mouth-clip-${(clipSeq += 1)}`;
  const path = mouthPath(shape, options);
  const halfWidth = (22 + width * 40) * (1 - round * 0.42) * scale;
  const upper = open * 40 * scale;
  const lower = open * 30 * scale;
  const lift = (corner - 0.5) * 26 * scale;

  const group = svg('g', { class: 'face__mouth' });

  group.appendChild(svg('defs', {}, [
    svg('clipPath', { id: clipId }, [svg('path', { d: path })]),
  ]));

  // The dark of the open mouth sits behind everything else in it.
  group.appendChild(svg('path', { d: path, fill: 'var(--face-cavity)' }));

  const inner = svg('g', { 'clip-path': `url(#${clipId})` });

  if (teeth > 0 && open > 0.02) {
    const depth = Math.min(upper * 0.95, (4 + teeth * 13) * scale);
    inner.appendChild(svg('rect', {
      x: round1(cx - halfWidth), y: round1(cy - upper - lift * 0.5),
      width: round1(halfWidth * 2), height: round1(depth + upper * 0.2),
      fill: 'var(--face-teeth)',
    }));
  }

  if (tongue > 0 && open > 0.02) {
    // The tongue rises towards the teeth as `tongue` approaches 1, which is what makes
    // an L read as an L rather than as another open vowel.
    const rise = tongue * (upper + lower) * 0.75;
    inner.appendChild(svg('ellipse', {
      cx: round1(cx),
      cy: round1(cy + lower - rise * 0.55),
      rx: round1(halfWidth * 0.62),
      ry: round1(Math.max(4, lower * 0.85) * (0.6 + tongue * 0.5)),
      fill: 'var(--face-tongue)',
    }));
  }

  group.appendChild(inner);

  group.appendChild(svg('path', {
    d: path, fill: 'none',
    stroke: 'var(--face-line)', 'stroke-width': 3.5 * scale, 'stroke-linejoin': 'round',
  }));

  if (lipBite > 0) {
    // Upper teeth resting on the lower lip, drawn over the closed mouth rather than
    // inside it - that is what the pose actually is.
    const biteWidth = halfWidth * 1.3;
    group.appendChild(svg('rect', {
      x: round1(cx - biteWidth * 0.5), y: round1(cy - 8 * scale),
      width: round1(biteWidth), height: round1(7 * scale * lipBite),
      rx: round1(2 * scale),
      fill: 'var(--face-teeth)', stroke: 'var(--face-line)', 'stroke-width': 1.5 * scale,
    }));
  }

  return group;
}

/**
 * A mouth on its own. Used by the chart and by the breakdown's shape chips.
 *
 * The viewBox is fixed at the size of the *widest possible* mouth rather than sized to
 * this particular one, for the same reason the stage is capped: two poses shown side by
 * side have to be drawn at one scale, or a pucker and a wide open vowel look the same
 * size and the chart stops being comparable. The caller scales the whole box.
 */
// Sized to the widest and tallest a mouth can actually be drawn - half-width 62 plus
// the stroke, and upper 40 + lower 30 plus the corner lift - rather than to a round
// number. Slack here is slack in every chart cell.
export const MOUTH_BOX = { width: 134, height: 96 };

export function mouthOnly(shape) {
  const { width, height } = MOUTH_BOX;
  const node = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'mouth-only',
    role: 'img',
    preserveAspectRatio: 'xMidYMid meet',
  });
  node.appendChild(drawMouth(shape, { cx: width / 2, cy: height / 2, scale: 1 }));
  return node;
}

/* ---------------------------------------------------------------------------- *
 * The rest of the head
 * ---------------------------------------------------------------------------- */

/** Brow angles by expression. Neutral is level; everything else reads off the brows. */
const BROWS = {
  angry: { inner: 10, outer: -6, lift: 2 },
  sad: { inner: -9, outer: 5, lift: -2 },
  smile: { inner: -1, outer: -3, lift: -4 },
  happy: { inner: -1, outer: -3, lift: -4 },
  laughing: { inner: -3, outer: -5, lift: -7 },
  neutral: { inner: 0, outer: 0, lift: 0 },
};

const EYES = {
  angry: 0.78, sad: 0.85, smile: 0.9, happy: 0.9, laughing: 0.5, neutral: 1,
};

function drawEye(x, y, openness) {
  const rx = 17;
  const ry = Math.max(2.5, 15 * openness);
  const group = svg('g', {});
  group.appendChild(svg('ellipse', {
    cx: x, cy: y, rx, ry,
    fill: 'var(--face-eye-white)', stroke: 'var(--face-line)', 'stroke-width': 3,
  }));
  group.appendChild(svg('circle', {
    cx: x, cy: round1(y + (1 - openness) * 2), r: Math.min(7, ry * 0.72),
    fill: 'var(--face-pupil)',
  }));
  return group;
}

function drawBrow(x, y, { inner, outer, lift }, mirror = false) {
  const half = 24;
  const sign = mirror ? -1 : 1;
  const innerX = x + sign * -half;
  const outerX = x + sign * half;
  return svg('path', {
    d: `M ${round1(innerX)} ${round1(y - lift + inner)} Q ${round1(x)} ${round1(y - lift - 7)} ${round1(outerX)} ${round1(y - lift + outer)}`,
    fill: 'none', stroke: 'var(--face-hair)', 'stroke-width': 8, 'stroke-linecap': 'round',
  });
}

/**
 * The whole head, drawn from tokens.
 *
 * @param {object} shape the seven mouth numbers
 * @param {string|null} expression the running expression, which drives the brows and eyes
 */
export function faceSvg(shape, expression = null) {
  const node = svg('svg', {
    viewBox: `0 0 ${FACE_WIDTH} ${FACE_HEIGHT}`,
    class: 'face',
    role: 'img',
    'aria-label': 'Character preview',
  });

  const mood = BROWS[expression] ?? BROWS.neutral;
  const eyeOpen = EYES[expression] ?? EYES.neutral;

  // Ears
  for (const x of [92, FACE_WIDTH - 92]) {
    node.appendChild(svg('ellipse', {
      cx: x, cy: 230, rx: 20, ry: 28,
      fill: 'var(--face-skin)', stroke: 'var(--face-line)', 'stroke-width': 3.5,
    }));
  }

  // Head
  node.appendChild(svg('path', {
    d: `M ${CX} 52 C 300 52 336 108 336 190 C 336 286 288 356 ${CX} 356 C 132 356 84 286 84 190 C 84 108 120 52 ${CX} 52 Z`,
    fill: 'var(--face-skin)', stroke: 'var(--face-line)', 'stroke-width': 4,
    'stroke-linejoin': 'round',
  }));

  // Hair
  node.appendChild(svg('path', {
    d: `M 88 176 C 84 92 140 44 ${CX} 44 C 280 44 336 92 332 176 C 320 150 300 128 268 122 C 240 140 180 140 152 120 C 118 130 98 150 88 176 Z`,
    fill: 'var(--face-hair)',
  }));

  // Brows, then eyes
  node.appendChild(drawBrow(166, 196, mood, false));
  node.appendChild(drawBrow(FACE_WIDTH - 166, 196, mood, true));
  node.appendChild(drawEye(166, 224, eyeOpen));
  node.appendChild(drawEye(FACE_WIDTH - 166, 224, eyeOpen));

  // Nose
  node.appendChild(svg('path', {
    d: `M ${CX} 234 L ${CX - 11} 262 Q ${CX} 270 ${CX + 9} 262`,
    fill: 'none', stroke: 'var(--face-line)', 'stroke-width': 3.5,
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));

  node.appendChild(drawMouth(shape));
  return node;
}

/* ---------------------------------------------------------------------------- *
 * The stage
 * ---------------------------------------------------------------------------- */

/**
 * One part of a layered character, placed.
 *
 * The group is translated to the placement point and rotated there, so the image hangs
 * off its own centre. That is what makes dragging behave: the point you grab is the
 * point that moves, whatever the rotation.
 */
function drawPart(part, { schemeId, viseme, editable = false, selected = false, handleScale = 1 } = {}) {
  const { placement, slot } = part;
  // The built-in mouth has no image, but it does have a natural size: MOUTH_BOX. Falling
  // back to the canvas size instead would make its grab handle the width of the whole
  // picture, which is unusable and looks broken.
  // An empty slot has no image to take a size from, so it borrows its part's natural
  // proportions - a brow ghost should look like a brow, not like a square the width of
  // the whole picture.
  const natural = part.kind === 'image' ? part.image
    : (part.kind === 'placeholder' ? (SLOT_BOX[slot] ?? MOUTH_BOX) : MOUTH_BOX);
  const box = placementBox(placement, natural);

  const group = svg('g', {
    class: `part part--${slot}${part.kind === 'placeholder' ? ' part--empty' : ''}`,
    'data-slot': slot,
    transform: `translate(${round1(box.x)} ${round1(box.y)}) rotate(${round1(box.rotation)})`,
    opacity: box.opacity === 1 ? null : box.opacity,
  });

  if (part.kind === 'image') {
    group.appendChild(svg('image', {
      href: part.image.src,
      x: round1(box.left), y: round1(box.top),
      width: round1(box.width), height: round1(box.height),
      preserveAspectRatio: 'xMidYMid meet',
    }));
  } else if (part.kind === 'drawn') {
    // No artwork for this pose yet: draw the built-in one in its place, so the character
    // still speaks while the set is being drawn.
    const info = visemeInfo(schemeId, viseme);
    const shape = info?.shape ?? getScheme(schemeId).visemes[0].shape;
    group.appendChild(drawMouth(shape, { cx: 0, cy: 0, scale: placement.scale }));
  } else {
    // A slot with no artwork at all. Editor only: you cannot position something that is
    // not there, so it is drawn as a labelled ghost that can be dragged and sized before
    // a single picture has been uploaded.
    group.appendChild(svg('rect', {
      class: 'part__ghost',
      x: round1(box.left), y: round1(box.top),
      width: round1(box.width), height: round1(box.height),
      rx: round1(6 * handleScale),
    }));
    group.appendChild(svg('text', {
      class: 'part__ghost-label',
      x: 0, y: round1(5 * handleScale), 'text-anchor': 'middle',
      style: { fontSize: `${round1(13 * handleScale)}px` },
    }, [SLOT_INFO[slot]?.label ?? slot]));
  }

  if (editable) {
    // An invisible, generous grab area: a thin mouth is hard to hit otherwise.
    const pad = 24 * handleScale;
    group.appendChild(svg('rect', {
      class: 'part__grab',
      x: round1(Math.min(box.left, -pad)), y: round1(Math.min(box.top, -pad)),
      width: round1(Math.max(box.width, pad * 2)), height: round1(Math.max(box.height, pad * 2)),
    }));
  }

  if (editable && selected) group.appendChild(drawHandles(box, handleScale));

  return group;
}

/**
 * Corner handles to resize, and one above to rotate.
 *
 * `handleScale` exists because these are drawn in canvas units, and a canvas is whatever
 * size the uploaded picture is. A 6-unit handle is comfortable on a 420-wide drawing and
 * invisible on a 4000-wide photograph, so the caller passes the ratio and the handles
 * stay the same size on screen whatever was uploaded.
 */
function drawHandles(box, handleScale = 1) {
  const group = svg('g', { class: 'part__handles' });
  const { corners, rotate } = handleAnchors(box, { rotateOffset: 30 * handleScale });
  const size = 9 * handleScale;

  group.appendChild(svg('rect', {
    class: 'part__outline',
    x: round1(box.left), y: round1(box.top),
    width: round1(box.width), height: round1(box.height),
    'stroke-width': round1(1.8 * handleScale),
  }));

  group.appendChild(svg('line', {
    class: 'part__rotate-stem',
    x1: 0, y1: round1(box.top), x2: 0, y2: round1(rotate.y),
    'stroke-width': round1(1.8 * handleScale),
  }));
  group.appendChild(svg('circle', {
    class: 'part__handle part__handle--rotate',
    'data-handle': 'rotate',
    cx: 0, cy: round1(rotate.y), r: round1(size * 0.62),
    'stroke-width': round1(1.8 * handleScale),
  }));

  for (const corner of corners) {
    group.appendChild(svg('rect', {
      class: `part__handle part__handle--${corner.id}`,
      'data-handle': corner.id,
      x: round1(corner.x - size / 2), y: round1(corner.y - size / 2),
      width: round1(size), height: round1(size),
      rx: round1(size * 0.22),
      'stroke-width': round1(1.8 * handleScale),
    }));
  }

  return group;
}

/**
 * A character composited for one instant.
 *
 * @param {object} options
 * @param {string} options.viseme     the mouth shape to show
 * @param {object} [options.character] null or `drawn` falls back to the built-in face
 * @param {string} [options.expression] drives brows, eyes and the built-in face
 * @param {boolean} [options.eyesClosed] mid-blink
 * @param {boolean} [options.editable] add grab handles for the editor
 */
export function compositeSvg({
  viseme, schemeId, character, expression = null, eyesClosed = false,
  editable = false, selectedSlot = null,
} = {}) {
  const frame = composeFrame(character, { viseme, expression, eyesClosed, includeEmpty: editable });
  const info = visemeInfo(schemeId, viseme);

  if (frame.mode === 'drawn') {
    const shape = info?.shape ?? getScheme(schemeId).visemes[0].shape;
    const node = faceSvg(shape, expression);
    node.setAttribute('aria-label', `${info?.title ?? viseme} — ${info?.letters || 'rest'}`);
    return node;
  }

  const { canvas } = frame;
  const node = svg('svg', {
    viewBox: `0 0 ${round1(canvas.width)} ${round1(canvas.height)}`,
    class: `face face--${frame.mode}`,
    role: 'img',
    'aria-label': `${info?.title ?? viseme}${character?.name ? ` — ${character.name}` : ''}`,
  });

  if (frame.mode === 'frame') {
    node.appendChild(svg('image', {
      href: frame.base.src,
      x: 0, y: 0, width: canvas.width, height: canvas.height,
      preserveAspectRatio: 'xMidYMid meet',
    }));
    return node;
  }

  if (frame.base?.src) {
    node.appendChild(svg('image', {
      href: frame.base.src,
      x: 0, y: 0, width: canvas.width, height: canvas.height,
      preserveAspectRatio: 'xMidYMid meet',
    }));
  }

  // Handles are drawn in canvas units; this keeps them a constant size on screen
  // whatever the uploaded picture's dimensions are.
  const handleScale = Math.max(0.25, Math.min(6, canvas.width / 520));

  for (const part of frame.parts) {
    node.appendChild(drawPart(part, {
      schemeId, viseme, editable, handleScale, selected: part.slot === selectedSlot,
    }));
  }

  return node;
}

/**
 * What goes on the stage. Kept as a separate name because the animator does not care
 * which of the three kinds of character it is showing.
 */
export function stageFor(visemeId, { schemeId, character, expression = null, eyesClosed = false } = {}) {
  return compositeSvg({ viseme: visemeId, schemeId, character, expression, eyesClosed });
}

/* ---------------------------------------------------------------------------- *
 * The pose chart
 * ---------------------------------------------------------------------------- */

/**
 * Every pose in the scheme, laid out as a character sheet.
 *
 * This is both the mouth-set editor's canvas and an export in its own right: a blank
 * sheet is a useful thing to hand an illustrator, and a filled one is a useful thing to
 * check at a glance.
 */
export function chartSvg(schemeId, { mouthSet = null, cols = 4, cell = 150, onPick = null } = {}) {
  const scheme = getScheme(schemeId);
  const visemes = scheme.visemes;
  const columns = Math.max(1, cols);
  const rows = Math.ceil(visemes.length / columns);
  const label = 34;

  const width = columns * cell;
  const height = rows * (cell + label);

  const node = svg('svg', {
    viewBox: `0 0 ${width} ${height}`,
    class: 'chart',
    role: 'group',
    'aria-label': `${scheme.name} pose chart`,
  });

  for (const [i, viseme] of visemes.entries()) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = col * cell;
    const y = row * (cell + label);

    const cellGroup = svg('g', {
      class: `chart__cell${viseme.kind === 'expression' ? ' chart__cell--expression' : ''}`,
      transform: `translate(${x} ${y})`,
      'data-viseme': viseme.id,
      role: onPick ? 'button' : 'presentation',
      tabindex: onPick ? '0' : null,
    });

    cellGroup.appendChild(svg('rect', {
      x: 4, y: 4, width: cell - 8, height: cell - 8, rx: 10,
      class: 'chart__ground',
    }));

    const image = mouthSet?.images?.[viseme.id];
    if (image?.src) {
      cellGroup.appendChild(svg('image', {
        href: image.src, x: 8, y: 8, width: cell - 16, height: cell - 16,
        preserveAspectRatio: 'xMidYMid meet',
      }));
    } else {
      // Fill the cell, letterboxed by preserveAspectRatio so every pose is one scale.
      const inset = 8;
      const mouth = mouthOnly(viseme.shape);
      mouth.setAttribute('x', inset);
      mouth.setAttribute('y', inset);
      mouth.setAttribute('width', cell - inset * 2);
      mouth.setAttribute('height', cell - inset * 2);
      cellGroup.appendChild(mouth);
    }

    cellGroup.appendChild(svg('text', {
      x: cell / 2, y: cell + 12, 'text-anchor': 'middle',
      class: 'chart__label',
    }, [viseme.label]));

    cellGroup.appendChild(svg('text', {
      x: cell / 2, y: cell + 26, 'text-anchor': 'middle',
      class: 'chart__sub',
    }, [image ? 'your artwork' : 'built-in']));

    if (onPick) {
      cellGroup.addEventListener('click', () => onPick(viseme.id));
      cellGroup.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPick(viseme.id);
        }
      });
    }

    node.appendChild(cellGroup);
  }

  return node;
}

/** A caption line under a drawing. Long text belongs here, never hung off a symbol. */
export const caption = (text) => el('p', { class: 'stage__caption', text });
