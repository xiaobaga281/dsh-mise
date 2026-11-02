/**
 * A keyframe shot page: two to eight pictures of the same subject, crossfaded
 * at exact times with a slow push, so a changing pose reads as motion.
 *
 * This is the honest way to get subject movement without a video model: an
 * image model draws the few poses that matter (same subject, same light), and
 * the page makes them move. The frames can come from any source — a provider, a
 * person's sketches, a camera burst — because the page only needs files and
 * times.
 *
 * A pure crossfade is not physics, and the page does not pretend: it is a
 * dissolve with a camera move, which is what a lot of premium explainers and
 * lyric pieces actually use between beats.
 *
 * @module openfilm-film-keyframes
 */

import { CINE_GRADES } from './film-cine.mjs';

export const MORPH_LIMITS = { minFrames: 2, maxFrames: 8 };

/**
 * @param {{ frames?: Array<{ src: string, at?: number }>, duration?: number, fade?: number, grade?: string, grain?: number, vignette?: number, push?: number, drift?: number }} spec
 * @param {{ exists?: (p: string) => boolean }} [env]
 */
export function validateMorphSpec(spec = {}, env = {}) {
  const problems = [];
  const frames = Array.isArray(spec.frames) ? spec.frames : [];
  if (frames.length < MORPH_LIMITS.minFrames) problems.push(`give at least ${MORPH_LIMITS.minFrames} frames (poses of the same subject)`);
  if (frames.length > MORPH_LIMITS.maxFrames) problems.push(`at most ${MORPH_LIMITS.maxFrames} frames; more than that reads as a slideshow`);
  for (const frame of frames) {
    if (typeof frame?.src !== 'string' || !frame.src) problems.push('every frame needs a src');
    else if (typeof env.exists === 'function' && !env.exists(frame.src)) problems.push(`not found in the project: ${frame.src}`);
    if (frame.at !== undefined && (!Number.isFinite(frame.at) || frame.at < 0)) problems.push(`frame at must be >= 0: ${frame.src}`);
  }
  const duration = Number(spec.duration ?? 5);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) problems.push('duration must be 0..120 seconds');
  const fade = Number(spec.fade ?? 0.6);
  if (!Number.isFinite(fade) || fade <= 0 || fade > 5) problems.push('fade must be 0..5 seconds');
  if (spec.grade !== undefined && !(spec.grade in CINE_GRADES)) problems.push(`unknown grade ${JSON.stringify(spec.grade)}`);
  for (const key of ['grain', 'vignette', 'push', 'drift']) {
    const value = spec?.[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) problems.push(`${key} must be 0..1`);
  }
  return { ok: problems.length === 0, problems, frames };
}

/**
 * Opacity of each frame at time t: ramps up to its hold, ramps down into the
 * next. Exported for tests and for a caller that wants the same curve elsewhere.
 * @param {number[]} times keyframe times in seconds, ascending
 * @param {number} fade seconds of dissolve on each side
 * @param {number} t
 * @returns {number[]} one weight per frame, roughly summing to 1 where fades overlap
 */
