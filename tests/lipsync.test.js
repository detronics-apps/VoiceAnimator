import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildUnits,
  buildTrack,
  emptyTrack,
  trackWarnings,
  explainTiming,
  explainVisemes,
} from '../js/lipsync.js';
import { parseScript } from '../js/scriptparse.js';
import { SCHEME_IDS, restViseme, visemeInfo, visemeFor } from '../js/visemes.js';

const SCRIPT = 'Hello there. [smile] This is the VoiceAnimator, and it runs in your browser.';
const EPS = 1e-6;

/* --- units -------------------------------------------------------------- */

test('units carry the phonemes, the pauses and the cues in script order', () => {
  const { units } = buildUnits(parseScript('Hi. [smile] Go'));
  const kinds = units.map((u) => u.kind);
  assert.ok(kinds.includes('phoneme'));
  assert.ok(kinds.includes('pause'));
  assert.ok(kinds.includes('expression'));
  assert.equal(units.find((u) => u.kind === 'expression').name, 'smile');
});

test('a word that expands to several spoken words is still one word', () => {
  const { words, units } = buildUnits(parseScript('In 1990.'));
  assert.equal(words.length, 2);
  const year = words[1];
  assert.equal(year.raw, '1990');
  assert.deepEqual(year.spoken, ['nineteen', 'ninety']);
  // Every phoneme it produced points back at the same four characters.
  const its = units.filter((u) => u.kind === 'phoneme' && u.wordIndex === 1);
  assert.ok(its.length > 4);
  assert.ok(its.every((u) => u.charStart === year.charStart && u.charEnd === year.charEnd));
});

test('a word is marked as overridden when any part of it was corrected', () => {
  const parsed = parseScript('hello world');
  const plain = buildUnits(parsed).words;
  assert.equal(plain[0].source, 'lexicon');

  const fixed = buildUnits(parsed, { overrides: { world: 'W ER L D' } }).words;
  assert.equal(fixed[1].source, 'override');
});

test('a word that produces no sound produces no unit', () => {
  const { words, units } = buildUnits(parseScript('...'));
  assert.deepEqual(words, []);
  assert.deepEqual(units, []);
});

/* --- the track ---------------------------------------------------------- */

test('a real script produces a contiguous track in every scheme', () => {
  for (const schemeId of SCHEME_IDS) {
    const track = buildTrack(SCRIPT, { schemeId });
    assert.ok(track.cues.length > 5, `${schemeId} produced only ${track.cues.length} cues`);
    assert.equal(track.cues[0].start, 0);
    for (let i = 1; i < track.cues.length; i += 1) {
      assert.ok(Math.abs(track.cues[i].start - track.cues[i - 1].end) < EPS,
        `${schemeId} gap at cue ${i}`);
    }
    assert.ok(Math.abs(track.duration - track.cues.at(-1).end) < EPS);
  }
});

test('every cue names a shape the chosen scheme can draw', () => {
  for (const schemeId of SCHEME_IDS) {
    for (const cue of buildTrack(SCRIPT, { schemeId }).cues) {
      assert.ok(visemeInfo(schemeId, cue.viseme),
        `${schemeId} produced unknown shape ${cue.viseme}`);
    }
  }
});

test('the track opens and closes at rest', () => {
  const plain = 'Hello there, this is a test.';
  for (const schemeId of SCHEME_IDS) {
    const { cues } = buildTrack(plain, { schemeId });
    assert.equal(cues[0].viseme, restViseme(schemeId));
    assert.equal(cues.at(-1).viseme, restViseme(schemeId));
  }
});

test('a running expression, not plain rest, is what the track closes on', () => {
  const { cues, expressions } = buildTrack('Hello [smile] there.', { schemeId: 'chart' });
  assert.equal(cues.at(-1).viseme, 'SMILE');
  assert.equal(cues.at(-1).kind, 'rest');
  assert.equal(expressions.at(-1).name, 'smile');

  // A scheme with no expressions falls back to its own rest pose rather than breaking.
  const rhubarb = buildTrack('Hello [smile] there.', { schemeId: 'rhubarb' });
  assert.equal(rhubarb.cues.at(-1).viseme, restViseme('rhubarb'));
});

