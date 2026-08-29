import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyMouthSet,
  hasArtwork,
  guessViseme,
  planAssignment,
  sheetGrid,
  SHEET_DEFAULTS,
  defaultCellAssignment,
  coverage,
  estimateBytes,
  fitsInStorage,
  STORAGE_LIMIT_BYTES,
  mouthSetWarnings,
  withImage,
  withoutImage,
  convertSet,
  sanitiseMouthSet,
} from '../js/mouthset.js';
import { SCHEME_IDS, visemesOf, mouthVisemesOf, getScheme } from '../js/visemes.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const image = (name = 'x.png', width = 100, height = 100) => ({ src: PIXEL, width, height, name });

const fullSet = (schemeId) => {
  let set = emptyMouthSet(schemeId);
  for (const viseme of visemesOf(schemeId)) set = withImage(set, viseme.id, image(`${viseme.id}.png`));
  return set;
};

/* --- the empty set ------------------------------------------------------ */

test('an empty set is valid and has no artwork', () => {
  const set = emptyMouthSet('chart');
  assert.equal(set.schemeId, 'chart');
  assert.deepEqual(set.images, {});
  assert.equal(hasArtwork(set), false);
  assert.equal(hasArtwork(undefined), false);
});

test('an empty set falls back to a real scheme', () => {
  assert.ok(SCHEME_IDS.includes(emptyMouthSet('nonsense').schemeId));
});

/* --- reading a viseme out of a filename --------------------------------- */

test('a file named after its viseme id lands in the right slot', () => {
  assert.equal(guessViseme('MBP.png', 'chart'), 'MBP');
  assert.equal(guessViseme('aei.jpg', 'chart'), 'AEI');
  assert.equal(guessViseme('CHSHJ.webp', 'chart'), 'CHSHJ');
  assert.equal(guessViseme('X.png', 'rhubarb'), 'X');
});

test('Preston Blair and Moho names are understood', () => {
  assert.equal(guessViseme('AI.png', 'chart'), 'AEI');
  assert.equal(guessViseme('WQ.png', 'chart'), 'QW');
  assert.equal(guessViseme('FV.png', 'chart'), 'FV');
  assert.equal(guessViseme('etc.png', 'chart'), 'CONS');
  assert.equal(guessViseme('rest.png', 'chart'), 'MBP');
});

test('plain English names are understood', () => {
  assert.equal(guessViseme('closed.png', 'chart'), 'MBP');
  assert.equal(guessViseme('smile.png', 'chart'), 'SMILE');
  assert.equal(guessViseme('angry.png', 'chart'), 'ANGRY');
  assert.equal(guessViseme('laughing.png', 'chart'), 'LAUGHING');
});

test('a prefixed or suffixed name still resolves on its last word', () => {
  assert.equal(guessViseme('lisa_mouth_MBP.png', 'chart'), 'MBP');
  assert.equal(guessViseme('char-01 - smile.PNG', 'chart'), 'SMILE');
  assert.equal(guessViseme('mouth A.png', 'rhubarb'), 'A');
});

test('a Rhubarb letter crosses into the character sheet and back', () => {
  assert.equal(guessViseme('A.png', 'chart'), 'MBP');
  assert.equal(guessViseme('D.png', 'chart'), 'AEI');
  assert.equal(guessViseme('MBP.png', 'rhubarb'), 'A');
  assert.equal(guessViseme('AI.png', 'rhubarb'), 'D');
});

test('an unrecognised name returns null rather than guessing wrong', () => {
  assert.equal(guessViseme('frame_0007.png', 'chart'), null);
  assert.equal(guessViseme('', 'chart'), null);
  assert.equal(guessViseme(undefined, 'chart'), null);
  assert.equal(guessViseme('.png', 'chart'), null);
});

test('an expression name is not offered to a scheme that cannot draw it', () => {
  assert.equal(guessViseme('smile.png', 'rhubarb'), null);
});

test('every viseme in every scheme is findable by its own id', () => {
  for (const schemeId of SCHEME_IDS) {
    for (const viseme of visemesOf(schemeId)) {
      assert.equal(guessViseme(`${viseme.id}.png`, schemeId), viseme.id,
        `${schemeId}/${viseme.id} could not be found by name`);
    }
  }
});