export function frameWeights(times, fade, t) {
  // A pose is fully on at its own time and holds until the dissolve into the
  // next one starts `fade` seconds earlier. Ramping *into* the time, rather
  // than around it, guarantees the last pose is complete at the end of the
  // shot instead of stopping half-transparent.
  const step = (from, to) => {
    const k = Math.min(1, Math.max(0, (t - from) / (to - from)));
    return k * k * (3 - 2 * k);
  };
  const weights = times.map((time, index) => {
    const inRamp = index === 0 ? 1 : step(time - fade, time);
    const outRamp = index === times.length - 1 ? 0 : step(times[index + 1] - fade, times[index + 1]);
    return Math.max(0, inRamp * (1 - outRamp));
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  return total > 0 ? weights.map((value) => value / total) : weights;
}

/** Evenly spaced keyframe times across the shot (or the caller's own times). */
export function keyframeTimes(spec) {
  const frames = Array.isArray(spec.frames) ? spec.frames : [];
  const duration = Number(spec.duration ?? 5);
  if (frames.every((frame) => Number.isFinite(frame?.at))) return frames.map((frame) => Number(frame.at));
  const step = duration / frames.length;
  return frames.map((_, index) => Number(((index + 0.5) * step).toFixed(3)));
}

/** Build the page. */
export function buildMorphPage(spec = {}) {
  const grade = CINE_GRADES[spec.grade] ?? CINE_GRADES['warm-film'];
  const duration = Number(spec.duration ?? 5);
  const fade = Number(spec.fade ?? 0.6);
  const grain = spec.grain ?? 0.16;
  const vignette = spec.vignette ?? 0.55;
  const push = spec.push ?? 0.04;
  const drift = spec.drift ?? 0.18;
  const frames = spec.frames ?? [];
  const times = keyframeTimes(spec);

  const layers = frames.map((frame, index) =>
    `    <div class="kf" data-i="${index}"><img src="${escapeAttr(frame.src)}" alt=""></div>`).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #05080a; overflow: hidden; }
  .stage { position: absolute; inset: 0; overflow: hidden; }
  .plate { position: absolute; inset: -4%; transform-origin: 50% 50%; filter: ${grade || 'none'}; }
  .kf { position: absolute; inset: 0; opacity: 0; will-change: opacity; }
  .kf img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .halation { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen;
    background: radial-gradient(58% 62% at 64% 30%, rgba(255,196,128,${(0.18 + 0.3 * grain).toFixed(3)}), rgba(255,140,60,0) 72%); }
  .vignette { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 132% at 50% 48%, rgba(0,0,0,0) 40%, rgba(2,6,10,${(0.35 + 0.45 * vignette).toFixed(3)}) 100%); }
  .grain { position: absolute; inset: -10%; pointer-events: none; opacity: ${grain}; mix-blend-mode: overlay;
    background-image: radial-gradient(rgba(255,255,255,.55) .5px, transparent .6px), radial-gradient(rgba(0,0,0,.55) .5px, transparent .6px);
    background-size: 3px 3px, 4px 4px; }
</style>
</head>
<body>
<div class="stage">
  <div class="plate">
${layers}
  </div>
  <div class="halation"></div>
  <div class="vignette"></div>
  <div class="grain"></div>
</div>
<script type="module">
const D = ${duration};
const FADE = ${fade};
const TIMES = ${JSON.stringify(times)};
const PUSH = ${push};
const DRIFT = ${drift};
const plates = [...document.querySelectorAll('.kf')];
const plateBox = document.querySelector('.plate');
const grainEl = document.querySelector('.grain');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const smooth = (x) => x * x * (3 - 2 * x);
const step = (from, to, now) => smooth(clamp01((now - from) / (to - from)));

function weights(now) {
  const values = TIMES.map((time, index) => {
    const inRamp = index === 0 ? 1 : step(time - FADE, time, now);
    const outRamp = index === TIMES.length - 1 ? 0 : step(TIMES[index + 1] - FADE, TIMES[index + 1], now);
    return Math.max(0, inRamp * (1 - outRamp));
  });
  const total = values.reduce((sum, v) => sum + v, 0);
  return total > 0 ? values.map((v) => v / total) : values;
}

window.film = {
  duration: D,
  frame(now) {
    const k = easeInOut(clamp01(now / D));
    // A slow push keeps a dissolve from looking like a slideshow.
    plateBox.style.transform = 'scale(' + (1 + PUSH * k).toFixed(4) + ') translate(' + (DRIFT * Math.sin(now * 0.9) * 0.4).toFixed(3) + 'vw, ' + (DRIFT * Math.cos(now * 0.7) * 0.3).toFixed(3) + 'vh)';
    const w = weights(now);
    plates.forEach((el, index) => { el.style.opacity = w[index].toFixed(3); });
    const step = Math.floor(now * 24) % 8;
    grainEl.style.backgroundPosition = step + 'px ' + ((step * 3) % 8) + 'px, ' + (1 - step) + 'px 2px';
  },
};
</script>
</body>
</html>
`;
}

function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
