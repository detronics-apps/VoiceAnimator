/**
 * Visemes: which mouth shape you draw for which sound.
 *
 * Pure: no DOM, no globals.
 *
 * A viseme is the *visual* unit of speech. There are around forty phonemes in English
 * and only a handful of distinguishable mouth shapes, because the tongue does most of
 * the work and the camera cannot see it. `P`, `B` and `M` are three different sounds
 * and one identical picture - which is exactly why lip sync is tractable at all.
 *
 * Two schemes ship:
 *
 *   `rhubarb` - the nine shapes A-H plus X used by Rhubarb Lip Sync. If you already
 *               have artwork drawn for Rhubarb, or you want to hand a track to a tool
 *               that expects it, use this one.
 *   `chart`   - the sixteen-pose sheet: twelve mouths labelled by the letters that
 *               produce them, plus four expressions. This is the layout hand-drawn
 *               character sheets normally come in, so it is the default.
 *
 * Each viseme also carries a `shape` - seven numbers between 0 and 1 describing how the
 * mouth is held. That is what lets the app draw a working default set before you have
 * any artwork at all, and it keeps the renderer free of any per-viseme special cases.
 */

/**
 * @typedef {object} Shape
 * @property {number} open     how far the jaw is dropped
 * @property {number} width    corner-to-corner, narrow (puckered) to wide (spread)
 * @property {number} round    how rounded the lips are
 * @property {number} teeth    how much of the upper teeth shows
 * @property {number} tongue   how visible the tongue is
 * @property {number} lipBite  upper teeth resting on the lower lip - F and V only
 * @property {number} corner   corners of the mouth: 0 turned down, 0.5 level, 1 up
 */

const shape = (open, width, round, teeth = 0, tongue = 0, lipBite = 0, corner = 0.5) =>
  ({ open, width, round, teeth, tongue, lipBite, corner });

/* ---------------------------------------------------------------------------- *
 * Scheme 1: Rhubarb Lip Sync, A-H plus X
 * ---------------------------------------------------------------------------- */

const RHUBARB_VISEMES = [
  { id: 'A', label: 'A', title: 'Closed', letters: 'P B M', kind: 'mouth',
    note: 'Lips pressed together. The one shape you must never skip - a missing closed mouth on a P reads as a dubbing error.',
    shape: shape(0.00, 0.50, 0.15) },
  { id: 'B', label: 'B', title: 'Slightly open, teeth together', letters: 'K S T EE', kind: 'mouth',
    note: 'The default consonant shape, and the one most frames land on.',
    shape: shape(0.24, 0.62, 0.05, 0.75) },
  { id: 'C', label: 'C', title: 'Open', letters: 'EH AE', kind: 'mouth',
    note: 'A relaxed open vowel.',
    shape: shape(0.45, 0.62, 0.05, 0.30) },
  { id: 'D', label: 'D', title: 'Wide open', letters: 'AA', kind: 'mouth',
    note: 'The widest jaw drop in the set.',
    shape: shape(0.85, 0.58, 0.10, 0.15, 0.35) },
  { id: 'E', label: 'E', title: 'Slightly rounded', letters: 'AO ER', kind: 'mouth',
    note: 'Rounded but not puckered.',
    shape: shape(0.42, 0.40, 0.65, 0.10) },
  { id: 'F', label: 'F', title: 'Puckered', letters: 'UW OW W', kind: 'mouth',
    note: 'Lips pushed forward into a small circle.',
    shape: shape(0.28, 0.22, 1.00) },
  { id: 'G', label: 'G', title: 'Teeth on lip', letters: 'F V', kind: 'mouth',
    note: 'Extended shape. Optional in Rhubarb, but F and V are obvious when they are missing.',
    shape: shape(0.14, 0.58, 0.05, 0.85, 0, 1) },
  { id: 'H', label: 'H', title: 'Tongue up', letters: 'L', kind: 'mouth',
    note: 'Extended shape. The tongue touches the ridge behind the upper teeth.',
    shape: shape(0.42, 0.55, 0.10, 0.35, 1.0) },
  { id: 'X', label: 'X', title: 'Rest', letters: 'silence', kind: 'mouth',
    note: 'The idle pose held between lines. Rhubarb calls this the rest position.',
    shape: shape(0.04, 0.52, 0.12) },
];

