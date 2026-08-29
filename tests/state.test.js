import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SCHEMA_VERSION,
  DEFAULT_SCRIPT,
  TOOLS,
  defaults,
  migrate,
  sanitiseSettings,
  sanitiseOverrides,
  shareState,
  encodeShare,
  decodeShare,
  toProject,
  fromProject,
} from '../js/state.js';
import { TIMING_DEFAULTS } from '../js/timing.js';
import { SCHEME_IDS } from '../js/visemes.js';
import { EXPORT_FORMATS } from '../js/exporters.js';
import { buildTrack } from '../js/lipsync.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* --- the defaults ------------------------------------------------------- */

test('the defaults are internally consistent', () => {
  assert.equal(defaults.version, SCHEMA_VERSION);
  assert.ok(TOOLS.includes(defaults.tool));
  assert.ok(SCHEME_IDS.includes(defaults.schemeId));
  assert.ok(EXPORT_FORMATS.some((f) => f.id === defaults.exportFormat));
  assert.equal(defaults.characters.length, 1, 'there is always a character to draw');
  assert.equal(defaults.characters[0].schemeId, defaults.schemeId);
  assert.equal(defaults.characters[0].kind, 'drawn');
});

test('the default script exercises the features it is there to demonstrate', () => {
  assert.match(DEFAULT_SCRIPT, /\[smile\]/);
  assert.match(DEFAULT_SCRIPT, /\[pause [\d.]+\]/);
  assert.match(DEFAULT_SCRIPT, /\d{4}/);
  const track = buildTrack(DEFAULT_SCRIPT);
  assert.ok(track.cues.length > 40);
  assert.equal(track.warnings.length, 0, 'the default script must not warn on load');
  assert.ok(track.expressions.length > 0);
});

/* --- migration ---------------------------------------------------------- */

test('migrating nothing gives the defaults', () => {
  for (const junk of [undefined, null, {}, 42, 'nope', []]) {
    const migrated = migrate(junk);
    assert.equal(migrated.version, SCHEMA_VERSION);
    assert.equal(migrated.script, DEFAULT_SCRIPT);
    assert.equal(migrated.settings.wpm, TIMING_DEFAULTS.wpm);
  }
});

// pitfalls.md #8, the exact trap: `{...defaults, ...incoming}` overwrites a good
// default with an explicit undefined.
test('a key present but undefined does not erase its default', () => {
  const migrated = migrate({
    script: undefined,
    schemeId: undefined,
    theme: undefined,
    settings: { wpm: undefined, fps: 30 },
  });
  assert.equal(migrated.script, DEFAULT_SCRIPT);
  assert.equal(migrated.schemeId, defaults.schemeId);
  assert.equal(migrated.theme, 'system');
  assert.equal(migrated.settings.wpm, TIMING_DEFAULTS.wpm);
  assert.equal(migrated.settings.fps, 30);
});

// A literal blob, as it would arrive from a file on disk - not one this code produced.
test('a hand-written project file loads and is fully populated', () => {
  const blob = {
    application: 'Detronics VoiceAnimator',
    version: 1,
    projectName: 'Robot intro',
    script: 'Beep boop. [angry] I am a robot.',
    schemeId: 'rhubarb',
    settings: { wpm: 132, fps: 25, pauses: { sentence: 0.6 } },
    overrides: { beep: 'B IY P' },
    characters: [{
      id: 'tin', name: 'Tin', schemeId: 'rhubarb',
      base: { src: PIXEL, width: 300, height: 400 },
      slots: { mouth: { placement: { x: 150, y: 260, scale: 0.5 }, images: { A: { src: PIXEL, width: 64, height: 64 } } } },
    }],
    activeCharacterId: 'tin',
  };

  const { state: loaded, error } = fromProject(blob);
  assert.equal(error, null);
  assert.equal(loaded.projectName, 'Robot intro');
  assert.equal(loaded.schemeId, 'rhubarb');
  assert.equal(loaded.settings.wpm, 132);
  assert.equal(loaded.settings.fps, 25);
  assert.equal(loaded.settings.pauses.sentence, 0.6);
  // A pause the file did not mention keeps its default rather than becoming undefined.
  assert.equal(loaded.settings.pauses.clause, TIMING_DEFAULTS.pauses.clause);
  assert.equal(loaded.overrides.beep, 'B IY P');
  assert.equal(loaded.characters.length, 1);
  assert.equal(loaded.characters[0].name, 'Tin');
  assert.equal(loaded.characters[0].kind, 'layers');
  assert.ok(loaded.characters[0].slots.mouth.images.A);
  assert.equal(loaded.characters[0].slots.mouth.placement.x, 150);
  assert.equal(loaded.activeCharacterId, 'tin');
  assert.equal(loaded.tool, defaults.tool);
});

