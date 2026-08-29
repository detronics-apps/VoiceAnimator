/**
 * Export: the track as a file, the drawing as a picture, the whole thing as a link.
 *
 * The preview is the point. Every format here is plain text, so showing it rather than
 * only offering a download means a mistake — the wrong shape names, the wrong frame
 * rate, a track that is half rest — is visible before it reaches an animation package.
 */

import { el, toast } from '../dom.js';
import { section, buttonRow, stat, filePicker } from '../controls.js';
import { explainExport } from '../explain.js';
import {
  downloadTrack, downloadProject, downloadSvg, downloadPng, copyShareLink, printSheet,
  openProjectFile, PROJECT_ACCEPT,
} from '../export.js';
import { EXPORT_FORMATS, NAMING_CHOICES, getFormat, buildExport, exportFilename, lossyShapes } from '../../exporters.js';
import { formatDuration } from '../../timecode.js';

export const id = 'export';
export const label = 'Export';
export const shortLabel = 'Out';

const namingFor = (app) => app.state.exportNaming ?? getFormat(app.state.exportFormat).naming;

export function stage(app) {
  const { state, track } = app;
  const format = getFormat(state.exportFormat);
  const naming = namingFor(app);

  const { text } = buildExport(track, format.id, {
    naming,
    soundFile: state.soundFile,
  });

  const host = el('div', { class: 'export' });

  host.appendChild(el('div', { class: 'export__head' }, [
    el('div', {}, [
      el('div', { class: 'export__title', text: format.label }),
      el('div', { class: 'muted small', text: format.note }),
    ]),
    el('code', { class: 'export__filename', text: exportFilename(format.id, state.projectName) }),
  ]));

  const preview = el('pre', { class: 'export__preview value' });
  const lines = text.split('\n');
  const shown = lines.slice(0, 400).join('\n');
  preview.textContent = shown + (lines.length > 400 ? `\n… ${lines.length - 400} more lines` : '');
  host.appendChild(preview);

  return host;
}

export function readout(app) {
  const { track, state } = app;
  const naming = namingFor(app);
  const lost = lossyShapes(track, naming);

  return el('div', { class: 'readout' }, [
    stat('Cues', String(track.cues.length)),
    stat('Length', formatDuration(track.duration)),
    stat('Frame rate', `${track.settings.fps} fps`),
    stat('Shape names', NAMING_CHOICES.find((c) => c.value === naming)?.label.split(' ')[0] ?? naming),
    stat('Detail lost', lost.length ? `${lost.length} merged` : 'none',
      { tone: lost.length ? 'warn' : 'ok' }),
  ]);
}

export function warnings(app) {
  const lost = lossyShapes(app.track, namingFor(app));
  if (!lost.length) return [];
  return [{
    level: 'warn',
    text: `This naming merges shapes that your scheme keeps apart: ${
      lost.map((entry) => `${entry.merged.join(' and ')} both become ${entry.name}`).join('; ')
    }. Export in the scheme’s own names to keep them separate.`,
  }];
}

export function explain(app) {
  return explainExport(app.track, lossyShapes(app.track, namingFor(app)));
}

/* ---------------------------------------------------------------------------- *
 * Controls
 * ---------------------------------------------------------------------------- */

