import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLOTS,
  SLOT_INFO,
  EXPRESSION_STATES,
  EYE_STATES,
  DEFAULT_CANVAS,
  SLOT_BOX,
  slotStates,
  defaultPlacement,
  initialPlacement,
  clampPlacement,
  placementBox,
  emptyCharacter,
  canvasFor,
  isBlank,
  withBase,
  withPlacement,
  withSlotImage,
  withoutSlotImage,
  withFrame,
  withoutFrame,
  duplicateCharacter,
  resolveSlot,
  composeFrame,
  blinkSchedule,
  isBlinking,
  BLINK_DEFAULTS,
  characterCoverage,
  estimateCharacterBytes,
  characterWarnings,
  sanitiseCharacter,
  sanitiseLibrary,
  findCharacter,
  characterByName,
  distance,
  scaleAfterDrag,
  rotationFromPointer,
  snapRotation,
  handleAnchors,
  emptyAdjust,
  hasAdjust,
  sanitiseAdjust,
  slotAdjust,
  effectivePlacement,
  adjustFromPlacement,
  withAdjust,
  withoutAdjust,
  clearAdjusts,
  adjustedStates,
  convertCharacter,
} from '../js/character.js';
import { SCHEME_IDS, visemesOf, mouthVisemesOf } from '../js/visemes.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const img = (w = 100, h = 100, name = 'x.png') => ({ src: PIXEL, width: w, height: h, name });

/* --- the slot model ----------------------------------------------------- */

test('every slot is described and drawn in a defined order', () => {
  assert.deepEqual(SLOTS, ['eyes', 'brows', 'mouth']);
  for (const slot of SLOTS) {
    assert.ok(SLOT_INFO[slot]?.label, `${slot} has no label`);
    assert.ok(SLOT_INFO[slot]?.note.length > 20, `${slot} has no explanation`);
  }
});

test('the mouth is keyed by viseme and follows the scheme', () => {
  for (const schemeId of SCHEME_IDS) {
    assert.deepEqual(slotStates('mouth', schemeId), visemesOf(schemeId).map((v) => v.id));
  }
});

test('brows and eyes are keyed by expression, with a fallback state first', () => {
  assert.equal(slotStates('brows', 'chart')[0], 'neutral');
  assert.equal(slotStates('eyes', 'chart')[0], 'open');
  assert.ok(slotStates('eyes', 'chart').includes('closed'), 'a blink needs a closed state');
  for (const state of EXPRESSION_STATES) assert.ok(slotStates('brows', 'chart').includes(state));
  for (const state of EYE_STATES) assert.ok(slotStates('eyes', 'chart').includes(state));
});

test('an unknown slot has no states rather than throwing', () => {
  assert.deepEqual(slotStates('nose', 'chart'), []);
});

/* --- placement ---------------------------------------------------------- */

test('a fresh placement is sane', () => {
  const p = defaultPlacement();
  assert.equal(p.scale, 1);
  assert.equal(p.rotation, 0);
  assert.equal(p.opacity, 1);
  assert.equal(p.visible, true);
});

test('a part starts on the base image, not off it', () => {
  for (const canvas of [DEFAULT_CANVAS, { width: 1200, height: 800 }, { width: 300, height: 900 }]) {
    for (const slot of SLOTS) {
      const p = initialPlacement(slot, canvas);
      assert.ok(p.x > 0 && p.x < canvas.width, `${slot} x ${p.x} is off a ${canvas.width} canvas`);
      assert.ok(p.y > 0 && p.y < canvas.height, `${slot} y ${p.y} is off a ${canvas.height} canvas`);
      assert.ok(p.scale > 0, `${slot} has no scale`);
    }
  }
});

test('the mouth starts visible and below centre; brows start above it', () => {
  const p = initialPlacement('mouth', DEFAULT_CANVAS);
  assert.equal(p.visible, true);
  assert.ok(p.y > DEFAULT_CANVAS.height / 2, 'a mouth belongs below the middle of a face');
  assert.ok(initialPlacement('brows', DEFAULT_CANVAS).y < p.y);
});

test('a part on a big canvas starts bigger', () => {
  const small = initialPlacement('mouth', { width: 420, height: 420 }).scale;
  const large = initialPlacement('mouth', { width: 1680, height: 1680 }).scale;
  assert.ok(large > small, 'a mouth on a large portrait should not stay tiny');
});

test('clamping keeps a part reachable but allows it off the edge', () => {
  const canvas = { width: 400, height: 400 };
  assert.equal(clampPlacement({ x: -100, y: 200 }, canvas).x, -100, 'partly off-frame is legal');
  assert.equal(clampPlacement({ x: -9999, y: 200 }, canvas).x, -400, 'but not unreachable');
  assert.equal(clampPlacement({ x: 9999, y: 200 }, canvas).x, 800);
  assert.equal(clampPlacement({ scale: 0 }, canvas).scale, 0.02);
  assert.equal(clampPlacement({ scale: 500 }, canvas).scale, 12);
  assert.equal(clampPlacement({ rotation: 900 }, canvas).rotation, 180);
  assert.equal(clampPlacement({ opacity: 5 }, canvas).opacity, 1);
});

