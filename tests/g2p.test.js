import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PHONEMES,
  PHONEME_LIST,
  LEXICON,
  isVowel,
  isVoiced,
  phonemeClass,
  syllableCount,
  normaliseWord,
  wordToPhonemes,
  collapseRepeats,
  phonemesToString,
  parsePhonemeString,
} from '../js/g2p.js';

const say = (word, options) => wordToPhonemes(word, options).phonemes.join(' ');

/* --- the inventory itself ---------------------------------------------- */

test('every phoneme declares a class and a voicing', () => {
  for (const [name, info] of Object.entries(PHONEMES)) {
    assert.ok(info.class, `${name} has no class`);
    assert.equal(typeof info.voiced, 'boolean', `${name} has no voicing`);
    assert.ok(info.example, `${name} has no example word`);
  }
});

test('vowels and consonants are classified consistently', () => {
  assert.ok(isVowel('AA') && isVowel('IY') && isVowel('AY'));
  assert.ok(!isVowel('S') && !isVowel('M') && !isVowel('sil'));
  assert.ok(isVoiced('Z') && isVoiced('M') && !isVoiced('S') && !isVoiced('T'));
  assert.equal(phonemeClass('P'), 'stop');
  assert.equal(phonemeClass('NG'), 'nasal');
  assert.equal(phonemeClass('nonsense'), 'unknown');
});

test('the lexicon only contains phonemes that exist', () => {
  for (const [word, phonemes] of Object.entries(LEXICON)) {
    for (const p of phonemes) {
      assert.ok(PHONEME_LIST.includes(p), `${word} uses unknown phoneme ${p}`);
    }
  }
});

/* --- normalisation ------------------------------------------------------ */

test('normalisation keeps internal apostrophes and drops everything else', () => {
  assert.equal(normaliseWord('Hello,'), 'hello');
  assert.equal(normaliseWord('"Wait!"'), 'wait');
  assert.equal(normaliseWord("don't"), "don't");
  assert.equal(normaliseWord('’tis'), 'tis');
  assert.equal(normaliseWord('  '), '');
  assert.equal(normaliseWord(null), '');
});

/* --- the rules ---------------------------------------------------------- */

test('short vowels and simple consonants', () => {
  assert.equal(say('cat'), 'K AE T');
  assert.equal(say('dog'), 'D AA G');
  assert.equal(say('bed'), 'B EH D');
  assert.equal(say('ship'), 'SH IH P');
  assert.equal(say('lip'), 'L IH P');
});

test('magic e lengthens the vowel before it', () => {
  assert.equal(say('make'), 'M EY K');
  assert.equal(say('time'), 'T AY M');
  assert.equal(say('note'), 'N OW T');
  assert.equal(say('these'), 'DH IY Z');       // lexicon
});

// pitfalls-style regression: `-xes` is an added syllable, not a magic e.
test('boxes is not read as a magic-e word', () => {
  assert.equal(say('boxes'), 'B AA K S IH Z');
  assert.equal(say('houses'), 'HH AW S IH Z');
  assert.equal(say('watches'), 'W AE CH IH Z');
});

test('a plural -s after a silent e adds no syllable', () => {
  assert.equal(say('makes'), 'M EY K S');
  assert.equal(say('times'), 'T AY M Z');
  assert.equal(say('notes'), 'N OW T S');
});

test('a final -s is voiced after a voiced sound and not after a voiceless one', () => {
  assert.equal(say('dogs'), 'D AA G Z');
  assert.equal(say('cats'), 'K AE T S');
  assert.equal(say('jumps'), 'JH AH M P S');
});

test('a final -ed is a syllable only after t or d', () => {
  assert.equal(say('wanted'), 'W AE N T IH D');
  assert.equal(say('walked'), 'W AO K T');       // devoiced after K
  assert.equal(say('played'), 'P L EY D');       // voiced after EY
});

test('a digraph is never split by the -ed rule', () => {
  assert.equal(say('speed'), 'S P IY D');
  assert.equal(say('need'), 'N IY D');
  assert.equal(say('indeed'), 'IH N D IY D');
});

test('silent letters', () => {
  assert.equal(say('knight'), 'N AY T');
  assert.equal(say('write'), 'R AY T');
  assert.equal(say('lamb'), 'L AE M');
  assert.equal(say('column'), 'K AA L AH M');
  assert.equal(say('phone'), 'F OW N');
});