export function sidebar(app) {
  const { state, track } = app;
  const host = el('div', { class: 'sidebar__body' });

  /* --- the track -------------------------------------------------------- */

  host.appendChild(section('Timing track', [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Format' }),
      el('div', { class: 'chipset chipset--stack' }, EXPORT_FORMATS.map((format) => el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(format.id === state.exportFormat),
        text: format.label,
        title: format.note,
        on: {
          click: () => {
            state.exportFormat = format.id;
            state.exportNaming = null;              // follow the format's own default
            app.refresh();
          },
        },
      }))),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', text: 'Shape names' }),
      el('div', { class: 'chipset chipset--stack' }, NAMING_CHOICES.map((choice) => el('button', {
        class: 'chip', type: 'button',
        'aria-pressed': String(choice.value === namingFor(app)),
        text: choice.label,
        on: { click: () => { state.exportNaming = choice.value; app.refresh(); } },
      }))),
    ]),

    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'sound-file', text: 'Sound file named in the export' }),
      el('input', {
        id: 'sound-file',
        class: 'input',
        value: state.soundFile,
        on: {
          change: (event) => {
            state.soundFile = event.target.value.trim().slice(0, 120) || 'voice.wav';
            app.refresh();
          },
        },
      }),
      el('div', { class: 'field__hint', text: 'Only written into the Rhubarb JSON and XML metadata.' }),
    ]),

    buttonRow([
      {
        label: 'Download',
        primary: true,
        onClick: () => downloadTrack(track, state.exportFormat, {
          baseName: state.projectName,
          soundFile: state.soundFile,
          naming: namingFor(app),
        }),
      },
      {
        label: 'Copy',
        onClick: async () => {
          const { text } = buildExport(track, state.exportFormat, {
            naming: namingFor(app), soundFile: state.soundFile,
          });
          try {
            await navigator.clipboard.writeText(text);
            toast('Copied to the clipboard');
          } catch {
            toast('This browser would not let the page write to the clipboard.');
          }
        },
      },
    ]),
  ]));

  /* --- pictures --------------------------------------------------------- */

  host.appendChild(section('Pictures', [
    el('p', {
      class: 'field__hint',
      text: 'The character as it stands, and the whole pose chart. Both come out as standalone files with the colours baked in.',
    }),
    buttonRow([
      {
        label: 'Character SVG',
        onClick: () => withStageSvg('.animate .face', (node) => downloadSvg(node, `${state.projectName}-pose`)),
      },
      {
        label: 'Character PNG',
        onClick: () => withStageSvg('.animate .face', (node) => downloadPng(node, `${state.projectName}-pose`)),
      },
    ]),
    buttonRow([
      {
        label: 'Chart SVG',
        onClick: () => withStageSvg('.mouths .chart', (node) => downloadSvg(node, `${state.schemeId}-chart`)),
      },
      {
        label: 'Timeline SVG',
        onClick: () => withStageSvg('.timeline', (node) => downloadSvg(node, `${state.projectName}-timeline`)),
      },
    ]),
    el('div', { class: 'field__hint', text: 'A picture can only be exported from the tab that draws it — switch to Animate or Mouth set first.' }),
  ], { open: false }));

  /* --- the project ------------------------------------------------------ */

  host.appendChild(section('Project', [
    el('div', { class: 'field' }, [
      el('label', { class: 'field__label', for: 'project-name', text: 'Project name' }),
      el('input', {
        id: 'project-name',
        class: 'input',
        value: state.projectName,
        on: {
          change: (event) => {
            state.projectName = event.target.value.trim().slice(0, 80) || 'voiceanimator';
            app.refresh();
          },
        },
      }),
    ]),
    el('p', {
      class: 'field__hint',
      text: 'A project file holds the script, the settings, your pronunciation corrections and the artwork. It is plain JSON, saved to your own machine.',
    }),
    buttonRow([
      { label: 'Save project', primary: true, onClick: () => downloadProject(state) },
    ]),
    filePicker({
      label: 'Open project…',
      accept: PROJECT_ACCEPT,
      onFiles: ([file]) => openProjectFile(app, file),
    }),
  ]));

  /* --- sharing ---------------------------------------------------------- */

  host.appendChild(section('Share and print', [
    el('p', {
      class: 'field__hint',
      text: 'A share link carries the script and every setting in the part of the URL after the #, which browsers never send to a server. Artwork is too large for a link — send a project file for that.',
    }),
    buttonRow([
      { label: 'Copy share link', onClick: () => copyShareLink() },
      { label: 'Print timing sheet', onClick: () => printSheet() },
    ]),
  ], { open: false }));

  return host;
}

/** Export a drawing that lives in another tab, and say so plainly if it is not there. */
function withStageSvg(selector, action) {
  const node = document.querySelector(selector);
  if (!node) {
    toast('That drawing is on another tab — switch to it, then export.');
    return;
  }
  try {
    const result = action(node);
    if (result?.catch) result.catch((error) => toast(error.message));
  } catch (error) {
    toast(error.message);
  }
}
