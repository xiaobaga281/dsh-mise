/**
 * mise-kit — the page-side floor a hand-written shot stands on.
 *
 * A film page is just `window.film = { frame(t) }`, which is a wonderful
 * contract and a terrible starting point: every page invented from scratch
 * reinvents the same six things badly — a type scale, a grid, a readable ink
 * colour, a reveal that settles, a camera that moves like mass, and grain that
 * is not a tiled dot pattern. The result reads as "generated" even when the
 * idea is good.
 *
 * This kit is those six things, as functions, with no opinion about the film:
 * it never picks a colour, a layout or a mood for you. It gives you the
 * vocabulary so the decisions you make are the ones that show.
 *
 * Copy it into the project beside of-motion.mjs:
 *
 *   import { defineShot, typeScale, grid, inkOn, contrast, reveal, camera,
 *            grain, drawOn, beats, local } from './mise-kit.mjs';
 *
 * Every function is a pure function of t (or of its arguments). Nothing here
 * starts a timer, reads the clock, or animates on its own — the host drives
 * frame(t), and the same t must always draw the same picture.
 *
 * @mise-kit v1.1
 */

import {
  clamp01, lerp, mapRange, easeOut, easeIn, easeInOut, easeOutExpo, easeOutBack,
  tween, spring, stagger, typewriter, counter, fitText, stageSize,
} from './of-motion.mjs';

export {
  clamp01, lerp, mapRange, easeOut, easeIn, easeInOut, easeOutExpo, easeOutBack,
  tween, spring, stagger, typewriter, counter, fitText, stageSize,
};

/** Progress of a local window: 0 before it opens, 1 after it closes. */
export function local(t, at = 0, dur = 1) {
  return clamp01((Number(t) - Number(at)) / Math.max(1e-6, Number(dur)));
}

/** A deterministic 0..1 stream. Never Math.random in a page: it breaks purity. */
export function seeded(seed = 1) {
  let state = (Math.round(Number(seed) || 1) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** What the stage really is, in CSS px — read it instead of assuming 1920. */
export function stage(el) {
  const box = (el ?? document.documentElement).getBoundingClientRect();
  return { width: box.width, height: box.height };
}

/**
 * A modular type scale in px. Same ratio the builders use, so a hand-written
 * page and a mise_type page can sit in one film without a visible jump.
 */
export function typeScale({ base = 26, ratio = 1.333, width = 1920 } = {}) {
  const step = (n) => Math.round(base * Math.pow(ratio, n) * (width / 1920));
  return { display: step(5), h1: step(4), h2: step(3), h3: step(2), body: step(0), small: step(-1), caption: step(-2), ratio, base };
}

/**
 * A real grid: margins, gutters and columns as numbers you can position with.
 *
 *   const g = grid({ width: stage().width, cols: 12 });
 *   el.style.left = g.span(1, 6).left + 'px';
 *   el.style.width = g.span(1, 6).width + 'px';
 */
export function grid({ width = 1920, cols = 12, margin = 0.05, gutter = 0.012 } = {}) {
  const m = width * margin;
  const g = width * gutter;
  const column = (width - m * 2 - g * (cols - 1)) / cols;
  return {
    cols,
    margin: m,
    gutter: g,
    column,
    /** Column i (0-based) for n columns wide. */
    span(i = 0, n = 1) {
      return {
        left: m + i * (column + g),
        width: column * n + g * Math.max(0, n - 1),
        right: width - (m + i * (column + g) + column * n + g * Math.max(0, n - 1)),
      };
    },
    /** Centre of column i, useful for an anchor with translate(-50%). */
    centre(i = 0, n = 1) {
      const box = this.span(i, n);
      return { x: box.left + box.width / 2, y: null };
    },
  };
}

// ── colour: enough to make a decision and prove it ────────────────────────

/** `#abc`, `#aabbcc`, `#aabbccdd`, `rgb(...)`, `rgba(...)` → { r, g, b, a }. */
export function parseColor(color) {
  const text = String(color ?? '').trim();
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join('') : hex;
    if (full.length !== 6 && full.length !== 8) throw new Error(`mise-kit: cannot read colour ${text}`);
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
      a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    };
  }
  const match = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 };
  }
  throw new Error(`mise-kit: cannot read colour ${text}`);
}

