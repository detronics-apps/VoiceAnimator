/**
 * Grapheme to phoneme: English spelling in, ARPAbet-style phonemes out.
 *
 * Pure: no DOM, no globals.
 *
 * Rhubarb Lip Sync reads the *audio* and recognises the sounds actually spoken. This tool
 * has no audio to read at the point the script is typed, so it works the other way round:
 * it predicts the sounds from the spelling, and lets you fix any word it gets wrong.
 *
 * That is why `wordToPhonemes` takes an `overrides` map. English spelling is not a
 * function of its pronunciation - `read`/`read`, `lead`/`lead`, `bow`/`bow` - so no rule
 * set can be complete. The design answer is a good default plus a one-click correction
 * that is remembered with the project, not a bigger rule table.
 *
 * Accuracy is discussed honestly in the README: expect roughly 90% of common English
 * words correct, and use the pronunciation override for the rest.
 */

/* ---------------------------------------------------------------------------- *
 * The phoneme inventory
 *
 * A 39-phoneme ARPAbet subset, plus `sil` for a deliberate rest. Each carries the
 * articulatory class, because that is what both the viseme mapping and the duration
 * model key off - a stop is short, a diphthong is long, and that is true regardless
 * of which word it appears in.
 * ---------------------------------------------------------------------------- */

export const PHONEMES = {
  // Monophthong vowels
  AA: { class: 'vowel', voiced: true, example: 'father' },
  AE: { class: 'vowel', voiced: true, example: 'cat' },
  AH: { class: 'vowel', voiced: true, example: 'cup' },
  AO: { class: 'vowel', voiced: true, example: 'law' },
  EH: { class: 'vowel', voiced: true, example: 'bed' },
  ER: { class: 'vowel', voiced: true, example: 'bird' },
  IH: { class: 'vowel', voiced: true, example: 'sit' },
  IY: { class: 'vowel', voiced: true, example: 'see' },
  UH: { class: 'vowel', voiced: true, example: 'book' },
  UW: { class: 'vowel', voiced: true, example: 'blue' },

  // Diphthongs - held longer, and they move, which matters for the timing model
  AW: { class: 'diphthong', voiced: true, example: 'now' },
  AY: { class: 'diphthong', voiced: true, example: 'my' },
  EY: { class: 'diphthong', voiced: true, example: 'day' },
  OW: { class: 'diphthong', voiced: true, example: 'go' },
  OY: { class: 'diphthong', voiced: true, example: 'boy' },

  // Stops
  B: { class: 'stop', voiced: true, example: 'bee' },
  D: { class: 'stop', voiced: true, example: 'dee' },
  G: { class: 'stop', voiced: true, example: 'green' },
  K: { class: 'stop', voiced: false, example: 'key' },
  P: { class: 'stop', voiced: false, example: 'pea' },
  T: { class: 'stop', voiced: false, example: 'tea' },

  // Affricates
  CH: { class: 'affricate', voiced: false, example: 'cheese' },
  JH: { class: 'affricate', voiced: true, example: 'gee' },

  // Fricatives
  DH: { class: 'fricative', voiced: true, example: 'thee' },
  F: { class: 'fricative', voiced: false, example: 'fee' },
  HH: { class: 'fricative', voiced: false, example: 'he' },
  S: { class: 'fricative', voiced: false, example: 'sea' },
  SH: { class: 'fricative', voiced: false, example: 'she' },
  TH: { class: 'fricative', voiced: false, example: 'theta' },
  V: { class: 'fricative', voiced: true, example: 'vee' },
  Z: { class: 'fricative', voiced: true, example: 'zee' },
  ZH: { class: 'fricative', voiced: true, example: 'seizure' },

  // Nasals
  M: { class: 'nasal', voiced: true, example: 'me' },
  N: { class: 'nasal', voiced: true, example: 'knee' },
  NG: { class: 'nasal', voiced: true, example: 'ping' },

  // Liquids and glides
  L: { class: 'liquid', voiced: true, example: 'lee' },
  R: { class: 'liquid', voiced: true, example: 'read' },
  W: { class: 'glide', voiced: true, example: 'we' },
  Y: { class: 'glide', voiced: true, example: 'yield' },

  // Silence. Not a sound, but it needs a duration and a mouth shape like anything else.
  sil: { class: 'silence', voiced: false, example: 'a pause' },
};

export const PHONEME_LIST = Object.keys(PHONEMES);

