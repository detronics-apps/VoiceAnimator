/**
 * Reading the script.
 *
 * Pure: no DOM, no globals.
 *
 * Three jobs, in this order:
 *
 *   1. Tokenise the text into words, punctuation pauses and `[cue]` markers.
 *   2. Expand anything that is written but not spoken - `3.5`, `£20`, `Dr`, `USB` -
 *      into the words a person would actually say.
 *   3. Keep the character offsets of the original text on every token, so the UI can
 *      highlight the word being spoken in the box the user typed it into.
 *
 * Point 3 is why expansion happens *inside* a token rather than by rewriting the text
 * first. `1990` becomes two spoken words but stays one four-character span on screen.
 */

/* ---------------------------------------------------------------------------- *
 * Numbers
 * ---------------------------------------------------------------------------- */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen'];

const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety'];

const SCALES = [
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

/** Under a hundred, where English stops being regular. */
function tensToWords(n) {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const unit = n % 10;
  return unit ? `${tens}-${ONES[unit]}` : tens;
}

/**
 * A whole number in words, British style - `one hundred and five`, not `one hundred five`.
 *
 * @param {number} n a non-negative integer below one trillion
 * @returns {string}
 */
export function numberToWords(n) {
  const value = Math.trunc(Math.abs(Number(n)));
  if (!Number.isFinite(value)) return '';
  if (value === 0) return 'zero';
  if (value >= 1e12) return String(value).split('').map((d) => ONES[Number(d)]).join(' ');

  const parts = [];
  let remainder = value;

  for (const [size, name] of SCALES) {
    if (remainder < size) continue;
    const count = Math.floor(remainder / size);
    parts.push(`${numberToWords(count)} ${name}`);
    remainder -= count * size;
  }

  if (remainder >= 100) {
    const hundreds = Math.floor(remainder / 100);
    parts.push(`${ONES[hundreds]} hundred`);
    remainder -= hundreds * 100;
  }

  if (remainder > 0) {
    // The `and` only appears when there is something after a hundred or a thousand.
    if (parts.length) parts.push('and');
    parts.push(tensToWords(remainder));
  }

  return (Number(n) < 0 ? `minus ${parts.join(' ')}` : parts.join(' ')).trim();
}

const ORDINAL_ONES = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth',
  nine: 'ninth', twelve: 'twelfth',
};

/** `3` -> `third`. Built from the cardinal, so it inherits all of its structure. */
export function ordinalToWords(n) {
  const cardinal = numberToWords(n);
  const words = cardinal.split(' ');
  const last = words[words.length - 1];
  const pieces = last.split('-');
  const tail = pieces[pieces.length - 1];

  let ordinal;
  if (ORDINAL_ONES[tail]) ordinal = ORDINAL_ONES[tail];
  else if (tail.endsWith('y')) ordinal = `${tail.slice(0, -1)}ieth`;
  else ordinal = `${tail}th`;

  pieces[pieces.length - 1] = ordinal;
  words[words.length - 1] = pieces.join('-');
  return words.join(' ');
}

/**
 * A four-digit year the way it is read aloud: `1990` is *nineteen ninety*, not
 * *one thousand nine hundred and ninety*. Only applied to plausible years.
 */
function yearToWords(n) {
  if (n < 1100 || n > 2099) return null;
  const high = Math.floor(n / 100);
  const low = n % 100;
  if (low === 0) return `${numberToWords(high)} hundred`;
  if (high === 20 && low < 10) return `two thousand and ${numberToWords(low)}`;
  if (low < 10) return `${numberToWords(high)} oh ${numberToWords(low)}`;
  return `${numberToWords(high)} ${tensToWords(low)}`;
}

const CURRENCY = { $: 'dollars', '£': 'pounds', '€': 'euros', '¥': 'yen' };
const CURRENCY_SINGULAR = { $: 'dollar', '£': 'pound', '€': 'euro', '¥': 'yen' };

/* ---------------------------------------------------------------------------- *
 * Abbreviations and acronyms
 *
 * Only entries that are unambiguous. `St` could be street or saint and is therefore
 * absent: a wrong expansion is worse than none, because the user can see and fix a
 * word that was left alone.
 * ---------------------------------------------------------------------------- */