test('clamping junk yields a usable placement rather than NaN', () => {
  const p = clampPlacement({ x: 'left', y: null, scale: 'big', rotation: {}, opacity: [] },
    { width: 400, height: 400 });
  for (const key of ['x', 'y', 'scale', 'rotation', 'opacity']) {
    assert.ok(Number.isFinite(p[key]), `${key} is ${p[key]}`);
  }
  assert.equal(p.x, 200);
  assert.equal(p.y, 200);
});

test('the placement box is centred on the placement point', () => {
  const box = placementBox({ ...defaultPlacement(), x: 100, y: 60, scale: 2 }, img(50, 20));
  assert.equal(box.width, 100);
  assert.equal(box.height, 40);
  assert.equal(box.left, -50);
  assert.equal(box.top, -20);
  assert.equal(box.x, 100);
  assert.equal(box.y, 60);
});

test('a box for an image of unknown size still has one', () => {
  const box = placementBox(defaultPlacement(), null);
  assert.ok(box.width > 0 && box.height > 0);
});

/* --- characters --------------------------------------------------------- */

test('a new character is blank, drawn, and has every slot', () => {
  const c = emptyCharacter('Bob', 'chart');
  assert.equal(c.name, 'Bob');
  assert.equal(c.kind, 'drawn');
  assert.equal(c.base, null);
  assert.ok(isBlank(c));
  for (const slot of SLOTS) {
    assert.ok(c.slots[slot].placement, `${slot} has no placement`);
    assert.deepEqual(c.slots[slot].images, {});
  }
  assert.deepEqual(canvasFor(c), DEFAULT_CANVAS);
});

test('two new characters never share an id', () => {
  const ids = new Set(Array.from({ length: 50 }, () => emptyCharacter().id));
  assert.equal(ids.size, 50);
});

test('adding a base image makes the character layered and adopts its canvas', () => {
  const c = withBase(emptyCharacter('Bob'), img(1200, 900));
  assert.equal(c.kind, 'layers');
  assert.deepEqual(canvasFor(c), { width: 1200, height: 900 });
  assert.ok(!isBlank(c));
});

// A placement in the old canvas means nothing in a new one.
test('parts are re-placed onto a new base rather than left where they were', () => {
  let c = withBase(emptyCharacter('Bob'), img(420, 420));
  c = withPlacement(c, 'mouth', { x: 210, y: 300 });
  c = withBase(c, img(1200, 300));

  const p = c.slots.mouth.placement;
  assert.ok(p.x > 0 && p.x < 1200, `x ${p.x} off the new canvas`);
  assert.ok(p.y > 0 && p.y < 300, `y ${p.y} off the new canvas`);
});

test('removing the base returns the character to what it still has', () => {
  const withArt = withFrame(withBase(emptyCharacter(), img()), 'MBP', img());
  assert.equal(withBase(withArt, null).kind, 'frames');
  assert.equal(withBase(emptyCharacter(), null).kind, 'drawn');
});

test('editing returns a new character and leaves the old one alone', () => {
  const before = emptyCharacter('Bob');
  const after = withSlotImage(before, 'mouth', 'MBP', img());
  assert.deepEqual(before.slots.mouth.images, {});
  assert.ok(after.slots.mouth.images.MBP);
  assert.notEqual(before, after);

  const removed = withoutSlotImage(after, 'mouth', 'MBP');
  assert.ok(after.slots.mouth.images.MBP, 'removing mutated the original');
  assert.deepEqual(removed.slots.mouth.images, {});
});

test('adding artwork to a slot turns that slot on', () => {
  let c = emptyCharacter();
  c = withPlacement(c, 'brows', { visible: false });
  assert.equal(c.slots.brows.placement.visible, false);
  c = withSlotImage(c, 'brows', 'angry', img());
  assert.equal(c.slots.brows.placement.visible, true, 'artwork nobody can see is a trap');
});

test('frames and layers are tracked separately', () => {
  let c = withFrame(emptyCharacter(), 'MBP', img());
  assert.equal(c.kind, 'frames');
  c = withoutFrame(c, 'MBP');
  assert.equal(c.kind, 'drawn');

  const layered = withFrame(withBase(emptyCharacter(), img()), 'MBP', img());
  assert.equal(layered.kind, 'layers', 'a base image wins over frames');
});

test('a duplicate is a deep copy with its own id', () => {
  const original = withSlotImage(withBase(emptyCharacter('Bob'), img()), 'mouth', 'MBP', img());
  const copy = duplicateCharacter(original, 'Bob 2');

  assert.notEqual(copy.id, original.id);
  assert.equal(copy.name, 'Bob 2');
  copy.slots.mouth.placement.x = 999;
  assert.notEqual(original.slots.mouth.placement.x, 999, 'the copy shares state with the original');
});

/* --- resolving one frame ------------------------------------------------ */