export const isVowel = (p) =>
  PHONEMES[p]?.class === 'vowel' || PHONEMES[p]?.class === 'diphthong';

export const isVoiced = (p) => PHONEMES[p]?.voiced === true;

export const phonemeClass = (p) => PHONEMES[p]?.class ?? 'unknown';

/** Syllables, counted the only way that is reliable: one per vowel nucleus. */
export function syllableCount(phonemes) {
  return phonemes.filter(isVowel).length;
}

/* ---------------------------------------------------------------------------- *
 * The exception lexicon
 *
 * Every entry here is a word the rules get wrong and that appears often enough to be
 * worth the bytes. Function words dominate, because they are both the most frequent
 * words in any script and the most irregularly spelled.
 * ---------------------------------------------------------------------------- */

const RAW_LEXICON = {
  // Articles, pronouns, auxiliaries - the top of every frequency list
  a: 'AH', an: 'AE N', the: 'DH AH', i: 'AY', you: 'Y UW', he: 'HH IY', she: 'SH IY',
  we: 'W IY', me: 'M IY', be: 'B IY', they: 'DH EY', them: 'DH EH M', their: 'DH EH R',
  there: 'DH EH R', these: 'DH IY Z', those: 'DH OW Z', this: 'DH IH S', that: 'DH AE T',
  then: 'DH EH N', than: 'DH AE N', thus: 'DH AH S', though: 'DH OW', through: 'TH R UW',
  thought: 'TH AO T', thorough: 'TH ER OW', throughout: 'TH R UW AW T',
  to: 'T UW', too: 'T UW', two: 'T UW', do: 'D UW', does: 'D AH Z', done: 'D AH N',
  go: 'G OW', goes: 'G OW Z', gone: 'G AO N', of: 'AH V', off: 'AO F', or: 'AO R',
  one: 'W AH N', once: 'W AH N S', only: 'OW N L IY', other: 'AH DH ER',
  another: 'AH N AH DH ER', mother: 'M AH DH ER', father: 'F AA DH ER',
  brother: 'B R AH DH ER', weather: 'W EH DH ER', whether: 'W EH DH ER',
  together: 'T AH G EH DH ER', either: 'IY DH ER', neither: 'N IY DH ER',
  rather: 'R AE DH ER', with: 'W IH DH', within: 'W IH DH IH N', without: 'W IH DH AW T',
  was: 'W AA Z', were: 'W ER', are: 'AA R', is: 'IH Z', has: 'HH AE Z', have: 'HH AE V',
  had: 'HH AE D', said: 'S EH D', says: 'S EH Z', say: 'S EY',
  would: 'W UH D', could: 'K UH D', should: 'SH UH D', shall: 'SH AE L',
  who: 'HH UW', whose: 'HH UW Z', whom: 'HH UW M', what: 'W AH T', where: 'W EH R',
  when: 'W EH N', why: 'W AY', how: 'HH AW', which: 'W IH CH', while: 'W AY L',
  because: 'B IH K AO Z', before: 'B IH F AO R', below: 'B IH L OW',
  been: 'B IH N', both: 'B OW TH', very: 'V EH R IY', every: 'EH V R IY',
  any: 'EH N IY', many: 'M EH N IY', most: 'M OW S T', post: 'P OW S T',
  cost: 'K AO S T', lost: 'L AO S T', across: 'AH K R AO S',

  // Verbs and everyday nouns the vowel rules mishandle
  come: 'K AH M', comes: 'K AH M Z', coming: 'K AH M IH NG', some: 'S AH M',
  something: 'S AH M TH IH NG', someone: 'S AH M W AH N', none: 'N AH N',
  love: 'L AH V', above: 'AH B AH V', give: 'G IH V', given: 'G IH V AH N',
  live: 'L IH V', lives: 'L AY V Z', move: 'M UW V', prove: 'P R UW V',
  lose: 'L UW Z', loose: 'L UW S', choose: 'CH UW Z', chose: 'CH OW Z',
  use: 'Y UW Z', used: 'Y UW Z D', useful: 'Y UW S F AH L', usual: 'Y UW ZH AH L',
  nose: 'N OW Z', rose: 'R OW Z', close: 'K L OW Z', please: 'P L IY Z',
  house: 'HH AW S', mouse: 'M AW S', now: 'N AW', cow: 'K AW', bow: 'B OW',
  down: 'D AW N', town: 'T AW N', brown: 'B R AW N', crown: 'K R AW N',
  power: 'P AW ER', tower: 'T AW ER', flower: 'F L AW ER', shower: 'SH AW ER',
  our: 'AW ER', hour: 'AW ER', your: 'Y AO R', four: 'F AO R', pour: 'P AO R',
  tour: 'T UH R', sure: 'SH UH R', measure: 'M EH ZH ER', pleasure: 'P L EH ZH ER',
  laugh: 'L AE F', laughing: 'L AE F IH NG', laughter: 'L AE F T ER',
  cough: 'K AO F', enough: 'IH N AH F', rough: 'R AH F', tough: 'T AH F',
  eye: 'AY', eyes: 'AY Z', people: 'P IY P AH L', women: 'W IH M AH N',
  woman: 'W UH M AH N', busy: 'B IH Z IY', business: 'B IH Z N AH S',
  island: 'AY L AH N D', friend: 'F R EH N D', friends: 'F R EH N D Z',
  again: 'AH G EH N', against: 'AH G EH N S T', great: 'G R EY T', break: 'B R EY K',
  bread: 'B R EH D', head: 'HH EH D', dead: 'D EH D', ready: 'R EH D IY',
  already: 'AO L R EH D IY', heavy: 'HH EH V IY', health: 'HH EH L TH',
  earth: 'ER TH', early: 'ER L IY', learn: 'L ER N', heard: 'HH ER D',
  search: 'S ER CH', work: 'W ER K', word: 'W ER D', world: 'W ER L D',
  worth: 'W ER TH', warm: 'W AO R M', water: 'W AO T ER', want: 'W AA N T',
  wear: 'W EH R', heart: 'HH AA R T', beautiful: 'B Y UW T AH F AH L',
  build: 'B IH L D', built: 'B IH L T', guide: 'G AY D', guess: 'G EH S',
  answer: 'AE N S ER', colour: 'K AH L ER', color: 'K AH L ER',
  money: 'M AH N IY', honey: 'HH AH N IY', front: 'F R AH N T', month: 'M AH N TH',
  young: 'Y AH NG', touch: 'T AH CH', country: 'K AH N T R IY', couple: 'K AH P AH L',
  trouble: 'T R AH B AH L', double: 'D AH B AH L', enough_: 'IH N AH F',
  blood: 'B L AH D', flood: 'F L AH D', good: 'G UH D', book: 'B UH K',
  look: 'L UH K', took: 'T UH K', foot: 'F UH T', wood: 'W UH D', wool: 'W UH L',
  put: 'P UH T', push: 'P UH SH', full: 'F UH L', pull: 'P UH L',

  // Technical vocabulary that turns up in a Detronics script
  music: 'M Y UW Z IH K', video: 'V IH D IY OW', audio: 'AO D IY OW',
  human: 'HH Y UW M AH N', unit: 'Y UW N IH T', units: 'Y UW N IH T S',
  new: 'N UW', few: 'F Y UW', view: 'V Y UW', cute: 'K Y UW T', huge: 'HH Y UW JH',
  tune: 'T UW N', during: 'D UH R IH NG', future: 'F Y UW CH ER',
  student: 'S T UW D AH N T', computer: 'K AH M P Y UW T ER',
  circuit: 'S ER K IH T', circuits: 'S ER K IH T S', voltage: 'V OW L T IH JH',
  current: 'K ER AH N T', resistor: 'R IH Z IH S T ER', diode: 'D AY OW D',
  engine: 'EH N JH AH N', energy: 'EH N ER JH IY', general: 'JH EH N ER AH L',
  gentle: 'JH EH N T AH L', giant: 'JH AY AH N T', gem: 'JH EH M', gym: 'JH IH M',
  magic: 'M AE JH IH K', large: 'L AA R JH', change: 'CH EY N JH',
  danger: 'D EY N JH ER', message: 'M EH S IH JH', imagine: 'IH M AE JH AH N',
  logic: 'L AA JH IH K', age: 'EY JH', page: 'P EY JH', cage: 'K EY JH',
  machine: 'M AH SH IY N', special: 'S P EH SH AH L', ocean: 'OW SH AH N',
  ancient: 'EY N SH AH N T', science: 'S AY AH N S',
  // Stressed open syllables. `e-`, `i-` and `o-` before a single consonant are a
  // coin flip in English - `even` is long, `ever` is short, and nothing in the
  // spelling separates them - so there is no rule for them, only these entries.
  even: 'IY V AH N', evening: 'IY V N IH NG', secret: 'S IY K R AH T',
  between: 'B IH T W IY N', begin: 'B IH G IH N', being: 'B IY IH NG',
  final: 'F AY N AH L', silent: 'S AY L AH N T', tiny: 'T AY N IY',
  minor: 'M AY N ER', item: 'AY T AH M', local: 'L OW K AH L', total: 'T OW T AH L',
  motor: 'M OW T ER', moment: 'M OW M AH N T', notice: 'N OW T IH S',
  focus: 'F OW K AH S', photo: 'F OW T OW', over: 'OW V ER', open: 'OW P AH N',

  // The number words. `expandToken` produces these from digits, so a wrong reading
  // here is a wrong mouth shape every time a figure appears in a script.
  zero: 'Z IH R OW', eleven: 'IH L EH V AH N', seventeen: 'S EH V AH N T IY N',
  nineteen: 'N AY N T IY N', seventy: 'S EH V AH N T IY', ninety: 'N AY N T IY',
  thousand: 'TH AW Z AH N D', million: 'M IH L Y AH N', billion: 'B IH L Y AH N',
  minus: 'M AY N AH S', second: 'S EH K AH N D', ninth: 'N AY N TH',
  twentieth: 'T W EH N T IY AH TH', hundredth: 'HH AH N D R AH D TH',
  degrees: 'D IH G R IY Z', celsius: 'S EH L S IY AH S',
  fahrenheit: 'F EH R AH N HH AY T', euros: 'Y UH R OW Z', euro: 'Y UH R OW',

  here: 'HH IH R', welcome: 'W EH L K AH M', cue: 'K Y UW', cues: 'K Y UW Z',
  voiceanimator: 'V OY S AE N IH M EY T ER',

  phoneme: 'F OW N IY M', phonemes: 'F OW N IY M Z',
  viseme: 'V IH Z IY M', visemes: 'V IH Z IY M Z',
  tongue: 'T AH NG', league: 'L IY G', vague: 'V EY G',
  sync: 'S IH NG K', hundred: 'HH AH N D R IH D', shoes: 'SH UW Z',
  // Negative contractions keep a schwa the spelling gives no clue about: `isn't` is
  // two syllables, not IH S N T.
  "don't": 'D OW N T', "won't": 'W OW N T', "can't": 'K AE N T',
  "isn't": 'IH Z AH N T', "wasn't": 'W AA Z AH N T', "aren't": 'AA R AH N T',
  "weren't": 'W ER AH N T', "hasn't": 'HH AE Z AH N T', "hadn't": 'HH AE D AH N T',
  "haven't": 'HH AE V AH N T', "doesn't": 'D AH Z AH N T', "didn't": 'D IH D AH N T',
  "couldn't": 'K UH D AH N T', "wouldn't": 'W UH D AH N T',
  "shouldn't": 'SH UH D AH N T',
  "i'm": 'AY M', "it's": 'IH T S', "that's": 'DH AE T S', "let's": 'L EH T S',
  animation: 'AE N IH M EY SH AH N', animate: 'AE N IH M EY T',

  one_: 'W AH N', okay: 'OW K EY', hello: 'HH AH L OW', hi: 'HH AY',
  yes: 'Y EH S', no: 'N OW', oh: 'OW', ah: 'AA', um: 'AH M', uh: 'AH',
  mm: 'M', hmm: 'HH M', wow: 'W AW', hey: 'HH EY', bye: 'B AY',

  // Multi-syllable words whose final -y the rules would read as AY
  reply: 'R IH P L AY', supply: 'S AH P L AY', apply: 'AH P L AY',
  deny: 'D IH N AY', rely: 'R IH L AY', july: 'JH UH L AY', imply: 'IH M P L AY',
};

