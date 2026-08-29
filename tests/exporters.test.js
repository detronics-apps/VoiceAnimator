import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTrack } from '../js/lipsync.js';
import { SCHEME_IDS, visemesOf } from '../js/visemes.js';
import {
  EXPORT_FORMATS,
  NAMING_CHOICES,
  getFormat,
  buildExport,
  exportFilename,
  shapeName,
  lossyShapes,
  toRhubarbTsv,
  toRhubarbJson,
  toRhubarbXml,
  toMohoDat,
  toCsv,
  toTimingSheet,
} from '../js/exporters.js';

const SCRIPT = 'Hello there. This is a bump on the map, and it works.';
const track = buildTrack(SCRIPT, { schemeId: 'chart' });
const rhubarbTrack = buildTrack(SCRIPT, { schemeId: 'rhubarb' });

const RHUBARB_SHAPES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X']);
const MOHO_SHAPES = new Set(['AI', 'O', 'E', 'U', 'L', 'WQ', 'MBP', 'FV', 'etc', 'rest']);

/* --- naming ------------------------------------------------------------- */

test('every viseme in every scheme has a Rhubarb name and a Moho name', () => {
  for (const schemeId of SCHEME_IDS) {
    for (const viseme of visemesOf(schemeId)) {
      const rhubarb = shapeName(viseme.id, schemeId, 'rhubarb');
      const moho = shapeName(viseme.id, schemeId, 'moho');
      assert.ok(RHUBARB_SHAPES.has(rhubarb), `${schemeId}/${viseme.id} -> "${rhubarb}"`);
      assert.ok(MOHO_SHAPES.has(moho), `${schemeId}/${viseme.id} -> "${moho}"`);
    }
  }
});

test('the scheme naming leaves the ids alone', () => {
  assert.equal(shapeName('MBP', 'chart', 'scheme'), 'MBP');
  assert.equal(shapeName('A', 'rhubarb', 'scheme'), 'A');
});

test('every naming choice offered is one the exporters implement', () => {
  for (const choice of NAMING_CHOICES) {
    assert.ok(['scheme', 'rhubarb', 'moho'].includes(choice.value));
    assert.ok(choice.label);
  }
});

test('flattening is reported, so nobody finds out downstream', () => {
  const lost = lossyShapes(track, 'rhubarb');
  assert.ok(lost.length > 0, 'the 12-shape sheet must lose detail becoming 9 Rhubarb shapes');
  for (const entry of lost) {
    assert.ok(entry.merged.length > 1);
    assert.ok(entry.name);
  }
  // Exporting in the scheme's own names loses nothing.
  assert.deepEqual(lossyShapes(track, 'scheme'), []);
});

/* --- Rhubarb TSV -------------------------------------------------------- */

test('the TSV is time, tab, shape - and nothing else', () => {
  const lines = toRhubarbTsv(track).trim().split('\n');
  assert.ok(lines.length > 3);
  for (const line of lines) {
    assert.match(line, /^\d+\.\d{2}\t[A-X]$/, `bad row: ${JSON.stringify(line)}`);
  }
});

test('the TSV starts at zero, never goes backwards, and ends at the duration', () => {
  const times = toRhubarbTsv(track).trim().split('\n').map((l) => Number(l.split('\t')[0]));
  assert.equal(times[0], 0);
  for (let i = 1; i < times.length; i += 1) {
    assert.ok(times[i] >= times[i - 1], `time went backwards at row ${i}`);
  }
  assert.equal(times.at(-1), Number(track.duration.toFixed(2)));
});

test('the TSV closes on the rest shape', () => {
  assert.equal(toRhubarbTsv(track).trim().split('\n').at(-1).split('\t')[1], 'X');
});

test('an empty track exports as an empty TSV, not a broken one', () => {
  assert.equal(toRhubarbTsv(buildTrack('')).trim(), '');
});

/* --- Rhubarb JSON ------------------------------------------------------- */

test('the JSON parses and has the documented shape', () => {
  const parsed = JSON.parse(toRhubarbJson(track, { soundFile: 'take-3.wav' }));
  assert.equal(parsed.metadata.soundFile, 'take-3.wav');
  assert.equal(typeof parsed.metadata.duration, 'number');
  assert.ok(Array.isArray(parsed.mouthCues));
  for (const cue of parsed.mouthCues) {
    assert.equal(typeof cue.start, 'number');
    assert.equal(typeof cue.end, 'number');
    assert.ok(RHUBARB_SHAPES.has(cue.value), `unknown shape ${cue.value}`);
    assert.ok(cue.end > cue.start);
  }
});

test('the JSON cues are contiguous, as Rhubarb’s are', () => {
  const cues = JSON.parse(toRhubarbJson(track)).mouthCues;
  for (let i = 1; i < cues.length; i += 1) {
    assert.equal(cues[i].start, cues[i - 1].end, `gap before cue ${i}`);
  }
});

test('the JSON rounds to two decimals rather than emitting raw floats', () => {
  const text = toRhubarbJson(track);
  assert.doesNotMatch(text, /\d\.\d{3,}/, 'a full-precision float reached the export');
});

/* --- Rhubarb XML -------------------------------------------------------- */

test('the XML is well formed enough to be parsed by anything', () => {
  const xml = toRhubarbXml(track);
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
  assert.match(xml, /<rhubarbResult>[\s\S]*<\/rhubarbResult>/);
  assert.equal((xml.match(/<mouthCue /g) ?? []).length, track.cues.length);
  assert.equal((xml.match(/<\/mouthCue>/g) ?? []).length, track.cues.length);
});

