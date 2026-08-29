import test from 'node:test';
import assert from 'node:assert/strict';

import { PHONEME_LIST } from '../js/g2p.js';
import {
  SCHEMES,
  SCHEME_IDS,
  DEFAULT_SCHEME,
  getScheme,
  visemesOf,
  mouthVisemesOf,
  expressionsOf,
  visemeInfo,
  restViseme,
  visemeFor,
  phonemesFor,
  shapeCount,
  equivalentViseme,
  EXPRESSION_CUES,
  expressionViseme,
} from '../js/visemes.js';

/* --- structural invariants, checked for every scheme -------------------- */

test('the default scheme exists', () => {
  assert.ok(SCHEME_IDS.includes(DEFAULT_SCHEME));
});

test('every scheme can draw every phoneme the G2P can produce', () => {
  for (const id of SCHEME_IDS) {
    const scheme = SCHEMES[id];
    for (const phoneme of PHONEME_LIST) {
      const viseme = scheme.map[phoneme];
      assert.ok(viseme, `${id} has no mouth shape for ${phoneme}`);
      assert.ok(scheme.byId[viseme], `${id} maps ${phoneme} to unknown viseme ${viseme}`);
    }
  }
});

test('every scheme declares a rest pose that it actually contains', () => {
  for (const id of SCHEME_IDS) {
    assert.ok(SCHEMES[id].byId[restViseme(id)], `${id} rest pose is not in the scheme`);
  }
});

test('silence always maps to the rest pose', () => {
  for (const id of SCHEME_IDS) {
    assert.equal(visemeFor('sil', id), restViseme(id));
  }
});

test('viseme ids are unique within a scheme', () => {
  for (const id of SCHEME_IDS) {
    const ids = visemesOf(id).map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length, `${id} has duplicate viseme ids`);
  }
});

test('every viseme carries a label, a title and a shape', () => {
  for (const id of SCHEME_IDS) {
    for (const viseme of visemesOf(id)) {
      assert.ok(viseme.label, `${id}/${viseme.id} has no label`);
      assert.ok(viseme.title, `${id}/${viseme.id} has no title`);
      assert.ok(viseme.note, `${id}/${viseme.id} has no explanation`);
      assert.ok(['mouth', 'expression'].includes(viseme.kind), `${id}/${viseme.id} bad kind`);
    }
  }
});

// The renderer multiplies these straight into coordinates: anything outside 0..1
// would push the drawing outside its viewBox. pitfalls.md #4.
test('every shape parameter is between 0 and 1', () => {
  const keys = ['open', 'width', 'round', 'teeth', 'tongue', 'lipBite', 'corner'];
  for (const id of SCHEME_IDS) {
    for (const viseme of visemesOf(id)) {
      for (const key of keys) {
        const value = viseme.shape[key];
        assert.equal(typeof value, 'number', `${id}/${viseme.id}.${key} is not a number`);
        assert.ok(value >= 0 && value <= 1, `${id}/${viseme.id}.${key} = ${value} is out of range`);
      }
    }
  }
});

test('no two mouth shapes in a scheme are drawn identically', () => {
  for (const id of SCHEME_IDS) {
    const seen = new Map();
    for (const viseme of mouthVisemesOf(id)) {
      const key = JSON.stringify(viseme.shape);
      assert.ok(!seen.has(key), `${id}: ${viseme.id} is drawn the same as ${seen.get(key)}`);
      seen.set(key, viseme.id);
    }
  }
});

test('every mouth shape is reachable from some phoneme', () => {
  for (const id of SCHEME_IDS) {
    for (const viseme of mouthVisemesOf(id)) {
      assert.ok(phonemesFor(id, viseme.id).length > 0,
        `${id}/${viseme.id} can never be shown - no phoneme maps to it`);
    }
  }
});

test('expressions are never reachable from a phoneme', () => {
  for (const id of SCHEME_IDS) {
    for (const viseme of expressionsOf(id)) {
      assert.equal(phonemesFor(id, viseme.id).length, 0,
        `${id}/${viseme.id} is an expression but a phoneme maps to it`);
    }
  }
});

/* --- the schemes are what they claim to be ------------------------------ */

test('the Rhubarb scheme is the documented A-X set', () => {
  assert.deepEqual(visemesOf('rhubarb').map((v) => v.id),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);
  assert.equal(shapeCount('rhubarb'), 9);
});

test('Rhubarb maps the sounds its documentation names', () => {
  for (const p of ['P', 'B', 'M']) assert.equal(visemeFor(p, 'rhubarb'), 'A');
  for (const p of ['K', 'S', 'T', 'IY']) assert.equal(visemeFor(p, 'rhubarb'), 'B');
  for (const p of ['EH', 'AE']) assert.equal(visemeFor(p, 'rhubarb'), 'C');
  assert.equal(visemeFor('AA', 'rhubarb'), 'D');
  for (const p of ['AO', 'ER']) assert.equal(visemeFor(p, 'rhubarb'), 'E');
  for (const p of ['UW', 'OW', 'W']) assert.equal(visemeFor(p, 'rhubarb'), 'F');
  for (const p of ['F', 'V']) assert.equal(visemeFor(p, 'rhubarb'), 'G');
  assert.equal(visemeFor('L', 'rhubarb'), 'H');
  assert.equal(visemeFor('sil', 'rhubarb'), 'X');
});

