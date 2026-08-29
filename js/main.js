/**
 * Chrome, tool routing and the render loop.
 *
 * One `app` object is passed to every tool: the state, the current track, the player,
 * and the two functions that matter — `refresh` rebuilds the track from the state and
 * redraws, `rerender` redraws without rebuilding. Keeping those separate is what makes
 * dragging a zoom control cheap and dragging the speaking rate correct.
 *
 * The version string in the footer is not decoration. A stale cache serving yesterday's
 * build looks exactly like a bug that was never fixed, and reading the version first is
 * cheaper than diagnosing one that is not there. See references/workflow.md.
 */

import { load, save, state, TOOLS, activeCharacter } from './state.js';
import { blinkSchedule, isBlinking, characterByName } from './character.js';
import { buildTrack, trackWarnings } from './lipsync.js';
import { speakerAt } from './timing.js';
import { fitToAudio, describeFit } from './envelope.js';
import { el, clear } from './ui/dom.js';
import { capDiagramScale, dualLabel } from './ui/patterns.js';
import { createPlayer } from './ui/player.js';
import { renderWarnings } from './ui/warnings.js';
import { downloadProject, openProjectFile, PROJECT_ACCEPT } from './ui/export.js';
import { releaseAudio } from './ui/audio.js';

import * as animate from './ui/tools/animate.js';
import * as breakdown from './ui/tools/breakdown.js';
import * as characterTool from './ui/tools/character.js';
import * as mouths from './ui/tools/mouths.js';
import * as exportTool from './ui/tools/export.js';

export const APP_VERSION = '1.3.2';

const TOOL_MODULES = {
  animate, breakdown, character: characterTool, mouths, export: exportTool,
};

const dom = {};

/* ---------------------------------------------------------------------------- *
 * The app object handed to every tool
 * ---------------------------------------------------------------------------- */

const app = {
  state,
  track: null,
  player: null,
  zoom: 1,

  /** Blink times for the current track. Rebuilt with the track, not every frame. */
  blinks: [],

  /**
   * The character on stage at `time` - the one a `[as name]` cue named, or the one
   * picked in the editor. Falls back rather than blanking the stage on a bad name.
   */
  characterAt(time) {
    const named = speakerAt(app.track?.speakers, time);
    if (named) {
      const match = characterByName(state.characters, named);
      if (match) return match;
    }
    return activeCharacter(state);
  },

  /** Whether the eyes are shut at `time`. */
  blinkingAt(time) {
    return state.blink.enabled && isBlinking(app.blinks, time);
  },

  /** The decoded recording, if one is loaded. Never persisted - it is a local file. */
  audio: null,
  fitAudio: true,
  fitPauses: true,
  audioThreshold: 0.08,
  audioMinSilence: 0.12,
  fitDescription: '',

  /** Rebuild the track from the state, then redraw everything. */
  refresh() {
    buildCurrentTrack();
    save();
    render();
  },

  /** Redraw without rebuilding the track. */
  rerender() {
    render();
  },

  save() {
    save();
  },

  setAudio(analysis) {
    if (app.audio && app.audio !== analysis) releaseAudio(app.audio);
    app.audio = analysis;
    if (!analysis && dom.audioElement) {
      dom.audioElement.remove();
      dom.audioElement = null;
      app.player.setAudio(null);
    }
    if (analysis) attachAudioElement(analysis);
    app.refresh();
  },
};

function attachAudioElement(analysis) {
  if (!dom.audioElement) {
    dom.audioElement = el('audio', { preload: 'auto', class: 'visually-hidden' });
    document.body.appendChild(dom.audioElement);
  }
  dom.audioElement.src = analysis.url;
  app.player.setAudio(dom.audioElement);
}

/* ---------------------------------------------------------------------------- *
 * Building the track
 * ---------------------------------------------------------------------------- */

function buildCurrentTrack() {
  const modelled = buildTrack(state.script, {
    settings: state.settings,
    schemeId: state.schemeId,
    overrides: state.overrides,
  });

  if (app.audio && app.fitAudio) {
    const fit = fitToAudio(modelled, app.audio, { usePauses: app.fitPauses });
    app.track = fit.track;
    app.fitDescription = describeFit(fit, app.audio);
  } else {
    app.track = modelled;
    app.fitDescription = '';
  }

  app.player?.setDuration(app.track.duration);

  // A blink schedule is deterministic for a given duration, so it only changes when the
  // track does - not on every re-render, which would make the eyes flutter.
  app.blinks = state.blink.enabled
    ? blinkSchedule(app.track.duration, {
      everySeconds: state.blink.everySeconds,
      seed: Math.max(1, Math.round(app.track.duration * 1000)),
    })
    : [];

  return app.track;
}