export function rgba(color, alpha = 1) {
  const { r, g, b } = parseColor(color);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Number(alpha)})`;
}

/** Mix two colours; k = 0 is a, k = 1 is b. */
export function mix(a, b, k = 0.5) {
  const x = parseColor(a);
  const y = parseColor(b);
  const t = clamp01(k);
  return `rgb(${Math.round(lerp(x.r, y.r, t))}, ${Math.round(lerp(x.g, y.g, t))}, ${Math.round(lerp(x.b, y.b, t))})`;
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function luminance(color) {
  const { r, g, b } = parseColor(color);
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. Body text wants >= 4.5, display >= 3. */
export function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * The ink to put on a background: whichever of light/dark reads better there.
 *
 * The usual failure is a grey subtitle on a dark card — measured, it is 1.6:1
 * and nobody sees it on their own monitor. Ask this instead of guessing:
 *
 *   el.style.color = inkOn(palette.card);              // the better of two
 *   if (contrast(ink, card) < 4.5) …                    // and you can still check
 */
export function inkOn(background, { light = '#f6f1e7', dark = '#111014', target = 4.5 } = {}) {
  const lightRatio = contrast(background, light);
  const darkRatio = contrast(background, dark);
  if (lightRatio >= target || lightRatio >= darkRatio) return light;
  return dark;
}

// ── motion: reveals, camera, drawn lines ─────────────────────────────────

export const REVEALS = ['rise', 'fade', 'mask', 'wipe', 'blur', 'scale'];

/**
 * One element arriving. `kind` is where it comes from, not what it means:
 * rise = from below, mask = uncovered upward, wipe = uncovered across,
 * blur = resolved out of focus, scale = settles from 96%.
 *
 * Returns the progress (0..1) so the caller can tie something else to it.
 */
export function reveal(el, t, { at = 0, dur = 0.62, kind = 'rise', distance = 28, blur = 10, ease = easeOut } = {}) {
  if (!el) return 0;
  const k = ease(local(t, at, dur));
  el.style.willChange = 'transform, opacity, filter, clip-path';
  if (kind === 'fade') {
    el.style.opacity = k.toFixed(3);
  } else if (kind === 'mask') {
    el.style.clipPath = `inset(0 0 ${((1 - k) * 100).toFixed(2)}% 0)`;
    el.style.opacity = '1';
  } else if (kind === 'wipe') {
    el.style.clipPath = `inset(0 ${((1 - k) * 100).toFixed(2)}% 0 0)`;
    el.style.opacity = '1';
  } else if (kind === 'blur') {
    el.style.filter = `blur(${((1 - k) * blur).toFixed(2)}px)`;
    el.style.opacity = k.toFixed(3);
  } else if (kind === 'scale') {
    el.style.transform = `scale(${(0.96 + 0.04 * k).toFixed(4)})`;
    el.style.opacity = k.toFixed(3);
  } else {
    el.style.transform = `translate3d(0, ${((1 - k) * distance).toFixed(2)}px, 0)`;
    el.style.opacity = k.toFixed(3);
  }
  return k;
}

export const CAMERA_MOVES = ['push-in', 'pull-out', 'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'dolly-diag', 'handheld'];

/**
 * A camera move on a stage-sized element. `amount` is a fraction of the frame
 * (0.06 = a 6% push), never a pixel count, so the same move scales to any size.
 *
 * A move that runs the whole shot at constant speed reads as flat; the easing
 * is what makes it a camera. `handheld` is a small seeded drift, for a shot
 * that should feel held rather than locked off.
 */
export function camera(el, t, { move = 'push-in', amount = 0.06, at = 0, dur, origin = '50% 52%', ease = easeInOut } = {}) {
  if (!el) return 0;
  const box = stage(el);
  const length = Number(dur ?? (window.film?.duration ?? 4));
  const k = ease(local(t, at, length));
  el.style.transformOrigin = origin;
  if (move === 'handheld') {
    const driftX = Math.sin(t * 0.83) * 0.35 + Math.sin(t * 1.71) * 0.18;
    const driftY = Math.cos(t * 0.61) * 0.28 + Math.sin(t * 1.37) * 0.12;
    const scale = 1 + amount * 0.4 + 0.002 * Math.sin(t * 0.9);
    el.style.transform = `scale(${scale.toFixed(4)}) translate3d(${driftX.toFixed(2)}px, ${driftY.toFixed(2)}px, 0)`;
    return k;
  }
  const push = (move === 'pull-out' ? 1 + amount * (1 - k) : 1 + amount * k);
  const panX = move === 'pan-right' ? -amount * box.width * k
    : move === 'pan-left' ? amount * box.width * k
      : move === 'dolly-diag' ? -amount * box.width * 0.6 * k : 0;
  const panY = move === 'tilt-up' ? amount * box.height * k
    : move === 'tilt-down' ? -amount * box.height * k
      : move === 'dolly-diag' ? amount * box.height * 0.4 * k : 0;
  const scale = move === 'pan-left' || move === 'pan-right' || move === 'tilt-up' || move === 'tilt-down'
    ? 1 + amount * 0.6
    : push;
  el.style.transform = `translate3d(${panX.toFixed(2)}px, ${panY.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;
  return k;
}

/**
 * Draw an SVG path on, as a function of t. The dash length is measured, not
 * guessed, so a hand-drawn curve draws at a constant speed.
 */
export function drawOn(path, t, { at = 0, dur = 1.2, ease = easeInOut } = {}) {
  if (!path) return 0;
  const length = typeof path.getTotalLength === 'function' ? path.getTotalLength() : 0;
  if (!length) return 0;
  const k = ease(local(t, at, dur));
  path.style.strokeDasharray = `${length.toFixed(2)}`;
  path.style.strokeDashoffset = `${(length * (1 - k)).toFixed(2)}`;
  return k;
}

// ── texture: grain that is grain ─────────────────────────────────────────

const TILE = { size: 96, count: 12, cache: null };

/**
 * Film grain, per frame. A static or stepped pattern reads as dirt on the
 * lens; grain is a different field every frame. Twelve noise tiles are drawn
 * once, then picked by the frame index — deterministic, cheap, and identical
 * on every machine.
 *
 *   <div class="grain" style="position:absolute;inset:-10%;pointer-events:none;
 *        mix-blend-mode:overlay;opacity:0.1"></div>
 *   grain(el, t);
 */
export function grain(el, t, { fps = 30, strength = 1 } = {}) {
  if (!el) return;
  if (!TILE.cache) {
    TILE.cache = [];
    for (let n = 0; n < TILE.count; n += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = TILE.size;
      canvas.height = TILE.size;
      const ctx = canvas.getContext('2d');
      const image = ctx.createImageData(TILE.size, TILE.size);
      const random = seeded(1013 + n * 7919);
      for (let i = 0; i < image.data.length; i += 4) {
        const v = Math.round(random() * 255);
        image.data[i] = v;
        image.data[i + 1] = v;
        image.data[i + 2] = v;
        image.data[i + 3] = 255;
      }
      ctx.putImageData(image, 0, 0);
      TILE.cache.push(`url(${canvas.toDataURL('image/png')})`);
    }
  }
  const frame = Math.floor(Number(t) * Number(fps));
  const pick = Math.abs(frame * 7 + 3) % TILE.count;
  el.style.backgroundImage = TILE.cache[pick];
  el.style.backgroundSize = `${TILE.size}px ${TILE.size}px`;
  el.style.backgroundPosition = `${Math.abs(frame) % TILE.size}px ${Math.abs(frame * 13) % TILE.size}px`;
  el.style.opacity = String(strength);
}

/** A CSS `filter` you can put on a whole stage, from five numbers. */
export function grade({ contrast: c = 1, saturate: s = 1, brightness: b = 1, hue = 0, sepia = 0 } = {}) {
  const parts = [];
  if (c !== 1) parts.push(`contrast(${c})`);
  if (s !== 1) parts.push(`saturate(${s})`);
  if (b !== 1) parts.push(`brightness(${b})`);
  if (hue) parts.push(`hue-rotate(${hue}deg)`);
  if (sepia) parts.push(`sepia(${sepia})`);
  return parts.join(' ') || 'none';
}

// ── time: cut on the music, not near it ──────────────────────────────────

/** A beat grid: `snap(t)` puts a cut on the nearest half beat. */
export function beats(bpm = 90) {
  const beat = 60 / Math.max(20, Number(bpm) || 90);
  const half = beat / 2;
  return {
    beat,
    half,
    bar: beat * 4,
    snap: (t) => Math.round(Number(t) / half) * half,
    /** Progress through the beat that t falls in. */
    phase: (t) => ((Number(t) % beat) + beat) % beat / beat,
  };
}

// ── one film, one set of variables ───────────────────────────────────────

/**
 * Read a CSS custom property, with a fallback.
 *
 * Eight pages written by hand drift: a margin of 96 here, 88 there, two
 * near-identical creams. The fix is not a theme — it is one file the film owns
 * (`look.css`), and every page reading its values instead of retyping them.
 *
 *   :root { --ink: #f6f1e7; --bg: #0b0906; --accent: #f0a64b; --gutter: 24px; }
 *
 *   el.style.color = token('--ink');
 *   el.style.left = token('--margin', '96px');
 */
export function token(name, fallback = '') {
  const key = String(name).startsWith('--') ? String(name) : `--${name}`;
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(key);
  return value.trim() || fallback;
}

/** Several tokens at once, as an object. `tokens('ink', 'bg', 'accent')`. */
export function tokens(...names) {
  const out = {};
  for (const name of names) {
    const key = String(name).replace(/^--/, '');
    out[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = token(key);
  }
  return out;
}

/**
 * Wait for the faces the page asked for, and say whether they actually loaded.
 *
 * A film that renders in a fallback serif on one machine and the real one on
 * another is a film you cannot proof. `document.fonts.check` answers for the
 * family you named, not for "some font is available".
 */
export async function fontReady(families = [], sample = '汉字 Aa') {
  if (typeof document === 'undefined' || !document.fonts) return false;
  await document.fonts.ready;
  const list = Array.isArray(families) ? families : [families];
  for (const family of list) {
    if (family && !document.fonts.check(`16px "${family}"`, sample)) return false;
  }
  return true;
}

// ── the contract ─────────────────────────────────────────────────────────

/**
 * Publish a shot as `window.film`, with the two guarantees the host needs:
 * a frame depends only on t, and a bad t cannot poison the page.
 *
 *   defineShot((t) => { … }, { duration: 4 });
 *
 * `draw` may return a Promise (web fonts, WebGL, a video texture): the host
 * waits for it before capturing, if you also pass it as `ready`.
 */
export function defineShot(draw, { duration, width, height, ready } = {}) {
  if (typeof draw !== 'function') throw new Error('mise-kit: defineShot needs a draw(t) function');
  const film = {
    ...(Number.isFinite(Number(duration)) && Number(duration) > 0 ? { duration: Number(duration) } : {}),
    ...(Number.isFinite(Number(width)) && Number(width) > 0 ? { width: Number(width) } : {}),
    ...(Number.isFinite(Number(height)) && Number(height) > 0 ? { height: Number(height) } : {}),
    ...(ready ? { ready } : {}),
    frame(t) {
      const time = Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : 0;
      return draw(time, film);
    },
  };
  window.film = film;
  return film;
}
