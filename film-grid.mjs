/**
 * The layout system: a real grid, real margins and a type scale.
 *
 * "It looks like a slide" is usually a layout problem before it is a motion
 * problem: content sits at guessed pixel offsets, type sizes are arbitrary, and
 * nothing lines up. A film frame is a canvas with a grid; giving every page the
 * same grid and the same scale is what makes separate shots feel like one film.
 *
 * Works for any aspect: landscape, portrait and square.
 *
 * @module mise-film-grid
 */

/** Frame sizes and margins per aspect, in 1920-long-edge units. */
export const LAYOUTS = {
  '16:9': { width: 1920, height: 1080, columns: 12, margin: 96, gutter: 24, safe: 64 },
  '9:16': { width: 1080, height: 1920, columns: 6, margin: 64, gutter: 18, safe: 96 },
  '1:1': { width: 1080, height: 1080, columns: 8, margin: 72, gutter: 20, safe: 72 },
  '4:5': { width: 1080, height: 1350, columns: 8, margin: 68, gutter: 20, safe: 80 },
};

/**
 * The grid for one aspect.
 * @param {string} aspect
 */
export function gridFor(aspect = '16:9') {
  const layout = LAYOUTS[aspect] ?? LAYOUTS['16:9'];
  const usable = layout.width - layout.margin * 2;
  const column = (usable - layout.gutter * (layout.columns - 1)) / layout.columns;
  return { ...layout, usable, column: Number(column.toFixed(2)) };
}

/** Where a column span sits, in px from the frame's left edge. */
export function columnSpan(grid, { start = 1, span = 1 } = {}) {
  const from = layout2px(grid, start);
  const width = grid.column * span + grid.gutter * (span - 1);
  return { left: from, width: Number(width.toFixed(2)) };
}

function layout2px(grid, column) {
  return Number((grid.margin + (column - 1) * (grid.column + grid.gutter)).toFixed(2));
}

/**
 * A modular type scale: the headline size, a ratio, and the roles a film needs.
 * @param {{ base?: number, ratio?: number }} options
 */
export function typeScale({ base = 28, ratio = 1.333 } = {}) {
  const step = (n) => Math.round(base * Math.pow(ratio, n));
  return {
    display: step(5),
    h1: step(4),
    h2: step(3),
    h3: step(2),
    body: base,
    small: step(-1),
    caption: step(-2),
    ratio,
    base,
  };
}

/**
 * CSS custom properties for a page, so the layout lives in one place instead of
 * in five inline styles that disagree.
 */
export function gridCss(aspect = '16:9', options = {}) {
  const grid = gridFor(aspect);
  const scale = typeScale(options);
  return `:root {
  --frame-w: ${grid.width}px; --frame-h: ${grid.height}px;
  --margin: ${grid.margin}px; --gutter: ${grid.gutter}px; --safe: ${grid.safe}px;
  --col: ${grid.column}px; --cols: ${grid.columns};
  --display: ${scale.display}px; --h1: ${scale.h1}px; --h2: ${scale.h2}px; --h3: ${scale.h3}px;
  --body: ${scale.body}px; --small: ${scale.small}px; --caption: ${scale.caption}px;
  --rule: rgba(255,255,255,0.14);
}`;
}

/**
 * How wide a line of type may run before it stops reading: 60–75 characters is
 * the comfortable band for body text, and a headline should stay on two lines.
 * @param {{ chars: number, size: number, grid: object }} input
 */
export function measureLine({ chars, size, grid }) {
  // A CJK glyph is ~1em wide, a latin one ~0.55em; this is an estimate for
  // planning, not a substitute for the browser's own measurement.
  const em = size;
  const width = chars * em;
  const max = grid.usable;
  return { width: Number(width.toFixed(1)), max, fits: width <= max, ratio: Number((width / max).toFixed(3)) };
}

/** Safe-area check: content must keep this much clear of every edge. */
export function safeArea(grid) {
  return { left: grid.safe, right: grid.width - grid.safe, top: grid.safe, bottom: grid.height - grid.safe };
}
