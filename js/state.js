/**
 * One state object, and the three places it can live.
 *
 * | Path                | Mechanism         | Note                                      |
 * |---------------------|-------------------|-------------------------------------------|
 * | Session persistence | `localStorage`    | Stays on the device                       |
 * | Sharing             | URL **fragment**  | Browsers never transmit a fragment         |
 * | Save / open project | JSON file         | A plain local file, artwork included       |
 *
 * The fragment is the important one: everything after the `#` in a URL is handled by
 * the browser and never sent to the server, which is what makes a share link private
 * even though it contains the whole script.
 *
 * Everything below `migrate` is pure and tested. `load`, `save` and `shareLink` are the
 * thin wrappers that touch the browser, and each one degrades to a no-op rather than
 * throwing - a browser with storage disabled should lose its memory, not its mind.
 */

import { TIMING_DEFAULTS, withDefaults } from './timing.js';
import { DEFAULT_SCHEME, SCHEME_IDS, getScheme } from './visemes.js';
import { PHONEMES, normaliseWord, parsePhonemeString } from './g2p.js';
import { EXPORT_FORMATS } from './exporters.js';
import { sanitiseMouthSet, SHEET_DEFAULTS } from './mouthset.js';
import {
  emptyCharacter, sanitiseLibrary, findCharacter, estimateLibraryBytes,
  convertCharacter, withFrame, BLINK_DEFAULTS,
} from './character.js';

const KEY = 'detronics-voiceanimator';

/**
 * Bumped whenever the shape of the state changes. `migrate` is where an old shape is
 * brought forward; see pitfalls.md #8 for why a saved file always outlives the code
 * that wrote it.
 */
export const SCHEMA_VERSION = 1;

export const DEFAULT_SCRIPT = `Hello, and welcome to the Detronics VoiceAnimator.

Type a script here and the mouth shapes follow along. [smile] Punctuation buys the
pauses — a comma is a beat, a full stop is longer, and a blank line is longer still.

Cue an expression like [angry] this one, write a number like 1990, or ask for a
deliberate [pause 0.8] gap wherever you need one.`;

export const TOOLS = Object.freeze(['animate', 'breakdown', 'character', 'mouths', 'export']);

/**
 * A whole library of artwork will not fit in `localStorage` - the origin gets about 5 MB
 * and one photographed character is often more than that on its own. Past this the app
 * keeps the library in memory and says to save a project file.
 */
export const LIBRARY_STORAGE_LIMIT = 3_000_000;

export const defaults = Object.freeze({
  version: SCHEMA_VERSION,
  theme: 'system',
  tool: 'animate',
  script: DEFAULT_SCRIPT,
  schemeId: DEFAULT_SCHEME,
  projectName: 'voiceanimator',
  settings: { ...TIMING_DEFAULTS },
  /** Word -> corrected phonemes. The answer to English spelling not being a function. */
  overrides: {},
  exportFormat: EXPORT_FORMATS[0].id,
  exportNaming: null,
  soundFile: 'voice.wav',
  /** The character library. Always at least one, even if it is entirely undrawn. */
  characters: [emptyCharacter('Character 1', DEFAULT_SCHEME)],
  activeCharacterId: null,
  blink: { enabled: true, everySeconds: BLINK_DEFAULTS.everySeconds },
  sheet: { ...SHEET_DEFAULTS },
  /** Playback preferences - not part of a share link, they are about this screen. */
  loop: false,
  showBreakdown: true,
});

export const state = structuredCloneish(defaults);

function structuredCloneish(value) {
  return JSON.parse(JSON.stringify(value));
}

/* ---------------------------------------------------------------------------- *
 * Migration and sanitising - pure
 * ---------------------------------------------------------------------------- */

const clampNumber = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const pickString = (value, allowed, fallback) =>
  (typeof value === 'string' && allowed.includes(value) ? value : fallback);

/** Only real words mapped to real phonemes survive a round trip through a file. */
export function sanitiseOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;

  for (const [word, phonemes] of Object.entries(raw)) {
    const key = normaliseWord(word);
    if (!key || key.length > 40) continue;

    const list = Array.isArray(phonemes)
      ? phonemes.filter((p) => Object.hasOwn(PHONEMES, p))
      : parsePhonemeString(phonemes);
    if (!list.length || list.length > 40) continue;

    out[key] = list.join(' ');
    if (Object.keys(out).length >= 500) break;
  }
  return out;
}

