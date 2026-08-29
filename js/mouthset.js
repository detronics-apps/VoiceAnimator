/**
 * Mouth sets: your artwork, mapped onto the viseme scheme.
 *
 * Pure: no DOM, no globals. Decoding an image and cropping a sheet are jobs for a
 * canvas and live in `js/ui/`; everything here is the arithmetic and the bookkeeping,
 * which is the part worth testing.
 *
 * Two ways in, because character artwork arrives as one or the other:
 *
 *   **Separate files.** One image per pose, usually named after the sound - `MBP.png`,
 *   `mouth_A.png`, `AI.png`. `guessViseme` reads those names so a sixteen-file drop
 *   lands in the right slots without sixteen dropdowns.
 *
 *   **One contact sheet.** Every pose on a single image in a grid, which is how a
 *   hand-drawn sheet is normally scanned or exported. `sheetGrid` works out where the
 *   cells are; the UI crops them.
 *
 * Nothing is uploaded in either case. The images are read by the browser, held in
 * memory, and written into the project file if you save one.
 */

import { getScheme, visemesOf, equivalentViseme } from './visemes.js';

/**
 * @typedef {object} MouthImage
 * @property {string} src a data URL - the decoded image, never a network address
 * @property {number} width
 * @property {number} height
 * @property {string} [name] the file it came from, for the UI to show
 */

/** A set with no artwork in it: the app draws its built-in shapes instead. */
export function emptyMouthSet(schemeId = 'chart') {
  return { name: '', schemeId: getScheme(schemeId).id, images: {} };
}

export const hasArtwork = (set) => Object.keys(set?.images ?? {}).length > 0;

/* ---------------------------------------------------------------------------- *
 * Reading a viseme out of a filename
 * ---------------------------------------------------------------------------- */

/**
 * Names that appear on real character sheets but are not viseme ids: the Preston Blair
 * set that Moho uses, plus the obvious English words.
 */
const FILENAME_ALIASES = {
  // Preston Blair / Moho
  ai: 'AEI', o: 'O', e: 'EE', u: 'U', l: 'L', wq: 'QW', mbp: 'MBP', fv: 'FV',
  etc: 'CONS', rest: 'MBP',
  // Plain English
  closed: 'MBP', shut: 'MBP', neutral: 'MBP', idle: 'MBP',
  open: 'AEI', wide: 'AEI', round: 'O', pucker: 'QW', oo: 'U',
  teeth: 'CONS', tongue: 'L', bite: 'FV',
  happy: 'SMILE', smile: 'SMILE', angry: 'ANGRY', cross: 'ANGRY',
  sad: 'SAD', unhappy: 'SAD', laugh: 'LAUGHING', laughing: 'LAUGHING',
  // The letters as written on the sheet
  bmp: 'MBP', pbm: 'MBP', aei: 'AEI', eai: 'AEI', qw: 'QW', wq_: 'QW',
  ee: 'EE', th: 'TH', r: 'R', chshj: 'CHSHJ', ch: 'CHSHJ', sh: 'CHSHJ',
  cons: 'CONS', cdgknstxyz: 'CONS',
};

/**
 * Guess which pose a file is for, from its name.
 *
 * Deliberately conservative: an unrecognised name returns null and the UI asks, rather
 * than the set quietly filling up with wrong assignments that are then hard to spot.
 *
 * @returns {string|null} a viseme id in `schemeId`, or null
 */
export function guessViseme(filename, schemeId = 'chart') {
  const scheme = getScheme(schemeId);
  const stem = String(filename ?? '')
    .replace(/\.[a-z0-9]+$/i, '')            // extension
    .replace(/[\s_\-.]+/g, ' ')
    .trim();
  if (!stem) return null;

  // The last word of `lisa mouth MBP` is the one that means something.
  const words = stem.split(' ').filter(Boolean);
  const candidates = [stem, ...words.slice().reverse()]
    .map((w) => w.replace(/[^a-z0-9]/gi, '').toLowerCase())
    .filter(Boolean);

  for (const candidate of candidates) {
    // An exact viseme id, in this scheme or the other one.
    for (const viseme of scheme.visemes) {
      if (viseme.id.toLowerCase() === candidate) return viseme.id;
    }
    if (FILENAME_ALIASES[candidate]) {
      const target = FILENAME_ALIASES[candidate];
      if (scheme.byId[target]) return target;
      const crossed = equivalentViseme(target, 'chart', scheme.id);
      if (crossed && scheme.byId[crossed]) return crossed;
    }
    // A bare Rhubarb letter, `A` to `X`.
    if (/^[a-hx]$/.test(candidate)) {
      const letter = candidate.toUpperCase();
      if (scheme.id === 'rhubarb') return letter;
      const crossed = equivalentViseme(letter, 'rhubarb', scheme.id);
      if (crossed) return crossed;
    }
  }

  return null;
}