const layered = (() => {
  let c = withBase(emptyCharacter('Bob', 'chart'), img(400, 400));
  c = withSlotImage(c, 'mouth', 'MBP', img(80, 40, 'mbp.png'));
  c = withSlotImage(c, 'brows', 'neutral', img(120, 20, 'brows.png'));
  c = withSlotImage(c, 'brows', 'angry', img(120, 20, 'angry.png'));
  c = withSlotImage(c, 'eyes', 'open', img(120, 40, 'eyes.png'));
  c = withSlotImage(c, 'eyes', 'closed', img(120, 10, 'shut.png'));
  return c;
})();

test('a slot with artwork for this pose resolves to that artwork', () => {
  const r = resolveSlot(layered, 'mouth', { viseme: 'MBP' });
  assert.equal(r.kind, 'image');
  assert.equal(r.image.name, 'mbp.png');
});

// This is what makes a half-finished character usable.
test('a mouth with no artwork for this pose falls back to the built-in drawing', () => {
  const r = resolveSlot(layered, 'mouth', { viseme: 'AEI' });
  assert.equal(r.kind, 'drawn');
  assert.ok(r.placement, 'the built-in mouth still needs to know where to go');
});

test('brows fall back to neutral, and to nothing at all when undrawn', () => {
  assert.equal(resolveSlot(layered, 'brows', { expression: 'angry' }).image.name, 'angry.png');
  assert.equal(resolveSlot(layered, 'brows', { expression: 'sad' }).image.name, 'brows.png');
  assert.equal(resolveSlot(layered, 'brows', {}).image.name, 'brows.png');
  assert.equal(resolveSlot(emptyCharacter(), 'brows', {}).kind, 'none');
});

test('a blink shows the closed eyes and only then', () => {
  assert.equal(resolveSlot(layered, 'eyes', { eyesClosed: true }).image.name, 'shut.png');
  assert.equal(resolveSlot(layered, 'eyes', { eyesClosed: false }).image.name, 'eyes.png');
});

test('a hidden slot resolves to nothing whatever artwork it has', () => {
  const hidden = withPlacement(layered, 'mouth', { visible: false });
  assert.equal(resolveSlot(hidden, 'mouth', { viseme: 'MBP' }).kind, 'none');
});

test('an unknown slot resolves to nothing rather than throwing', () => {
  assert.equal(resolveSlot(layered, 'nose', {}).kind, 'none');
  assert.equal(resolveSlot(null, 'mouth', {}).kind, 'none');
});

/* --- composing a frame -------------------------------------------------- */

test('a blank character composes as the built-in face', () => {
  const frame = composeFrame(emptyCharacter(), { viseme: 'MBP' });
  assert.equal(frame.mode, 'drawn');
  assert.deepEqual(frame.parts, []);
  assert.deepEqual(frame.canvas, DEFAULT_CANVAS);
});

test('a frames character composes as one whole picture', () => {
  const c = withFrame(emptyCharacter(), 'MBP', img(300, 300, 'closed.png'));
  const frame = composeFrame(c, { viseme: 'MBP' });
  assert.equal(frame.mode, 'frame');
  assert.equal(frame.base.name, 'closed.png');

  // A pose it does not have falls back rather than showing a blank stage.
  assert.equal(composeFrame(c, { viseme: 'AEI' }).mode, 'drawn');
});

test('a layered character composes base plus parts, in draw order', () => {
  const frame = composeFrame(layered, { viseme: 'MBP', expression: 'angry' });
  assert.equal(frame.mode, 'layers');
  assert.ok(frame.base);
  assert.deepEqual(frame.parts.map((p) => p.slot), ['eyes', 'brows', 'mouth']);
  assert.equal(frame.parts.at(-1).slot, 'mouth', 'the mouth must be drawn last');
});

test('a layered character with only a base still animates', () => {
  const bare = withBase(emptyCharacter(), img(400, 400));
  const frame = composeFrame(bare, { viseme: 'AEI' });
  assert.equal(frame.mode, 'layers');
  assert.deepEqual(frame.parts.map((p) => p.slot), ['mouth']);
  assert.equal(frame.parts[0].kind, 'drawn');
});

test('every viseme in every scheme composes to something drawable', () => {
  for (const schemeId of SCHEME_IDS) {
    const c = withBase(emptyCharacter('X', schemeId), img(500, 500));
    for (const viseme of visemesOf(schemeId)) {
      const frame = composeFrame(c, { viseme: viseme.id });
      assert.ok(frame.mode === 'layers' && frame.parts.length,
        `${schemeId}/${viseme.id} composed to nothing`);
    }
  }
});

/* --- blinking ----------------------------------------------------------- */

test('blinks are in order, inside the track, and never overlap', () => {
  const blinks = blinkSchedule(60, { seed: 7 });
  assert.ok(blinks.length > 5, `only ${blinks.length} blinks in a minute`);
  let previousEnd = 0;
  for (const blink of blinks) {
    assert.ok(blink.start >= previousEnd, 'blinks overlap');
    assert.ok(blink.end > blink.start);
    assert.ok(blink.end <= 60, 'a blink runs past the end of the track');
    previousEnd = blink.end;
  }
});