test('an unknown value falls back rather than being carried through', () => {
  const migrated = migrate({
    theme: 'neon', tool: 'destroy', schemeId: 'klingon', exportFormat: 'wav',
  });
  assert.equal(migrated.theme, 'system');
  assert.equal(migrated.tool, defaults.tool);
  assert.equal(migrated.schemeId, defaults.schemeId);
  assert.equal(migrated.exportFormat, defaults.exportFormat);
});

test('the migrated state is always usable by the pipeline', () => {
  for (const junk of [{}, { script: '' }, { settings: { wpm: 'fast', fps: -3 } },
    { schemeId: 'rhubarb', overrides: { a: 'NONSENSE' } }]) {
    const migrated = migrate(junk);
    assert.doesNotThrow(() => buildTrack(migrated.script, {
      settings: migrated.settings,
      schemeId: migrated.schemeId,
      overrides: migrated.overrides,
    }), `pipeline threw on ${JSON.stringify(junk)}`);
  }
});

/* --- settings ----------------------------------------------------------- */

test('settings are clamped to what the UI can offer', () => {
  const wild = sanitiseSettings({
    wpm: 100000, fps: 0, minHold: -5, leadIn: 999, emphasiseFinal: 50,
    pauses: { clause: -1, sentence: 900 },
  });
  assert.equal(wild.wpm, 400);
  assert.equal(wild.fps, 1);
  assert.equal(wild.minHold, 0);
  assert.equal(wild.leadIn, 10);
  assert.equal(wild.emphasiseFinal, 3);
  assert.equal(wild.pauses.clause, 0);
  assert.equal(wild.pauses.sentence, 10);
});

test('a settings value that is not a number falls back rather than becoming NaN', () => {
  const settings = sanitiseSettings({ wpm: 'quickly', fps: null, minHold: {} });
  for (const value of [settings.wpm, settings.fps, settings.minHold]) {
    assert.ok(Number.isFinite(value), `${value} is not a number`);
  }
  assert.equal(settings.wpm, TIMING_DEFAULTS.wpm);
});

test('quantise is on unless it was explicitly turned off', () => {
  assert.equal(sanitiseSettings({}).quantise, true);
  assert.equal(sanitiseSettings({ quantise: undefined }).quantise, true);
  assert.equal(sanitiseSettings({ quantise: false }).quantise, false);
});

/* --- overrides ---------------------------------------------------------- */

test('overrides are normalised on the way in', () => {
  const overrides = sanitiseOverrides({ 'Hello,': 'hh ah l ow', READ: ['R', 'EH', 'D'] });
  assert.equal(overrides.hello, 'HH AH L OW');
  assert.equal(overrides.read, 'R EH D');
});

test('an override made of nonsense is discarded, not stored', () => {
  const overrides = sanitiseOverrides({
    good: 'K AE T', bad: 'XX YY', empty: '', huge: 'AA '.repeat(200),
    '': 'K', ['a'.repeat(100)]: 'K',
  });
  assert.deepEqual(Object.keys(overrides), ['good']);
});