/** Timing settings, clamped to what the UI can actually offer. */
export function sanitiseSettings(raw) {
  const merged = withDefaults(raw && typeof raw === 'object' ? raw : {});
  return {
    wpm: clampNumber(merged.wpm, 40, 400, TIMING_DEFAULTS.wpm),
    fps: clampNumber(Math.round(merged.fps), 1, 120, TIMING_DEFAULTS.fps),
    minHold: clampNumber(merged.minHold, 0, 1, TIMING_DEFAULTS.minHold),
    quantise: merged.quantise !== false,
    leadIn: clampNumber(merged.leadIn, 0, 10, TIMING_DEFAULTS.leadIn),
    tailOut: clampNumber(merged.tailOut, 0, 10, TIMING_DEFAULTS.tailOut),
    restAfter: clampNumber(merged.restAfter, 0, 10, TIMING_DEFAULTS.restAfter),
    emphasiseFinal: clampNumber(merged.emphasiseFinal, 1, 3, TIMING_DEFAULTS.emphasiseFinal),
    pauses: {
      clause: clampNumber(merged.pauses?.clause, 0, 10, TIMING_DEFAULTS.pauses.clause),
      sentence: clampNumber(merged.pauses?.sentence, 0, 10, TIMING_DEFAULTS.pauses.sentence),
      line: clampNumber(merged.pauses?.line, 0, 10, TIMING_DEFAULTS.pauses.line),
      paragraph: clampNumber(merged.pauses?.paragraph, 0, 20, TIMING_DEFAULTS.pauses.paragraph),
    },
  };
}

/**
 * Bring anything - a share link, a project file, last week's `localStorage` - up to the
 * current shape.
 *
 * Note that nothing is spread over the defaults. `{...defaults, ...incoming}` looks
 * equivalent and is not: an incoming object carrying `wpm: undefined` overwrites a
 * perfectly good default with nothing. Every field is read explicitly with its own
 * fallback instead.
 */
export function migrate(raw) {
  const incoming = raw && typeof raw === 'object' ? raw : {};
  const next = structuredCloneish(defaults);

  // --- version 1 is the first published shape. A future version 2 would convert here,
  // --- before any of the field reads below, so the reads only ever see one shape.

  next.version = SCHEMA_VERSION;
  next.theme = pickString(incoming.theme, ['system', 'light', 'dark'], defaults.theme);
  next.tool = pickString(incoming.tool, TOOLS, defaults.tool);
  next.schemeId = pickString(incoming.schemeId, SCHEME_IDS, defaults.schemeId);

  if (typeof incoming.script === 'string') next.script = incoming.script.slice(0, 200_000);

  if (typeof incoming.projectName === 'string' && incoming.projectName.trim()) {
    next.projectName = incoming.projectName.trim().slice(0, 80);
  }

  next.settings = sanitiseSettings(incoming.settings);
  next.overrides = sanitiseOverrides(incoming.overrides);

  next.exportFormat = pickString(
    incoming.exportFormat, EXPORT_FORMATS.map((f) => f.id), defaults.exportFormat,
  );
  next.exportNaming = pickString(incoming.exportNaming, ['scheme', 'rhubarb', 'moho'], null);

  if (typeof incoming.soundFile === 'string' && incoming.soundFile.trim()) {
    next.soundFile = incoming.soundFile.trim().slice(0, 120);
  }

  next.characters = sanitiseLibrary(incoming.characters, next.schemeId);

  // Version 1.0 stored a single `mouthSet` of whole-frame pictures and had no notion of
  // a character. Those pictures are exactly a `frames` character, so an old project or
  // share link opens with its artwork intact rather than blank.
  const legacy = sanitiseMouthSet(incoming.mouthSet, next.schemeId);
  if (Object.keys(legacy.images).length && !Array.isArray(incoming.characters)) {
    let carried = emptyCharacter(legacy.name || 'Character 1', next.schemeId);
    for (const [visemeId, image] of Object.entries(legacy.images)) {
      carried = withFrame(carried, visemeId, image);
    }
    next.characters = [carried];
  }

  next.activeCharacterId = findCharacter(
    next.characters,
    typeof incoming.activeCharacterId === 'string' ? incoming.activeCharacterId : null,
  )?.id ?? next.characters[0].id;

  next.blink = {
    enabled: incoming.blink?.enabled !== false,
    everySeconds: clampNumber(incoming.blink?.everySeconds, 0.5, 30, BLINK_DEFAULTS.everySeconds),
  };

  next.sheet = {
    cols: clampNumber(Math.round(incoming.sheet?.cols), 1, 24, SHEET_DEFAULTS.cols),
    rows: clampNumber(Math.round(incoming.sheet?.rows), 1, 24, SHEET_DEFAULTS.rows),
    padding: clampNumber(incoming.sheet?.padding, 0, 2000, SHEET_DEFAULTS.padding),
    gap: clampNumber(incoming.sheet?.gap, 0, 2000, SHEET_DEFAULTS.gap),
    labelHeight: clampNumber(incoming.sheet?.labelHeight, 0, 2000, SHEET_DEFAULTS.labelHeight),
  };

  next.loop = incoming.loop === true;
  next.showBreakdown = incoming.showBreakdown !== false;

  return next;
}