const RHUBARB_MAP = {
  // Vowels
  AA: 'D', AE: 'C', AH: 'C', AO: 'E', EH: 'C', ER: 'E', IH: 'B', IY: 'B',
  UH: 'F', UW: 'F',
  // Diphthongs take the shape of where the mouth starts
  AW: 'D', AY: 'C', EY: 'C', OW: 'F', OY: 'E',
  // Bilabials - the shape that matters most
  B: 'A', M: 'A', P: 'A',
  // Labiodentals
  F: 'G', V: 'G',
  // Tongue-up
  L: 'H',
  // Rounded glide
  W: 'F',
  // Everything else the camera cannot distinguish
  CH: 'B', JH: 'B', SH: 'B', ZH: 'B',
  D: 'B', DH: 'B', G: 'B', HH: 'B', K: 'B', N: 'B', NG: 'B',
  R: 'B', S: 'B', T: 'B', TH: 'B', Y: 'B', Z: 'B',
  // Silence
  sil: 'X',
};

/* ---------------------------------------------------------------------------- *
 * Scheme 2: the sixteen-pose character sheet
 *
 * Twelve mouths labelled by the letters that produce them, in the order they appear
 * on the sheet, then the four expressions. Expressions are not driven by phonemes -
 * they are cued from the script with `[smile]`, `[angry]` and so on.
 * ---------------------------------------------------------------------------- */

const CHART_VISEMES = [
  { id: 'O', label: 'O', title: 'Rounded open', letters: 'O', kind: 'mouth',
    note: 'A round open vowel.',
    shape: shape(0.55, 0.30, 0.95, 0.05) },
  { id: 'CONS', label: 'C D G K N', title: 'Teeth together', letters: 'C D G K N S T X Y Z', kind: 'mouth',
    note: 'The workhorse consonant shape. Most frames of most lines land here.',
    shape: shape(0.24, 0.64, 0.05, 0.80) },
  { id: 'MBP', label: 'B M P', title: 'Closed', letters: 'B M P', kind: 'mouth',
    note: 'Lips pressed together. Also serves as the rest pose for this set.',
    shape: shape(0.00, 0.52, 0.15) },
  { id: 'AEI', label: 'A E I', title: 'Wide open', letters: 'A E I', kind: 'mouth',
    note: 'The open vowel. The biggest jaw drop on the sheet.',
    shape: shape(0.85, 0.60, 0.10, 0.20, 0.35) },
  { id: 'QW', label: 'Q W', title: 'Puckered', letters: 'Q W', kind: 'mouth',
    note: 'Lips pushed forward.',
    shape: shape(0.30, 0.22, 1.00) },
  { id: 'EE', label: 'EE', title: 'Spread, teeth showing', letters: 'EE', kind: 'mouth',
    note: 'A wide smile-like spread with the teeth apart.',
    shape: shape(0.30, 0.90, 0.00, 0.90, 0, 0, 0.66) },
  { id: 'U', label: 'U', title: 'Small round', letters: 'U', kind: 'mouth',
    note: 'Tighter and higher than O.',
    shape: shape(0.34, 0.26, 0.90, 0.05) },
  { id: 'CHSHJ', label: 'CH SH J', title: 'Forward, teeth together', letters: 'CH SH J', kind: 'mouth',
    note: 'Lips pushed slightly forward with the teeth close.',
    shape: shape(0.26, 0.42, 0.55, 0.70) },
  { id: 'L', label: 'L', title: 'Tongue up', letters: 'L', kind: 'mouth',
    note: 'The tongue touches behind the upper teeth. Worth having: L is very visible.',
    shape: shape(0.44, 0.56, 0.10, 0.35, 1.0) },
  { id: 'FV', label: 'F V', title: 'Teeth on lip', letters: 'F V', kind: 'mouth',
    note: 'Upper teeth resting on the lower lip.',
    shape: shape(0.14, 0.60, 0.05, 0.90, 0, 1) },
  { id: 'R', label: 'R', title: 'Rounded, tense', letters: 'R', kind: 'mouth',
    note: 'Slightly rounded and pulled back.',
    shape: shape(0.34, 0.44, 0.60, 0.25) },
  { id: 'TH', label: 'TH', title: 'Tongue between teeth', letters: 'TH', kind: 'mouth',
    note: 'The tongue tip shows between the teeth.',
    shape: shape(0.30, 0.58, 0.10, 0.50, 0.9) },

  // Expressions. Cued from the script, never from a phoneme.
  { id: 'ANGRY', label: 'Angry', title: 'Angry', letters: '', kind: 'expression',
    note: 'Brows down, mouth square. Cue it with [angry].',
    shape: shape(0.55, 0.70, 0.05, 0.85, 0.1, 0, 0.28) },
  { id: 'SMILE', label: 'Smile', title: 'Smile', letters: '', kind: 'expression',
    note: 'Closed smile. Cue it with [smile].',
    shape: shape(0.10, 0.88, 0.00, 0.20, 0, 0, 0.92) },
  { id: 'SAD', label: 'Sad', title: 'Sad', letters: '', kind: 'expression',
    note: 'Corners down. Cue it with [sad].',
    shape: shape(0.08, 0.60, 0.10, 0, 0, 0, 0.10) },
  { id: 'LAUGHING', label: 'Laughing', title: 'Laughing', letters: '', kind: 'expression',
    note: 'Wide open with the tongue showing. Cue it with [laughing].',
    shape: shape(0.80, 0.82, 0.05, 0.60, 0.6, 0, 0.80) },
];