/** Word -> array of phonemes. Frozen so a caller cannot corrupt it for everyone else. */
export const LEXICON = Object.freeze(
  Object.fromEntries(
    Object.entries(RAW_LEXICON)
      .filter(([word]) => !word.endsWith('_'))
      .map(([word, phones]) => [word, Object.freeze(phones.split(' '))]),
  ),
);

/* ---------------------------------------------------------------------------- *
 * The rule table
 *
 * Read left to right; at each position the first matching rule in the letter's bucket
 * wins, so longer and more specific patterns are listed first. `when` receives the
 * whole word and the text either side of the match, which is how context-sensitive
 * spellings - magic e, a silent final e, `c` before `i` - are expressed.
 * ---------------------------------------------------------------------------- */

const VOWEL_LETTERS = 'aeiou';
const CONSONANT = '[bcdfghjklmnpqrstvwxz]';

/** True at the end of the word. */
const atEnd = (c) => c.after === '';

/** True at the start of the word. */
const atStart = (c) => c.before === '';

/**
 * "Magic e": a single consonant then a final `e` (or `es`) lengthens the vowel before it.
 * `make`, `time`, `note`, `cute`, and their plurals `makes`, `times`.
 *
 * The `es` form deliberately excludes s, x and z. `-xes` in `boxes` is the *other*
 * plural spelling - a syllable added to a word that never had a magic e - and reading
 * it as one turns `boxes` into `B OW K S IH Z`.
 */
