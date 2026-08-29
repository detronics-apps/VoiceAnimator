/**
 * Characters: a base drawing with parts placed on top of it.
 *
 * Pure: no DOM, no globals. The compositing itself is a handful of SVG transforms and
 * lives in `js/ui/face-svg.js`; everything here is the model and the arithmetic.
 *
 * A character is one of three kinds, and the difference is only in how much you have
 * drawn:
 *
 *   `drawn`   nothing uploaded. The built-in face animates. Useful immediately, and the
 *             fallback whenever a pose has no artwork.
 *   `frames`  one complete picture per pose, swapped whole. This is what a scanned
 *             sixteen-pose character sheet is, and it needs no positioning at all.
 *   `layers`  one still base image - your character - with a mouth, brows and eyes
 *             placed on top of it and swapped independently. This is the one that makes
 *             *your* character speak rather than a flipbook of somebody's drawings.
 *
 * The layered kind is deliberately useful before you have drawn anything: a slot with no
 * artwork for the pose being shown falls back to the built-in drawing at that slot's
 * position. So you can upload a character, drag the mouth onto its face, and watch it
 * speak — then replace the built-in mouths with your own one at a time.
 */

import { getScheme, visemesOf, equivalentViseme } from './visemes.js';

/** Parts placed over the base, in the order they are drawn. */
export const SLOTS = Object.freeze(['eyes', 'brows', 'mouth']);

export const SLOT_INFO = Object.freeze({
  eyes: {
    label: 'Eyes',
    note: 'Swapped by expression, and closed for a blink. Leave it off if the eyes are part of the base drawing.',
  },
  brows: {
    label: 'Eyebrows',
    note: 'Swapped by expression. Brows carry most of what a face is doing, so they are worth drawing even when nothing else is.',
  },
  mouth: {
    label: 'Mouth',
    note: 'Swapped by viseme, once per sound. This is the one that has to be in the right place.',
  },
});

/** Expressions a brow or eye set can be keyed by. `neutral` is the fallback. */
export const EXPRESSION_STATES = Object.freeze(['neutral', 'angry', 'sad', 'smile', 'laughing']);

/** Eye states. `open` is the fallback; `closed` is what a blink uses. */
export const EYE_STATES = Object.freeze(['open', 'closed', 'angry', 'sad', 'smile', 'laughing']);

/** The drawing space when there is no base image to take it from. */
export const DEFAULT_CANVAS = Object.freeze({ width: 420, height: 420 });

/**
 * How big a slot is assumed to be before it has any artwork.
 *
 * Only the editor's placeholders use these. Without them an empty slot falls back to the
 * canvas size and the ghost is a square the width of the whole picture, which tells you
 * nothing about where a brow is going to sit. These are the proportions of the part
 * itself, in the same units as the built-in face.
 */
export const SLOT_BOX = Object.freeze({
  mouth: Object.freeze({ width: 134, height: 96 }),
  brows: Object.freeze({ width: 210, height: 52 }),
  eyes: Object.freeze({ width: 210, height: 76 }),
});

/** Which keys a slot's images are stored under. */
export function slotStates(slot, schemeId) {
  if (slot === 'mouth') return visemesOf(schemeId).map((v) => v.id);
  if (slot === 'brows') return [...EXPRESSION_STATES];
  if (slot === 'eyes') return [...EYE_STATES];
  return [];
}

/* ---------------------------------------------------------------------------- *
 * Placement
 * ---------------------------------------------------------------------------- */

/**
 * @typedef {object} Placement
 * @property {number} x      centre of the part, in canvas units
 * @property {number} y
 * @property {number} scale  multiplier on the image's own size
 * @property {number} rotation degrees, clockwise
 * @property {number} opacity 0..1
 * @property {boolean} visible
 */

export const defaultPlacement = () =>
  ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, visible: true });

/**
 * Where a part starts out on a freshly uploaded base image.
 *
 * Proportions of a head rather than absolute numbers, so a tall portrait and a wide
 * establishing shot both land somewhere sensible. It will not be right - that is what
 * dragging is for - but it will be visible, which is the part that matters.
 */