/* ---------------------------------------------------------------------------- *
 * Sharing - pure
 * ---------------------------------------------------------------------------- */

/**
 * What travels in a link.
 *
 * Artwork does not: a sixteen-pose set is megabytes of data URL and no browser would
 * carry it in an address bar. A share link is the script and the settings - what makes
 * the *timing* reproducible - and the recipient brings their own drawings.
 */
export function shareState(source = state) {
  return {
    version: SCHEMA_VERSION,
    script: source.script,
    schemeId: source.schemeId,
    settings: source.settings,
    overrides: source.overrides,
    tool: source.tool,
    projectName: source.projectName,
    blink: source.blink,
  };
}

export const encodeShare = (source = state) =>
  encodeURIComponent(JSON.stringify(shareState(source)));

/** @returns {object|null} null when the fragment is absent or not ours */
export function decodeShare(fragment) {
  const text = String(fragment ?? '').replace(/^#/, '');
  if (!text) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(text));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------- *
 * Project files - pure
 * ---------------------------------------------------------------------------- */

/** Everything, artwork included. This is what "Save project" writes. */
export function toProject(source = state) {
  return {
    application: 'Detronics VoiceAnimator',
    version: SCHEMA_VERSION,
    saved: new Date().toISOString().slice(0, 10),
    projectName: source.projectName,
    script: source.script,
    schemeId: source.schemeId,
    settings: source.settings,
    overrides: source.overrides,
    characters: source.characters,
    activeCharacterId: source.activeCharacterId,
    blink: source.blink,
    sheet: source.sheet,
    soundFile: source.soundFile,
  };
}

/**
 * Read a project file.
 *
 * A project file is a plain JSON file that can be mailed, edited by hand or written by
 * something else entirely, so it goes through exactly the same migration as everything
 * else and is trusted no further.
 *
 * @returns {{state: object|null, error: string|null}}
 */
export function fromProject(text) {
  let parsed;
  try {
    parsed = JSON.parse(typeof text === 'string' ? text : JSON.stringify(text));
  } catch {
    return { state: null, error: 'That file is not readable as JSON.' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { state: null, error: 'That file does not contain a project.' };
  }
  if (parsed.application && parsed.application !== 'Detronics VoiceAnimator') {
    return { state: null, error: `That project was saved by ${String(parsed.application).slice(0, 40)}, not by this tool.` };
  }
  if (typeof parsed.script !== 'string') {
    return { state: null, error: 'That project has no script in it.' };
  }

  return { state: migrate(parsed), error: null };
}

/* ---------------------------------------------------------------------------- *
 * The browser-facing wrappers
 *
 * Everything above is pure and tested. These are deliberately thin, and every one of
 * them degrades to a no-op rather than throwing.
 * ---------------------------------------------------------------------------- */

const storage = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;                                   // storage blocked by the browser
  }
};