const MAGIC_E = new RegExp(`^(${CONSONANT}e|[bcdfgklmnprtvw]es)$`);
const magicE = (c) => MAGIC_E.test(c.after);

/**
 * A final `e` is silent when it follows a consonant and there is already a vowel
 * earlier in the word. `ace` yes; `the` and `she` no, which is what keeps those two
 * out of the rule table and in the lexicon only for their `DH`/`SH` onsets.
 *
 * A plural `-s` after it does not change that: `makes` is one syllable.
 */
const silentFinalE = (c) =>
  (c.after === '' || c.after === 's') &&
  /[bcdfghjklmnpqrstvwxz]$/.test(c.before) &&
  new RegExp(`[${VOWEL_LETTERS}y]`).test(c.before.slice(0, -1));

/**
 * An open syllable - a single consonant (optionally plus l or r) followed by another
 * vowel - keeps the vowel long: `table`, `lazy`, `later`, `paper`, `over`, `open`.
 */
const OPEN_SYLLABLE = new RegExp(`^${CONSONANT}[lr]?[${VOWEL_LETTERS}y]`);
const openSyllable = (c) => OPEN_SYLLABLE.test(c.after);

const nextIsVowel = (c) => new RegExp(`^[${VOWEL_LETTERS}y]`).test(c.after);
const nextIsConsonantOrEnd = (c) => !nextIsVowel(c);

