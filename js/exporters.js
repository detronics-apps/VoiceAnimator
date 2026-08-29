/**
 * Getting the track out of the browser and into something that animates.
 *
 * Pure: no DOM, no globals. Every exporter takes a track and returns a string.
 *
 * The point of matching Rhubarb Lip Sync's own output formats exactly is that anything
 * already built around Rhubarb - a Blender add-on, a Moho rig, someone's Python script -
 * takes this tool's output without knowing the difference. Where a scheme has shapes
 * Rhubarb does not, they are mapped down to the nearest Rhubarb shape on the way out and
 * the export says so in a comment, rather than inventing a letter no reader understands.
 */

import { equivalentViseme, getScheme, visemeInfo } from './visemes.js';
import { formatSeconds, formatTimecode, secondsToFrames } from './timecode.js';

/* ---------------------------------------------------------------------------- *
 * Shape naming
 * ---------------------------------------------------------------------------- */

/**
 * Preston Blair names, which is what Moho, Anime Studio and most 2D rigs call their
 * switch layers. The character sheet is already this set in all but spelling.
 */
const MOHO_NAMES = {
  AEI: 'AI', O: 'O', EE: 'E', U: 'U', L: 'L', QW: 'WQ', MBP: 'MBP', FV: 'FV',
  CONS: 'etc', CHSHJ: 'etc', TH: 'etc', R: 'E',
  ANGRY: 'etc', SMILE: 'etc', SAD: 'rest', LAUGHING: 'AI',
  // The Rhubarb letters, for a track built in that scheme.
  A: 'MBP', B: 'etc', C: 'AI', D: 'AI', E: 'E', F: 'WQ', G: 'FV', H: 'L', X: 'rest',
};

/** How a shape is named in a given export. */
export function shapeName(viseme, schemeId, naming) {
  if (naming === 'rhubarb') return equivalentViseme(viseme, schemeId, 'rhubarb') ?? 'X';
  if (naming === 'moho') return MOHO_NAMES[viseme] ?? 'etc';
  return viseme;
}

export const NAMING_CHOICES = Object.freeze([
  { value: 'scheme', label: 'This scheme’s own names' },
  { value: 'rhubarb', label: 'Rhubarb letters (A–X)' },
  { value: 'moho', label: 'Preston Blair / Moho (AI, O, E, U, L, WQ, MBP, FV, etc, rest)' },
]);

/**
 * Shapes that had to be flattened on the way out, so the UI can say which detail was
 * lost rather than letting the user find out in their animation package.
 */
export function lossyShapes(track, naming) {
  if (naming === 'scheme') return [];
  const used = [...new Set(track.cues.map((c) => c.viseme))];
  const collisions = new Map();

  for (const viseme of used) {
    const name = shapeName(viseme, track.schemeId, naming);
    if (!collisions.has(name)) collisions.set(name, []);
    collisions.get(name).push(viseme);
  }

  return [...collisions.entries()]
    .filter(([, visemes]) => visemes.length > 1)
    .map(([name, visemes]) => ({
      name,
      merged: visemes.map((v) => visemeInfo(track.schemeId, v)?.label ?? v),
    }));
}

/* ---------------------------------------------------------------------------- *
 * Rhubarb's own three formats
 * ---------------------------------------------------------------------------- */

/**
 * Rhubarb's `--exportFormat tsv`: one row per shape change, tab separated, with a final
 * row marking the end of the track.
 */
export function toRhubarbTsv(track, { naming = 'rhubarb' } = {}) {
  const rows = track.cues.map((cue) =>
    `${formatSeconds(cue.start)}\t${shapeName(cue.viseme, track.schemeId, naming)}`);
  if (track.cues.length) {
    rows.push(`${formatSeconds(track.duration)}\t${shapeName('X', 'rhubarb', naming)}`);
  }
  return `${rows.join('\n')}\n`;
}

/** Rhubarb's `--exportFormat json`. */
export function toRhubarbJson(track, { naming = 'rhubarb', soundFile = 'voice.wav' } = {}) {
  return `${JSON.stringify({
    metadata: {
      soundFile,
      duration: Number(track.duration.toFixed(2)),
    },
    mouthCues: track.cues.map((cue) => ({
      start: Number(cue.start.toFixed(2)),
      end: Number(cue.end.toFixed(2)),
      value: shapeName(cue.viseme, track.schemeId, naming),
    })),
  }, null, 2)}\n`;
}

const escapeXml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

/** Rhubarb's `--exportFormat xml`. */
export function toRhubarbXml(track, { naming = 'rhubarb', soundFile = 'voice.wav' } = {}) {
  const cues = track.cues.map((cue) =>
    `    <mouthCue start="${formatSeconds(cue.start)}" end="${formatSeconds(cue.end)}">` +
    `${escapeXml(shapeName(cue.viseme, track.schemeId, naming))}</mouthCue>`).join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<rhubarbResult>',
    '  <metadata>',
    `    <soundFile>${escapeXml(soundFile)}</soundFile>`,
    `    <duration>${formatSeconds(track.duration)}</duration>`,
    '  </metadata>',
    '  <mouthCues>',
    cues,
    '  </mouthCues>',
    '</rhubarbResult>',
    '',
  ].filter((line) => line !== '').join('\n');
}