test('the blink schedule is deterministic, so the track does not jitter on re-render', () => {
  assert.deepEqual(blinkSchedule(30, { seed: 3 }), blinkSchedule(30, { seed: 3 }));
  assert.notDeepEqual(blinkSchedule(30, { seed: 3 }), blinkSchedule(30, { seed: 4 }));
});

test('blinks are irregular rather than metronomic', () => {
  const blinks = blinkSchedule(120, { seed: 11 });
  const gaps = blinks.slice(1).map((b, i) => b.start - blinks[i].start);
  assert.ok(new Set(gaps.map((g) => g.toFixed(3))).size > gaps.length / 2,
    'a character blinking on a perfect metronome reads as a machine');
});

test('a track too short to blink in has no blinks', () => {
  assert.deepEqual(blinkSchedule(0.05), []);
  assert.deepEqual(blinkSchedule(0), []);
  assert.deepEqual(blinkSchedule(-5), []);
});

test('isBlinking agrees with the schedule', () => {
  const blinks = blinkSchedule(20, { seed: 5 });
  for (const blink of blinks) {
    assert.equal(isBlinking(blinks, blink.start), true);
    assert.equal(isBlinking(blinks, (blink.start + blink.end) / 2), true);
    assert.equal(isBlinking(blinks, blink.end + 0.001), false);
  }
  assert.equal(isBlinking([], 3), false);
});

test('the blink rate is adjustable', () => {
  const often = blinkSchedule(60, { seed: 2, everySeconds: 1.5 }).length;
  const rarely = blinkSchedule(60, { seed: 2, everySeconds: 10 }).length;
  assert.ok(often > rarely, `${often} was not more than ${rarely}`);
  assert.ok(BLINK_DEFAULTS.everySeconds > 1);
});

/* --- coverage, size and warnings ---------------------------------------- */

test('coverage counts the source the character actually uses', () => {
  const frames = withFrame(emptyCharacter('F', 'chart'), 'MBP', img());
  assert.deepEqual(characterCoverage(frames, 'chart').assigned, ['MBP']);

  assert.deepEqual(characterCoverage(layered, 'chart').assigned, ['MBP']);
  assert.equal(characterCoverage(layered, 'chart').total, mouthVisemesOf('chart').length);
  assert.equal(characterCoverage(layered, 'chart').brows, 2);
  assert.equal(characterCoverage(layered, 'chart').eyes, 2);
  assert.equal(characterCoverage(layered, 'chart').hasBase, true);
});

test('a blank character costs nothing and a filled one costs something', () => {
  assert.equal(estimateCharacterBytes(emptyCharacter()), 0);
  assert.equal(estimateCharacterBytes(null), 0);
  assert.ok(estimateCharacterBytes(layered) > 0);
});

test('a drawn character never warns', () => {
  assert.deepEqual(characterWarnings(emptyCharacter(), 'chart'), []);
});

test('a hidden mouth is the loudest warning there is', () => {
  const hidden = withPlacement(layered, 'mouth', { visible: false });
  const warnings = characterWarnings(hidden, 'chart');
  assert.ok(warnings.some((w) => w.level === 'danger'), 'a character that cannot speak must say so');
});

test('a mouth dragged off the picture is flagged', () => {
  const lost = withPlacement(layered, 'mouth', { x: -300, y: -300 });
  assert.ok(characterWarnings(lost, 'chart').some((w) => /outside the picture/.test(w.text)));
});

test('a well-placed layered character produces no warnings', () => {
  assert.deepEqual(characterWarnings(layered, 'chart'), []);
});

test('no warning leaks a raw float', () => {
  for (const c of [withPlacement(layered, 'mouth', { x: -300.123456789 }),
    withFrame(emptyCharacter(), 'MBP', img())]) {
    for (const w of characterWarnings(c, 'chart')) {
      assert.doesNotMatch(w.text, /\d\.\d{4,}/);
    }
  }
});

/* --- loading an untrusted character ------------------------------------- */

test('a character round-trips through JSON with its placement intact', () => {
  const read = sanitiseCharacter(JSON.parse(JSON.stringify(layered)), 'chart');
  assert.equal(read.kind, 'layers');
  assert.equal(read.name, 'Bob');
  assert.equal(read.id, layered.id);
  assert.deepEqual(read.canvas, layered.canvas);
  assert.deepEqual(read.slots.mouth.placement, layered.slots.mouth.placement);
  assert.equal(read.slots.mouth.images.MBP.name, 'mbp.png');
  assert.equal(read.slots.eyes.images.closed.name, 'shut.png');
});

test('a character file with a web address for an image loads without it', () => {
  const read = sanitiseCharacter({
    name: 'Trap',
    base: { src: 'https://example.com/tracker.png', width: 10, height: 10 },
    slots: { mouth: { images: { MBP: { src: PIXEL, width: 10, height: 10 } } } },
  }, 'chart');
  assert.equal(read.base, null, 'a remote image was loaded');
  assert.ok(read.slots.mouth.images.MBP, 'a valid data URL was rejected');
});