test('a hostile sound file name cannot break the XML', () => {
  const xml = toRhubarbXml(track, { soundFile: 'a<b>&"c\'.wav' });
  assert.match(xml, /<soundFile>a&lt;b&gt;&amp;&quot;c&apos;\.wav<\/soundFile>/);
  assert.doesNotMatch(xml.split('<mouthCues>')[0].replace(/&lt;|&gt;/g, ''), /<[^/?a-zA-Z]/);
});

/* --- Moho --------------------------------------------------------------- */

test('the Moho file starts with its magic line and uses frame numbers', () => {
  const lines = toMohoDat(track).trim().split('\n');
  assert.equal(lines[0], 'MohoSwitch1');
  for (const line of lines.slice(1)) {
    assert.match(line, /^\d+ [A-Za-z]+$/, `bad row: ${line}`);
    assert.ok(MOHO_SHAPES.has(line.split(' ')[1]));
  }
});

test('the Moho file records changes only - never the same shape twice running', () => {
  const shapes = toMohoDat(track).trim().split('\n').slice(1).map((l) => l.split(' ')[1]);
  for (let i = 1; i < shapes.length; i += 1) {
    assert.notEqual(shapes[i], shapes[i - 1], `shape repeated at row ${i}`);
  }
});

test('Moho frame numbers never go backwards', () => {
  const frames = toMohoDat(track).trim().split('\n').slice(1).map((l) => Number(l.split(' ')[0]));
  for (let i = 1; i < frames.length; i += 1) {
    assert.ok(frames[i] >= frames[i - 1], `frame went backwards at row ${i}`);
  }
});

test('the Moho frame rate follows the track', () => {
  const at24 = toMohoDat(buildTrack(SCRIPT, { settings: { fps: 24 } })).trim().split('\n');
  const at60 = toMohoDat(buildTrack(SCRIPT, { settings: { fps: 60 } })).trim().split('\n');
  assert.ok(Number(at60.at(-1).split(' ')[0]) > Number(at24.at(-1).split(' ')[0]),
    'sixty frames a second should give a higher final frame number');
});

/* --- CSV ---------------------------------------------------------------- */

test('the CSV has one header and one row per cue', () => {
  const lines = toCsv(track).trim().split('\n');
  assert.equal(lines.length, track.cues.length + 1);
  assert.equal(lines[0], 'start,end,duration,frame,shape,phonemes,word');
});

test('a word containing a comma or a quote cannot break the CSV', () => {
  const nasty = buildTrack('He said "well, maybe".');
  for (const line of toCsv(nasty).trim().split('\n')) {
    // Every row must have exactly seven fields once quoting is honoured.
    const fields = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g);
    assert.ok(fields.length >= 7, `row did not survive quoting: ${line}`);
  }
});

/* --- timing sheet ------------------------------------------------------- */

test('the timing sheet is readable and names the scheme', () => {
  const sheet = toTimingSheet(track);
  assert.match(sheet, /Detronics VoiceAnimator/);
  assert.match(sheet, /Character sheet/);
  assert.match(sheet, /\d\d:\d\d:\d\d:\d\d/);
  assert.doesNotMatch(sheet, /NaN|undefined/);
});

/* --- the registry ------------------------------------------------------- */

test('every registered format builds something for every scheme', () => {
  for (const schemeId of SCHEME_IDS) {
    const built = buildTrack(SCRIPT, { schemeId });
    for (const format of EXPORT_FORMATS) {
      const { text } = buildExport(built, format.id);
      assert.ok(text.length > 10, `${format.id} produced nothing for ${schemeId}`);
      assert.doesNotMatch(text, /NaN|undefined|\[object/, `${format.id} leaked a bad value`);
    }
  }
});

test('every registered format handles an empty track without throwing', () => {
  const empty = buildTrack('');
  for (const format of EXPORT_FORMATS) {
    assert.doesNotThrow(() => buildExport(empty, format.id), `${format.id} threw`);
  }
});

test('every format declares an extension, a mime type and a note', () => {
  for (const format of EXPORT_FORMATS) {
    assert.match(format.extension, /^[a-z]{2,4}$/);
    assert.match(format.mime, /^[a-z]+\/[a-z0-9.+-]+$/);
    assert.ok(format.note.length > 10, `${format.id} has no explanation`);
  }
});

test('an unknown format id falls back rather than throwing', () => {
  assert.equal(getFormat('nope').id, EXPORT_FORMATS[0].id);
  assert.doesNotThrow(() => buildExport(track, undefined));
});

test('filenames are safe whatever the user called the project', () => {
  assert.equal(exportFilename('tsv', 'My Script'), 'my-script.tsv');
  assert.equal(exportFilename('json', '../../etc/passwd'), 'etc-passwd.json');
  assert.equal(exportFilename('csv', ''), 'voiceanimator.csv');
  assert.equal(exportFilename('moho', '!!!'), 'voiceanimator.dat');
  assert.match(exportFilename('xml', 'a'.repeat(200)), /^a{48}\.xml$/);
});

/* --- the two schemes agree where they should ---------------------------- */

test('a track built in Rhubarb exports the same letters it was built with', () => {
  const shapes = new Set(toRhubarbTsv(rhubarbTrack).trim().split('\n').map((l) => l.split('\t')[1]));
  const used = new Set(rhubarbTrack.cues.map((c) => c.viseme));
  for (const shape of used) assert.ok(shapes.has(shape), `${shape} was lost on export`);
});