/* ---------------------------------------------------------------------------- *
 * Animation packages
 * ---------------------------------------------------------------------------- */

/**
 * Moho / Anime Studio switch data. Frame numbers, not seconds, so the frame rate the
 * track was quantised at is the frame rate the file assumes.
 */
export function toMohoDat(track, { naming = 'moho', fps = null } = {}) {
  const rate = fps ?? track.settings?.fps ?? 24;
  const rows = ['MohoSwitch1'];
  let previous = null;

  for (const cue of track.cues) {
    const name = shapeName(cue.viseme, track.schemeId, naming);
    if (name === previous) continue;             // a switch file records changes only
    rows.push(`${secondsToFrames(cue.start, rate)} ${name}`);
    previous = name;
  }

  if (track.cues.length) rows.push(`${secondsToFrames(track.duration, rate)} rest`);
  return `${rows.join('\n')}\n`;
}

/** A spreadsheet-friendly table: every cue with the sounds and the word behind it. */
export function toCsv(track, { naming = 'scheme' } = {}) {
  const rate = track.settings?.fps ?? 24;
  const quote = (value) => {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = [['start', 'end', 'duration', 'frame', 'shape', 'phonemes', 'word'].join(',')];
  for (const cue of track.cues) {
    rows.push([
      formatSeconds(cue.start, 3),
      formatSeconds(cue.end, 3),
      formatSeconds(cue.end - cue.start, 3),
      secondsToFrames(cue.start, rate),
      quote(shapeName(cue.viseme, track.schemeId, naming)),
      quote(cue.phonemes.join(' ')),
      quote(cue.word ?? ''),
    ].join(','));
  }
  return `${rows.join('\n')}\n`;
}

/** A plain readable sheet: what an animator would tape to the desk. */
export function toTimingSheet(track, { naming = 'scheme' } = {}) {
  const rate = track.settings?.fps ?? 24;
  const rows = track.cues.map((cue) => {
    const frames = secondsToFrames(cue.end - cue.start, rate);
    return [
      formatTimecode(cue.start, rate).padEnd(12),
      String(frames).padStart(3),
      ' ',
      shapeName(cue.viseme, track.schemeId, naming).padEnd(6),
      cue.word ?? '',
    ].join(' ');
  });

  return [
    `Detronics VoiceAnimator — timing sheet`,
    `${getScheme(track.schemeId).name} · ${rate} fps · ${formatSeconds(track.duration)} s · ${track.cues.length} cues`,
    '',
    'timecode      len  shape  word',
    '─'.repeat(46),
    ...rows,
    '',
  ].join('\n');
}

/* ---------------------------------------------------------------------------- *
 * The registry the UI builds its menu from
 * ---------------------------------------------------------------------------- */

export const EXPORT_FORMATS = Object.freeze([
  { id: 'tsv', label: 'Rhubarb TSV', extension: 'tsv', mime: 'text/tab-separated-values',
    naming: 'rhubarb', build: toRhubarbTsv,
    note: 'Exactly what `rhubarb --exportFormat tsv` writes.' },
  { id: 'json', label: 'Rhubarb JSON', extension: 'json', mime: 'application/json',
    naming: 'rhubarb', build: toRhubarbJson,
    note: 'Exactly what `rhubarb --exportFormat json` writes.' },
  { id: 'xml', label: 'Rhubarb XML', extension: 'xml', mime: 'application/xml',
    naming: 'rhubarb', build: toRhubarbXml,
    note: 'Exactly what `rhubarb --exportFormat xml` writes.' },
  { id: 'moho', label: 'Moho switch data', extension: 'dat', mime: 'text/plain',
    naming: 'moho', build: toMohoDat,
    note: 'Frame-numbered switch layer data for Moho and Anime Studio.' },
  { id: 'csv', label: 'Spreadsheet (CSV)', extension: 'csv', mime: 'text/csv',
    naming: 'scheme', build: toCsv,
    note: 'Every cue with the sounds and the word behind it.' },
  { id: 'sheet', label: 'Timing sheet', extension: 'txt', mime: 'text/plain',
    naming: 'scheme', build: toTimingSheet,
    note: 'A readable exposure sheet, in timecode.' },
]);

export const getFormat = (id) => EXPORT_FORMATS.find((f) => f.id === id) ?? EXPORT_FORMATS[0];

/** Build one export. Falls back to the first format rather than throwing on a bad id. */
export function buildExport(track, formatId, options = {}) {
  const format = getFormat(formatId);
  const text = format.build(track, { naming: format.naming, ...options });
  return { text, format };
}

/** A safe, descriptive filename. Never trusts a user-supplied name into the filesystem. */
export function exportFilename(formatId, baseName = 'voiceanimator') {
  const format = getFormat(formatId);
  const safe = String(baseName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'voiceanimator';
  return `${safe}.${format.extension}`;
}