test('a character file cannot smuggle in a state the slot does not have', () => {
  const read = sanitiseCharacter({
    slots: {
      mouth: { images: { MBP: { src: PIXEL }, NOTAVISEME: { src: PIXEL } } },
      brows: { images: { angry: { src: PIXEL }, confused: { src: PIXEL } } },
    },
  }, 'chart');
  assert.deepEqual(Object.keys(read.slots.mouth.images), ['MBP']);
  assert.deepEqual(Object.keys(read.slots.brows.images), ['angry']);
});

test('a character file with an absurd placement is clamped, not obeyed', () => {
  const read = sanitiseCharacter({
    base: { src: PIXEL, width: 400, height: 400 },
    slots: { mouth: { placement: { x: 1e9, y: -1e9, scale: 1e6, rotation: 1e4 } } },
  }, 'chart');
  const p = read.slots.mouth.placement;
  assert.ok(p.x <= 800 && p.y >= -400 && p.scale <= 12 && Math.abs(p.rotation) <= 180);
});

test('sanitising junk yields a usable character rather than throwing', () => {
  for (const junk of [null, undefined, 42, 'nope', [], { slots: 'no' }, { frames: 5 }]) {
    assert.doesNotThrow(() => sanitiseCharacter(junk, 'chart'));
    const c = sanitiseCharacter(junk, 'chart');
    assert.equal(c.kind, 'drawn');
    for (const slot of SLOTS) assert.ok(c.slots[slot].placement);
  }
});

/* --- the library -------------------------------------------------------- */

test('a library always has at least one character', () => {
  for (const junk of [null, undefined, [], 'no', 42]) {
    const library = sanitiseLibrary(junk, 'chart');
    assert.equal(library.length, 1);
    assert.ok(library[0].id);
  }
});

test('a library never contains two characters with the same id', () => {
  const library = sanitiseLibrary([
    { id: 'same', name: 'A' }, { id: 'same', name: 'B' }, { id: 'same', name: 'C' },
  ], 'chart');
  assert.equal(new Set(library.map((c) => c.id)).size, 3);
});

test('a library is bounded', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ name: `C${i}` }));
  assert.ok(sanitiseLibrary(many, 'chart').length <= 24);
});

test('finding a character falls back rather than returning nothing', () => {
  const library = sanitiseLibrary([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], 'chart');
  assert.equal(findCharacter(library, 'b').name, 'B');
  assert.equal(findCharacter(library, 'nope').name, 'A');
  assert.equal(findCharacter([], 'a'), null);
});

test('a [as name] cue matches on the name, forgivingly', () => {
  const library = sanitiseLibrary([{ name: 'Bob' }, { name: 'Alice Smith' }], 'chart');
  assert.equal(characterByName(library, 'bob').name, 'Bob');
  assert.equal(characterByName(library, 'BOB').name, 'Bob');
  assert.equal(characterByName(library, ' alice smith ').name, 'Alice Smith');
  assert.equal(characterByName(library, 'alicesmith').name, 'Alice Smith');
  assert.equal(characterByName(library, 'nobody'), null);
  assert.equal(characterByName(library, ''), null);
});

/* --- direct manipulation ------------------------------------------------- */

