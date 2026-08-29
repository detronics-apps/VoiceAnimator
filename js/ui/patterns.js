/**
 * Reusable helpers that exist because something broke without them.
 * See references/pitfalls.md for the symptom each one cures.
 *
 * The scaffold copies this to js/ui/patterns.js. Import what you need;
 * `capDiagramScale` in particular must be called on every render.
 */

import { el } from './dom.js';

/* ====================================================================== *
 * Tooltips - pitfalls.md #1
 *
 * ALREADY DONE FOR YOU in assets/dom.js, which the scaffold vendors: use its
 * `infoIcon(text)`. It is documented here so the reason survives.
 *
 * The bubble cannot live inside the icon. A sidebar with `overflow-y: auto` is
 * a clipping context, and descendants are clipped to it whatever their
 * z-index. One shared bubble on <body>, positioned in viewport coordinates,
 * escapes every clipping context on the page.
 *
 * Three things that are easy to leave out:
 *   - retire it on scroll and resize, or it drifts away from its icon
 *   - bind click as well as mouseenter, or it is unreachable on a phone
 *   - pointer-events: none, so it never eats a click meant for what is under it
 * ====================================================================== */

/* ====================================================================== *
 * Diagram scale - pitfalls.md #3
 *
 * Renderers size their canvas to the circuit, which is right. Letting the
 * browser then stretch that canvas to fill the panel is not: a one-component
 * drawing gets magnified several times over. Pinning max-width to the viewBox
 * width keeps one drawing unit at one pixel, so every diagram is drawn at the
 * same scale. Narrower panels still shrink it to fit.
 *
 * Call after replacing the stage contents, on every render.
 * ====================================================================== */

export function capDiagramScale(host) {
  for (const node of host.querySelectorAll('svg[viewBox]')) {
    const width = Number(node.getAttribute('viewBox').split(/\s+/)[2]);
    if (Number.isFinite(width) && width > 0) node.style.maxWidth = `${Math.round(width)}px`;
  }
}

/* ====================================================================== *
 * Standalone SVG export - pitfalls.md #7
 *
 * `fill="var(--text)"` resolves against the document. In a downloaded file
 * there is no document, so every token has to be substituted for its computed
 * value before serialising. Assert the output contains no `var(--`.
 * ====================================================================== */

export function inlineTokens(node) {
  const computed = getComputedStyle(document.documentElement);
  const resolve = (value) => value.replace(
    /var\((--[\w-]+)\)/g,
    (_, name) => computed.getPropertyValue(name).trim() || '#000000',
  );

  const walk = (element) => {
    for (const attr of Array.from(element.attributes || [])) {
      if (attr.value.includes('var(--')) element.setAttribute(attr.name, resolve(attr.value));
    }
    if (element.style?.cssText?.includes('var(--')) {
      element.style.cssText = resolve(element.style.cssText);
    }
    for (const child of element.children) walk(child);
  };
  walk(node);
  return node;
}

/** A standalone copy of a live SVG: tokens resolved, font stated, ground painted. */
export function standaloneSvg(source, { background = true, padding = 12 } = {}) {
  const clone = source.cloneNode(true);
  inlineTokens(clone);

  const [, , vbW, vbH] = (clone.getAttribute('viewBox') || '0 0 760 250').split(/\s+/).map(Number);

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', vbW);
  clone.setAttribute('height', vbH);
  clone.setAttribute('font-family', 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif');

  // Interactive attributes mean nothing in a file.
  for (const node of clone.querySelectorAll('[tabindex], [role], [aria-pressed]')) {
    node.removeAttribute('tabindex');
    node.removeAttribute('aria-pressed');
    if (node.getAttribute('role') === 'button') node.setAttribute('role', 'presentation');
  }

  if (background) {
    // A transparent PNG looks broken pasted into a light document.
    const panel = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#ffffff';
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', -padding);
    rect.setAttribute('y', -padding);
    rect.setAttribute('width', vbW + padding * 2);
    rect.setAttribute('height', vbH + padding * 2);
    rect.setAttribute('fill', panel);
    clone.insertBefore(rect, clone.firstChild);
  }

  return { node: clone, width: vbW, height: vbH };
}

/* ====================================================================== *
 * Arrowheads - pitfalls.md #6
 *
 * An arrowhead is barb - apex - barb, with the apex exactly on the shaft tip
 * and the barbs trailing back at about 150 degrees from the direction of
 * travel. A pair is offset along the perpendicular of its direction, or the
 * two arrows splay apart instead of running parallel.
 * ====================================================================== */

/** Two parallel arrows pointing up and to the right from (x, y). */
export function emissionArrows(group, x, y, path) {
  for (const offset of [0, 10]) {          // (1, 1) is perpendicular to (1, -1)
    const x0 = x + offset;
    const y0 = y + offset;
    const tipX = x0 + 11;
    const tipY = y0 - 11;
    group.appendChild(path(`M ${x0} ${y0} L ${tipX} ${tipY}`));
    group.appendChild(path(`M ${tipX - 2} ${tipY + 6} L ${tipX} ${tipY} L ${tipX - 6} ${tipY + 2}`));
  }
}

/* ====================================================================== *
 * Dual labels - pitfalls.md, header section
 *
 * Render both labels and let CSS pick one, rather than measuring in JS.
 * Needs `el` from ./dom.js.
 * ====================================================================== */

export const dualLabel = (long, short) => [
  el('span', { class: 'btn-label btn-label--long', text: long }),
  el('span', { class: 'btn-label btn-label--short', text: short }),
];

/* ====================================================================== *
 * State migration - pitfalls.md #8
 *
 * localStorage, project files and share links all outlive the code. Whenever a
 * slice changes shape, migrate it on the way in - and remember that a renamed
 * *value* needs migrating as much as a renamed key.
 *
 * Note `|| 'custom'`: spreading an incoming slice that carries a key set to
 * undefined will overwrite a perfectly good default.
 * ====================================================================== */

export function migrateExample(slice) {
  if (!slice || typeof slice !== 'object') return slice;
  if (Array.isArray(slice.items) && slice.items.length) {
    // Already current in shape, but a renamed value may still need fixing.
    return slice.mode === 'oldName' ? { ...slice, mode: 'newName' } : slice;
  }

  const count = Math.max(1, Number(slice.count) || 1);
  const migrated = {
    ...slice,
    mode: slice.mode === 'oldName' ? 'newName' : (slice.mode || 'custom'),
    items: Array.from({ length: count }, () => ({ value: Number(slice.value) || 0 })),
  };
  delete migrated.count;
  delete migrated.value;
  return migrated;
}