export function load() {
  let stored = null;
  try {
    stored = JSON.parse(storage()?.getItem(KEY) ?? 'null');
  } catch { /* corrupt or unreadable: fall back to the defaults */ }

  const shared = typeof location === 'undefined' ? null : decodeShare(location.hash);

  // A share link is the more specific intent, so it wins over what is on the device.
  Object.assign(state, migrate({ ...(stored ?? {}), ...(shared ?? {}) }));

  // A share link never carries artwork, so a library already on this device survives one.
  if (shared && Array.isArray(stored?.characters) && stored.characters.length) {
    state.characters = sanitiseLibrary(stored.characters, state.schemeId);
    state.activeCharacterId = findCharacter(state.characters, stored.activeCharacterId)?.id
      ?? state.characters[0].id;
  }

  return state;
}

/**
 * @returns {boolean} whether the artwork could be kept as well. A full set of PNGs will
 *          not fit in `localStorage`, so it is dropped from the stored copy and the UI
 *          says to save a project file instead.
 */
export function save() {
  const store = storage();
  if (!store) return false;

  const keepArtwork = estimateLibraryBytes(state.characters) <= LIBRARY_STORAGE_LIMIT;
  const payload = keepArtwork
    ? state
    // Drop the pictures but keep the rig: names, placements and blink settings are tiny
    // and are the part that would be tedious to redo.
    : {
      ...state,
      characters: state.characters.map((c) => ({
        ...c, base: null, frames: {},
        slots: Object.fromEntries(Object.entries(c.slots)
          .map(([slot, entry]) => [slot, { ...entry, images: {} }])),
      })),
    };

  try {
    store.setItem(KEY, JSON.stringify(payload));
    return keepArtwork;
  } catch {
    // Quota exceeded even without the artwork: keep the script, drop the rest.
    try {
      store.setItem(KEY, JSON.stringify({
        version: SCHEMA_VERSION,
        script: state.script,
        schemeId: state.schemeId,
        settings: state.settings,
        overrides: state.overrides,
        theme: state.theme,
      }));
    } catch { /* nothing more to be done */ }
    return false;
  }
}

export function reset() {
  Object.assign(state, structuredCloneish(defaults));
  try { storage()?.removeItem(KEY); } catch { /* already gone */ }
  return state;
}

export function shareLink() {
  const base = typeof location === 'undefined'
    ? 'https://detronics-apps.github.io/VoiceAnimator/'
    : location.origin + location.pathname;
  return `${base}#${encodeShare(state)}`;
}

/* ---------------------------------------------------------------------------- *
 * Pronunciation overrides
 * ---------------------------------------------------------------------------- */

/** @returns {boolean} whether the correction was understood */
export function setOverride(word, phonemes) {
  const key = normaliseWord(word);
  if (!key) return false;
  const list = Array.isArray(phonemes) ? phonemes : parsePhonemeString(phonemes);
  if (!list.length) return false;
  state.overrides = { ...state.overrides, [key]: list.join(' ') };
  return true;
}

export function clearOverride(word) {
  const key = normaliseWord(word);
  if (!key || !(key in state.overrides)) return false;
  const next = { ...state.overrides };
  delete next[key];
  state.overrides = next;
  return true;
}

/** Overrides in the form `wordToPhonemes` wants them. */
export const overridesFor = (source = state) => source.overrides;

/**
 * Changing scheme must not leave artwork pointing at poses the new scheme lacks.
 *
 * Every character is re-keyed rather than emptied, and what could not be carried is
 * returned so the UI can say so.
 *
 * @returns {{schemeId: string, dropped: string[]}}
 */
export function setScheme(schemeId) {
  const next = getScheme(schemeId).id;
  if (next === state.schemeId) return { schemeId: next, dropped: [] };

  const dropped = [];
  state.characters = state.characters.map((character) => {
    const result = convertCharacter(character, next);
    dropped.push(...result.dropped);
    return result.character;
  });
  state.schemeId = next;
  return { schemeId: next, dropped };
}

/** The character currently on stage. Never null: the library always has one. */
export const activeCharacter = (source = state) =>
  findCharacter(source.characters, source.activeCharacterId);

/** Replace the active character with an edited copy. */
export function updateActiveCharacter(next) {
  const id = activeCharacter()?.id;
  state.characters = state.characters.map((c) => (c.id === id ? next : c));
  return next;
}