export const ABBREVIATIONS = Object.freeze({
  mr: 'mister', mrs: 'missus', ms: 'miz', dr: 'doctor', prof: 'professor',
  vs: 'versus', etc: 'etcetera', approx: 'approximately', min: 'minutes',
  max: 'maximum', fig: 'figure', ref: 'reference', dept: 'department',
  '&': 'and', '+': 'plus', '=': 'equals', '@': 'at', '%': 'percent',
  '°': 'degrees', '#': 'number',
});

/**
 * Acronyms said letter by letter. Deliberately a fixed list rather than a rule:
 * "spell out anything in capitals" turns a shouted THIS IS IMPORTANT into
 * *tee aitch eye ess*.
 */
export const ACRONYMS = Object.freeze({
  usb: 'you ess bee', led: 'ell ee dee', pcb: 'pee see bee', ic: 'eye see',
  dc: 'dee see', ac: 'ay see', pwm: 'pee double-you em', rgb: 'ar gee bee',
  api: 'ay pee eye', url: 'you ar ell', html: 'aitch tee em ell',
  css: 'see ess ess', pdf: 'pee dee eff', gps: 'gee pee ess',
  lcd: 'ell see dee', oled: 'oh ell ee dee', psu: 'pee ess you',
  rms: 'ar em ess', emi: 'ee em eye', esd: 'ee ess dee', rf: 'ar eff',
  ir: 'eye ar', uv: 'you vee', cad: 'kad', cnc: 'see en see',
  smd: 'ess em dee', mcu: 'em see you', spi: 'ess pee eye',
  uart: 'you art', gnd: 'ground', vcc: 'vee see see', pi: 'pie',
  ai: 'ay eye', svg: 'ess vee gee', png: 'pee en gee', json: 'jayson',
  fps: 'eff pee ess', wpm: 'double-you pee em',
});

/* ---------------------------------------------------------------------------- *
 * Expanding one written token into spoken words
 * ---------------------------------------------------------------------------- */

