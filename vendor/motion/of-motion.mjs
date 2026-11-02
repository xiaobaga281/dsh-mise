/**
 * of-motion — the motion kit for OpenFilm shot pages.
 *
 * @of-motion v3
 *
 * Copied into a film project by `mise_run open` (and by `mise_new`), so a
 * page imports it with a relative path: <script type="module" src="of-motion.mjs">.
 * Pages live in the project root by convention; a page in a subfolder imports
 * "../of-motion.mjs". `mise_check` reports an import that does not resolve.
 *
 * Why a kit instead of hand-written math in every page:
 *
 *  - Determinism. A film's picture is a pure function of t, so the same t must
 *    always draw the same frame. Everything here is a pure function of (t, and
 *    nothing else). `rnd` is explicitly seeded: the host freezes `Math.random`
 *    to a seed of t, but a page that reaches for it depends on a host detail it
 *    cannot see, and a seeded stream makes the number reproducible in a unit
 *    test without any host at all.
 *  - One vocabulary. `press`, `typewriter`, `stagger` and `fadeEnv` are named
 *    once here, so five pages read as one film instead of five guesses at how a
 *    thing should move.
 *
 * @module of-motion
 */

/* ── scalars ─────────────────────────────────────────────────────────────── */

/** Clamp to 0..1, the range every easing expects. */
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Linear interpolation. */
export const lerp = (a, b, k) => a + (b - a) * k;

/** Map `v` from one range to another, clamped to the target range. */
export const mapRange = (v, inMin, inMax, outMin, outMax) =>
  lerp(outMin, outMax, clamp01((v - inMin) / (inMax - inMin || 1)));

/* ── easings ─────────────────────────────────────────────────────────────── */

/** Decelerate: fast then settle. The default for anything arriving. */
export const easeOut = (k) => 1 - Math.pow(1 - k, 3);

/** Accelerate: slow then away. The default for anything leaving. */
export const easeIn = (k) => k * k * k;

/** Slow at both ends. The default for anything crossing the stage. */
export const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

/** Stronger deceleration, for long travel. */
export const easeOutExpo = (k) => (k === 1 ? 1 : 1 - Math.pow(2, -10 * k));

/** Overshoot past the target, then come back. */
export const easeOutBack = (k, s = 1.70158) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2);

/**
 * A sticker being pressed onto the page: it arrives, dips past its mark, and
 * settles. Returns 0 before `start`, 1 after `start + dur`, and in between a
 * value that overshoots once.
 * @param {number} t seconds
 * @param {number} [start]
 * @param {number} [dur]
 */
export function press(t, start = 0, dur = 0.45) {
  if (t <= start) return 0;
  if (t >= start + dur) return 1;
  const k = (t - start) / dur;
  // Two overshoots reads as a bounce; one reads as a press.
  return easeOutBack(clamp01(k), 1.2);
}

/* ── seeded random ───────────────────────────────────────────────────────── */

/**
 * A deterministic random stream. `rnd(seed)` returns a function producing the
 * same sequence every time, so a particle field is reproducible: same t, same
 * picture, no host needed.
 * @param {number} seed
 * @returns {() => number} values in [0, 1)
 */