/** The word has no vowel letter other than this final `y`: `my`, `try`, `sky`. */
const onlyVowelIsFinalY = (c) =>
  c.after === '' && !new RegExp(`[${VOWEL_LETTERS}]`).test(c.before);

const R = (m, p, when = null) => ({ m, p: p === '' ? [] : p.split(' '), when });

const RULES = [
  // --- a ---------------------------------------------------------------
  R('augh', 'AO'),
  R('aigh', 'EY'),
  R('ation', 'EY SH AH N'),
  R('ator', 'EY T ER', atEnd),
  R('able', 'AH B AH L', (c) => atEnd(c) && c.before.length >= 3),
  R('ance', 'AH N S', atEnd),
  R('ence', 'AH N S', atEnd),
  R('age', 'IH JH', (c) => atEnd(c) && c.before.length >= 2),
  R('al', 'AH L', (c) => atEnd(c) && c.before.length >= 3),
  R('all', 'AO L'),
  R('alk', 'AO K'),
  R('alm', 'AA M'),
  R('air', 'EH R'),
  R('are', 'EH R', atEnd),
  R('ai', 'EY'),
  R('ay', 'EY'),
  R('au', 'AO'),
  R('aw', 'AO'),
  R('ar', 'ER', (c) => (atEnd(c) || c.after === 's') && c.before.length >= 3),
  R('ar', 'AA R', nextIsConsonantOrEnd),
  R('a', 'EY', magicE),
  // An unstressed opening `a-`: about, around, above, alone, ago, apart.
  R('a', 'AH', (c) => atStart(c) && openSyllable(c)),
  R('a', 'EY', openSyllable),
  R('a', 'AH', (c) => atEnd(c) && c.before.length > 0),
  R('a', 'AE'),

  // --- b ---------------------------------------------------------------
  R('bb', 'B'),
  R('b', '', (c) => atEnd(c) && c.before.endsWith('m')),   // lamb, comb, thumb
  R('b', 'B'),

  // --- c ---------------------------------------------------------------
  R('cious', 'SH AH S'),
  R('cial', 'SH AH L'),
  R('cion', 'SH AH N'),
  R('ch', 'CH'),
  R('ck', 'K'),
  R('cc', 'K S', (c) => /^[eiy]/.test(c.after)),
  R('cc', 'K'),
  R('ce', 'S', atEnd),
  R('c', 'S', (c) => /^[eiy]/.test(c.after)),
  R('c', 'K'),

  // --- d ---------------------------------------------------------------
  R('dge', 'JH'),
  R('dd', 'D'),
  // Past tense: `-ed` is a whole syllable only after t or d.
  R('ed', 'IH D', (c) => atEnd(c) && /[td]$/.test(c.before)),
  R('ed', 'D', (c) => atEnd(c) && c.before.length >= 2),
  R('d', 'D'),

  // --- e ---------------------------------------------------------------
  R('eigh', 'EY'),
  R('ear', 'IH R'),
  R('ee', 'IY'),
  R('ea', 'IY'),
  R('ei', 'EY'),
  R('eu', 'Y UW'),
  R('ew', 'UW'),
  R('ey', 'IY'),
  // `-es` as an added syllable: boxes, houses, watches. Must be tried before the
  // bare `e` rules, or it is read as EH + S.
  R('es', 'IH Z', (c) => atEnd(c) && /(s|x|z|ch|sh)$/.test(c.before)),
  // Unstressed final syllables: open, listen, vowel, level.
  R('en', 'AH N', (c) => atEnd(c) && c.before.length >= 2),
  R('el', 'AH L', (c) => atEnd(c) && c.before.length >= 2),
  R('er', 'EH R', nextIsVowel),
  R('er', 'ER'),
  R('e', '', silentFinalE),
  R('e', 'IY', magicE),
  R('e', 'EH'),

  // --- f ---------------------------------------------------------------
  R('ff', 'F'),
  R('ful', 'F AH L', atEnd),
  R('f', 'F'),

  // --- g ---------------------------------------------------------------
  R('ght', 'T'),
  R('gh', 'G', atStart),
  R('gh', ''),                                              // through, night, weigh
  R('gn', 'N', atStart),
  R('gg', 'G'),
  R('ge', 'JH', atEnd),
  R('g', 'G'),

  // --- h ---------------------------------------------------------------
  R('h', 'HH'),

  // --- i ---------------------------------------------------------------
  R('igh', 'AY'),
  R('ious', 'IY AH S'),
  R('ion', 'AH N'),
  R('ing', 'IH NG', atEnd),
  R('ind', 'AY N D', atEnd),
  R('ild', 'AY L D', atEnd),
  R('ie', 'IY', (c) => atEnd(c) && c.before.length >= 3),
  R('ie', 'AY', atEnd),
  R('ir', 'ER', nextIsConsonantOrEnd),
  R('i', 'AY', magicE),
  R('i', 'AY', atEnd),
  R('i', 'IH'),

  // --- j ---------------------------------------------------------------
  R('j', 'JH'),

  // --- k ---------------------------------------------------------------
  R('kn', 'N', atStart),
  R('kk', 'K'),
  R('k', 'K'),

  // --- l ---------------------------------------------------------------
  R('le', 'AH L', (c) => atEnd(c) && /[bcdfgkpstz]$/.test(c.before)),
  R('ll', 'L'),
  R('l', 'L'),

  // --- m ---------------------------------------------------------------
  R('mm', 'M'),
  R('ment', 'M AH N T', atEnd),
  R('mn', 'M', atEnd),                                      // column, autumn
  R('m', 'M'),

  // --- n ---------------------------------------------------------------
  R('ness', 'N AH S', atEnd),
  R('ng', 'NG'),
  R('nk', 'NG K'),
  R('nn', 'N'),
  R('n', 'N'),

  // --- o ---------------------------------------------------------------
  R('ough', 'AO'),
  R('ould', 'UH D'),
  R('ous', 'AH S', atEnd),
  R('oo', 'UW'),
  R('oa', 'OW'),
  R('oi', 'OY'),
  R('oy', 'OY'),
  R('oe', 'OW', atEnd),
  R('own', 'OW N', atEnd),
  R('ow', 'OW', atEnd),
  R('ow', 'AW'),
  R('our', 'AO R', (c) => !atEnd(c)),
  R('ou', 'AW'),
  R('old', 'OW L D', atEnd),
  R('or', 'AO R', nextIsConsonantOrEnd),
  R('on', 'AH N', (c) => atEnd(c) && c.before.length >= 3),
  R('o', 'OW', magicE),
  R('o', 'OW', atEnd),
  R('o', 'OW', (c) => atStart(c) && openSyllable(c)),   // over, open, obey
  R('o', 'AA'),

  // --- p ---------------------------------------------------------------
  R('ph', 'F'),
  R('ps', 'S', atStart),
  R('pp', 'P'),
  R('p', 'P'),

  // --- q ---------------------------------------------------------------
  R('qu', 'K W'),
  R('q', 'K'),

  // --- r ---------------------------------------------------------------
  R('rr', 'R'),
  R('r', 'R'),

  // --- s ---------------------------------------------------------------
  R('ssion', 'SH AH N'),
  R('sion', 'ZH AH N'),
  R('sure', 'ZH ER', atEnd),
  R('sh', 'SH'),
  R('sc', 'S', (c) => /^[eiy]/.test(c.after)),
  R('ss', 'S'),
  R('se', 'S', atEnd),
  R('s', 'S'),

  // --- t ---------------------------------------------------------------
  R('tion', 'SH AH N'),
  R('tious', 'SH AH S'),
  R('tial', 'SH AH L'),
  R('tch', 'CH'),
  R('ture', 'CH ER', atEnd),
  R('th', 'TH'),
  R('tt', 'T'),
  R('t', 'T'),

  // --- u ---------------------------------------------------------------
  R('ur', 'ER', nextIsConsonantOrEnd),
  R('ue', 'UW', atEnd),                                   // blue, true, value
  R('uy', 'AY'),
  R('ui', 'UW'),
  R('u', 'Y UW', (c) => magicE(c) && /[bcfghkmpv]$/.test(c.before)),
  R('u', 'UW', magicE),
  R('u', 'AH'),

  // --- v ---------------------------------------------------------------
  R('v', 'V'),

  // --- w ---------------------------------------------------------------
  R('wr', 'R', atStart),
  R('wh', 'W'),
  R('w', 'W'),

  // --- x ---------------------------------------------------------------
  R('x', 'Z', atStart),
  R('x', 'K S'),

  // --- y ---------------------------------------------------------------
  R('y', 'Y', atStart),
  R('y', 'AY', magicE),
  R('y', 'AY', (c) => /^[bcdfghjklmnpqrstvwxz]le$/.test(c.after)),
  R('y', 'AY', onlyVowelIsFinalY),
  R('y', 'IY', atEnd),
  R('y', 'IH'),

  // --- z ---------------------------------------------------------------
  R('zz', 'Z'),
  R('z', 'Z'),
];