/* ---------------------------------------------------------------------------- *
 * Chrome
 * ---------------------------------------------------------------------------- */

function applyTheme() {
  if (state.theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', state.theme);
}

const THEME_LABEL = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };
const THEME_SHORT = { system: 'Auto', light: 'Light', dark: 'Dark' };

function buildHeader() {
  const themeButton = el('button', {
    class: 'btn', type: 'button', id: 'theme-toggle',
    title: 'Switch between following the system, always light, and always dark',
  });

  const paintTheme = () => {
    clear(themeButton);
    themeButton.append(...dualLabel(THEME_LABEL[state.theme], THEME_SHORT[state.theme]));
  };

  themeButton.addEventListener('click', () => {
    const order = ['system', 'light', 'dark'];
    state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
    applyTheme();
    paintTheme();
    save();
  });
  paintTheme();

  // The file dialog cannot be opened without a real <input type=file>, so one lives
  // here permanently and the visible button clicks it.
  const projectInput = el('input', {
    type: 'file',
    accept: PROJECT_ACCEPT,
    class: 'visually-hidden',
    'aria-hidden': 'true',
    tabindex: '-1',
    on: {
      change: async (event) => {
        const [file] = event.target.files ?? [];
        event.target.value = '';            // so the same file can be opened twice
        await openProjectFile(app, file);
      },
    },
  });

  // Both labels are rendered and CSS picks one, rather than measuring in JS: on a phone
  // these shorten to Save and Load before they can crowd the wordmark.
  const saveButton = el('button', {
    class: 'btn', type: 'button', id: 'save-project',
    title: 'Save the script, settings, pronunciation corrections and artwork to a file on this machine',
    on: { click: () => downloadProject(state) },
  }, dualLabel('Save project', 'Save'));

  const loadButton = el('button', {
    class: 'btn', type: 'button', id: 'load-project',
    title: 'Open a project file saved from this app',
    on: { click: () => projectInput.click() },
  }, dualLabel('Load project', 'Load'));

  return el('header', { class: 'app-header' }, [
    el('div', { class: 'brand' }, [
      el('img', { class: 'brand__logo', src: 'assets/logo.png', alt: 'Detronics' }),
      el('span', { class: 'brand__sep', 'aria-hidden': 'true' }),
      el('span', { class: 'brand__tool', text: 'VoiceAnimator' }),
    ]),
    el('div', { class: 'header-actions' }, [saveButton, loadButton, themeButton, projectInput]),
  ]);
}

function buildTabs() {
  const bar = el('div', { class: 'segmented', role: 'tablist', 'aria-label': 'Tools' });

  for (const toolId of TOOLS) {
    const tool = TOOL_MODULES[toolId];
    bar.appendChild(el('button', {
      class: 'segmented__btn',
      type: 'button',
      role: 'tab',
      'aria-selected': String(toolId === state.tool),
      dataset: { tool: toolId },
      on: {
        click: () => {
          if (state.tool === toolId) return;
          state.tool = toolId;
          save();
          render();
        },
      },
    }, dualLabel(tool.label, tool.shortLabel)));
  }

  return bar;
}

function buildFooter() {
  return el('footer', { class: 'app-footer' }, [
    el('span', { text: 'Everything runs in your browser. No script, recording or drawing is uploaded.' }),
    el('nav', {}, [
      el('a', {
        href: 'https://github.com/DanielSWolf/rhubarb-lip-sync',
        target: '_blank', rel: 'noopener noreferrer',
        text: 'Rhubarb Lip Sync',
      }),
      el('span', { class: 'muted', text: `v${APP_VERSION}` }),
    ]),
  ]);
}

/* ---------------------------------------------------------------------------- *
 * Rendering
 * ---------------------------------------------------------------------------- */

/**
 * Whether the user has their hands on a control right now.
 *
 * Only controls that are edited *continuously* count: a text box being typed into, a
 * slider being dragged. Buttons, chips, checkboxes and selects are discrete - by the time
 * their handler runs the interaction is over, and rebuilding them is not only safe but
 * necessary, since a chip has to redraw to show that it is now the pressed one.
 */
function isLiveEditing() {
  const node = document.activeElement;
  if (!node || !dom.sidebar.contains(node)) return false;
  if (node.tagName === 'TEXTAREA') return true;
  if (node.tagName !== 'INPUT') return false;
  return ['text', 'number', 'range', 'search'].includes(node.type);
}

/**
 * Set when a render skipped the controls, so they can be caught up later.
 *
 * The controls read from the track - word counts, durations, "one frame is 42 ms" - so
 * they do go stale while this is true. That is the trade: a hint a few hundred
 * milliseconds behind is invisible, and a text field destroyed under the user's cursor
 * is not.
 */
