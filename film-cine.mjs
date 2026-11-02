/**
 * A cinematic shot page from one picture (or a few layers), with no model and
 * no GPU assumption.
 *
 * The gap between a still and a "shot" is mostly not object motion: it is the
 * camera, the optics and the air. This generator draws those — an eased camera
 * move, layered parallax when layers exist, a grade, halation, corner falloff,
 * grain and a small handheld drift — as a pure function of t, so any machine
 * that can run the film renders the same frames.
 *
 * Everything here is parameters: a person (or the agent) says "push in, warm
 * film, grain", not a page of code.
 *
 * @module openfilm-film-cine
 */

/** Camera moves, as (scale, pan) pairs driven by one eased progress k. */
export const CINE_MOVES = {
  'push-in': { from: 1.0, to: 1.1, panX: 0, panY: 0 },
  'pull-out': { from: 1.1, to: 1.0, panX: 0, panY: 0 },
  'pan-right': { from: 1.04, to: 1.04, panX: -2.2, panY: 0 },
  'pan-left': { from: 1.04, to: 1.04, panX: 2.2, panY: 0 },
  'tilt-up': { from: 1.04, to: 1.04, panX: 0, panY: 1.6 },
  'tilt-down': { from: 1.04, to: 1.04, panX: 0, panY: -1.6 },
  'dolly-diag': { from: 1.02, to: 1.12, panX: -1.4, panY: 0.8 },
  'handheld-drift': { from: 1.03, to: 1.07, panX: -0.6, panY: 0.4 },
};

/** Looks a page can carry with CSS alone (no LUT file, no ffmpeg). */
export const CINE_GRADES = {
  none: '',
  'warm-film': 'contrast(1.06) saturate(1.06) sepia(0.12) hue-rotate(-6deg) brightness(1.01)',
  'teal-orange': 'contrast(1.09) saturate(1.12) hue-rotate(-3deg)',
  noir: 'grayscale(0.72) contrast(1.16) brightness(0.98)',
  clean: 'contrast(1.03) saturate(1.03)',
  'dream-soft': 'contrast(1.02) saturate(0.96) brightness(1.04) blur(0.4px)',
};

/**
 * Check a shot spec before a page is written.
 * @param {{ src?: string, layers?: Array<{src: string, depth?: number}>, move?: string, duration?: number, grade?: string, grain?: number, vignette?: number, handheld?: number, bloom?: number }} spec
 * @param {{ exists?: (p: string) => boolean }} [env]
 */
export function validateCine(spec, env = {}) {
  const problems = [];
  const layers = Array.isArray(spec?.layers) && spec.layers.length ? spec.layers : (spec?.src ? [{ src: spec.src, depth: 0 }] : []);
  if (layers.length === 0) problems.push('give `src` (one picture) or `layers` (2–3 pictures, far to near)');
  for (const layer of layers) {
    if (typeof layer?.src !== 'string' || !layer.src) problems.push('every layer needs a src');
    else if (typeof env.exists === 'function' && !env.exists(layer.src)) problems.push(`not found in the project: ${layer.src}`);
    if (layer.depth !== undefined && (!Number.isFinite(layer.depth) || layer.depth < 0 || layer.depth > 1)) problems.push(`layer depth must be 0..1: ${layer.src}`);
  }
  if (spec?.move !== undefined && !CINE_MOVES[spec.move]) problems.push(`unknown move ${JSON.stringify(spec.move)}; there is ${Object.keys(CINE_MOVES).join(', ')}`);
  if (spec?.grade !== undefined && !(spec.grade in CINE_GRADES)) problems.push(`unknown grade ${JSON.stringify(spec.grade)}; there is ${Object.keys(CINE_GRADES).join(', ')}`);
  const duration = Number(spec?.duration ?? 5);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) problems.push('duration must be a number of seconds between 0 and 120');
  for (const key of ['grain', 'vignette', 'handheld', 'bloom']) {
    const value = spec?.[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) problems.push(`${key} must be 0..1`);
  }
  return { ok: problems.length === 0, problems, layers };
}

/**
 * Build the page.
 * @param {object} spec validated by validateCine
 * @returns {{ html: string, duration: number }}
 */