export function rnd(seed = 1) {
  let s = Math.floor(seed) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A stable pseudo-random value in [0,1) for a given index, without a stream:
 * `hash(i)` is the same number in every page and every frame.
 * @param {number} i
 */
export function hash(i) {
  let s = Math.floor(i) | 0;
  s = (s + 0x6d2b79f5) | 0;
  let x = Math.imul(s ^ (s >>> 15), 1 | s);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/* ── tween: several properties, one curve ───────────────────────────────── */

/**
 * One or several properties moving together, from `from` to `to`, over `dur`
 * seconds, on one easing.
 *
 * Replaces the shape that otherwise gets hand-written in every page:
 * `left: lerp(a, b, easeOut(k)) + 'px'; top: lerp(...); scale: lerp(...)` —
 * three lines that drift apart the moment one is edited. Here they are one
 * call, and the easing is chosen once for the whole move, which is what makes
 * a move read as one move.
 *
 * @param {Record<string, number>} from starting values
 * @param {Record<string, number>} to ending values
 * @param {number} t seconds
 * @param {{ start?: number, dur?: number, ease?: (k: number) => number }} [o]
 * @returns {Record<string, number>} the values at t (keys of `from`)
 */
export function tween(from, to, t, o = {}) {
  const { start = 0, dur = 0.6, ease = easeOut } = o;
  const k = clamp01((t - start) / dur);
  const e = ease(k);
  const out = {};
  for (const key of Object.keys(from)) out[key] = lerp(from[key], to[key] ?? from[key], e);
  return out;
}

/* ── spring: the physics of a landing ───────────────────────────────────── */

/**
 * A damped spring's position at time `t` — the curve of something released
 * off-centre that settles.
 *
 * `press` above fakes a landing with one overshoot on a cubic bezier; this is
 * the real thing, integrated from the same ODE a physics engine uses (semi-
 * implicit Euler at a fixed 1 ms step, so it stays a pure function of t and
 * costs four multiplies a step: a two-second spring is 2000 steps, ~0.2 ms).
 *
 * The defaults are tuned for a landing, not a launch: one visible overshoot of
 * about 12% over roughly half a second. `stiffness` (how hard it pulls) and
 * `damping` (how fast it loses energy) reshape it — a lower damping bounces
 * longer, a higher one thuds straight in.
 *
 * @param {number} t seconds
 * @param {{ stiffness?: number, damping?: number, mass?: number, from?: number, to?: number }} [o]
 * @returns {number} the position between `from` and `to`
 */
export function spring(t, o = {}) {
  const { stiffness = 120, damping = 9, mass = 1, from = 0, to = 1 } = o;
  if (t <= 0) return from;
  // Fixed-step integration: deterministic, and independent of frame rate.
  const STEP = 0.001;
  // Displacement from the target, in units of the whole move: released from
  // `from`, which is one unit away from `to`.
  let x = from === to ? 0 : -1;
  let v = 0;
  const k = stiffness / mass;
  const c = damping / mass;
  const steps = Math.min(20_000, Math.floor(t / STEP));
  for (let i = 0; i < steps; i++) {
    const a = -k * x - c * v;
    v += a * STEP;
    x += v * STEP;
  }
  // x runs from −1 (at `from`) to 0 (at `to`), so the progress is x + 1.
  return lerp(from, to, x + 1);
}

/* ── nudge: something that is never quite still ─────────────────────────── */

/**
 * A small idle motion — the breathing of a logo, the sway of a hanging tag.
 * A sine of `amp` px at `period` seconds, so it is periodic and never
 * settles: the page looks alive while nothing happens.
 *
 * @param {number} t seconds
 * @param {{ amp?: number, period?: number, phase?: number, start?: number }} [o]
 * @returns {number} the offset in px at t
 */
export function nudge(t, o = {}) {
  const { amp = 4, period = 3, phase = 0, start = 0 } = o;
  if (t < start) return 0;
  return amp * Math.sin(((t - start) / period) * Math.PI * 2 + phase);
}

/* ── composites ──────────────────────────────────────────────────────────── */

/**
 * One of a list arriving in sequence. `i`-th of `count` starts `step` seconds
 * after the first, each taking `dur` to arrive.
 * @returns {number} 0 before it starts, 1 after it lands
 */
export function stagger(i, t, start = 0, step = 0.15, dur = 0.5) {
  return easeOut(clamp01((t - start - i * step) / dur));
}

/**
 * Text typed one character at a time. Returns the substring visible at `t`,
 * so a caption can be written without a loop.
 * @param {string} text
 * @param {number} t
 * @param {number} [start]
 * @param {number} [per] seconds per character
 * @returns {string}
 */
export function typewriter(text, t, start = 0, per = 0.06) {
  if (t <= start) return '';
  const count = Math.floor((t - start) / per);
  return count >= text.length ? text : text.slice(0, Math.max(0, count));
}

/** True while `typewriter` still has characters left to show at `t`. */
export function typing(text, t, start = 0, per = 0.06) {
  return t > start && t < start + per * text.length;
}

/**
 * A number counting up to `target`. Whole numbers while climbing, so a counter
 * never shows a fraction mid-animation.
 * @param {number} target
 * @param {number} t
 * @param {number} [start]
 * @param {number} [dur]
 */
export function counter(target, t, start = 0, dur = 1) {
  if (t <= start) return 0;
  if (t >= start + dur) return target;
  return Math.round(target * easeOut(clamp01((t - start) / dur)));
}

/* ── the clip's own fade ─────────────────────────────────────────────────── */

/**
 * How visible a clip is at its own second `local`, for a fade written on it in
 * film.html as `fade="[in, out]"`.
 *
 * This matches upstream `fadeGain` (film-doc.mjs) exactly — same proportional
 * shortening when in+out exceed the clip, same linear ramps — so a page can fade
 * its own contents in sympathy with the fade the film applies to the clip. A page
 * that ignores it still fades (the host fades the element); this is for content
 * that must move with the clip, not instead of it.
 *
 * @param {number} local seconds into the clip's own span
 * @param {number} length the clip's length in seconds
 * @param {[number, number] | null | undefined} fade
 * @returns {number} 0..1
 */
export function fadeEnv(local, length, fade) {
  if (!fade || !(length > 0)) return 1;
  const fin = Number(fade[0]) || 0;
  const fout = Number(fade[1]) || 0;
  const k = fin + fout > length ? length / (fin + fout) : 1;
  const a = fin * k;
  const b = fout * k;
  let g = 1;
  if (a > 0) g = Math.min(g, local / a);
  if (b > 0) g = Math.min(g, (length - local) / b);
  return Math.max(0, Math.min(1, g));
}

/**
 * A fade shortened to fit the clip, as upstream `fittedFade` computes it. Use it
 * to draw a progress bar that knows where the fade really ends.
 * @returns {[number, number] | null}
 */
export function fitFade(fade, length) {
  if (!fade || !(length > 0)) return null;
  const fin = Number(fade[0]) || 0;
  const fout = Number(fade[1]) || 0;
  const k = fin + fout > length ? length / (fin + fout) : 1;
  return [fin * k, fout * k];
}

/* ── applying it ─────────────────────────────────────────────────────────── */

/**
 * Write a batch of properties on an element in one go.
 *
 * One assignment per property is fine, but a page that sets six of them in
 * `frame(t)` reads better as one call, and a missing element is a page bug that
 * should not take the whole film down.
 * @param {Element} el
 * @param {Record<string, string|number>} props
 */
export function apply(el, props) {
  if (!el) return;
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') el.textContent = String(value);
    else if (key === 'transform') el.style.transform = String(value);
    else if (key === 'opacity') el.style.opacity = String(value);
    else if (key === 'filter') el.style.filter = String(value);
    else el.style[key] = String(value);
  }
}

/** A `transform` string from parts, skipping the ones not given. */
export function transform({ x = 0, y = 0, scale = 1, rotate = 0, origin }) {
  const parts = [];
  if (x || y) parts.push(`translate(${x}px, ${y}px)`);
  if (scale !== 1) parts.push(`scale(${scale})`);
  if (rotate) parts.push(`rotate(${rotate}deg)`);
  return { transform: parts.join(' ') || 'none', ...(origin ? { transformOrigin: origin } : {}) };
}

/**
 * Everything a page needs for the most common move: an element that presses on,
 * holds, and lifts off. One call in `frame(t)`.
 * @param {Element} el
 * @param {number} t
 * @param {{ start?: number, dur?: number, hold?: number, lift?: number, from?: number, rotate?: number }} [o]
 */
export function pressAndLift(el, t, o = {}) {
  const { start = 0, dur = 0.45, hold = 1.0, lift = 0.4, from = 0.55, rotate = 0 } = o;
  const pressK = press(t, start, dur);
  const liftStart = start + dur + hold;
  const liftK = clamp01((t - liftStart) / lift);
  const scale = lerp(from, 1, pressK) * (1 - 0.08 * liftK);
  apply(el, {
    opacity: String(Math.min(pressK, 1 - liftK)),
    transform: `scale(${scale}) rotate(${rotate}deg) translateY(${-24 * liftK}px)`,
  });
}

/**
 * ── Real size, real text ────────────────────────────────────────────────────
 *
 * A film is shown at whatever size its stage is, not at the size guessed while
 * writing a page. These helpers read the box the page is actually laid out in
 * and fit text to it, so a title or a caption never overflows on a phone-shaped
 * stage because someone wrote 96px for a 1920px frame.
 */

/**
 * The page's own box, in CSS pixels: the stage the film is being drawn at.
 * Falls back to the film's declared size and then the window.
 * @param {Element} [el] the element to measure (default: document.body)
 * @returns {{ width: number, height: number }}
 */
export function stageSize(el) {
  const target = el ?? (typeof document !== 'undefined' ? document.body : null);
  const rect = target?.getBoundingClientRect?.();
  const width = Math.round(rect?.width || (typeof window !== 'undefined' ? window.film?.width ?? window.innerWidth : 0));
  const height = Math.round(rect?.height || (typeof window !== 'undefined' ? window.film?.height ?? window.innerHeight : 0));
  return { width, height };
}

/**
 * Fit an element's font size to a box by measuring the text, not guessing.
 *
 * The measurement is made on a hidden copy of the element, so the page never
 * flickers through wrong sizes. `wrap: true` measures inside `maxWidth` and
 * also respects `maxHeight`; the default fits one line and is what a title
 * wants. The chosen size is written to the element's own `font-size`.
 *
 * Call it once (after `document.fonts.ready`), not inside frame(t): the result
 * must not depend on t.
 * @param {Element} el
 * @param {{ maxWidth?: number, maxHeight?: number, min?: number, max?: number, step?: number, wrap?: boolean }} [options]
 * @returns {number} the font size used, in px
 */
export function fitText(el, options = {}) {
  if (!el || typeof document === 'undefined') return 0;
  const { maxHeight = Infinity, min = 12, max = 240, step = 2, wrap = false } = options;
  const width = Math.round(options.maxWidth || el.parentElement?.clientWidth || stageSize().width * 0.86);
  if (!(width > 0)) return 0;
  const probe = el.cloneNode(true);
  Object.assign(probe.style, {
    position: 'absolute', left: '-10000px', top: '0', visibility: 'hidden',
    display: 'block', margin: '0', width: wrap ? `${width}px` : 'auto',
    whiteSpace: wrap ? 'normal' : 'nowrap', pointerEvents: 'none',
  });
  (el.parentElement ?? document.body).appendChild(probe);
  try {
    for (let size = max; size >= min; size -= step) {
      probe.style.fontSize = `${size}px`;
      const box = probe.getBoundingClientRect();
      const fitsWidth = box.width <= width + 0.5;
      const fitsHeight = box.height <= maxHeight + 0.5;
      if (fitsWidth && fitsHeight) {
        el.style.fontSize = `${size}px`;
        return size;
      }
    }
    el.style.fontSize = `${min}px`;
    return min;
  } finally {
    probe.remove();
  }
}

/**
 * Fit text once the page's fonts have loaded — the size a fallback font
 * measures is not the size the real font needs.
 * @param {Element} el @param {object} [options] see fitText
 * @returns {Promise<number>}
 */
export async function fitTextWhenReady(el, options = {}) {
  try { await document?.fonts?.ready; } catch {}
  return fitText(el, options);
}

export default {
  clamp01, lerp, mapRange,
  easeOut, easeIn, easeInOut, easeOutExpo, easeOutBack, press,
  tween, spring, nudge,
  rnd, hash,
  stagger, typewriter, typing, counter,
  fadeEnv, fitFade,
  apply, transform, pressAndLift,
  stageSize, fitText, fitTextWhenReady,
};
