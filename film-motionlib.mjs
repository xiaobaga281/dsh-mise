/**
 * Motion that behaves like mass: springs, inertia and seeded drift.
 *
 * Linear easing is why a page reads as a slideshow. Real interfaces and real
 * cameras have mass: they overshoot a little, settle, and keep drifting after
 * the input stops. Every function here is closed-form and deterministic in t,
 * so a frame is the same on any machine, and the same motion can be reused by
 * every page instead of being re-typed per shot.
 *
 * @module mise-film-motionlib
 */

/** Damped spring step response: 0 → 1 with a settle curve. */
export function spring(t, { zeta = 0.62, omega = 11, mass = 1 } = {}) {
  const time = Math.max(0, t);
  const w0 = Math.sqrt(omega * omega) / Math.sqrt(Math.max(0.05, mass));
  const z = Math.min(0.99, Math.max(0.05, zeta));
  if (z >= 0.999) {
    // Critically damped: no overshoot, still a real settle.
    return 1 - Math.exp(-w0 * time) * (1 + w0 * time);
  }
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * time) * (Math.cos(wd * time) + ((z * w0) / wd) * Math.sin(wd * time));
}

/** The same spring between two values. */
export function springValue(from, to, t, options) {
  return from + (to - from) * spring(t, options);
}

/** A tiny overshoot on purpose: the settle that reads as "pressed". */
export function press(t, { zeta = 0.42, omega = 16, amount = 1 } = {}) {
  const k = spring(t, { zeta, omega });
  return 1 + (k - 1) * amount;
}