/* --- planning a drop ---------------------------------------------------- */

test('a well-named drop is assigned in full', () => {
  const files = mouthVisemesOf('chart').map((v) => ({ name: `${v.id}.png` }));
  const plan = planAssignment(files, 'chart');
  assert.equal(plan.matches.length, files.length);
  assert.deepEqual(plan.unmatched, []);
  assert.deepEqual(plan.clashes, []);
});

test('unrecognised files are listed rather than dropped', () => {
  const plan = planAssignment([{ name: 'MBP.png' }, { name: 'IMG_2201.png' }], 'chart');
  assert.equal(plan.matches.length, 1);
  assert.deepEqual(plan.unmatched.map((u) => u.name), ['IMG_2201.png']);
});

test('two files claiming the same pose are reported, first one wins', () => {
  const plan = planAssignment([{ name: 'MBP.png' }, { name: 'closed.png' }], 'chart');
  assert.equal(plan.matches.length, 1);
  assert.equal(plan.matches[0].name, 'MBP.png');
  assert.deepEqual(plan.clashes, [{ viseme: 'MBP', names: ['MBP.png', 'closed.png'] }]);
});

test('an empty drop plans nothing and throws nothing', () => {
  assert.deepEqual(planAssignment([], 'chart').matches, []);
  assert.deepEqual(planAssignment(undefined, 'chart').matches, []);
});

/* --- contact sheets ----------------------------------------------------- */

test('a grid produces exactly cols x rows cells', () => {
  const cells = sheetGrid(1000, 600, { cols: 5, rows: 3 });
  assert.equal(cells.length, 15);
  assert.equal(cells[0].index, 0);
  assert.equal(cells.at(-1).index, 14);
});

test('cells tile the image without overlapping or leaving a gap', () => {
  const cells = sheetGrid(1000, 600, { cols: 5, rows: 3 });
  for (const cell of cells) {
    assert.equal(cell.width, 200);
    assert.equal(cell.height, 200);
    assert.equal(cell.x, cell.col * 200);
    assert.equal(cell.y, cell.row * 200);
  }
});

test('no cell falls outside the image', () => {
  for (const options of [{ cols: 5, rows: 3 }, { cols: 4, rows: 4, padding: 20, gap: 10 },
    { cols: 1, rows: 1 }, { cols: 6, rows: 3, labelHeight: 30 }]) {
    for (const cell of sheetGrid(1440, 1100, options)) {
      assert.ok(cell.x >= -1e-9, 'cell starts left of the image');
      assert.ok(cell.y >= -1e-9, 'cell starts above the image');
      assert.ok(cell.x + cell.width <= 1440 + 1e-9, 'cell runs off the right edge');
      assert.ok(cell.y + cell.height <= 1100 + 1e-9, 'cell runs off the bottom edge');
      assert.ok(cell.width > 0 && cell.height > 0, 'cell has no area');
    }
  }
});

test('padding and gaps come out of the cells, not the image', () => {
  const cells = sheetGrid(1000, 1000, { cols: 2, rows: 2, padding: 50, gap: 100 });
  assert.equal(cells[0].x, 50);
  assert.equal(cells[0].width, 400);
  assert.equal(cells[1].x, 550);
});

test('a caption strip is trimmed off the bottom of each cell', () => {
  const plain = sheetGrid(1000, 600, { cols: 5, rows: 3 })[0];
  const labelled = sheetGrid(1000, 600, { cols: 5, rows: 3, labelHeight: 40 })[0];
  assert.equal(labelled.height, plain.height - 40);
  assert.equal(labelled.width, plain.width);
});

test('a degenerate grid is empty rather than infinite', () => {
  assert.deepEqual(sheetGrid(0, 0, {}), []);
  assert.deepEqual(sheetGrid(100, 100, { padding: 500 }), []);
  assert.equal(sheetGrid(100, 100, { cols: 0, rows: 0 }).length, 1);
  assert.ok(sheetGrid(100, 100, { cols: 999, rows: 999 }).length <= 24 * 24);
});