/** Bucketed by first letter, order preserved, so a lookup touches ~15 rules not ~180. */
const RULE_INDEX = (() => {
  const index = new Map();
  for (const rule of RULES) {
    const key = rule.m[0];
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(rule);
  }
  return index;
})();

/* ---------------------------------------------------------------------------- *
 * Post-processing
 *
 * Two English rules that are about the *sounds* either side, not the letters, so they
 * cannot be expressed in the table above.
 * ---------------------------------------------------------------------------- */

const SIBILANTS = new Set(['S', 'Z', 'SH', 'ZH', 'CH', 'JH']);

/**
 * A final `-s` is voiced after a voiced sound: `dogs` ends in Z, `cats` ends in S.
 * Not applied after a sibilant, where the spelling would have been `-es` anyway.
 */
function voiceFinalS(phonemes, word) {
  if (!word.endsWith('s') || phonemes.length < 2) return phonemes;
  const last = phonemes[phonemes.length - 1];
  const prev = phonemes[phonemes.length - 2];
  if (last !== 'S' || SIBILANTS.has(prev) || !isVoiced(prev)) return phonemes;
  return [...phonemes.slice(0, -1), 'Z'];
}

/** A final `-ed` devoices after a voiceless sound: `walked` ends in T, `played` in D. */
function devoiceFinalED(phonemes, word) {
  if (!word.endsWith('ed') || phonemes.length < 2) return phonemes;
  const last = phonemes[phonemes.length - 1];
  const prev = phonemes[phonemes.length - 2];
  if (last !== 'D' || isVoiced(prev)) return phonemes;
  return [...phonemes.slice(0, -1), 'T'];
}

