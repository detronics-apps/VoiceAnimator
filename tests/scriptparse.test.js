import test from 'node:test';
import assert from 'node:assert/strict';

import {
  numberToWords,
  ordinalToWords,
  expandToken,
  parseMarker,
  parseScript,
  ABBREVIATIONS,
  ACRONYMS,
  DEFAULT_MARKER_PAUSE,
} from '../js/scriptparse.js';

const spoken = (text) => parseScript(text).tokens
  .filter((t) => t.type === 'word')
  .flatMap((t) => t.words);

/* --- numbers ------------------------------------------------------------ */

test('numbers up to a hundred', () => {
  assert.equal(numberToWords(0), 'zero');
  assert.equal(numberToWords(7), 'seven');
  assert.equal(numberToWords(13), 'thirteen');
  assert.equal(numberToWords(20), 'twenty');
  assert.equal(numberToWords(42), 'forty-two');
  assert.equal(numberToWords(99), 'ninety-nine');
});

test('numbers use the British `and`', () => {
  assert.equal(numberToWords(105), 'one hundred and five');
  assert.equal(numberToWords(100), 'one hundred');
  assert.equal(numberToWords(1000), 'one thousand');
  assert.equal(numberToWords(1024), 'one thousand and twenty-four');
  assert.equal(numberToWords(2500), 'two thousand five hundred');
});

test('large numbers', () => {
  assert.equal(numberToWords(1000000), 'one million');
  assert.equal(numberToWords(3400000), 'three million four hundred thousand');
  assert.equal(numberToWords(1000000000), 'one billion');
});

test('negatives and nonsense', () => {
  assert.equal(numberToWords(-5), 'minus five');
  assert.equal(numberToWords(NaN), '');
  assert.equal(numberToWords(3.9), 'three');       // truncated; decimals go via expandToken
});

test('every number below a thousand produces only real words', () => {
  const allowed = /^[a-z-]+$/;
  for (let n = 0; n < 1000; n += 1) {
    for (const word of numberToWords(n).split(' ')) {
      assert.ok(allowed.test(word), `${n} produced ${word}`);
    }
  }
});

test('ordinals', () => {
  assert.equal(ordinalToWords(1), 'first');
  assert.equal(ordinalToWords(2), 'second');
  assert.equal(ordinalToWords(3), 'third');
  assert.equal(ordinalToWords(4), 'fourth');
  assert.equal(ordinalToWords(5), 'fifth');
  assert.equal(ordinalToWords(12), 'twelfth');
  assert.equal(ordinalToWords(20), 'twentieth');
  assert.equal(ordinalToWords(21), 'twenty-first');
  assert.equal(ordinalToWords(100), 'one hundredth');
});

/* --- token expansion ---------------------------------------------------- */

test('a plain word is just lowercased', () => {
  assert.deepEqual(expandToken('Hello'), ['hello']);
  assert.deepEqual(expandToken('"Wait!"'), ['wait']);
  assert.deepEqual(expandToken("don't"), ["don't"]);
});

test('a four-digit number is read as a year', () => {
  assert.deepEqual(expandToken('1990'), ['nineteen', 'ninety']);
  assert.deepEqual(expandToken('1905'), ['nineteen', 'oh', 'five']);
  assert.deepEqual(expandToken('2005'), ['two', 'thousand', 'and', 'five']);
  assert.deepEqual(expandToken('1900'), ['nineteen', 'hundred']);
});

test('a number with a thousands separator is a quantity, not a year', () => {
  assert.deepEqual(expandToken('1,990'), ['one', 'thousand', 'nine', 'hundred', 'and', 'ninety']);
});

test('decimals are read digit by digit after the point', () => {
  assert.deepEqual(expandToken('3.5'), ['three', 'point', 'five']);
  assert.deepEqual(expandToken('0.25'), ['zero', 'point', 'two', 'five']);
});

test('currency puts the unit after the amount', () => {
  assert.deepEqual(expandToken('£20'), ['twenty', 'pounds']);
  assert.deepEqual(expandToken('$1'), ['one', 'dollar']);
  assert.deepEqual(expandToken('£3.50'), ['three', 'pounds', 'fifty']);
});

test('percentages, degrees and ordinals', () => {
  assert.deepEqual(expandToken('50%'), ['fifty', 'percent']);
  assert.deepEqual(expandToken('20°C'), ['twenty', 'degrees', 'celsius']);
  assert.deepEqual(expandToken('3rd'), ['third']);
  assert.deepEqual(expandToken('21st'), ['twenty', 'first']);
});

