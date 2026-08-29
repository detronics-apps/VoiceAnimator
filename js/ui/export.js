/**
 * Getting things out of the page: text files, SVG, PNG, a share link and a print sheet.
 *
 * The one thing worth reading carefully in here is `svgFile`. A live SVG on the page is
 * full of `var(--token)` references that resolve against the document; in a downloaded
 * file there is no document, so every one of them has to be substituted for its computed
 * value before serialising, or the drawing arrives black. pitfalls.md #7, and the
 * assertion at the end of `serialise` is what stops it happening again.
 */

import { download, toast } from './dom.js';
import { standaloneSvg } from './patterns.js';
import { buildExport, exportFilename } from '../exporters.js';
import { shareLink, toProject, fromProject } from '../state.js';
import { FACE_WIDTH, FACE_HEIGHT } from './face-svg.js';

/* ---------------------------------------------------------------------------- *
 * Text exports
 * ---------------------------------------------------------------------------- */

export function downloadTrack(track, formatId, { baseName, soundFile } = {}) {
  const { text, format } = buildExport(track, formatId, { soundFile });
  download(new Blob([text], { type: `${format.mime};charset=utf-8` }),
    exportFilename(formatId, baseName));
  toast(`${format.label} downloaded`);
}

export function downloadProject(state) {
  const text = `${JSON.stringify(toProject(state), null, 2)}\n`;
  download(new Blob([text], { type: 'application/json;charset=utf-8' }),
    `${slug(state.projectName)}.voiceanimator.json`);
  toast('Project saved');
}

/** What a project file is offered as, wherever it is offered. */
export const PROJECT_ACCEPT = 'application/json,.json';

/**
 * Read a project file into the running app.
 *
 * One implementation, called from both the header button and the Export tab, so the two
 * cannot drift - a project opened from the toolbar has to behave exactly like one opened
 * from the panel. Everything untrusted about the file is handled by `fromProject`; what
 * is left here is telling the user what happened.
 *
 * @returns {Promise<boolean>} whether the project was opened
 */
export async function openProjectFile(app, file) {
  if (!file) return false;
  let text;
  try {
    text = await file.text();
  } catch {
    toast(`${file.name} could not be read.`);
    return false;
  }

  const { state: loaded, error } = fromProject(text);
  if (error) { toast(error); return false; }

  Object.assign(app.state, loaded);
  app.refresh();
  toast(`${loaded.projectName} opened`);
  return true;
}

const slug = (name) => String(name ?? '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  || 'voiceanimator';

/* ---------------------------------------------------------------------------- *
 * Drawings
 * ---------------------------------------------------------------------------- */

/**
 * Serialise a live SVG into a standalone file.
 *
 * @throws if any token reference survived - a black export is worse than a loud failure
 */
export function serialise(source, options = {}) {
  const { node, width, height } = standaloneSvg(source, options);
  const text = new XMLSerializer().serializeToString(node);

  if (text.includes('var(--')) {
    throw new Error('Export still contains CSS custom properties; see pitfalls.md #7.');
  }
  return { text, width, height };
}

export function downloadSvg(source, name, options = {}) {
  const { text } = serialise(source, options);
  download(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }), `${slug(name)}.svg`);
  toast('SVG downloaded');
}

/**
 * Rasterise through an `<img>` and a canvas.
 *
 * A data URL rather than a blob URL, because a blob URL taints the canvas in some
 * browsers and `toBlob` then throws on read. `scale` is there because a 420px drawing
 * pasted into a slide wants to be 2x that.
 */
export async function downloadPng(source, name, { scale = 2, ...options } = {}) {
  const { text, width, height } = serialise(source, options);
  const encoded = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;

  const image = new Image();
  image.width = width;
  image.height = height;

  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('The drawing could not be rasterised.'));
    image.src = encoded;
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The drawing could not be rasterised.');
  download(blob, `${slug(name)}.png`);
  toast('PNG downloaded');
}

/* ---------------------------------------------------------------------------- *
 * Sharing
 * ---------------------------------------------------------------------------- */

export async function copyShareLink() {
  const link = shareLink();
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copied — the script travels in it, and never leaves the browser');
  } catch {
    // Clipboard permission refused, or an insecure origin. Show it instead of failing.
    window.prompt('Copy this link:', link);
  }
  return link;
}

/* ---------------------------------------------------------------------------- *
 * Cropping a contact sheet
 *
 * The one place a canvas is genuinely needed: `sheetGrid` in js/mouthset.js works out
 * where the cells are, and this cuts them out.
 * ---------------------------------------------------------------------------- */

/** Decode an image file to something a canvas can draw. */
export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve({ image, src: String(reader.result), name: file.name });
      image.onerror = () => reject(new Error(`${file.name} is not an image this browser can read.`));
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Cut one cell out of a sheet.
 *
 * The result is trimmed to the same aspect as the stage and exported as PNG, so a set
 * cut from one sheet is consistent by construction - which is the mismatched-proportions
 * warning in `js/mouthset.js` avoided rather than reported.
 */
export function cropCell(image, cell, { width = FACE_WIDTH, height = FACE_HEIGHT } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fit the cell inside the canvas without distorting it.
  const scale = Math.min(width / cell.width, height / cell.height);
  const drawWidth = cell.width * scale;
  const drawHeight = cell.height * scale;

  ctx.drawImage(
    image,
    cell.x, cell.y, cell.width, cell.height,
    (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight,
  );

  return { src: canvas.toDataURL('image/png'), width, height };
}

/* ---------------------------------------------------------------------------- *
 * Printing
 * ---------------------------------------------------------------------------- */

export function printSheet() {
  window.print();
}