/** Two identical phonemes in a row are one held sound, not two. */
export function collapseRepeats(phonemes) {
  const out = [];
  for (const p of phonemes) if (p !== out[out.length - 1]) out.push(p);
  return out;
}

/* ---------------------------------------------------------------------------- *
 * The public entry point
 * ---------------------------------------------------------------------------- */

/** Strip everything that is not a letter or an internal apostrophe, and lowercase. */
export function normaliseWord(word) {
  return String(word ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z']/g, '')
    .replace(/^'+|'+$/g, '');
}

/**
 * Predict the phonemes of a single word.
 *
 * @param {string} word
 * @param {object} [options]
 * @param {Record<string, string[]|string>} [options.overrides] user corrections, checked
 *        before the built-in lexicon so a project can always win
 * @returns {{ phonemes: string[], source: 'override'|'lexicon'|'rules'|'empty' }}
 */
export function wordToPhonemes(word, { overrides = {} } = {}) {
  const clean = normaliseWord(word);
  if (!clean) return { phonemes: [], source: 'empty' };

  const override = overrides[clean];
  if (override) {
    const list = Array.isArray(override) ? override : String(override).split(/\s+/);
    const valid = list.filter((p) => Object.hasOwn(PHONEMES, p));
    if (valid.length) return { phonemes: valid, source: 'override' };
  }

  if (LEXICON[clean]) return { phonemes: [...LEXICON[clean]], source: 'lexicon' };

  // Contractions: pronounce the stem and append the clitic, rather than letting the
  // apostrophe fall out of normalisation and produce `dont` -> D AA N T.
  const letters = clean.replace(/'/g, '');
  const contraction = matchContraction(clean, overrides);
  if (contraction) return { phonemes: contraction, source: 'rules' };

  let phonemes = [];
  let i = 0;
  while (i < letters.length) {
    const bucket = RULE_INDEX.get(letters[i]);
    let matched = null;

    if (bucket) {
      for (const rule of bucket) {
        if (!letters.startsWith(rule.m, i)) continue;
        const context = {
          word: letters,
          i,
          before: letters.slice(0, i),
          after: letters.slice(i + rule.m.length),
        };
        if (rule.when && !rule.when(context)) continue;
        matched = rule;
        break;
      }
    }

    if (matched) {
      phonemes.push(...matched.p);
      i += matched.m.length;
    } else {
      // An unknown letter is skipped rather than allowed to stall the scan.
      i += 1;
    }
  }

  phonemes = voiceFinalS(phonemes, letters);
  phonemes = devoiceFinalED(phonemes, letters);
  phonemes = collapseRepeats(phonemes);

  // A word must always produce a mouth movement. Falling through to silence would
  // make the character stop moving mid-sentence for no visible reason.
  if (!phonemes.length) phonemes = ['AH'];

  return { phonemes, source: 'rules' };
}

const CLITICS = {
  "'s": ['Z'], "'re": ['ER'], "'ve": ['V'], "'ll": ['L'], "'d": ['D'], "'m": ['M'],
};

/** `don't` -> `do` + `n't`; `we'll` -> `we` + `'ll`. */
function matchContraction(clean, overrides) {
  if (!clean.includes("'")) return null;

  // `can't` is `can` + `t`, not `ca` + `n't`: the apostrophe stands in for the `o` of
  // `not`, so the `n` belongs to the stem. Dropping it gives `ca` -> K AH.
  if (clean.endsWith("n't")) {
    const stem = `${clean.slice(0, -3)}n`;
    if (stem.length < 2) return null;
    const base = wordToPhonemes(stem, { overrides }).phonemes;
    return base.length ? collapseRepeats([...base, 'T']) : null;
  }

  for (const [suffix, phones] of Object.entries(CLITICS)) {
    if (!clean.endsWith(suffix)) continue;
    const stem = clean.slice(0, -suffix.length);
    if (!stem) return null;
    const base = wordToPhonemes(stem, { overrides }).phonemes;
    if (!base.length) return null;
    // `it's` is T + S, not T + Z: the clitic devoices like any other final -s.
    const tail = suffix === "'s" && !isVoiced(base[base.length - 1]) ? ['S'] : phones;
    return collapseRepeats([...base, ...tail]);
  }
  return null;
}

/** Turn a phoneme array back into the space-separated form used in overrides and exports. */
export const phonemesToString = (phonemes) => phonemes.join(' ');

/** Read an override string, keeping only phonemes that actually exist. */
export function parsePhonemeString(text) {
  return String(text ?? '')
    .toUpperCase()
    .split(/[\s,]+/)
    .map((p) => (p === 'SIL' ? 'sil' : p))
    .filter((p) => Object.hasOwn(PHONEMES, p));
}