test('distance is plain Euclidean distance', () => {
  assert.equal(distance({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distance({ x: 0, y: 0 }, { x: 0, y: 0 }), 0);
  assert.equal(distance(null, null), 0);
});

// Scaling is about the centre, so the ratio of distances is the ratio of scales.
test('dragging a corner twice as far from the centre doubles the size', () => {
  assert.equal(scaleAfterDrag(1, 100, 200), 2);
  assert.equal(scaleAfterDrag(2, 100, 50), 1);
  assert.equal(scaleAfterDrag(1, 100, 100), 1);
});

test('a resize is clamped to the same range as a typed scale', () => {
  assert.equal(scaleAfterDrag(1, 100, 100000), 12);
  assert.equal(scaleAfterDrag(1, 100, 0), 0.02);
  // The clamp must agree with clampPlacement, or a drag could set a value the sliders
  // then refuse to show.
  assert.equal(clampPlacement({ scale: scaleAfterDrag(1, 100, 100000) }).scale, 12);
  assert.equal(clampPlacement({ scale: scaleAfterDrag(1, 100, 0) }).scale, 0.02);
});

test('a resize that starts on the centre changes nothing rather than exploding', () => {
  assert.equal(scaleAfterDrag(1.5, 0, 300), 1.5);
  assert.equal(scaleAfterDrag(1.5, NaN, 300), 1.5);
  assert.equal(scaleAfterDrag(NaN, 100, 200), 1);
});

test('rotation is measured clockwise from straight up, as SVG means it', () => {
  const centre = { x: 100, y: 100 };
  assert.equal(rotationFromPointer(centre, { x: 100, y: 0 }), 0);
  assert.equal(rotationFromPointer(centre, { x: 200, y: 100 }), 90);
  assert.equal(rotationFromPointer(centre, { x: 100, y: 200 }), 180);
  assert.equal(rotationFromPointer(centre, { x: 0, y: 100 }), -90);
  assert.equal(rotationFromPointer(centre, centre), 0);
});

test('every rotation the pointer can produce is one clampPlacement accepts', () => {
  const centre = { x: 0, y: 0 };
  for (let deg = 0; deg < 360; deg += 7) {
    const r = (deg * Math.PI) / 180;
    const value = rotationFromPointer(centre, { x: Math.sin(r) * 50, y: -Math.cos(r) * 50 });
    assert.ok(value >= -180 && value <= 180, `${deg} degrees produced ${value}`);
    assert.equal(clampPlacement({ rotation: value }).rotation, value);
  }
});

test('rotation snaps to a step when asked', () => {
  assert.equal(snapRotation(7, 15), 0);
  assert.equal(snapRotation(8, 15), 15);
  assert.equal(snapRotation(-38, 15), -45);
  assert.equal(snapRotation(37, 0), 37);
});

test('handles sit on the corners of the box and above it', () => {
  const box = { width: 100, height: 60 };
  const { corners, rotate } = handleAnchors(box);
  assert.deepEqual(corners.map((c) => c.id), ['nw', 'ne', 'se', 'sw']);
  assert.deepEqual(corners.find((c) => c.id === 'nw'), { id: 'nw', x: -50, y: -30 });
  assert.deepEqual(corners.find((c) => c.id === 'se'), { id: 'se', x: 50, y: 30 });
  assert.ok(rotate.y < -30, 'the rotate handle belongs above the box');
  assert.equal(rotate.x, 0);
});

/* --- positioning a slot before its artwork exists ------------------------ */

test('an empty brow slot is a placeholder in the editor and nothing on the stage', () => {
  const bare = withBase(emptyCharacter(), img(400, 400));
  assert.equal(resolveSlot(bare, 'brows', {}).kind, 'none');
  assert.equal(resolveSlot(bare, 'brows', { includeEmpty: true }).kind, 'placeholder');
  assert.ok(resolveSlot(bare, 'brows', { includeEmpty: true }).placement,
    'a placeholder still needs somewhere to be');
});

test('a hidden slot can still be positioned in the editor', () => {
  const hidden = withPlacement(withBase(emptyCharacter(), img(400, 400)), 'eyes', { visible: false });
  assert.equal(resolveSlot(hidden, 'eyes', {}).kind, 'none');
  assert.notEqual(resolveSlot(hidden, 'eyes', { includeEmpty: true }).kind, 'none');
});

test('the editor sees every slot; the stage sees only what is drawn', () => {
  const bare = withBase(emptyCharacter(), img(400, 400));
  assert.deepEqual(composeFrame(bare, { viseme: 'MBP' }).parts.map((p) => p.slot), ['mouth']);
  assert.deepEqual(
    composeFrame(bare, { viseme: 'MBP', includeEmpty: true }).parts.map((p) => p.slot),
    ['eyes', 'brows', 'mouth'],
  );
});

test('placeholders never leak onto a frames or drawn character', () => {
  assert.deepEqual(composeFrame(emptyCharacter(), { viseme: 'MBP', includeEmpty: true }).parts, []);
  const frames = withFrame(emptyCharacter(), 'MBP', img());
  assert.deepEqual(composeFrame(frames, { viseme: 'MBP', includeEmpty: true }).parts, []);
});

test('every slot has a natural size for its placeholder', () => {
  for (const slot of SLOTS) {
    assert.ok(SLOT_BOX[slot], `${slot} has no placeholder size`);
    assert.ok(SLOT_BOX[slot].width > 0 && SLOT_BOX[slot].height > 0);
    // A part is wider than it is tall; a square ghost tells you nothing about a brow.
    assert.ok(SLOT_BOX[slot].width > SLOT_BOX[slot].height, `${slot} ghost is not part-shaped`);
    assert.ok(SLOT_BOX[slot].width < DEFAULT_CANVAS.width,
      `${slot} ghost is as wide as the whole canvas`);
  }
});

/* --- per-pose adjustments ------------------------------------------------ */

const based = () => withBase(emptyCharacter('Bob', 'chart'), img(600, 800, 'base.png'));

test('a fresh adjustment is the identity and is not treated as an adjustment', () => {
  const a = emptyAdjust();
  assert.deepEqual(a, { dx: 0, dy: 0, scaleFactor: 1, dRotation: 0 });
  assert.equal(hasAdjust(a), false);
  assert.equal(hasAdjust(null), false);
  assert.equal(hasAdjust({ dx: 0.0000001 }), false);
  assert.equal(hasAdjust({ dy: 12 }), true);
  assert.equal(hasAdjust({ scaleFactor: 1.4 }), true);
});

test('an adjustment is a delta, so it folds onto the slot placement', () => {
  const base = { x: 300, y: 500, scale: 1, rotation: 0, opacity: 1, visible: true };
  const out = effectivePlacement(base, { dx: 20, dy: -15, scaleFactor: 1.5, dRotation: 10 },
    { width: 600, height: 800 });
  assert.equal(out.x, 320);
  assert.equal(out.y, 485);
  assert.equal(out.scale, 1.5);
  assert.equal(out.rotation, 10);
});

// This is the reason deltas were chosen over absolute placements.
test('moving the slot carries every adjusted pose with it', () => {
  let c = based();
  c = withPlacement(c, 'mouth', { x: 300, y: 500, scale: 1 });
  c = withAdjust(c, 'mouth', 'AEI', { dy: 40, scaleFactor: 1.4 });

  const before = resolveSlot(c, 'mouth', { viseme: 'AEI' }).placement;
  assert.equal(before.y, 540);

  // Reposition the whole mouth 100 to the right and 60 up.
  c = withPlacement(c, 'mouth', { x: 400, y: 440 });
  const after = resolveSlot(c, 'mouth', { viseme: 'AEI' }).placement;

  assert.equal(after.x, 400, 'the pose did not follow the slot across');
  assert.equal(after.y, 480, 'the pose did not keep its own offset');
  assert.equal(after.scale, 1.4, 'the pose lost its own size');
});

test('only the adjusted pose moves; the others stay on the slot placement', () => {
  let c = withPlacement(based(), 'mouth', { x: 300, y: 500, scale: 1 });
  c = withAdjust(c, 'mouth', 'AEI', { dy: 40, scaleFactor: 1.4 });

  const wide = resolveSlot(c, 'mouth', { viseme: 'AEI' }).placement;
  const closed = resolveSlot(c, 'mouth', { viseme: 'MBP' }).placement;

  assert.equal(wide.y, 540);
  assert.equal(wide.scale, 1.4);
  assert.equal(closed.y, 500);
  assert.equal(closed.scale, 1);
});

test('the adjustment that turns one placement into another is the difference', () => {
  const base = { x: 100, y: 200, scale: 2, rotation: 10, opacity: 1, visible: true };
  const wanted = { x: 130, y: 190, scale: 3, rotation: 25, opacity: 1, visible: true };
  const adjust = adjustFromPlacement(base, wanted);

  assert.equal(adjust.dx, 30);
  assert.equal(adjust.dy, -10);
  assert.equal(adjust.scaleFactor, 1.5);
  assert.equal(adjust.dRotation, 15);

  // Round trip: applying it must reproduce what was wanted.
  const back = effectivePlacement(base, adjust);
  assert.equal(back.x, wanted.x);
  assert.equal(back.y, wanted.y);
  assert.ok(Math.abs(back.scale - wanted.scale) < 1e-9);
  assert.equal(back.rotation, wanted.rotation);
});

test('every slot state can be adjusted independently, in every scheme', () => {
  for (const schemeId of SCHEME_IDS) {
    let c = withBase(emptyCharacter('X', schemeId), img(500, 500));
    for (const slot of SLOTS) {
      for (const state of slotStates(slot, schemeId)) {
        c = withAdjust(c, slot, state, { dy: 3 });
      }
      assert.equal(adjustedStates(c, slot, schemeId).length,
        slotStates(slot, schemeId).length, `${schemeId}/${slot}`);
    }
  }
});

test('an adjustment equal to the identity is removed rather than stored', () => {
  let c = withAdjust(based(), 'mouth', 'AEI', { dy: 40 });
  assert.deepEqual(adjustedStates(c, 'mouth', 'chart'), ['AEI']);

  c = withAdjust(c, 'mouth', 'AEI', { dy: 0 });
  assert.deepEqual(adjustedStates(c, 'mouth', 'chart'), [],
    'a pose nudged back to zero should not still read as adjusted');
});

test('adjustments can be removed one at a time or all at once', () => {
  let c = based();
  c = withAdjust(c, 'mouth', 'AEI', { dy: 40 });
  c = withAdjust(c, 'mouth', 'O', { scaleFactor: 0.8 });
  assert.deepEqual(adjustedStates(c, 'mouth', 'chart').sort(), ['AEI', 'O']);

  assert.deepEqual(adjustedStates(withoutAdjust(c, 'mouth', 'O'), 'mouth', 'chart'), ['AEI']);
  assert.deepEqual(adjustedStates(clearAdjusts(c, 'mouth'), 'mouth', 'chart'), []);
});

test('adjusting returns a new character and leaves the old one alone', () => {
  const before = based();
  const after = withAdjust(before, 'mouth', 'AEI', { dy: 40 });
  assert.deepEqual(before.slots.mouth.adjusts, {});
  assert.ok(after.slots.mouth.adjusts.AEI);
  assert.notEqual(before, after);
});

test('an unknown slot or a missing state is refused rather than stored', () => {
  assert.equal(withAdjust(based(), 'nose', 'AEI', { dy: 5 }).slots.nose, undefined);
  assert.deepEqual(withAdjust(based(), 'mouth', '', { dy: 5 }).slots.mouth.adjusts, {});
});

test('an effective placement is clamped like any other', () => {
  const base = { x: 300, y: 400, scale: 6, rotation: 170, opacity: 1, visible: true };
  const out = effectivePlacement(base, { dx: 99999, scaleFactor: 20, dRotation: 170 },
    { width: 600, height: 800 });
  assert.ok(out.x <= 1200);
  assert.ok(out.scale <= 12);
  assert.ok(Math.abs(out.rotation) <= 180);
  for (const key of ['x', 'y', 'scale', 'rotation']) {
    assert.ok(Number.isFinite(out[key]), `${key} is ${out[key]}`);
  }
});

test('a junk adjustment is sanitised rather than obeyed', () => {
  const a = sanitiseAdjust({ dx: 'left', dy: null, scaleFactor: 'huge', dRotation: {} });
  assert.deepEqual(a, emptyAdjust());
  assert.deepEqual(sanitiseAdjust(undefined), emptyAdjust());
  assert.equal(sanitiseAdjust({ scaleFactor: 1e9 }).scaleFactor, 20);
  assert.equal(sanitiseAdjust({ scaleFactor: 0 }).scaleFactor, 0.05);
});

test('resolving a slot reports which state it drew, so the editor can adjust it', () => {
  let c = based();
  c = withSlotImage(c, 'brows', 'neutral', img(200, 40, 'brows.png'));
  assert.equal(resolveSlot(c, 'mouth', { viseme: 'AEI' }).stateKey, 'AEI');
  // An expression with no artwork falls back to neutral, and the adjustment must follow
  // the pose that is actually on screen rather than the one that was asked for.
  assert.equal(resolveSlot(c, 'brows', { expression: 'angry' }).stateKey, 'neutral');
  assert.equal(resolveSlot(c, 'brows', { expression: 'neutral' }).stateKey, 'neutral');
});

test('a blink takes the closed-eye adjustment, not the open one', () => {
  let c = based();
  c = withSlotImage(c, 'eyes', 'open', img(200, 60, 'open.png'));
  c = withSlotImage(c, 'eyes', 'closed', img(200, 20, 'shut.png'));
  c = withAdjust(c, 'eyes', 'closed', { dy: 6 });
  c = withPlacement(c, 'eyes', { y: 300 });

  assert.equal(resolveSlot(c, 'eyes', { eyesClosed: true }).placement.y, 306);
  assert.equal(resolveSlot(c, 'eyes', { eyesClosed: false }).placement.y, 300);
});

test('a new base picture clears the adjustments along with the placements', () => {
  let c = withAdjust(based(), 'mouth', 'AEI', { dy: 40 });
  assert.deepEqual(adjustedStates(c, 'mouth', 'chart'), ['AEI']);
  c = withBase(c, img(1200, 400, 'other.png'));
  assert.deepEqual(adjustedStates(c, 'mouth', 'chart'), [],
    'a delta measured against a placement that no longer exists is meaningless');
});

test('adjustments survive a project round trip', () => {
  let c = based();
  c = withAdjust(c, 'mouth', 'AEI', { dy: 40, scaleFactor: 1.4 });
  c = withAdjust(c, 'brows', 'angry', { dy: -8 });

  const read = sanitiseCharacter(JSON.parse(JSON.stringify(c)), 'chart');
  assert.deepEqual(read.slots.mouth.adjusts.AEI, { dx: 0, dy: 40, scaleFactor: 1.4, dRotation: 0 });
  assert.deepEqual(read.slots.brows.adjusts.angry, { dx: 0, dy: -8, scaleFactor: 1, dRotation: 0 });
});

test('a project file cannot smuggle in an adjustment for a state that does not exist', () => {
  const read = sanitiseCharacter({
    base: { src: PIXEL, width: 400, height: 400 },
    slots: { mouth: { adjusts: { AEI: { dy: 5 }, NOTAPOSE: { dy: 5 } } } },
  }, 'chart');
  assert.deepEqual(Object.keys(read.slots.mouth.adjusts), ['AEI']);
});

test('changing scheme carries the mouth adjustments with the artwork', () => {
  let c = withBase(emptyCharacter('X', 'chart'), img(500, 500));
  c = withSlotImage(c, 'mouth', 'MBP', img(80, 40, 'closed.png'));
  c = withAdjust(c, 'mouth', 'MBP', { dy: 12 });

  const { character } = convertCharacter(c, 'rhubarb');
  // MBP becomes A in the Rhubarb scheme; the nudge has to follow it.
  assert.ok(character.slots.mouth.images.A, 'the artwork did not carry across');
  assert.equal(character.slots.mouth.adjusts.A?.dy, 12, 'the nudge did not carry across');
  assert.equal(character.slots.mouth.adjusts.MBP, undefined);
});

test('every adjusted pose still composes to something drawable', () => {
  for (const schemeId of SCHEME_IDS) {
    let c = withBase(emptyCharacter('X', schemeId), img(600, 800));
    for (const state of slotStates('mouth', schemeId)) {
      c = withAdjust(c, 'mouth', state, { dy: 30, scaleFactor: 1.6, dRotation: 12 });
    }
    for (const v of visemesOf(schemeId)) {
      const frame = composeFrame(c, { viseme: v.id });
      assert.ok(frame.parts.length, `${schemeId}/${v.id} composed to nothing`);
      for (const part of frame.parts) {
        assert.ok(Number.isFinite(part.placement.x) && Number.isFinite(part.placement.scale),
          `${schemeId}/${v.id} produced a broken placement`);
      }
    }
  }
});