export function initialPlacement(slot, canvas = DEFAULT_CANVAS) {
  const w = Math.max(1, canvas.width);
  const h = Math.max(1, canvas.height);
  const base = defaultPlacement();

  const offsets = {
    mouth: 0.18,
    brows: -0.16,
    eyes: -0.07,
  };

  return {
    ...base,
    x: w / 2,
    y: h / 2 + h * (offsets[slot] ?? 0),
    // A mouth drawn on a 420-wide canvas dropped onto a 1200-wide portrait needs to come
    // down in size, not stay at 100%.
    scale: Math.max(0.1, Math.min(4, w / DEFAULT_CANVAS.width)),
    visible: slot === 'mouth',
  };
}

/**
 * `Number(null)` is 0 and `Number('')` is 0, so a saved placement carrying either would
 * be read as a real coordinate and slam the part against the top-left corner. Absent has
 * to mean absent.
 */
const clamp = (v, lo, hi, fallback = 0) => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * Keep a part reachable.
 *
 * A part is allowed to hang off the edge - a mouth on a character standing at the side
 * of frame legitimately does - but not so far that its handle cannot be grabbed to bring
 * it back. One canvas width of slack in each direction.
 */
export function clampPlacement(placement, canvas = DEFAULT_CANVAS) {
  const w = Math.max(1, canvas.width);
  const h = Math.max(1, canvas.height);
  return {
    x: clamp(placement?.x, -w, w * 2, w / 2),
    y: clamp(placement?.y, -h, h * 2, h / 2),
    scale: clamp(placement?.scale, 0.02, 12, 1),
    rotation: clamp(placement?.rotation, -180, 180, 0),
    opacity: clamp(placement?.opacity, 0, 1, 1),
    visible: placement?.visible !== false,
  };
}

/**
 * The numbers a renderer needs to draw one part.
 *
 * Returned as data rather than a transform string so this stays testable without a DOM,
 * and so the same numbers can drive a drag handle as well as the drawing.
 */
export function placementBox(placement, image) {
  const p = clampPlacement(placement, DEFAULT_CANVAS);
  const w = Math.max(1, Number(image?.width) || DEFAULT_CANVAS.width);
  const h = Math.max(1, Number(image?.height) || DEFAULT_CANVAS.height);

  return {
    x: placement.x,
    y: placement.y,
    width: w * p.scale,
    height: h * p.scale,
    rotation: p.rotation,
    opacity: p.opacity,
    // Top-left of the unrotated box, which is what an <image> needs once the group has
    // been translated to the centre.
    left: -(w * p.scale) / 2,
    top: -(h * p.scale) / 2,
  };
}

/* ---------------------------------------------------------------------------- *
 * Per-pose adjustments
 *
 * One placement for a whole slot is not enough. A wide open mouth is bigger than a
 * closed one and usually sits lower on the face; an angry brow sits lower than a neutral
 * one. So every *state* of a slot - each viseme, each expression - may carry its own
 * adjustment on top of the slot's placement.
 *
 * These are deltas rather than absolute placements, and that is the whole design. If they
 * were absolute, moving the mouth after tuning half a dozen poses would leave those poses
 * behind and you would have to redo them all. As deltas they ride along: the slot
 * placement is where the mouth is, and an adjustment is how this particular pose differs
 * from it.
 * ---------------------------------------------------------------------------- */

/**
 * @typedef {object} Adjust
 * @property {number} dx        offset from the slot placement, canvas units
 * @property {number} dy
 * @property {number} scaleFactor  multiplier on the slot's scale, 1 = unchanged
 * @property {number} dRotation degrees added to the slot's rotation
 */

export const emptyAdjust = () => ({ dx: 0, dy: 0, scaleFactor: 1, dRotation: 0 });

const IDENTITY = emptyAdjust();

/** Whether an adjustment actually says anything, or is just the identity. */
export function hasAdjust(adjust) {
  if (!adjust) return false;
  return Math.abs((adjust.dx ?? 0) - IDENTITY.dx) > 1e-6
    || Math.abs((adjust.dy ?? 0) - IDENTITY.dy) > 1e-6
    || Math.abs((adjust.scaleFactor ?? 1) - IDENTITY.scaleFactor) > 1e-6
    || Math.abs((adjust.dRotation ?? 0) - IDENTITY.dRotation) > 1e-6;
}