test('the override list is bounded', () => {
  const many = Object.fromEntries(
    Array.from({ length: 900 }, (_, i) => [`word${i}`, 'K AE T']),
  );
  assert.ok(Object.keys(sanitiseOverrides(many)).length <= 500);
});

test('sanitising junk overrides yields an empty map', () => {
  for (const junk of [null, undefined, 'no', 42, []]) {
    assert.deepEqual(sanitiseOverrides(junk), {});
  }
});

/* --- sharing ------------------------------------------------------------ */

const SAMPLE = migrate({
  script: 'Hello there, world.',
  schemeId: 'rhubarb',
  settings: { wpm: 175, fps: 25 },
  overrides: { world: 'W ER L D' },
  projectName: 'Take 3',
  characters: [{
    id: 'bob', name: 'Bob', schemeId: 'rhubarb',
    base: { src: PIXEL, width: 200, height: 200 },
    slots: { mouth: { placement: { x: 100, y: 140, scale: 0.4 }, images: { A: { src: PIXEL, width: 8, height: 8 } } } },
  }],
  activeCharacterId: 'bob',
});

test('a share link carries the script and the settings', () => {
  const shared = shareState(SAMPLE);
  assert.equal(shared.script, 'Hello there, world.');
  assert.equal(shared.schemeId, 'rhubarb');
  assert.equal(shared.settings.wpm, 175);
  assert.equal(shared.overrides.world, 'W ER L D');
});

test('a share link never carries artwork', () => {
  const encoded = encodeShare(SAMPLE);
  assert.equal(shareState(SAMPLE).characters, undefined);
  assert.ok(!encoded.includes('data%3Aimage'), 'a data URL reached the link');
  assert.ok(!encoded.includes('base64'), 'image data reached the link');
});

test('a share link round-trips exactly', () => {
  const decoded = migrate(decodeShare(`#${encodeShare(SAMPLE)}`));
  assert.equal(decoded.script, SAMPLE.script);
  assert.equal(decoded.schemeId, SAMPLE.schemeId);
  assert.deepEqual(decoded.settings, SAMPLE.settings);
  assert.deepEqual(decoded.overrides, SAMPLE.overrides);
  assert.equal(decoded.projectName, SAMPLE.projectName);
});

test('a share link survives the characters people actually type', () => {
  for (const script of ['Café — naïve, 100% "quoted" & <tagged>',
    'Line one\nLine two\n\nLine four', 'emoji 🙂 and a #hash and a %25']) {
    const source = migrate({ script });
    const decoded = migrate(decodeShare(`#${encodeShare(source)}`));
    assert.equal(decoded.script, script);
  }
});

test('a broken or foreign fragment is ignored rather than throwing', () => {
  for (const fragment of ['', '#', undefined, null, '#not-json', '#%%%',
    '#"a string"', '#123', '#null']) {
    assert.doesNotThrow(() => decodeShare(fragment));
    const decoded = decodeShare(fragment);
    assert.ok(decoded === null || typeof decoded === 'object');
  }
});

test('a share link cannot smuggle in a script of unbounded size', () => {
  const decoded = migrate({ script: 'x'.repeat(500_000) });
  assert.ok(decoded.script.length <= 200_000);
});

/* --- project files ------------------------------------------------------ */

test('a project round-trips through JSON with its artwork intact', () => {
  const written = JSON.stringify(toProject(SAMPLE), null, 2);
  const { state: read, error } = fromProject(written);

  assert.equal(error, null);
  assert.equal(read.script, SAMPLE.script);
  assert.equal(read.schemeId, SAMPLE.schemeId);
  assert.deepEqual(read.settings, SAMPLE.settings);
  assert.deepEqual(read.overrides, SAMPLE.overrides);

  const character = read.characters[0];
  assert.ok(character.base, 'the base image was lost');
  assert.ok(character.slots.mouth.images.A, 'the mouth artwork was lost');
  assert.equal(character.slots.mouth.images.A.src, PIXEL);
  assert.equal(character.slots.mouth.placement.x, 100, 'the placement was lost');
  assert.equal(read.activeCharacterId, 'bob');
});