const CHART_MAP = {
  // Open vowels
  AA: 'AEI', AE: 'AEI', AH: 'AEI', EH: 'AEI', AY: 'AEI', EY: 'AEI',
  // Rounded
  AO: 'O', OW: 'O', OY: 'O', AW: 'O',
  // Close front
  IY: 'EE', IH: 'EE',
  // Close back
  UW: 'U', UH: 'U',
  // R-coloured
  ER: 'R', R: 'R',
  // Bilabial
  B: 'MBP', M: 'MBP', P: 'MBP',
  // Labiodental
  F: 'FV', V: 'FV',
  // Post-alveolar
  CH: 'CHSHJ', JH: 'CHSHJ', SH: 'CHSHJ', ZH: 'CHSHJ',
  // Dental
  TH: 'TH', DH: 'TH',
  // Tongue-up
  L: 'L',
  // Rounded glide
  W: 'QW',
  // The sheet's catch-all consonant pose
  D: 'CONS', G: 'CONS', HH: 'CONS', K: 'CONS', N: 'CONS', NG: 'CONS',
  S: 'CONS', T: 'CONS', Y: 'CONS', Z: 'CONS',
  // Silence: the sheet has no rest pose, so the closed mouth serves as one
  sil: 'MBP',
};

/* ---------------------------------------------------------------------------- *
 * The scheme registry
 * ---------------------------------------------------------------------------- */

const buildScheme = (id, name, note, visemes, map, rest) => Object.freeze({
  id,
  name,
  note,
  rest,
  visemes: Object.freeze(visemes.map((v) => Object.freeze({ ...v, shape: Object.freeze(v.shape) }))),
  map: Object.freeze(map),
  byId: Object.freeze(Object.fromEntries(visemes.map((v) => [v.id, v]))),
});

export const SCHEMES = Object.freeze({
  chart: buildScheme(
    'chart',
    'Character sheet (16 poses)',
    'Twelve mouths labelled by the letters that produce them, plus four expressions. The layout hand-drawn character sheets normally come in.',
    CHART_VISEMES, CHART_MAP, 'MBP',
  ),
  rhubarb: buildScheme(
    'rhubarb',
    'Rhubarb (A–X)',
    'The nine shapes used by Rhubarb Lip Sync: A–F are its basic set, G and H are its extended shapes, X is the rest pose.',
    RHUBARB_VISEMES, RHUBARB_MAP, 'X',
  ),
});

export const SCHEME_IDS = Object.freeze(Object.keys(SCHEMES));