export function buildCinePage(spec = {}) {
  const { layers } = validateCine(spec);
  const move = CINE_MOVES[spec.move] ?? CINE_MOVES['push-in'];
  const grade = CINE_GRADES[spec.grade] ?? CINE_GRADES['warm-film'];
  const duration = Number(spec.duration ?? 5);
  const grain = spec.grain ?? 0.16;
  const vignette = spec.vignette ?? 0.55;
  const handheld = spec.handheld ?? 0.18;
  const bloom = spec.bloom ?? 0;
  const ordered = [...layers].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));

  const layerHtml = ordered.map((layer, i) => {
    const depth = Number.isFinite(layer.depth) ? layer.depth : (i / Math.max(1, ordered.length - 1));
    return `    <div class="layer" data-depth="${depth}" data-index="${i}"><img src="${escapeAttr(layer.src)}" alt=""></div>`;
  }).join('\n');

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #05080a; overflow: hidden; }
  .stage { position: absolute; inset: 0; overflow: hidden; }
  .scene { position: absolute; inset: -6%; will-change: transform; transform-origin: 50% 50%; }
  .layer { position: absolute; inset: 0; will-change: transform; transform-origin: 50% 50%; }
  .layer img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .grade { position: absolute; inset: 0; filter: ${grade || 'none'}; }
  .bloom { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; opacity: ${bloom}; }
  .bloom img { width: 100%; height: 100%; object-fit: cover; filter: blur(22px) saturate(1.3); }
  .halation { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen;
    background: radial-gradient(58% 62% at 64% 30%, rgba(255,196,128,${(0.18 + 0.3 * grain).toFixed(3)}), rgba(255,140,60,0) 72%); }
  .vignette { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 132% at 50% 48%, rgba(0,0,0,0) 40%, rgba(2,6,10,${(0.35 + 0.45 * vignette).toFixed(3)}) 100%);
    box-shadow: inset 0 0 ${Math.round(120 + 160 * vignette)}px ${Math.round(20 + 60 * vignette)}px rgba(2,6,10,${(0.35 + 0.4 * vignette).toFixed(3)}); }
  .grain { position: absolute; inset: -10%; pointer-events: none; opacity: ${grain}; mix-blend-mode: overlay;
    background-image: radial-gradient(rgba(255,255,255,.55) .5px, transparent .6px), radial-gradient(rgba(0,0,0,.55) .5px, transparent .6px);
    background-size: 3px 3px, 4px 4px; background-position: 0 0, 1px 2px; }
</style>
</head>
<body>
<div class="stage">
  <div class="scene">
    <div class="grade">
${layerHtml}
    </div>
  </div>
${bloom > 0 ? `  <div class="bloom"><img src="${escapeAttr(ordered[ordered.length - 1].src)}" alt=""></div>` : ''}
  <div class="halation"></div>
  <div class="vignette"></div>
  <div class="grain"></div>
</div>
<script type="module">
const scene = document.querySelector('.scene');
const layers = [...document.querySelectorAll('.layer')];
const grainEl = document.querySelector('.grain');
const D = ${duration};
const FROM = ${move.from}, TO = ${move.to};
const PANX = ${move.panX}, PANY = ${move.panY};
const HAND = ${handheld};

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
// Deterministic hand-held wobble: two slow sines with fixed phases — no random stream at all.
const wobble = (t, scale) => Math.sin(t * 1.7 + 0.6) * scale + Math.sin(t * 0.63 + 2.1) * scale * 0.6;

window.film = {
  duration: D,
  frame(t) {
    const k = easeInOut(clamp01(t / D));
    const scale = FROM + (TO - FROM) * k;
    const hx = HAND * wobble(t, 0.16);
    const hy = HAND * wobble(t + 1.3, 0.12);
    scene.style.transform = 'scale(' + scale.toFixed(4) + ') translate(' + (PANX * k + hx).toFixed(3) + 'vw, ' + (PANY * k + hy).toFixed(3) + 'vh)';
    // Each layer moves a fraction of the camera by its depth: far layers barely,
    // near layers fully. One plate still gets the camera move; several get parallax.
    for (const el of layers) {
      const depth = Number(el.dataset.depth) || 0;
      const factor = 0.25 + 0.75 * depth;
      el.style.transform = 'translate(' + (-PANX * k * factor + hx * 0.5).toFixed(3) + 'vw, ' + (-PANY * k * factor + hy * 0.5).toFixed(3) + 'vh) scale(' + (1 + (scale - 1) * factor).toFixed(4) + ')';
    }
    // Film grain moves on a whole-pixel grid at 24 steps a second: alive, still repeatable.
    const step = Math.floor(t * 24) % 8;
    grainEl.style.backgroundPosition = step + 'px ' + ((step * 3) % 8) + 'px, ' + (1 - step) + 'px 2px';
  },
};
</script>
</body>
</html>
`;
  return { html, duration };
}

function escapeAttr(text) {
  return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