test('the default cell assignment follows sheet order and stops at the last cell', () => {
  const assignment = defaultCellAssignment('chart', 16);
  assert.equal(Object.keys(assignment).length, 16);
  assert.equal(assignment.O, 0);
  assert.equal(assignment.CONS, 1);
  assert.equal(assignment.LAUGHING, 15);

  const short = defaultCellAssignment('chart', 5);
  assert.equal(Object.keys(short).length, 5);
  assert.equal(short.LAUGHING, undefined);
});

test('no default assignment points at a cell that does not exist', () => {
  for (const schemeId of SCHEME_IDS) {
    for (const count of [0, 1, 9, 16, 30]) {
      for (const index of Object.values(defaultCellAssignment(schemeId, count))) {
        assert.ok(index >= 0 && index < count, `${schemeId}: cell ${index} of ${count}`);
      }
    }
  }
});

/* --- coverage ----------------------------------------------------------- */

test('an empty set covers nothing and a full set covers everything', () => {
  for (const schemeId of SCHEME_IDS) {
    const empty = coverage(emptyMouthSet(schemeId), schemeId);
    assert.equal(empty.assigned.length, 0);
    assert.equal(empty.complete, false);
    assert.equal(empty.missing.length, empty.total);

    const full = coverage(fullSet(schemeId), schemeId);
    assert.equal(full.complete, true);
    assert.deepEqual(full.missing, []);
    assert.equal(full.assigned.length, full.total);
  }
});

test('coverage counts mouths, not expressions', () => {
  const cover = coverage(fullSet('chart'), 'chart');
  assert.equal(cover.total, mouthVisemesOf('chart').length);
  assert.equal(cover.expressionsAssigned.length, 4);
});

test('a missing closed mouth is called out specifically', () => {
  const set = withoutImage(fullSet('chart'), 'MBP');
  assert.equal(coverage(set, 'chart').missingClosed, true);
  assert.equal(coverage(withoutImage(fullSet('chart'), 'EE'), 'chart').missingClosed, false);
});

/* --- warnings ----------------------------------------------------------- */

test('a set with no artwork produces no warnings - the built-in shapes are fine', () => {
  assert.deepEqual(mouthSetWarnings(emptyMouthSet('chart'), 'chart'), []);
});

test('a complete, consistent set produces no warnings', () => {
  assert.deepEqual(mouthSetWarnings(fullSet('chart'), 'chart'), []);
});

test('a missing closed mouth is the loudest warning there is', () => {
  const warnings = mouthSetWarnings(withoutImage(fullSet('chart'), 'MBP'), 'chart');
  assert.ok(warnings.some((w) => w.level === 'danger'));
});

test('mismatched image proportions are flagged', () => {
  let set = fullSet('chart');
  set = withImage(set, 'EE', image('EE.png', 400, 100));
  assert.ok(mouthSetWarnings(set, 'chart').some((w) => /same shape/.test(w.text)));
});

test('no warning leaks a raw float', () => {
  const set = withImage(withoutImage(fullSet('chart'), 'EE'), 'O', image('O.png', 333, 97));
  for (const warning of mouthSetWarnings(set, 'chart')) {
    assert.doesNotMatch(warning.text, /\d\.\d{4,}/);
  }
});

/* --- size --------------------------------------------------------------- */

test('an empty set costs nothing', () => {
  assert.equal(estimateBytes(emptyMouthSet('chart')), 0);
  assert.equal(estimateBytes(undefined), 0);
  assert.equal(fitsInStorage(emptyMouthSet('chart')), true);
});

test('size is estimated from the data URL length', () => {
  const set = withImage(emptyMouthSet('chart'), 'MBP', image());
  assert.ok(estimateBytes(set) > 0);
  assert.ok(estimateBytes(set) < 200);
});

test('a set too big for local storage is reported as such', () => {
  const huge = { src: `data:image/png;base64,${'A'.repeat(STORAGE_LIMIT_BYTES * 2)}`, width: 1, height: 1 };
  const set = withImage(emptyMouthSet('chart'), 'MBP', huge);
  assert.equal(fitsInStorage(set), false);
  assert.ok(mouthSetWarnings(set, 'chart').some((w) => /memory only/.test(w.text)));
});

/* --- editing ------------------------------------------------------------ */