test('the character sheet is twelve mouths and four expressions', () => {
  assert.equal(mouthVisemesOf('chart').length, 12);
  assert.equal(expressionsOf('chart').length, 4);
  assert.deepEqual(expressionsOf('chart').map((v) => v.id),
    ['ANGRY', 'SMILE', 'SAD', 'LAUGHING']);
});

test('the character sheet maps the letters printed under each pose', () => {
  for (const p of ['B', 'M', 'P']) assert.equal(visemeFor(p, 'chart'), 'MBP');
  for (const p of ['D', 'G', 'K', 'N', 'S', 'T', 'Y', 'Z']) {
    assert.equal(visemeFor(p, 'chart'), 'CONS');
  }
  for (const p of ['AA', 'AE', 'EH']) assert.equal(visemeFor(p, 'chart'), 'AEI');
  for (const p of ['CH', 'SH', 'JH']) assert.equal(visemeFor(p, 'chart'), 'CHSHJ');
  for (const p of ['F', 'V']) assert.equal(visemeFor(p, 'chart'), 'FV');
  for (const p of ['TH', 'DH']) assert.equal(visemeFor(p, 'chart'), 'TH');
  assert.equal(visemeFor('W', 'chart'), 'QW');
  assert.equal(visemeFor('IY', 'chart'), 'EE');
  assert.equal(visemeFor('UW', 'chart'), 'U');
  assert.equal(visemeFor('L', 'chart'), 'L');
  assert.equal(visemeFor('AO', 'chart'), 'O');
});

/* --- forgiving lookups -------------------------------------------------- */

test('an unknown scheme falls back rather than throwing', () => {
  assert.equal(getScheme('nope').id, DEFAULT_SCHEME);
  assert.equal(getScheme(undefined).id, DEFAULT_SCHEME);
});

test('an unknown phoneme yields the rest pose, not a crash', () => {
  assert.equal(visemeFor('QQ', 'chart'), restViseme('chart'));
  assert.equal(visemeFor(undefined, 'rhubarb'), 'X');
});

test('visemeInfo returns null for a viseme that is not in the scheme', () => {
  assert.equal(visemeInfo('rhubarb', 'SMILE'), null);
  assert.ok(visemeInfo('chart', 'SMILE'));
});

/* --- moving artwork between schemes ------------------------------------- */

test('a viseme maps to itself within its own scheme', () => {
  for (const id of SCHEME_IDS) {
    for (const viseme of visemesOf(id)) {
      assert.equal(equivalentViseme(viseme.id, id, id), viseme.id);
    }
  }
});

test('every Rhubarb shape has a character-sheet equivalent', () => {
  for (const viseme of visemesOf('rhubarb')) {
    const target = equivalentViseme(viseme.id, 'rhubarb', 'chart');
    assert.ok(target, `Rhubarb ${viseme.id} has no equivalent`);
    assert.ok(visemeInfo('chart', target), `Rhubarb ${viseme.id} maps to unknown ${target}`);
  }
});

test('every character-sheet mouth has a Rhubarb equivalent, and expressions do not', () => {
  for (const viseme of mouthVisemesOf('chart')) {
    const target = equivalentViseme(viseme.id, 'chart', 'rhubarb');
    assert.ok(target, `chart ${viseme.id} has no equivalent`);
    assert.ok(visemeInfo('rhubarb', target), `chart ${viseme.id} maps to unknown ${target}`);
  }
  for (const viseme of expressionsOf('chart')) {
    assert.equal(equivalentViseme(viseme.id, 'chart', 'rhubarb'), null);
  }
});

test('a closed mouth stays a closed mouth across schemes', () => {
  assert.equal(equivalentViseme('A', 'rhubarb', 'chart'), 'MBP');
  assert.equal(equivalentViseme('MBP', 'chart', 'rhubarb'), 'A');
});

/* --- expression cues ---------------------------------------------------- */

test('expression cues resolve, case-insensitively', () => {
  assert.equal(expressionViseme('smile', 'chart'), 'SMILE');
  assert.equal(expressionViseme('ANGRY', 'chart'), 'ANGRY');
  assert.equal(expressionViseme('happy', 'chart'), 'SMILE');
  assert.equal(expressionViseme('laugh', 'chart'), 'LAUGHING');
});

test('an expression the scheme cannot draw resolves to null', () => {
  assert.equal(expressionViseme('smile', 'rhubarb'), null);
  assert.equal(expressionViseme('confused', 'chart'), null);
  assert.equal(expressionViseme(undefined, 'chart'), null);
});

test('every cue names a viseme that the character sheet contains', () => {
  for (const id of Object.values(EXPRESSION_CUES)) {
    assert.ok(visemeInfo('chart', id), `cue target ${id} is not on the sheet`);
  }
});

/* --- the schemes are frozen -------------------------------------------- */

test('a caller cannot corrupt a scheme for everyone else', () => {
  assert.throws(() => { SCHEMES.chart.map.AA = 'MBP'; }, TypeError);
  assert.equal(visemeFor('AA', 'chart'), 'AEI');
});
