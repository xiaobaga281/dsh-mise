/**
 * Craft constants, converted from published motion-design guidance into numbers
 * this engine can enforce.
 *
 * Sources behind these numbers:
 * - the 100/300/500 duration ladder (instant / state / layout / entrance) and
 *   "an exit is about 75% of its entrance";
 * - the ~80ms perceptual threshold, below which two events read as simultaneous;
 * - a cap on total stagger (per-item delay × items) so a list does not take a
 *   second to appear;
 * - exponential easing for entrances, and no bounce/elastic: real objects
 *   decelerate, they do not wobble.
 *
 * The point of putting them in code is nothing here stays a suggestion: the
 * page builders read these, and the tests check the pages obey them.
 *
 * @module openfilm-film-craft
 */

/** Seconds. The ladder, not a menu. */
export const DURATION = {
  instant: [0.10, 0.15],
  state: [0.20, 0.30],
  layout: [0.30, 0.50],
  entrance: [0.50, 0.80],
};

/** An exit is quicker than its entrance, or the film feels reluctant. */
export const EXIT_RATIO = 0.75;

/** Two events closer than this read as one event. */
export const SIMULTANEITY = 0.08;

/** Per-item stagger and the total it may never exceed. */
export const STAGGER = { perItem: 0.05, totalCap: 0.5 };

/** Exponential curves, as the CSS the pages actually use. */
export const EASING = {
  enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  exit: 'cubic-bezier(0.7, 0, 0.84, 0)',
  toggle: 'cubic-bezier(0.65, 0, 0.35, 1)',
  quart: 'cubic-bezier(0.25, 1, 0.5, 1)',
};

/** Motion materials, cheapest first. A film needs more than transform/opacity. */
export const MATERIALS = ['transform', 'opacity', 'clip-path', 'blur', 'glow', 'gradient'];

/**
 * Per-item stagger that respects the total cap.
 * @param {number} count
 * @param {{ perItem?: number, totalCap?: number }} [options]
 * @returns {number} the delay per item, in seconds
 */
export function staggerStep(count, options = {}) {
  const perItem = Number(options.perItem ?? STAGGER.perItem);
  const totalCap = Number(options.totalCap ?? STAGGER.totalCap);
  const items = Math.max(1, Number(count) || 1);
  return Math.min(perItem, totalCap / items);
}

/** Clamp an entrance duration into the documented band. */
export function entranceSeconds(seconds) {
  const [lo, hi] = DURATION.entrance;
  const value = Number(seconds);
  if (!Number.isFinite(value)) return hi;
  return Math.min(hi, Math.max(lo, value));
}

/**
 * What a person authoring a film should be told, in the language the rest of
 * the planner speaks. Kept short: three lines people can act on beat a page of
 * theory nobody reads.
 */
export function craftNotes() {
  return [
    `入场 ${DURATION.entrance[0]}–${DURATION.entrance[1]}s，退场取入场的 ${Math.round(EXIT_RATIO * 100)}%；短于 ${SIMULTANEITY * 1000}ms 的两个动作会被看成一个`,
    `错峰每项 ${STAGGER.perItem * 1000}ms，全组总错峰不超过 ${STAGGER.totalCap * 1000}ms（项目多就缩短每项）`,
    `曲线用指数缓出（${EASING.enter}），不要回弹：真实物体是减速停下，不是弹一下`,
  ];
}

/**
 * A small warmth/coolness per shot, in -1..1.
 *
 * A whole film at one white point reads flat, and it is the giveaway of a
 * template. Real coverage drifts: a shot in window light is warmer than the one
 * that follows it in shade. The wave is deterministic, so the same film renders
 * the same on every machine, and it stays inside a small band so the shots still
 * belong to one world.
 * @param {number} index 0-based shot
 * @param {number} [amplitude] 0..1 of the allowed band
 */
export function shotWarmth(index, amplitude = 0.6) {
  const i = Math.max(0, Number(index) || 0);
  const band = Math.max(0, Math.min(1, Number(amplitude)));
  return Number((Math.sin(i * 1.15 + 0.6) * 0.82 * band).toFixed(3));
}

/**
 * The same guidance as a checkable list, for a reviewer or a test.
 * @returns {Array<{ id: string, holds: (value: number) => boolean }>}
 */
export function craftChecks() {
  return [
    { id: 'entrance-band', holds: (seconds) => seconds >= DURATION.entrance[0] && seconds <= DURATION.entrance[1] },
    { id: 'exit-shorter', holds: (exit, enter) => exit < enter },
    { id: 'stagger-cap', holds: (step, count) => step * count <= STAGGER.totalCap + 1e-9 },
    { id: 'not-instant', holds: (seconds) => seconds >= SIMULTANEITY },
  ];
}