export function sanitiseAdjust(raw) {
  return {
    dx: clamp(raw?.dx, -20000, 20000, 0),
    dy: clamp(raw?.dy, -20000, 20000, 0),
    // The factor range is what keeps `base.scale * factor` inside clampPlacement's own
    // limits from either end of the scale slider.
    scaleFactor: clamp(raw?.scaleFactor, 0.05, 20, 1),
    dRotation: clamp(raw?.dRotation, -180, 180, 0),
  };
}

/** The adjustment stored for one state of one slot, or the identity. */
export function slotAdjust(character, slot, stateKey) {
  const stored = character?.slots?.[slot]?.adjusts?.[stateKey];
  return stored ? sanitiseAdjust(stored) : emptyAdjust();
}

/** The slot placement with one state's adjustment folded in, clamped as usual. */
export function effectivePlacement(placement, adjust, canvas = DEFAULT_CANVAS) {
  const base = clampPlacement(placement, canvas);
  if (!hasAdjust(adjust)) return base;
  const a = sanitiseAdjust(adjust);

  return clampPlacement({
    ...base,
    x: base.x + a.dx,
    y: base.y + a.dy,
    scale: base.scale * a.scaleFactor,
    rotation: base.rotation + a.dRotation,
  }, canvas);
}

/**
 * The adjustment that turns `base` into `wanted`.
 *
 * This is what a drag commits when it is editing one pose rather than the whole slot:
 * the gesture produces an absolute placement, and only the difference is stored.
 */
export function adjustFromPlacement(base, wanted) {
  const from = clampPlacement(base);
  const to = clampPlacement(wanted);
  return sanitiseAdjust({
    dx: to.x - from.x,
    dy: to.y - from.y,
    scaleFactor: from.scale > 1e-9 ? to.scale / from.scale : 1,
    dRotation: to.rotation - from.rotation,
  });
}

export function withAdjust(character, slot, stateKey, patch) {
  if (!SLOTS.includes(slot) || !stateKey) return character;
  const entry = character.slots[slot];
  const next = sanitiseAdjust({ ...slotAdjust(character, slot, stateKey), ...patch });
  const adjusts = { ...(entry.adjusts ?? {}) };

  // An adjustment equal to the identity is not stored: it would show as "adjusted" in
  // the UI and mean nothing.
  if (hasAdjust(next)) adjusts[stateKey] = next;
  else delete adjusts[stateKey];

  return {
    ...character,
    slots: { ...character.slots, [slot]: { ...entry, adjusts } },
  };
}

export function withoutAdjust(character, slot, stateKey) {
  const adjusts = { ...(character?.slots?.[slot]?.adjusts ?? {}) };
  delete adjusts[stateKey];
  return {
    ...character,
    slots: { ...character.slots, [slot]: { ...character.slots[slot], adjusts } },
  };
}

export function clearAdjusts(character, slot) {
  return {
    ...character,
    slots: { ...character.slots, [slot]: { ...character.slots[slot], adjusts: {} } },
  };
}

/** Which states of a slot have been adjusted, in the order they are listed. */
export function adjustedStates(character, slot, schemeId = character?.schemeId) {
  const adjusts = character?.slots?.[slot]?.adjusts ?? {};
  return slotStates(slot, schemeId).filter((state) => hasAdjust(adjusts[state]));
}

/* ---------------------------------------------------------------------------- *
 * Characters
 * ---------------------------------------------------------------------------- */

let idSeq = 0;
const newId = () => `ch-${Date.now().toString(36)}-${(idSeq += 1).toString(36)}`;