test('consonant digraphs', () => {
  assert.equal(say('church'), 'CH ER CH');
  assert.equal(say('thing'), 'TH IH NG');
  assert.equal(say('teeth'), 'T IY TH');
  assert.equal(say('quick'), 'K W IH K');
  assert.equal(say('fox'), 'F AA K S');
});

test('latinate endings', () => {
  assert.equal(say('nation'), 'N EY SH AH N');
  assert.equal(say('vision'), 'V IH ZH AH N');
  assert.equal(say('picture'), 'P IH K CH ER');
  assert.equal(say('calculator'), 'K AE L K AH L EY T ER');
});

test('unstressed final syllables reduce to a schwa', () => {
  assert.equal(say('open'), 'OW P AH N');        // lexicon
  assert.equal(say('listen'), 'L IH S T AH N');
  assert.equal(say('level'), 'L EH V AH L');
  assert.equal(say('little'), 'L IH T AH L');
  assert.equal(say('normal'), 'N AO R M AH L');
});

test('-able is a suffix, not the whole of `table`', () => {
  assert.equal(say('table'), 'T EY B AH L');
  assert.equal(say('comfortable'), 'K AA M F AO R T AH B AH L');
});

test('short words are not mistaken for suffixed ones', () => {
  assert.equal(say('ten'), 'T EH N');
  assert.equal(say('pal'), 'P AE L');
  assert.equal(say('red'), 'R EH D');
});

/* --- contractions ------------------------------------------------------- */

test("n't keeps the n that belongs to the stem", () => {
  // `ca` + `n't` would give K AH; the n is part of `can`.
  assert.equal(say("can't"), 'K AE N T');
  assert.equal(say("won't"), 'W OW N T');
});

test('clitics attach to the stem', () => {
  assert.equal(say("we'll"), 'W IY L');
  assert.equal(say("they're"), 'DH EY ER');
  assert.equal(say("I've"), 'AY V');
  assert.equal(say("I'm"), 'AY M');
});

test("a clitic 's devoices after a voiceless sound", () => {
  assert.equal(say("it's"), 'IH T S');
  assert.equal(say("Bob's"), 'B AA B Z');
});

/* --- overrides ---------------------------------------------------------- */

test('an override beats both the lexicon and the rules', () => {
  assert.equal(say('the'), 'DH AH');
  assert.equal(say('the', { overrides: { the: 'DH IY' } }), 'DH IY');
  assert.equal(say('cat', { overrides: { cat: ['K', 'AA', 'T'] } }), 'K AA T');
});

test('an override made of nonsense is ignored rather than obeyed', () => {
  assert.equal(say('cat', { overrides: { cat: 'XX YY' } }), 'K AE T');
  assert.equal(say('cat', { overrides: { cat: '' } }), 'K AE T');
});

test('overrides are matched on the normalised word', () => {
  assert.equal(say('Cat!', { overrides: { cat: 'M IY AW' } }), 'M IY AW');
});

/* --- invariants --------------------------------------------------------- */

const SAMPLE = `The quick brown fox jumps over the lazy dog while a voice animator
  renders every mouth shape from angry to laughing without uploading anything
  anywhere because it all happens right here in your own browser`;

test('every word produces at least one phoneme', () => {
  for (const word of SAMPLE.split(/\s+/)) {
    const { phonemes } = wordToPhonemes(word);
    assert.ok(phonemes.length > 0, `${word} produced nothing`);
  }
});

test('every phoneme produced is one the app knows how to draw', () => {
  for (const word of SAMPLE.split(/\s+/)) {
    for (const p of wordToPhonemes(word).phonemes) {
      assert.ok(PHONEME_LIST.includes(p), `${word} produced unknown phoneme ${p}`);
    }
  }
});

test('no word produces two identical phonemes in a row', () => {
  for (const word of SAMPLE.split(/\s+/)) {
    const phonemes = wordToPhonemes(word).phonemes;
    for (let i = 1; i < phonemes.length; i += 1) {
      assert.notEqual(phonemes[i], phonemes[i - 1], `${word} repeats ${phonemes[i]}`);
    }
  }
});

test('every word has at least one vowel to hang a syllable on', () => {
  for (const word of SAMPLE.split(/\s+/)) {
    const phonemes = wordToPhonemes(word).phonemes;
    assert.ok(syllableCount(phonemes) >= 1, `${word} has no vowel`);
  }
});

test('the same word always gives the same answer', () => {
  for (const word of SAMPLE.split(/\s+/)) {
    assert.deepEqual(wordToPhonemes(word).phonemes, wordToPhonemes(word).phonemes);
  }
});