test('every word gets a time span, in order, inside the track', () => {
  const track = buildTrack(SCRIPT);
  assert.ok(track.words.length > 5);
  let previousEnd = -1;
  for (const word of track.words) {
    assert.ok(word.start !== null, `"${word.raw}" was never timed`);
    assert.ok(word.end > word.start, `"${word.raw}" has no duration`);
    assert.ok(word.start >= previousEnd - EPS, `"${word.raw}" starts before the previous word ends`);
    assert.ok(word.end <= track.duration + EPS, `"${word.raw}" runs past the end`);
    previousEnd = word.end;
  }
});

test('every word span points at real characters in the script', () => {
  const track = buildTrack(SCRIPT);
  for (const word of track.words) {
    assert.equal(SCRIPT.slice(word.charStart, word.charEnd), word.raw);
  }
});

test('a word carries one viseme per phoneme', () => {
  for (const word of buildTrack(SCRIPT).words) {
    assert.equal(word.visemes.length, word.phonemes.length);
    for (const [i, phoneme] of word.phonemes.entries()) {
      assert.equal(word.visemes[i], visemeFor(phoneme, 'chart'));
    }
  }
});

test('an empty script is a valid empty track, not a crash', () => {
  const track = emptyTrack();
  assert.deepEqual(track.cues, []);
  assert.deepEqual(track.words, []);
  assert.equal(track.duration, 0);
  assert.equal(track.stats.cueCount, 0);
  assert.deepEqual(buildTrack(null).cues, []);
});

test('pronunciation overrides change the shapes on screen', () => {
  const plain = buildTrack('read', { schemeId: 'chart' });
  const fixed = buildTrack('read', { schemeId: 'chart', overrides: { read: 'R EH D' } });
  assert.notDeepEqual(plain.words[0].phonemes, fixed.words[0].phonemes);
  assert.deepEqual(fixed.words[0].phonemes, ['R', 'EH', 'D']);
});

test('an expression cue survives into the track', () => {
  const track = buildTrack('Hello [angry] there', { schemeId: 'chart' });
  assert.equal(track.expressions.length, 1);
  assert.equal(track.expressions[0].name, 'angry');
});

test('the settings actually used are reported back', () => {
  const track = buildTrack(SCRIPT, { settings: { wpm: 200 } });
  assert.equal(track.settings.wpm, 200);
  assert.equal(track.settings.fps, 24);            // default preserved
});

test('a faster rate gives a shorter track for the same script', () => {
  const slow = buildTrack(SCRIPT, { settings: { wpm: 110 } }).duration;
  const fast = buildTrack(SCRIPT, { settings: { wpm: 210 } }).duration;
  assert.ok(fast < slow, `${fast} was not shorter than ${slow}`);
});

test('the same input always gives the same track', () => {
  const a = buildTrack(SCRIPT);
  const b = buildTrack(SCRIPT);
  assert.deepEqual(a.cues, b.cues);
  assert.equal(a.duration, b.duration);
});

test('a long script stays contiguous and terminates', () => {
  const long = Array.from({ length: 120 },
    (_, i) => `Line ${i} of the test script, with commas, and a full stop.`).join('\n');
  const track = buildTrack(long);
  assert.ok(track.duration > 60);
  for (let i = 1; i < track.cues.length; i += 1) {
    assert.ok(Math.abs(track.cues[i].start - track.cues[i - 1].end) < EPS);
  }
});

/* --- warnings ----------------------------------------------------------- */

test('an unknown cue is reported and names the ones that do work', () => {
  const warnings = trackWarnings(buildTrack('Hello [shrug] there'));
  const text = warnings.map((w) => w.text).join(' ');
  assert.match(text, /\[shrug\]/);
  assert.match(text, /\[smile\]/);
});