export function emptyCharacter(name = 'Character', schemeId = 'chart') {
  const scheme = getScheme(schemeId);
  return {
    id: newId(),
    name: String(name).slice(0, 60) || 'Character',
    schemeId: scheme.id,
    kind: 'drawn',
    base: null,
    canvas: { ...DEFAULT_CANVAS },
    frames: {},
    slots: Object.fromEntries(SLOTS.map((slot) => [slot, {
      placement: initialPlacement(slot, DEFAULT_CANVAS),
      images: {},
      adjusts: {},
    }])),
  };
}

/** The drawing space: the base image's size, or the default square. */
export function canvasFor(character) {
  const w = Number(character?.canvas?.width);
  const h = Number(character?.canvas?.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { width: w, height: h };
  return { ...DEFAULT_CANVAS };
}

export const isBlank = (character) =>
  !character?.base && !Object.keys(character?.frames ?? {}).length &&
  SLOTS.every((slot) => !Object.keys(character?.slots?.[slot]?.images ?? {}).length);

/**
 * Give a character a base image, and move every part onto it.
 *
 * The parts are re-placed rather than kept, because a placement in the old canvas means
 * nothing in the new one - a mouth at (210, 290) on a 420 square is off the bottom of a
 * 300-tall banner.
 */
export function withBase(character, image) {
  const canvas = image
    ? { width: Math.max(1, image.width), height: Math.max(1, image.height) }
    : { ...DEFAULT_CANVAS };

  return {
    ...character,
    kind: image ? 'layers' : (Object.keys(character.frames ?? {}).length ? 'frames' : 'drawn'),
    base: image ?? null,
    canvas,
    slots: Object.fromEntries(SLOTS.map((slot) => [slot, {
      ...character.slots[slot],
      placement: initialPlacement(slot, canvas),
      // The placements are being reset, so deltas measured against the old ones mean
      // nothing. Keeping them would move poses relative to a position that no longer
      // exists.
      adjusts: {},
    }])),
  };
}

export function withPlacement(character, slot, patch) {
  if (!SLOTS.includes(slot)) return character;
  const canvas = canvasFor(character);
  return {
    ...character,
    slots: {
      ...character.slots,
      [slot]: {
        ...character.slots[slot],
        placement: clampPlacement({ ...character.slots[slot].placement, ...patch }, canvas),
      },
    },
  };
}

export function withSlotImage(character, slot, state, image) {
  if (!SLOTS.includes(slot)) return character;
  return {
    ...character,
    kind: character.base ? 'layers' : character.kind,
    slots: {
      ...character.slots,
      [slot]: {
        ...character.slots[slot],
        images: { ...character.slots[slot].images, [state]: image },
        placement: { ...character.slots[slot].placement, visible: true },
      },
    },
  };
}

export function withoutSlotImage(character, slot, state) {
  if (!SLOTS.includes(slot)) return character;
  const images = { ...character.slots[slot].images };
  delete images[state];
  return {
    ...character,
    slots: { ...character.slots, [slot]: { ...character.slots[slot], images } },
  };
}

/** Whole-frame artwork: one complete picture per pose, no positioning. */
export function withFrame(character, visemeId, image) {
  return {
    ...character,
    kind: character.base ? 'layers' : 'frames',
    frames: { ...character.frames, [visemeId]: image },
  };
}

export function withoutFrame(character, visemeId) {
  const frames = { ...character.frames };
  delete frames[visemeId];
  return {
    ...character,
    kind: character.base ? 'layers' : (Object.keys(frames).length ? 'frames' : 'drawn'),
    frames,
  };
}

export function duplicateCharacter(character, name) {
  return {
    ...structuredCopy(character),
    id: newId(),
    name: String(name ?? `${character.name} copy`).slice(0, 60),
  };
}

const structuredCopy = (value) => JSON.parse(JSON.stringify(value));

/* ---------------------------------------------------------------------------- *
 * What to draw at one instant
 * ---------------------------------------------------------------------------- */

/**
 * Resolve one slot to a picture, an instruction to draw the built-in part, or nothing.
 *
 * The fallback chain is what makes a half-finished character usable: a mouth with no
 * artwork for this particular viseme is drawn by the app *at the slot's position*, so
 * the character still speaks while you are still drawing.
 *
 * `includeEmpty` is for the editor only. A brow slot with no artwork draws nothing, which
 * is right on the stage and useless in the editor - you cannot position something that is
 * not there. With it set, an empty slot comes back as a `placeholder` so it can be put in
 * the right place *before* the artwork exists.
 *
 * @returns {{kind:'image', image:object, placement:object}
 *          |{kind:'drawn', placement:object}
 *          |{kind:'placeholder', placement:object}
 *          |{kind:'none'}}
 */
export function resolveSlot(character, slot,
  { viseme, expression, eyesClosed, includeEmpty = false } = {}) {
  const entry = character?.slots?.[slot];
  if (!entry) return { kind: 'none' };

  const base = entry.placement ?? defaultPlacement();
  if (base.visible === false && !includeEmpty) return { kind: 'none' };

  const images = entry.images ?? {};
  const mood = expression ?? 'neutral';

  // Which state of this slot is on screen - and therefore which per-pose adjustment
  // applies. The state is resolved before the image, because an adjustment is attached
  // to the pose whether or not that pose has been drawn yet.
  let stateKey = null;
  let image = null;
  if (slot === 'mouth') {
    stateKey = viseme ?? null;
    image = images[viseme] ?? null;
  } else if (slot === 'brows') {
    stateKey = images[mood] ? mood : 'neutral';
    image = images[mood] ?? images.neutral ?? null;
  } else if (slot === 'eyes') {
    if (eyesClosed && images.closed) { stateKey = 'closed'; image = images.closed; }
    else { stateKey = images[mood] ? mood : 'open'; image = images[mood] ?? images.open ?? null; }
  }

  const placement = effectivePlacement(base, slotAdjust(character, slot, stateKey),
    canvasFor(character));

  if (image?.src) return { kind: 'image', image, placement, stateKey };

  // Only the mouth has a built-in drawing worth falling back to. Brows and eyes with no
  // artwork stay absent, because the base image almost certainly has its own.
  if (slot === 'mouth') return { kind: 'drawn', placement, stateKey };
  if (includeEmpty) return { kind: 'placeholder', placement, stateKey };
  return { kind: 'none' };
}

/** The complete instruction for one frame: the base, then each part in draw order. */
export function composeFrame(character,
  { viseme, expression, eyesClosed, includeEmpty = false } = {}) {
  const canvas = canvasFor(character);

  if (!character || character.kind === 'drawn') {
    return { canvas, mode: 'drawn', base: null, parts: [] };
  }

  if (character.kind === 'frames') {
    const image = character.frames?.[viseme] ?? null;
    return image
      ? { canvas, mode: 'frame', base: image, parts: [] }
      : { canvas, mode: 'drawn', base: null, parts: [] };
  }

  const parts = [];
  for (const slot of SLOTS) {
    const resolved = resolveSlot(character, slot,
      { viseme, expression, eyesClosed, includeEmpty });
    if (resolved.kind !== 'none') parts.push({ slot, ...resolved });
  }

  return { canvas, mode: 'layers', base: character.base ?? null, parts };
}

/* ---------------------------------------------------------------------------- *
 * Blinking
 *
 * A character that never blinks reads as a photograph with a moving mouth. The schedule
 * is deterministic for a given duration and seed so the track does not jitter every time
 * the page re-renders - which it would with `Math.random`, and which is exactly the kind
 * of thing that is invisible in a screenshot and obvious in a recording.
 * ---------------------------------------------------------------------------- */

export const BLINK_DEFAULTS = Object.freeze({
  everySeconds: 4.2,
  jitter: 0.55,
  durationSeconds: 0.12,
});

/** A small deterministic generator. Not cryptographic; it only has to be repeatable. */
function lcg(seed) {
  let s = (Math.abs(Math.trunc(seed)) % 2147483647) || 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** @returns {Array<{start:number, end:number}>} in time order, never overlapping */
export function blinkSchedule(duration, options = {}) {
  const { everySeconds, jitter, durationSeconds } = { ...BLINK_DEFAULTS, ...options };
  const seed = Number(options.seed) || 1;
  const total = Math.max(0, Number(duration) || 0);
  const gap = Math.max(0.4, Number(everySeconds) || BLINK_DEFAULTS.everySeconds);
  const length = Math.max(0.02, Number(durationSeconds) || BLINK_DEFAULTS.durationSeconds);
  if (total <= length) return [];

  const random = lcg(seed);
  const out = [];
  let t = gap * (0.35 + random() * 0.4);

  while (t + length < total) {
    out.push({ start: t, end: t + length });
    const spread = gap * Math.max(0, Math.min(0.95, jitter));
    t += gap - spread / 2 + random() * spread;
  }
  return out;
}

export function isBlinking(blinks, time) {
  for (const blink of blinks) {
    if (time >= blink.start && time < blink.end) return true;
    if (blink.start > time) break;
  }
  return false;
}

/* ---------------------------------------------------------------------------- *
 * Coverage, warnings and size
 * ---------------------------------------------------------------------------- */

export function characterCoverage(character, schemeId = character?.schemeId) {
  const scheme = getScheme(schemeId);
  const mouths = scheme.visemes.filter((v) => v.kind === 'mouth');

  const source = character?.kind === 'frames' ? (character.frames ?? {})
    : (character?.slots?.mouth?.images ?? {});

  const assigned = mouths.filter((v) => source[v.id]).map((v) => v.id);

  return {
    kind: character?.kind ?? 'drawn',
    assigned,
    missing: mouths.filter((v) => !source[v.id]).map((v) => v.id),
    total: mouths.length,
    complete: assigned.length === mouths.length,
    brows: Object.keys(character?.slots?.brows?.images ?? {}).length,
    eyes: Object.keys(character?.slots?.eyes?.images ?? {}).length,
    hasBase: Boolean(character?.base),
  };
}

export function estimateCharacterBytes(character) {
  const sources = [
    character?.base?.src,
    ...Object.values(character?.frames ?? {}).map((i) => i?.src),
    ...SLOTS.flatMap((slot) => Object.values(character?.slots?.[slot]?.images ?? {}).map((i) => i?.src)),
  ];
  return sources.reduce((sum, src) => sum + Math.ceil((String(src ?? '').length * 3) / 4), 0);
}

export function characterWarnings(character, schemeId = character?.schemeId) {
  const out = [];
  if (!character || character.kind === 'drawn') return out;

  const cover = characterCoverage(character, schemeId);

  if (character.kind === 'layers') {
    const mouth = character.slots.mouth.placement;
    const canvas = canvasFor(character);
    const outside = mouth.x < 0 || mouth.y < 0 || mouth.x > canvas.width || mouth.y > canvas.height;
    if (mouth.visible === false) {
      out.push({
        level: 'danger',
        text: 'The mouth layer is hidden, so this character cannot speak. Turn it back on in the Mouth section.',
      });
    } else if (outside) {
      out.push({
        level: 'warn',
        text: 'The mouth is positioned outside the picture. Drag it back onto the face, or press Reset position.',
      });
    }
  }

  if (character.kind === 'frames' && !cover.complete && cover.assigned.length) {
    out.push({
      level: 'warn',
      text: `${cover.missing.length} of ${cover.total} poses have no picture, so the built-in drawing is used for those. A layered character avoids this — one base image plus a mouth is enough to animate every pose.`,
    });
  }

  return out;
}

/* ---------------------------------------------------------------------------- *
 * Loading an untrusted character
 * ---------------------------------------------------------------------------- */

const SAFE_SRC = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;

/**
 * An image, only if it is genuinely a self-contained one.
 *
 * A project file is plain JSON that can be mailed or hand-edited, so an `src` pointing
 * at a web address would turn opening a project into a network request - which is the
 * one thing this app promises never to do.
 */
function safeImage(raw) {
  if (typeof raw?.src !== 'string' || !SAFE_SRC.test(raw.src)) return null;
  return {
    src: raw.src,
    width: Math.max(0, Number(raw.width) || 0),
    height: Math.max(0, Number(raw.height) || 0),
    name: typeof raw.name === 'string' ? raw.name.slice(0, 120) : '',
  };
}

export function sanitiseCharacter(raw, schemeId) {
  const scheme = getScheme(raw?.schemeId ?? schemeId);
  const character = emptyCharacter(
    typeof raw?.name === 'string' ? raw.name : 'Character', scheme.id,
  );

  if (typeof raw?.id === 'string' && /^[\w-]{1,40}$/.test(raw.id)) character.id = raw.id;

  const base = safeImage(raw?.base);
  if (base) {
    character.base = base;
    character.canvas = {
      width: base.width || DEFAULT_CANVAS.width,
      height: base.height || DEFAULT_CANVAS.height,
    };
  }

  if (Number(raw?.canvas?.width) > 0 && Number(raw?.canvas?.height) > 0) {
    character.canvas = {
      width: Math.min(20000, Number(raw.canvas.width)),
      height: Math.min(20000, Number(raw.canvas.height)),
    };
  }

  for (const [visemeId, image] of Object.entries(raw?.frames ?? {})) {
    if (!scheme.byId[visemeId]) continue;
    const safe = safeImage(image);
    if (safe) character.frames[visemeId] = safe;
  }

  for (const slot of SLOTS) {
    const incoming = raw?.slots?.[slot];
    character.slots[slot].placement = clampPlacement(
      { ...initialPlacement(slot, character.canvas), ...(incoming?.placement ?? {}) },
      character.canvas,
    );
    const allowed = new Set(slotStates(slot, scheme.id));
    for (const [state, image] of Object.entries(incoming?.images ?? {})) {
      if (!allowed.has(state)) continue;
      const safe = safeImage(image);
      if (safe) character.slots[slot].images[state] = safe;
    }
    for (const [state, adjust] of Object.entries(incoming?.adjusts ?? {})) {
      if (!allowed.has(state)) continue;
      const safe = sanitiseAdjust(adjust);
      if (hasAdjust(safe)) character.slots[slot].adjusts[state] = safe;
    }
  }

  character.kind = character.base ? 'layers'
    : (Object.keys(character.frames).length ? 'frames' : 'drawn');

  return character;
}

/** A whole library, with at least one character in it. */
export function sanitiseLibrary(raw, schemeId) {
  const list = Array.isArray(raw) ? raw.slice(0, 24).map((c) => sanitiseCharacter(c, schemeId)) : [];
  if (!list.length) list.push(emptyCharacter('Character 1', schemeId));

  // Ids must be unique, or switching character picks the wrong one.
  const seen = new Set();
  for (const character of list) {
    while (seen.has(character.id)) character.id = newId();
    seen.add(character.id);
  }
  return list;
}

export const findCharacter = (library, id) =>
  library.find((c) => c.id === id) ?? library[0] ?? null;

/** Match a `[as name]` cue to a character, on name, case- and space-insensitively. */
export function characterByName(library, name) {
  const wanted = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!wanted) return null;
  return library.find((c) => c.name.toLowerCase().replace(/\s+/g, '') === wanted) ?? null;
}

/* ---------------------------------------------------------------------------- *
 * Moving a character between viseme schemes
 * ---------------------------------------------------------------------------- */

/**
 * Re-key a character's mouth artwork onto another scheme.
 *
 * The mapping is not one-to-one - the twelve-pose sheet distinguishes shapes Rhubarb
 * merges - so what could not come across is reported rather than dropped in silence.
 * Brows, eyes, the base image and every placement are untouched: they are not keyed by
 * viseme, so a scheme change means nothing to them.
 *
 * @returns {{character: object, carried: string[], dropped: string[]}}
 */
export function convertCharacter(character, toSchemeId) {
  const from = getScheme(character?.schemeId).id;
  const to = getScheme(toSchemeId).id;
  if (!character) return { character, carried: [], dropped: [] };
  if (from === to) return { character: { ...character, schemeId: to }, carried: [], dropped: [] };

  const carried = [];
  const dropped = [];

  const remap = (source) => {
    const out = {};
    for (const [visemeId, image] of Object.entries(source ?? {})) {
      const target = equivalentViseme(visemeId, from, to);
      // Two source poses can map to one target; the first wins and the second is named.
      if (target && !out[target]) { out[target] = image; carried.push(visemeId); }
      else dropped.push(visemeId);
    }
    return out;
  };

  // Adjustments follow the same mapping but are not reported: losing a nudge is not
  // worth a warning next to losing a drawing.
  const remapAdjusts = (source, fromId, toId) => {
    const out = {};
    for (const [visemeId, adjust] of Object.entries(source ?? {})) {
      const target = equivalentViseme(visemeId, fromId, toId);
      if (target && !out[target]) out[target] = adjust;
    }
    return out;
  };

  return {
    character: {
      ...character,
      schemeId: to,
      frames: remap(character.frames),
      slots: {
        ...character.slots,
        mouth: {
          ...character.slots.mouth,
          images: remap(character.slots.mouth?.images),
          // Adjustments are keyed by viseme too, so they have to move with the artwork
          // or a re-keyed mouth would be drawn with another pose's offset.
          adjusts: remapAdjusts(character.slots.mouth?.adjusts, from, to),
        },
      },
    },
    carried,
    dropped,
  };
}

/** Total bytes across a whole library, for the storage guard. */
export const estimateLibraryBytes = (library) =>
  (library ?? []).reduce((sum, c) => sum + estimateCharacterBytes(c), 0);

/* ---------------------------------------------------------------------------- *
 * Direct manipulation
 *
 * The maths behind dragging a corner to resize and a handle to rotate. It lives here
 * rather than in the editor for the usual reason: it is arithmetic, and arithmetic is
 * the part worth testing without a browser.
 * ---------------------------------------------------------------------------- */

export const distance = (a, b) => Math.hypot((b?.x ?? 0) - (a?.x ?? 0), (b?.y ?? 0) - (a?.y ?? 0));

/**
 * Scale from a corner drag.
 *
 * Scaling is about the *centre*, not the opposite corner, because the placement point is
 * the centre: growing about a corner would move the part as well as resize it, and the
 * two would have to be undone separately. Ratio of distances rather than of widths, so a
 * corner dragged diagonally behaves the same as one dragged along an edge.
 */
export function scaleAfterDrag(originScale, startDistance, currentDistance) {
  const start = Number(startDistance);
  const now = Number(currentDistance);
  const base = Number(originScale);
  if (!Number.isFinite(base) || !Number.isFinite(start) || !Number.isFinite(now)) return base || 1;
  // A grab that started exactly on the centre has no ratio to work from.
  if (start < 1e-6) return base;
  return Math.min(12, Math.max(0.02, base * (now / start)));
}

/**
 * The angle from a centre to a point, in degrees, with 0 pointing straight up and
 * positive clockwise - which is what an SVG `rotate()` means.
 */
export function rotationFromPointer(centre, point) {
  const dx = (point?.x ?? 0) - (centre?.x ?? 0);
  const dy = (point?.y ?? 0) - (centre?.y ?? 0);
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return 0;
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;
  // Normalise into (-180, 180], which is the range clampPlacement allows. Half-open at
  // the bottom so straight down is 180 rather than -180; either is the same angle, but
  // only one of them reads correctly in a readout beside a slider.
  const turned = ((degrees % 360) + 360) % 360;
  return Math.round(turned > 180 ? turned - 360 : turned);
}

/** Snap a rotation to the nearest step, for the shift-drag that everyone expects. */
export const snapRotation = (degrees, step = 15) =>
  (step > 0 ? Math.round(degrees / step) * step : degrees);

/**
 * Where the editor handles go, in the part's own coordinates - that is, relative to its
 * centre and before rotation, because the group they are drawn into is already
 * translated and rotated.
 */
export function handleAnchors(box, { rotateOffset = 26 } = {}) {
  const hw = (box?.width ?? 0) / 2;
  const hh = (box?.height ?? 0) / 2;
  return {
    corners: [
      { id: 'nw', x: -hw, y: -hh },
      { id: 'ne', x: hw, y: -hh },
      { id: 'se', x: hw, y: hh },
      { id: 'sw', x: -hw, y: hh },
    ],
    rotate: { x: 0, y: -hh - rotateOffset },
  };
}
