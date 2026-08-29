/**
 * Live banners.
 *
 * The house rule is to warn as a value crosses something worth knowing about, not to
 * refuse the value when the user tries to move on. Nothing here blocks anything: every
 * banner is a sentence saying what has happened and what it means.
 *
 * The sentences themselves come from the pure modules, so they can be - and are - tested
 * for the thing that most often goes wrong with them, which is a raw internal value
 * ending up in the middle of a sentence. pitfalls.md #9.
 */

import { el, clear } from './dom.js';

const TONE = { ok: 'banner-ok', warn: 'banner-warn', danger: 'banner-danger' };

export function renderWarnings(host, warnings) {
  clear(host);
  if (!warnings.length) return host;

  for (const warning of warnings) {
    host.appendChild(el('div', {
      class: `banner ${TONE[warning.level] ?? TONE.warn}`,
      role: warning.level === 'danger' ? 'alert' : 'status',
      text: warning.text,
    }));
  }
  return host;
}