test('editing returns a new set and leaves the old one alone', () => {
  const before = emptyMouthSet('chart');
  const after = withImage(before, 'MBP', image());
  assert.deepEqual(before.images, {});
  assert.ok(after.images.MBP);
  assert.notEqual(before, after);

  const removed = withoutImage(after, 'MBP');
  assert.ok(after.images.MBP, 'removing mutated the original');
  assert.deepEqual(removed.images, {});
});

/* --- converting between schemes ----------------------------------------- */

test('converting to the same scheme changes nothing', () => {
  const set = fullSet('chart');
  const { set: same, dropped } = convertSet(set, 'chart');
  assert.deepEqual(Object.keys(same.images).sort(), Object.keys(set.images).sort());
  assert.deepEqual(dropped, []);
});

test('a Rhubarb set converts onto the character sheet, reporting what collapsed', () => {
  const { set, carried, dropped } = convertSet(fullSet('rhubarb'), 'chart');
  assert.equal(set.schemeId, 'chart');

  // Two pairs collapse, and both are shapes the sheet genuinely does not separate:
  // C (open) and D (wide open) are one open mouth, and A (closed) doubles as the rest
  // pose that X is. Seven of the nine carry across as themselves.
  assert.equal(carried.length, 7);
  assert.deepEqual(dropped, ['D', 'X']);
  assert.ok(set.images.MBP && set.images.AEI && set.images.CONS);
});

test('converting a character sheet to Rhubarb reports what could not come along', () => {
  const { set, dropped } = convertSet(fullSet('chart'), 'rhubarb');
  assert.equal(set.schemeId, 'rhubarb');
  for (const expression of ['ANGRY', 'SMILE', 'SAD', 'LAUGHING']) {
    assert.ok(dropped.includes(expression), `${expression} should have been reported`);
  }
});

test('a converted set only ever contains visemes the target scheme has', () => {
  for (const from of SCHEME_IDS) {
    for (const to of SCHEME_IDS) {
      const { set } = convertSet(fullSet(from), to);
      for (const id of Object.keys(set.images)) {
        assert.ok(getScheme(to).byId[id], `${from} -> ${to} produced ${id}`);
      }
    }
  }
});

/* --- loading an untrusted project --------------------------------------- */

test('a project file with a web address for an image loads without it', () => {
  const loaded = sanitiseMouthSet({
    schemeId: 'chart',
    images: {
      MBP: { src: 'https://example.com/tracker.png', width: 10, height: 10 },
      EE: { src: PIXEL, width: 10, height: 10 },
    },
  }, 'chart');

  assert.equal(loaded.images.MBP, undefined, 'a remote image was loaded');
  assert.ok(loaded.images.EE, 'a valid data URL was rejected');
});

test('a project file cannot smuggle in a viseme the scheme does not have', () => {
  const loaded = sanitiseMouthSet({
    schemeId: 'rhubarb',
    images: { SMILE: { src: PIXEL }, A: { src: PIXEL } },
  }, 'rhubarb');
  assert.deepEqual(Object.keys(loaded.images), ['A']);
});

test('a javascript: or non-image data URL is refused', () => {
  for (const src of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png,notbase64', PIXEL.replace('base64,', 'base64,<')]) {
    const loaded = sanitiseMouthSet({ schemeId: 'chart', images: { MBP: { src } } }, 'chart');
    assert.deepEqual(loaded.images, {}, `${src.slice(0, 30)} was accepted`);
  }
});

test('sanitising junk yields an empty set rather than throwing', () => {
  for (const junk of [null, undefined, 42, 'nope', { images: 'no' }, { images: { MBP: 5 } }]) {
    assert.doesNotThrow(() => sanitiseMouthSet(junk, 'chart'));
    assert.deepEqual(sanitiseMouthSet(junk, 'chart').images, {});
  }
});

test('a name from a project file is kept but bounded', () => {
  assert.equal(sanitiseMouthSet({ name: 'Lisa', images: {} }, 'chart').name, 'Lisa');
  assert.equal(sanitiseMouthSet({ name: 'x'.repeat(500), images: {} }, 'chart').name.length, 80);
  assert.equal(sanitiseMouthSet({ name: 99, images: {} }, 'chart').name, '');
});