/** Quotes, brackets and trailing punctuation are written, not spoken. */
const EDGE_NOISE = /[^\p{L}\p{N}$£€¥#&+@%°]+/u;
const stripEdges = (token) => token
  .replace(new RegExp(`^${EDGE_NOISE.source}`, 'u'), '')
  .replace(new RegExp(`${EDGE_NOISE.source}$`, 'u'), '');

/**
 * @param {string} raw one whitespace-delimited chunk of the script
 * @returns {string[]} the words a person would say for it, possibly none
 */
export function expandToken(raw) {
  const token = stripEdges(String(raw ?? ''));
  if (!token) return [];

  // A hyphenated or slashed compound is two words with a join in the middle.
  if (/[\p{L}\p{N}][-/][\p{L}\p{N}]/u.test(token)) {
    return token.split(/[-/]+/).flatMap(expandToken);
  }

  const lower = token.toLowerCase().replace(/\.$/, '');

  if (Object.hasOwn(ABBREVIATIONS, lower)) return ABBREVIATIONS[lower].split(' ');
  if (Object.hasOwn(ACRONYMS, lower) && token === token.toUpperCase()) {
    return ACRONYMS[lower].split(' ');
  }

  // Currency: the symbol is read after the amount, and pence/cents are a bare number.
  const money = token.match(/^([$£€¥])\s?([\d,]+)(?:\.(\d{1,2}))?$/);
  if (money) {
    const [, symbol, whole, fraction] = money;
    const amount = Number(whole.replace(/,/g, ''));
    const unit = amount === 1 && !fraction ? CURRENCY_SINGULAR[symbol] : CURRENCY[symbol];
    const words = [...numberToWords(amount).split(' '), unit];
    if (fraction) words.push(...numberToWords(Number(fraction.padEnd(2, '0'))).split(' '));
    return words;
  }

  const percent = token.match(/^([\d,.]+)\s?%$/);
  if (percent) return [...expandToken(percent[1]), 'percent'];

  const degrees = token.match(/^([\d,.]+)\s?°([cf])?$/i);
  if (degrees) {
    const words = [...expandToken(degrees[1]), 'degrees'];
    if (degrees[2]) words.push(degrees[2].toLowerCase() === 'c' ? 'celsius' : 'fahrenheit');
    return words;
  }

  const ordinal = token.match(/^(\d+)(st|nd|rd|th)$/i);
  if (ordinal) return ordinalToWords(Number(ordinal[1])).split(/[\s-]+/);

  const decimal = token.match(/^([\d,]+)\.(\d+)$/);
  if (decimal) {
    const whole = numberToWords(Number(decimal[1].replace(/,/g, '')));
    const digits = decimal[2].split('').map((d) => ONES[Number(d)]);
    return [...whole.split(/[\s-]+/), 'point', ...digits];
  }

  const integer = token.match(/^[\d,]+$/);
  if (integer) {
    const value = Number(token.replace(/,/g, ''));
    // A bare four-digit number with no thousands separator is usually a year.
    const asYear = !token.includes(',') && token.length === 4 ? yearToWords(value) : null;
    return (asYear ?? numberToWords(value)).split(/[\s-]+/);
  }

  // A number stuck to a unit: `5v`, `100n`, `24fps`.
  const measured = token.match(/^([\d,.]+)([\p{L}]+)$/u);
  if (measured) return [...expandToken(measured[1]), ...expandToken(measured[2])];

  // Letters with digits mixed in, `R2D2` style: read each run separately.
  if (/\d/.test(token) && /\p{L}/u.test(token)) {
    return token.match(/\d+|[\p{L}']+/gu)?.flatMap(expandToken) ?? [];
  }

  return [token.toLowerCase()];
}

/* ---------------------------------------------------------------------------- *
 * Cue markers
 * ---------------------------------------------------------------------------- */

/** `[pause]` with no number lasts this long. */
export const DEFAULT_MARKER_PAUSE = 0.4;

const EXPRESSION_NAMES = new Set(['angry', 'smile', 'happy', 'sad', 'laughing', 'laugh',
  'neutral', 'rest']);

/**
 * @returns {{kind:'pause', seconds:number}
 *          |{kind:'expression', name:string}
 *          |{kind:'character', name:string}
 *          |null}
 */
export function parseMarker(body) {
  const text = String(body ?? '').trim().toLowerCase();
  if (!text) return null;

  // `[as bob]` hands the rest of the script to another character, so one script can be
  // a two-hander. The name is matched against the character library, forgivingly.
  const speaker = text.match(/^as\s+(.{1,60})$/);
  if (speaker) return { kind: 'character', name: speaker[1].trim() };

  const pause = text.match(/^(?:pause|wait|beat)(?:\s+([\d.]+)\s*(m?s)?)?$/);
  if (pause) {
    let seconds = DEFAULT_MARKER_PAUSE;
    if (pause[1] !== undefined) {
      const value = Number(pause[1]);
      if (Number.isFinite(value)) seconds = pause[2] === 'ms' ? value / 1000 : value;
    }
    return { kind: 'pause', seconds: Math.max(0, Math.min(60, seconds)) };
  }

  if (EXPRESSION_NAMES.has(text)) return { kind: 'expression', name: text };
  return null;
}

/* ---------------------------------------------------------------------------- *
 * The scanner
 * ---------------------------------------------------------------------------- */

const SENTENCE_END = new Set(['.', '!', '?', '…']);
const CLAUSE_END = new Set([',', ';', ':', '—', '–']);

const isWordChar = (ch) => /[\p{L}\p{N}'’$£€¥%°#&+@/-]/u.test(ch);

/**
 * Read a script into a flat token stream.
 *
 * Every token carries `start` and `end` offsets into the original text, so the player
 * can highlight the exact characters being spoken - including for a word whose spoken
 * form has more words in it than the writing does.
 *
 * @param {string} text
 * @returns {{tokens: object[], warnings: object[], wordCount: number, lineCount: number, spokenWordCount: number}}
 */
export function parseScript(text) {
  const source = String(text ?? '');
  const tokens = [];
  const warnings = [];

  let i = 0;
  let line = 0;
  let wordIndex = 0;
  let sawWordOnLine = false;
  let blankRun = 0;

  const lastToken = () => tokens[tokens.length - 1];

  /** Punctuation and line breaks never stack up into a silent eternity. */
  const pushPause = (cause, seconds = null, start = i, end = i + 1) => {
    const previous = lastToken();
    if (!previous || previous.type !== 'word') {
      // Two pauses in a row: keep whichever is the longer rest.
      if (previous?.type === 'pause') {
        const rank = { clause: 1, sentence: 2, line: 3, paragraph: 4, marker: 5 };
        if ((rank[cause] ?? 0) > (rank[previous.cause] ?? 0)) {
          previous.cause = cause;
          previous.seconds = seconds;
          previous.end = end;
        }
        return;
      }
      if (!previous) return;      // never open a script with a pause
    }
    tokens.push({ type: 'pause', cause, seconds, line, start, end });
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === '\n') {
      if (sawWordOnLine) {
        blankRun = 0;
      } else {
        blankRun += 1;
      }
      pushPause(blankRun > 0 ? 'paragraph' : 'line', null, i, i + 1);
      line += 1;
      sawWordOnLine = false;
      i += 1;
      continue;
    }

    if (/\s/.test(ch)) { i += 1; continue; }

    if (ch === '[') {
      const close = source.indexOf(']', i);
      if (close === -1) {
        warnings.push({ type: 'unclosed-marker', text: source.slice(i, i + 20), line });
        i += 1;
        continue;
      }
      const body = source.slice(i + 1, close);
      const marker = parseMarker(body);
      if (!marker) {
        warnings.push({ type: 'unknown-marker', text: `[${body}]`, line });
      } else if (marker.kind === 'pause') {
        tokens.push({ type: 'pause', cause: 'marker', seconds: marker.seconds, line, start: i, end: close + 1 });
      } else if (marker.kind === 'character') {
        tokens.push({ type: 'character', name: marker.name, line, start: i, end: close + 1 });
      } else {
        tokens.push({ type: 'expression', name: marker.name, line, start: i, end: close + 1 });
      }
      i = close + 1;
      continue;
    }

    if (SENTENCE_END.has(ch)) {
      const start = i;
      while (i < source.length && SENTENCE_END.has(source[i])) i += 1;
      pushPause('sentence', null, start, i);
      continue;
    }

    if (CLAUSE_END.has(ch)) {
      pushPause('clause', null, i, i + 1);
      i += 1;
      continue;
    }

    if (isWordChar(ch)) {
      const start = i;
      while (i < source.length) {
        if (isWordChar(source[i])) { i += 1; continue; }
        // `.` and `,` are sentence punctuation everywhere except between two digits,
        // where they are part of the number: `3.5`, `1,000`.
        const betweenDigits = (source[i] === '.' || source[i] === ',') &&
          /\d/.test(source[i - 1] ?? '') && /\d/.test(source[i + 1] ?? '');
        if (!betweenDigits) break;
        i += 1;
      }

      const raw = source.slice(start, i);
      const words = expandToken(raw);

      // A run of nothing but dashes is a dash, and a dash is a beat.
      if (!words.length && /^[-/]+$/.test(raw)) pushPause('clause', null, start, i);

      if (words.length) {
        tokens.push({ type: 'word', raw, words, line, index: wordIndex, start, end: i });
        wordIndex += 1;
        sawWordOnLine = true;
        blankRun = 0;
      }
      continue;
    }

    i += 1;                                   // quotes, brackets, anything else
  }

  // A trailing pause animates nothing.
  while (tokens.length && tokens[tokens.length - 1].type === 'pause') tokens.pop();

  return {
    tokens,
    warnings,
    wordCount: tokens.filter((t) => t.type === 'word').length,
    spokenWordCount: tokens.reduce((n, t) => n + (t.type === 'word' ? t.words.length : 0), 0),
    lineCount: source.length ? source.split('\n').length : 0,
  };
}