/** The sixteen-pose sheet is the default: it is what hand-drawn artwork comes as. */
export const DEFAULT_SCHEME = 'chart';

/** Falls back rather than throwing, so a stale share link cannot blank the stage. */
export function getScheme(schemeId) {
  return SCHEMES[schemeId] ?? SCHEMES[DEFAULT_SCHEME];
}

/** Every viseme in a scheme, sheet order. */
export const visemesOf = (schemeId) => getScheme(schemeId).visemes;

/** Just the speech shapes - what the timing engine is allowed to choose from. */
export const mouthVisemesOf = (schemeId) =>
  getScheme(schemeId).visemes.filter((v) => v.kind === 'mouth');

/** Just the expressions - only ever set by a script cue. */
export const expressionsOf = (schemeId) =>
  getScheme(schemeId).visemes.filter((v) => v.kind === 'expression');

export const visemeInfo = (schemeId, visemeId) => getScheme(schemeId).byId[visemeId] ?? null;

export const restViseme = (schemeId) => getScheme(schemeId).rest;

/**
 * The mouth shape for one sound.
 *
 * An unknown phoneme returns the rest pose rather than throwing: a corrupt override in
 * a share link should cost one frame of stillness, not the whole page.
 */
export function visemeFor(phoneme, schemeId) {
  const scheme = getScheme(schemeId);
  return scheme.map[phoneme] ?? scheme.rest;
}

/** Every phoneme drawn with a given shape. Used by the "How this works" panel. */
export function phonemesFor(schemeId, visemeId) {
  const scheme = getScheme(schemeId);
  return Object.keys(scheme.map).filter((p) => scheme.map[p] === visemeId);
}

/**
 * How many distinguishable pictures a scheme asks you to draw - the number that makes
 * lip sync worth doing at all, next to the forty sounds it covers.
 */
export const shapeCount = (schemeId) => mouthVisemesOf(schemeId).length;

/* ---------------------------------------------------------------------------- *
 * Moving artwork between schemes
 *
 * Someone who has drawn a Rhubarb set should not have to redraw it to use the sheet
 * layout, and vice versa. The mapping is not one-to-one in either direction - the
 * sheet distinguishes shapes Rhubarb merges - so it is stated explicitly rather than
 * derived, and the tool says plainly which poses it could not fill.
 * ---------------------------------------------------------------------------- */

const CHART_FROM_RHUBARB = {
  A: 'MBP', B: 'CONS', C: 'AEI', D: 'AEI', E: 'O', F: 'QW', G: 'FV', H: 'L', X: 'MBP',
};

const RHUBARB_FROM_CHART = {
  O: 'E', CONS: 'B', MBP: 'A', AEI: 'D', QW: 'F', EE: 'B', U: 'F',
  CHSHJ: 'B', L: 'H', FV: 'G', R: 'E', TH: 'B',
  // Expressions have no Rhubarb equivalent at all.
  ANGRY: null, SMILE: null, SAD: null, LAUGHING: null,
};

/**
 * @returns {string|null} the nearest viseme in `toScheme`, or null when there is none.
 */
export function equivalentViseme(visemeId, fromScheme, toScheme) {
  if (fromScheme === toScheme) return visemeId;
  if (fromScheme === 'rhubarb' && toScheme === 'chart') return CHART_FROM_RHUBARB[visemeId] ?? null;
  if (fromScheme === 'chart' && toScheme === 'rhubarb') return RHUBARB_FROM_CHART[visemeId] ?? null;
  return null;
}

/** Expression cues a script may name, mapped to the viseme that draws them. */
export const EXPRESSION_CUES = Object.freeze({
  angry: 'ANGRY', smile: 'SMILE', happy: 'SMILE', sad: 'SAD',
  laughing: 'LAUGHING', laugh: 'LAUGHING',
});

/** @returns {string|null} the viseme for a `[cue]`, if this scheme can draw it. */
export function expressionViseme(cue, schemeId) {
  const id = EXPRESSION_CUES[String(cue ?? '').toLowerCase()];
  if (!id) return null;
  return getScheme(schemeId).byId[id] ? id : null;
}