/**
 * Work out where every file should go, without changing anything.
 *
 * @param {Array<{name: string}>} files
 * @returns {{matches: object[], unmatched: object[], clashes: object[]}}
 */
export function planAssignment(files, schemeId = 'chart') {
  const matches = [];
  const unmatched = [];
  const taken = new Map();

  for (const [index, file] of (files ?? []).entries()) {
    const viseme = guessViseme(file?.name, schemeId);
    if (!viseme) { unmatched.push({ index, name: file?.name ?? '' }); continue; }
    if (!taken.has(viseme)) taken.set(viseme, []);
    taken.get(viseme).push({ index, name: file?.name ?? '', viseme });
  }

  const clashes = [];
  for (const [viseme, entries] of taken) {
    matches.push(entries[0]);
    if (entries.length > 1) clashes.push({ viseme, names: entries.map((e) => e.name) });
  }

  matches.sort((a, b) => a.index - b.index);
  return { matches, unmatched, clashes };
}

/* ---------------------------------------------------------------------------- *
 * Contact sheets
 * ---------------------------------------------------------------------------- */

export const SHEET_DEFAULTS = Object.freeze({
  cols: 5, rows: 3, padding: 0, gap: 0, labelHeight: 0,
});

/**
 * Where the cells of a contact sheet are.
 *
 * Uniform grid, because that is what nearly every exported sheet is. A hand-drawn sheet
 * with an uneven last row still works: set the grid to the widest row, and assign the
 * cells you want in the UI - the ones that fall on empty space are simply left unused.
 *
 * `labelHeight` trims the caption strip under each pose, which sheets nearly always
 * have and which would otherwise be baked into every mouth.
 *
 * @returns {Array<{index:number, col:number, row:number, x:number, y:number, width:number, height:number}>}
 */
export function sheetGrid(width, height, options = {}) {
  const { cols, rows, padding, gap, labelHeight } = { ...SHEET_DEFAULTS, ...options };

  const w = Math.max(0, Number(width) || 0);
  const h = Math.max(0, Number(height) || 0);
  const columns = Math.max(1, Math.min(24, Math.trunc(cols) || 1));
  const lines = Math.max(1, Math.min(24, Math.trunc(rows) || 1));
  const pad = Math.max(0, Number(padding) || 0);
  const space = Math.max(0, Number(gap) || 0);
  const label = Math.max(0, Number(labelHeight) || 0);

  const usableWidth = w - pad * 2 - space * (columns - 1);
  const usableHeight = h - pad * 2 - space * (lines - 1);
  if (usableWidth <= 0 || usableHeight <= 0) return [];

  const cellWidth = usableWidth / columns;
  const cellHeight = usableHeight / lines;
  const drawnHeight = Math.max(1, cellHeight - label);

  const cells = [];
  for (let row = 0; row < lines; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      cells.push({
        index: row * columns + col,
        col,
        row,
        x: pad + col * (cellWidth + space),
        y: pad + row * (cellHeight + space),
        width: cellWidth,
        height: drawnHeight,
      });
    }
  }
  return cells;
}

/**
 * Which cell each pose comes from, assuming the sheet is in the scheme's own order.
 *
 * That assumption is what makes a sixteen-pose sheet one click rather than sixteen; the
 * UI shows the numbered cells over the image so a wrong guess is obvious immediately.
 *
 * @returns {Record<string, number>} viseme id -> cell index
 */
export function defaultCellAssignment(schemeId, cellCount) {
  const assignment = {};
  const visemes = visemesOf(schemeId);
  const count = Math.max(0, Math.trunc(cellCount) || 0);
  for (let i = 0; i < Math.min(visemes.length, count); i += 1) {
    assignment[visemes[i].id] = i;
  }
  return assignment;
}

/* ---------------------------------------------------------------------------- *
 * Coverage and health
 * ---------------------------------------------------------------------------- */

/**
 * What is drawn and what is missing.
 *
 * Missing mouths are not an error - the built-in shapes fill in - so this reports rather
 * than refuses. But a set missing its closed mouth is worth saying out loud, because a
 * missing P is the single most visible failure in lip sync.
 */
export function coverage(set, schemeId = set?.schemeId) {
  const scheme = getScheme(schemeId);
  const images = set?.images ?? {};

  const mouths = scheme.visemes.filter((v) => v.kind === 'mouth');
  const expressions = scheme.visemes.filter((v) => v.kind === 'expression');

  const assigned = mouths.filter((v) => images[v.id]).map((v) => v.id);
  const missing = mouths.filter((v) => !images[v.id]).map((v) => v.id);

  return {
    assigned,
    missing,
    expressionsAssigned: expressions.filter((v) => images[v.id]).map((v) => v.id),
    total: mouths.length,
    complete: missing.length === 0,
    // The rest pose doubles as the closed mouth on the character sheet.
    missingClosed: missing.includes(scheme.rest) || missing.includes('MBP') || missing.includes('A'),
  };
}