test('a measured value splits into number and unit', () => {
  assert.deepEqual(expandToken('24fps'), ['twenty', 'four', 'fps']);
  assert.deepEqual(expandToken('5v'), ['five', 'v']);
});

test('hyphenated compounds are two words', () => {
  assert.deepEqual(expandToken('well-known'), ['well', 'known']);
  assert.deepEqual(expandToken('on/off'), ['on', 'off']);
});

test('known abbreviations expand and unknown ones are left alone', () => {
  assert.deepEqual(expandToken('Dr'), ['doctor']);
  assert.deepEqual(expandToken('Dr.'), ['doctor']);
  assert.deepEqual(expandToken('&'), ['and']);
  assert.deepEqual(expandToken('St'), ['st']);      // ambiguous: deliberately not expanded
});

test('acronyms are spelled out only when actually capitalised', () => {
  assert.deepEqual(expandToken('USB'), ['you', 'ess', 'bee']);
  assert.deepEqual(expandToken('LED'), ['ell', 'ee', 'dee']);
  // Shouting is not an acronym.
  assert.deepEqual(expandToken('THIS'), ['this']);
  assert.deepEqual(expandToken('usb'), ['usb']);
});

test('every abbreviation and acronym expands to speakable words', () => {
  for (const value of [...Object.values(ABBREVIATIONS), ...Object.values(ACRONYMS)]) {
    assert.ok(/^[a-z -]+$/.test(value), `"${value}" is not a plain lowercase expansion`);
  }
});

test('a token with nothing speakable in it produces nothing', () => {
  assert.deepEqual(expandToken('...'), []);
  assert.deepEqual(expandToken(''), []);
  assert.deepEqual(expandToken(null), []);
});

/* --- markers ------------------------------------------------------------ */

test('pause markers, with and without a duration', () => {
  assert.deepEqual(parseMarker('pause'), { kind: 'pause', seconds: DEFAULT_MARKER_PAUSE });
  assert.deepEqual(parseMarker('pause 1.5'), { kind: 'pause', seconds: 1.5 });
  assert.deepEqual(parseMarker('pause 500ms'), { kind: 'pause', seconds: 0.5 });
  assert.deepEqual(parseMarker('beat'), { kind: 'pause', seconds: DEFAULT_MARKER_PAUSE });
});

test('a pause marker is clamped rather than trusted', () => {
  assert.equal(parseMarker('pause 9999').seconds, 60);
});

test('expression markers', () => {
  assert.deepEqual(parseMarker('smile'), { kind: 'expression', name: 'smile' });
  assert.deepEqual(parseMarker('ANGRY'), { kind: 'expression', name: 'angry' });
  assert.equal(parseMarker('shrug'), null);
  assert.equal(parseMarker(''), null);
});

/* --- the scanner -------------------------------------------------------- */

test('a plain sentence becomes words, and an interior full stop becomes a pause', () => {
  const { tokens, wordCount } = parseScript('Hello there.');
  assert.equal(wordCount, 2);
  // The final full stop leads nowhere, so it produces no pause at all.
  assert.deepEqual(tokens.map((t) => t.type), ['word', 'word']);

  assert.deepEqual(parseScript('Hello there. Again').tokens.map((t) => t.type),
    ['word', 'word', 'pause', 'word']);
});

test('a trailing pause is dropped - it animates nothing', () => {
  assert.equal(parseScript('Hello.').tokens.at(-1).type, 'word');
  assert.equal(parseScript('Hello.\n\n\n').tokens.at(-1).type, 'word');
});

test('a script never opens with a pause', () => {
  assert.equal(parseScript('   ...  Hello').tokens[0].type, 'word');
  assert.equal(parseScript(',,, Hello').tokens[0].type, 'word');
});

test('punctuation becomes the right kind of pause', () => {
  const causes = (text) => parseScript(text).tokens.filter((t) => t.type === 'pause').map((t) => t.cause);
  assert.deepEqual(causes('one, two'), ['clause']);
  assert.deepEqual(causes('one. two'), ['sentence']);
  assert.deepEqual(causes('one\ntwo'), ['line']);
  assert.deepEqual(causes('one\n\ntwo'), ['paragraph']);
  assert.deepEqual(causes('one — two'), ['clause']);
  assert.deepEqual(causes('one - two'), ['clause']);
});

test('stacked punctuation collapses to the longest rest', () => {
  const pauses = parseScript('Wait...\n\nGo').tokens.filter((t) => t.type === 'pause');
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].cause, 'paragraph');
});