test('punctuation and case do not change the answer', () => {
  assert.equal(say('Mouth'), say('mouth'));
  assert.equal(say('"MOUTH!"'), say('mouth'));
});

test('a word of pure punctuation is empty, not a fabricated sound', () => {
  const { phonemes, source } = wordToPhonemes('---');
  assert.deepEqual(phonemes, []);
  assert.equal(source, 'empty');
});

/* --- helpers ------------------------------------------------------------ */

test('repeats collapse to a single held sound', () => {
  assert.deepEqual(collapseRepeats(['M', 'M', 'AA', 'AA', 'T']), ['M', 'AA', 'T']);
  assert.deepEqual(collapseRepeats([]), []);
});

test('phoneme strings round-trip', () => {
  const phonemes = wordToPhonemes('animator').phonemes;
  assert.deepEqual(parsePhonemeString(phonemesToString(phonemes)), phonemes);
});

test('parsing a phoneme string discards anything unknown', () => {
  assert.deepEqual(parsePhonemeString('k ae t'), ['K', 'AE', 'T']);
  assert.deepEqual(parsePhonemeString('K, QQ, AE'), ['K', 'AE']);
  assert.deepEqual(parsePhonemeString('SIL'), ['sil']);
  assert.deepEqual(parsePhonemeString(undefined), []);
});

/* --- the number vocabulary ---------------------------------------------- */

// `expandToken` turns every digit in a script into one of these words, so a wrong
// reading here is a wrong mouth shape every time a figure appears.
test('every number word reads correctly', () => {
  const expected = {
    zero: 'Z IH R OW', one: 'W AH N', two: 'T UW', three: 'TH R IY', four: 'F AO R',
    five: 'F AY V', six: 'S IH K S', seven: 'S EH V AH N', eight: 'EY T', nine: 'N AY N',
    ten: 'T EH N', eleven: 'IH L EH V AH N', twelve: 'T W EH L V',
    thirteen: 'TH ER T IY N', fourteen: 'F AO R T IY N', fifteen: 'F IH F T IY N',
    sixteen: 'S IH K S T IY N', seventeen: 'S EH V AH N T IY N', eighteen: 'EY T IY N',
    nineteen: 'N AY N T IY N', twenty: 'T W EH N T IY', thirty: 'TH ER T IY',
    forty: 'F AO R T IY', fifty: 'F IH F T IY', sixty: 'S IH K S T IY',
    seventy: 'S EH V AH N T IY', eighty: 'EY T IY', ninety: 'N AY N T IY',
    hundred: 'HH AH N D R IH D', thousand: 'TH AW Z AH N D', million: 'M IH L Y AH N',
    minus: 'M AY N AH S', point: 'P OY N T',
  };
  for (const [word, phonemes] of Object.entries(expected)) {
    assert.equal(say(word), phonemes, `"${word}" was read wrongly`);
  }
});

test('a spoken year comes out as real words', () => {
  // `1990` -> nineteen ninety, and neither half may collapse to a schwa.
  assert.equal(say('nineteen'), 'N AY N T IY N');
  assert.equal(say('ninety'), 'N AY N T IY');
});

/* --- rules added after the first pass ------------------------------------ */

test('y before a magic e is the vowel of `my`, not of `city`', () => {
  assert.equal(say('type'), 'T AY P');
  assert.equal(say('style'), 'S T AY L');
  assert.equal(say('byte'), 'B AY T');
  assert.equal(say('cycle'), 'S AY K AH L');
  // Still short where it should be.
  assert.equal(say('city'), 'S IH T IY');
  assert.equal(say('happy'), 'HH AE P IY');
});

test('uy is one sound', () => {
  assert.equal(say('buy'), 'B AY');
  assert.equal(say('buys'), 'B AY Z');
  assert.equal(say('guy'), 'G AY');
});

test('our before another letter is the vowel of `four`', () => {
  assert.equal(say('fourteen'), 'F AO R T IY N');
  assert.equal(say('fourth'), 'F AO R TH');
  assert.equal(say('course'), 'K AO R S');
  // At the end of a word it stays a diphthong.
  assert.equal(say('sour'), 'S AW R');
  assert.equal(say('flour'), 'F L AW R');
});

test('an unstressed final -ar is a schwa, but a stressed one is not', () => {
  assert.equal(say('dollar'), 'D AA L ER');
  assert.equal(say('dollars'), 'D AA L ER Z');
  assert.equal(say('car'), 'K AA R');
  assert.equal(say('star'), 'S T AA R');
});