/** Roughly how much memory the set occupies. A data URL is about 4 bytes per 3 of image. */
export function estimateBytes(set) {
  return Object.values(set?.images ?? {})
    .reduce((sum, image) => sum + Math.ceil((String(image?.src ?? '').length * 3) / 4), 0);
}

/**
 * localStorage is typically 5 MB for the whole origin, and a sixteen-pose set of
 * full-size PNGs will not fit. Past this the app keeps the set in memory only and says
 * so, rather than throwing a quota error on the next keystroke.
 */
export const STORAGE_LIMIT_BYTES = 2_000_000;

export const fitsInStorage = (set) => estimateBytes(set) <= STORAGE_LIMIT_BYTES;

/**
 * Warnings about a set, in the house style: things worth knowing as they happen, not a
 * validation error that refuses the work.
 */
export function mouthSetWarnings(set, schemeId = set?.schemeId) {
  const out = [];
  if (!hasArtwork(set)) return out;

  const cover = coverage(set, schemeId);

  if (cover.missingClosed) {
    out.push({
      level: 'danger',
      text: 'The closed mouth has no artwork. A missing P, B or M is the most visible fault in lip sync — that pose is worth drawing before any other.',
    });
  } else if (cover.missing.length) {
    out.push({
      level: 'warn',
      text: `${cover.missing.length} of ${cover.total} mouth shapes have no artwork, so the built-in drawing is used for those.`,
    });
  }

  const sizes = Object.values(set.images).filter((i) => i?.width && i?.height);
  if (sizes.length > 1) {
    const ratios = sizes.map((i) => i.width / i.height);
    const spread = Math.max(...ratios) / Math.min(...ratios);
    if (spread > 1.15) {
      out.push({
        level: 'warn',
        text: 'The images are not all the same shape, so the mouth will appear to change size between poses. Export them on one canvas at one size.',
      });
    }
  }

  if (!fitsInStorage(set)) {
    out.push({
      level: 'warn',
      text: 'This set is too large to keep on this device between visits, so it is held in memory only. Save the project to a file to keep it.',
    });
  }

  return out;
}

/* ---------------------------------------------------------------------------- *
 * Editing a set
 *
 * All of these return a new set rather than mutating, so undo is a matter of keeping
 * the previous object.
 * ---------------------------------------------------------------------------- */

export function withImage(set, visemeId, image) {
  return { ...set, images: { ...set.images, [visemeId]: image } };
}

export function withoutImage(set, visemeId) {
  const images = { ...set.images };
  delete images[visemeId];
  return { ...set, images };
}

/**
 * Move a set onto another scheme, carrying whatever artwork has an equivalent.
 *
 * The mapping is not one-to-one - the twelve-pose sheet distinguishes shapes Rhubarb
 * merges - so this reports what it could not carry rather than dropping it silently.
 *
 * @returns {{set: object, carried: string[], dropped: string[]}}
 */
export function convertSet(set, toSchemeId) {
  const from = getScheme(set?.schemeId).id;
  const to = getScheme(toSchemeId).id;
  if (from === to) return { set: { ...set }, carried: Object.keys(set?.images ?? {}), dropped: [] };

  const images = {};
  const carried = [];
  const dropped = [];

  for (const [visemeId, image] of Object.entries(set?.images ?? {})) {
    const target = equivalentViseme(visemeId, from, to);
    // Two source poses can map to one target; the first one wins and the second is
    // reported, rather than silently overwriting.
    if (target && !images[target]) {
      images[target] = image;
      carried.push(visemeId);
    } else {
      dropped.push(visemeId);
    }
  }

  return { set: { ...set, schemeId: to, images }, carried, dropped };
}

/* ---------------------------------------------------------------------------- *
 * Loading a set that came from somewhere else
 * ---------------------------------------------------------------------------- */

/** A data URL for an image, and nothing else. Anything else is not loaded. */
const SAFE_SRC = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;

/**
 * Read a mouth set out of a project file or a share link.
 *
 * A project file is a plain JSON file the user can edit, mail or receive from someone
 * else, so nothing in it is trusted: only real visemes are kept, and only images that
 * are self-contained data URLs. An `src` pointing at a web address would turn opening a
 * project into a network request, which is exactly what this app promises never to do.
 */
export function sanitiseMouthSet(raw, schemeId) {
  const scheme = getScheme(raw?.schemeId ?? schemeId);
  const set = emptyMouthSet(scheme.id);
  set.name = typeof raw?.name === 'string' ? raw.name.slice(0, 80) : '';

  for (const [visemeId, image] of Object.entries(raw?.images ?? {})) {
    if (!scheme.byId[visemeId]) continue;
    if (typeof image?.src !== 'string' || !SAFE_SRC.test(image.src)) continue;
    set.images[visemeId] = {
      src: image.src,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      name: typeof image.name === 'string' ? image.name.slice(0, 120) : '',
    };
  }

  return set;
}