test('an impossible speaking rate is flagged as such', () => {
  const track = buildTrack('One.\n\n\nTwo.', { settings: { wpm: 400, pauses: { paragraph: 4 } } });
  const levels = trackWarnings(track).map((w) => w.level);
  assert.ok(levels.includes('danger') || levels.includes('warn'));
});

test('a minimum hold under two frames is flagged', () => {
  const track = buildTrack(SCRIPT, { settings: { fps: 30, minHold: 0.01 } });
  assert.ok(trackWarnings(track).some((w) => /flicker/.test(w.text)));
});

test('a clean script at a sane rate produces no warnings', () => {
  assert.deepEqual(trackWarnings(buildTrack(SCRIPT)), []);
});

// pitfalls.md #9: a raw internal value must never reach a sentence.
test('no warning contains a full-precision number', () => {
  const tracks = [
    buildTrack(SCRIPT, { settings: { fps: 30, minHold: 0.0123456789 } }),
    buildTrack('One.\n\n\nTwo.', { settings: { wpm: 400, pauses: { paragraph: 4 } } }),
    buildTrack('Hello [shrug] there'),
  ];
  for (const track of tracks) {
    for (const warning of trackWarnings(track)) {
      assert.doesNotMatch(warning.text, /\d\.\d{4,}/,
        `a raw float reached the user: "${warning.text}"`);
    }
  }
});

/* --- the teaching panel ------------------------------------------------- */

test('the explanation is worked through with the numbers on screen', () => {
  const track = buildTrack(SCRIPT, { settings: { wpm: 175 } });
  const { plain, formula, worked } = explainTiming(track);
  assert.ok(plain.length > 80);
  assert.match(formula, /speechScale/);
  assert.match(worked, /175 wpm/);
  assert.match(worked, new RegExp(`${track.stats.cueCount} cues`));
});

test('the explanation says something useful before anything is typed', () => {
  const { worked } = explainTiming(emptyTrack());
  assert.ok(worked.length > 10);
  assert.doesNotMatch(worked, /NaN|undefined/);
});

test('no explanation leaks a full-precision number', () => {
  for (const settings of [{}, { wpm: 173, fps: 25 }, { minHold: 1 / 3 }]) {
    const { worked } = explainTiming(buildTrack(SCRIPT, { settings }));
    assert.doesNotMatch(worked, /\d\.\d{4,}/, `raw float in: ${worked}`);
    assert.doesNotMatch(worked, /NaN|undefined/);
  }
});

test('the viseme explanation lists the scheme it is describing', () => {
  for (const schemeId of SCHEME_IDS) {
    const { plain, formula, worked } = explainVisemes(schemeId);
    assert.doesNotMatch(`${plain}${formula}${worked}`, /NaN|undefined/);
    for (const viseme of ['A', 'MBP'].filter((id) => visemeInfo(schemeId, id))) {
      assert.match(worked, new RegExp(visemeInfo(schemeId, viseme).title));
    }
  }
});

/* --- speakers ------------------------------------------------------------ */

test('a two-hander divides the track between its speakers', () => {
  const track = buildTrack('[as bob] Hello there. [as alice] Hello yourself.');
  assert.deepEqual(track.speakers.map((s) => s.name), ['bob', 'alice']);
  assert.ok(track.speakers[0].end <= track.speakers[1].start + EPS);
  assert.ok(track.speakers.at(-1).end <= track.duration + EPS);
  assert.equal(track.warnings.length, 0, 'a speaker cue must not warn');
});

test('a script with no speaker cue has no speakers', () => {
  assert.deepEqual(buildTrack('Hello there.').speakers, []);
});

test('the unknown-cue warning names the speaker cue too', () => {
  const text = trackWarnings(buildTrack('Hello [shrug] there')).map((w) => w.text).join(' ');
  assert.match(text, /\[as name\]/);
});