// A project saved by 1.0 had no characters at all, only a flat set of whole-frame
// pictures. Opening one must not lose the artwork.
test('a project from before characters existed opens with its artwork carried over', () => {
  const { state: loaded, error } = fromProject({
    application: 'Detronics VoiceAnimator',
    version: 1,
    script: 'Old project.',
    schemeId: 'chart',
    mouthSet: {
      schemeId: 'chart',
      name: 'Lisa',
      images: {
        MBP: { src: PIXEL, width: 64, height: 64, name: 'MBP.png' },
        AEI: { src: PIXEL, width: 64, height: 64, name: 'AEI.png' },
      },
    },
  });

  assert.equal(error, null);
  assert.equal(loaded.characters.length, 1);
  assert.equal(loaded.characters[0].name, 'Lisa');
  assert.equal(loaded.characters[0].kind, 'frames');
  assert.deepEqual(Object.keys(loaded.characters[0].frames).sort(), ['AEI', 'MBP']);
  assert.equal(loaded.activeCharacterId, loaded.characters[0].id);
});

test('a project that has characters ignores any legacy mouth set alongside them', () => {
  const { state: loaded } = fromProject({
    application: 'Detronics VoiceAnimator',
    script: 'x',
    schemeId: 'chart',
    characters: [{ name: 'New', slots: { mouth: { images: { MBP: { src: PIXEL } } } } }],
    mouthSet: { schemeId: 'chart', images: { AEI: { src: PIXEL } } },
  });
  assert.equal(loaded.characters.length, 1);
  assert.equal(loaded.characters[0].name, 'New');
  assert.deepEqual(loaded.characters[0].frames, {});
});

test('a project names itself, so a stray file is identifiable', () => {
  const project = toProject(SAMPLE);
  assert.equal(project.application, 'Detronics VoiceAnimator');
  assert.equal(project.version, SCHEMA_VERSION);
  assert.match(project.saved, /^\d{4}-\d{2}-\d{2}$/);
});

test('a file that is not a project is refused with a reason, not a stack trace', () => {
  for (const [input, pattern] of [
    ['not json at all', /not readable as JSON/],
    ['[]', /no script in it/],
    ['{"application":"Rhubarb","script":"x"}', /saved by Rhubarb/],
    ['{"nothing":1}', /no script in it/],
    ['null', /does not contain a project/],
  ]) {
    const { state: loaded, error } = fromProject(input);
    assert.equal(loaded, null);
    assert.match(error, pattern);
  }
});

test('a project file with a remote image loads without it', () => {
  const { state: loaded } = fromProject({
    application: 'Detronics VoiceAnimator',
    script: 'Hello',
    schemeId: 'chart',
    characters: [{
      name: 'Trap',
      base: { src: 'https://example.com/tracker.png', width: 10, height: 10 },
      slots: { mouth: { images: { MBP: { src: 'https://example.com/pixel.png' } } } },
    }],
  });
  const character = loaded.characters[0];
  assert.equal(character.base, null, 'a network request was smuggled into a project');
  assert.deepEqual(character.slots.mouth.images, {});
});

test('a project from an unknown future version still loads what it can', () => {
  const { state: loaded, error } = fromProject({
    application: 'Detronics VoiceAnimator',
    version: 99,
    script: 'From the future.',
    somethingNew: { we: 'do not know about' },
    settings: { wpm: 140, unknownSetting: true },
  });
  assert.equal(error, null);
  assert.equal(loaded.script, 'From the future.');
  assert.equal(loaded.settings.wpm, 140);
  assert.equal(loaded.version, SCHEMA_VERSION);
  assert.equal(loaded.somethingNew, undefined, 'an unknown key was carried through');
});