/** Delay for the i-th unit of a staggered reveal, with a seeded jitter. */
export function stagger(i, { base = 0.05, spread = 0.02, seed = 7 } = {}) {
  const noise = Math.sin((i + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  const jitter = (noise - Math.floor(noise)) * spread;
  return base * i + jitter;
}

/**
 * Deterministic smooth drift (a camera that is not on a tripod): a few slow
 * sines at unrelated rates, so it never visibly loops.
 */
export function drift(t, { seed = 3, amount = 1 } = {}) {
  const a = Math.sin(t * 0.71 + seed) * 0.6;
  const b = Math.sin(t * 1.13 + seed * 2.1) * 0.3;
  const c = Math.sin(t * 1.97 + seed * 3.7) * 0.1;
  return (a + b + c) * amount;
}

/** Scroll-style inertia for an incoming panel that started moving. */
export function inertia(t, velocity = 1, friction = 4.5) {
  return velocity * (1 - Math.exp(-friction * t)) / friction;
}

/** Ease set, shared so two pages do not fade differently. */
export const EASE = {
  outCubic: (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3),
  inOutCubic: (k) => {
    const v = Math.min(1, Math.max(0, k));
    return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
  },
  outQuint: (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 5),
  smooth: (k) => {
    const v = Math.min(1, Math.max(0, k));
    return v * v * (3 - 2 * v);
  },
};

/**
 * A spring in the physics terms motion designers actually reach for:
 * stiffness, damping and mass (the Remotion / Reanimated 2 parameterisation),
 * instead of a damping ratio nobody tunes by hand.
 *
 * Borrowed because it is the vocabulary every motion reference uses: a designer
 * says "stiffness 100, damping 10" and expects that curve.
 *
 * @param {{ frame: number, fps?: number, from?: number, to?: number, config?: { stiffness?: number, damping?: number, mass?: number }, durationInFrames?: number, overshootClamping?: boolean }} spec
 */
export function springPhysics(spec = {}) {
  const fps = Number(spec.fps ?? 30) || 30;
  const from = Number(spec.from ?? 0);
  const to = Number(spec.to ?? 1);
  const config = spec.config ?? {};
  const stiffness = Math.max(1, Number(config.stiffness ?? 100));
  const damping = Math.max(0.1, Number(config.damping ?? 10));
  const mass = Math.max(0.05, Number(config.mass ?? 1));
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const z = Math.min(0.999, Math.max(0.001, zeta));
  const wd = omega * Math.sqrt(1 - z * z);

  const progressAt = (seconds) => (zeta >= 0.999
    ? 1 - Math.exp(-omega * seconds) * (1 + omega * seconds)
    : 1 - Math.exp(-z * omega * seconds) * (Math.cos(wd * seconds) + ((z * omega) / wd) * Math.sin(wd * seconds)));

  let seconds = Math.max(0, Number(spec.frame ?? 0)) / fps;
  // A fixed duration means "be finished exactly then": a shot cannot still be
  // settling when the cut takes it away. Stretch the clock so the spring has
  // reached 99.99% of its travel by the last frame.
  const duration = Number(spec.durationInFrames ?? 0);
  if (Number.isFinite(duration) && duration > 0) {
    const restSeconds = Math.log(10000) / Math.max(0.0001, z * omega);
    seconds *= restSeconds / (duration / fps);
  }
  let progress = progressAt(seconds);
  if (spec.overshootClamping === true) progress = Math.min(1, progress);
  // Within a thousandth of the target, snap: a value like 0.9999 renders
  // identically but fails an exact "is it finished" check forever.
  if (Math.abs(1 - progress) < 1e-3) progress = 1;
  return from + (to - from) * progress;
}

/**
 * A range mapper with the two options that actually matter in practice:
 * clamping so a value cannot run past the shot, and perceptual scale so a zoom
 * grows in *area* rather than in CSS units (a linear scale reads as too slow
 * at the start and too fast at the end).
 * @param {number} value
 * @param {number[]} input range, ascending
 * @param {number[]} output
 * @param {{ extrapolate?: 'clamp'|'extend', output?: 'default'|'perceptual-scale' }} [options]
 */
export function interpolate(value, input, output, options = {}) {
  if (!Array.isArray(input) || !Array.isArray(output) || input.length !== output.length || input.length < 2) {
    throw new Error('interpolate needs two ranges of the same length (>= 2)');
  }
  let index = 0;
  while (index < input.length - 2 && value > input[index + 1]) index += 1;
  const x0 = input[index];
  const x1 = input[index + 1];
  const y0 = output[index];
  const y1 = output[index + 1];
  const span = x1 - x0 || 1;
  let k = (value - x0) / span;
  if (options.extrapolate === 'clamp') k = Math.min(1, Math.max(0, k));
  const mapped = y0 + (y1 - y0) * k;
  if (options.output === 'perceptual-scale') {
    const sign = mapped < 0 ? -1 : 1;
    return sign * Math.sqrt(Math.abs(mapped));
  }
  return mapped;
}

/**
 * Film grain, as source a page can inline.
 *
 * A tiled dot pattern slid in eight 24 Hz steps does not read as grain: it
 * crawls across the picture like dirt on the lens, and it is the same dirt in
 * every shot. Real grain is a different field every frame.
 *
 * Twelve 96px noise tiles are drawn once at load, then picked by a hash of the
 * frame index. The sequence looks random, is identical on every machine, and
 * costs one style write per frame. The tile is small on purpose: at a 2x
 * supersampled render it is averaged down by the scaler, which is exactly the
 * softening film grain has.
 */
export function grainRuntime() {
  return `
const GRAIN_TILES = (() => {
  const size = 96;
  const tiles = [];
  for (let n = 0; n < 12; n += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const g = canvas.getContext('2d');
    const img = g.createImageData(size, size);
    let seed = (1013 + n * 7919) >>> 0;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const v = (seed >>> 24) & 255;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    tiles.push('url(' + canvas.toDataURL('image/png') + ')');
  }
  return tiles;
})();
const setGrain = (el, t, rate) => {
  if (!el) return;
  const fps = Number(rate) > 0 ? Number(rate) : 24;
  const frame = Math.floor(t * fps);
  const pick = (frame * 7 + 3) % GRAIN_TILES.length;
  el.style.backgroundImage = GRAIN_TILES[pick];
  el.style.backgroundSize = '96px 96px';
  el.style.backgroundPosition = (frame % 96) + 'px ' + ((frame * 13) % 96) + 'px';
};`;
}

/**
 * The page-side runtime: the same helpers, as source a page can inline.
 *
 * The functions are serialised from this module rather than re-typed, so a page
 * cannot drift away from the motion the tests describe.
 */
export function motionRuntime() {
  return [
    'const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);',
    `const spring = ${spring.toString()};`,
    `const springPhysics = ${springPhysics.toString()};`,
    `const interpolate = ${interpolate.toString()};`,
    `const press = ${press.toString()};`,
    `const stagger = ${stagger.toString()};`,
    `const drift = ${drift.toString()};`,
    'const EASE = { outCubic: (k) => 1 - Math.pow(1 - clamp01(k), 3), smooth: (k) => { const v = clamp01(k); return v * v * (3 - 2 * v); } };',
  ].join('\n');
}