test('an ellipsis is one pause, not three', () => {
  const pauses = parseScript('Wait... go').tokens.filter((t) => t.type === 'pause');
  assert.equal(pauses.length, 1);
  assert.equal(pauses[0].cause, 'sentence');
});

test('a decimal point does not end a sentence', () => {
  assert.deepEqual(spoken('It costs 3.5 units'),
    ['it', 'costs', 'three', 'point', 'five', 'units']);
  assert.equal(parseScript('It costs 3.5 units').tokens.filter((t) => t.type === 'pause').length, 0);
});

test('markers appear in the stream', () => {
  const { tokens } = parseScript('Hello [smile] there [pause 2] again');
  assert.deepEqual(tokens.map((t) => t.type),
    ['word', 'expression', 'word', 'pause', 'word']);
  assert.equal(tokens[1].name, 'smile');
  assert.equal(tokens[3].seconds, 2);
});

test('an unknown or unclosed marker is warned about, not silently dropped', () => {
  const { warnings } = parseScript('Hello [shrug] there [oops');
  assert.deepEqual(warnings.map((w) => w.type), ['unknown-marker', 'unclosed-marker']);
  assert.equal(warnings[0].text, '[shrug]');
});

/* --- offsets: what the highlight depends on ----------------------------- */

test('every token points at the exact characters it came from', () => {
  const text = 'Hello, world.\n[smile] Again';
  const { tokens } = parseScript(text);
  for (const token of tokens) {
    assert.ok(token.start >= 0 && token.end <= text.length, 'offset outside the text');
    assert.ok(token.end > token.start, 'empty span');
    if (token.type === 'word') {
      assert.equal(text.slice(token.start, token.end), token.raw);
    }
    if (token.type === 'expression') {
      assert.equal(text.slice(token.start, token.end), '[smile]');
    }
  }
});

test('offsets never go backwards', () => {
  const { tokens } = parseScript('One, two. Three\n\n[pause 1] Four 1990 and £5.50');
  for (let i = 1; i < tokens.length; i += 1) {
    assert.ok(tokens[i].start >= tokens[i - 1].start,
      `token ${i} starts before token ${i - 1}`);
  }
});

test('a word that expands to several spoken words keeps its single span', () => {
  const text = 'It was 1990.';
  const token = parseScript(text).tokens.find((t) => t.raw === '1990');
  assert.deepEqual(token.words, ['nineteen', 'ninety']);
  assert.equal(text.slice(token.start, token.end), '1990');
});

test('line numbers follow the newlines', () => {
  const { tokens } = parseScript('one\ntwo\nthree');
  const words = tokens.filter((t) => t.type === 'word');
  assert.deepEqual(words.map((t) => t.line), [0, 1, 2]);
});

/* --- counts and empty input --------------------------------------------- */

test('counts distinguish written words from spoken ones', () => {
  const result = parseScript('In 1990 we made 3 things.');
  assert.equal(result.wordCount, 6);                 // In 1990 we made 3 things
  assert.equal(result.spokenWordCount, 7);           // 1990 -> nineteen ninety
});

test('empty input is empty, not a crash', () => {
  const result = parseScript('');
  assert.deepEqual(result.tokens, []);
  assert.equal(result.wordCount, 0);
  assert.equal(result.lineCount, 0);
  assert.deepEqual(parseScript(null).tokens, []);
  assert.deepEqual(parseScript('   \n  \n ').tokens, []);
});

/* --- speaker cues -------------------------------------------------------- */

test('an [as name] cue names a speaker', () => {
  assert.deepEqual(parseMarker('as bob'), { kind: 'character', name: 'bob' });
  assert.deepEqual(parseMarker('AS Alice Smith'), { kind: 'character', name: 'alice smith' });
  assert.equal(parseMarker('as'), null, 'a speaker cue needs a name');
  assert.equal(parseMarker('ash'), null, 'a word starting with `as` is not a speaker cue');
});

test('a speaker cue appears in the stream as its own token', () => {
  const { tokens, warnings } = parseScript('[as bob] Hello. [as alice] Hi there.');
  assert.deepEqual(warnings, []);
  assert.deepEqual(tokens.filter((t) => t.type === 'character').map((t) => t.name),
    ['bob', 'alice']);
});

test('a two-hander keeps its offsets', () => {
  const text = '[as bob] Hello. [as alice] Hi.';
  for (const token of parseScript(text).tokens) {
    assert.ok(token.end > token.start && token.end <= text.length);
    if (token.type === 'character') {
      assert.match(text.slice(token.start, token.end), /^\[as .+\]$/);
    }
  }
});