let sidebarStale = false;

/** Which tool the controls currently on screen belong to. */
let sidebarTool = null;

function renderSidebar() {
  const tool = TOOL_MODULES[state.tool] ?? TOOL_MODULES.animate;
  clear(dom.sidebar).appendChild(tool.sidebar(app));
  sidebarTool = state.tool;
  sidebarStale = false;
}

function render() {
  const tool = TOOL_MODULES[state.tool] ?? TOOL_MODULES.animate;

  // Tabs reflect the current tool without being rebuilt.
  for (const button of dom.tabs.querySelectorAll('[data-tool]')) {
    button.setAttribute('aria-selected', String(button.dataset.tool === state.tool));
  }

  clear(dom.stage).appendChild(tool.stage(app));
  capDiagramScale(dom.stage);

  clear(dom.extra);
  if (tool.extra) dom.extra.appendChild(tool.extra(app));

  clear(dom.readout).appendChild(tool.readout(app));

  const banners = [
    ...trackWarnings(app.track),
    ...(tool.warnings ? tool.warnings(app) : []),
  ];
  renderWarnings(dom.banners, banners);

  clear(dom.explain).appendChild(tool.explain(app));

  // Never rebuild the controls while one of them is being used. Typing in the script box
  // fires a rebuild on every keystroke, and rebuilding replaces the textarea - so the
  // caret lands on <body> and the next letter goes nowhere. The same applies to a slider
  // mid-drag, which is detached and stops following the pointer.
  //
  // Only ever skipped when the controls would be the *same* ones. A different tool means
  // a different panel, and leaving the old tool's controls up would be worse than losing
  // a caret - which is exactly what happens if the click that changed tool did not move
  // focus off the field first, as a synthetic click does not, and nor does a real one in
  // every browser.
  if (isLiveEditing() && sidebarTool === state.tool) sidebarStale = true;
  else renderSidebar();

  // Paint the first frame of the new view at wherever the playhead already is.
  tool.frame?.(app, app.player.time);
}

/** Catch the controls up once the user has finished with whatever they were editing. */
function bindSidebarCatchUp() {
  dom.sidebar.addEventListener('focusout', () => {
    // Let focus settle first: moving between two fields inside the panel is not leaving.
    setTimeout(() => {
      if (sidebarStale && !isLiveEditing()) renderSidebar();
    }, 0);
  });
}

function buildViewport() {
  dom.tabs = buildTabs();
  dom.stage = el('div', { class: 'viewport__stage', id: 'stage' });
  dom.extra = el('div', { class: 'viewport__extra', id: 'extra' });
  dom.readout = el('div', { id: 'readout' });
  dom.banners = el('div', { class: 'banners', id: 'banners' });
  dom.explain = el('div', { class: 'explain-host', id: 'explain' });

  return el('section', { class: 'viewport' },
    [dom.tabs, dom.stage, dom.extra, dom.readout, dom.banners, dom.explain]);
}

/* ---------------------------------------------------------------------------- *
 * Keyboard
 * ---------------------------------------------------------------------------- */

function bindKeys() {
  window.addEventListener('keydown', (event) => {
    // Never steal a key from someone typing a script.
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.code === 'Space') {
      event.preventDefault();
      app.player.toggle();
      app.onPlayStateChange?.();
    } else if (event.code === 'ArrowLeft') {
      event.preventDefault();
      app.player.step(event.shiftKey ? -10 : -1, state.settings.fps);
      app.onPlayStateChange?.();
    } else if (event.code === 'ArrowRight') {
      event.preventDefault();
      app.player.step(event.shiftKey ? 10 : 1, state.settings.fps);
      app.onPlayStateChange?.();
    } else if (event.code === 'Home') {
      event.preventDefault();
      app.player.stop();
      app.onPlayStateChange?.();
    }
  });
}

/* ---------------------------------------------------------------------------- *
 * Start
 * ---------------------------------------------------------------------------- */

function init() {
  load();
  applyTheme();

  app.player = createPlayer({
    onFrame: (time) => {
      const tool = TOOL_MODULES[state.tool] ?? TOOL_MODULES.animate;
      tool.frame?.(app, time);
    },
    onStop: () => app.onPlayStateChange?.(),
  });
  app.player.setLoop(state.loop);

  buildCurrentTrack();

  dom.sidebar = el('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Controls' });
  document.body.append(
    buildHeader(),
    el('main', { class: 'app-main' }, [buildViewport(), dom.sidebar]),
    buildFooter(),
  );

  render();
  bindKeys();
  bindSidebarCatchUp();
  save();
}

init();
