/**
 * A depth-sliced shot page: parallax from one picture and its depth map, drawn
 * with plain 2D canvas.
 *
 * WebGL would give true per-pixel displacement, but headless and software
 * renderers lose the context, and a shot must never render black on a machine
 * we cannot see. So the depth map is used for what it does best without a GPU:
 * it slices the picture into three feathered bands, and each band slides a
 * different distance as the camera moves. Near things travel further than far
 * things, the scene gains volume, and the whole thing is 2D canvas draws that
 * every browser can do.
 *
 * Depth comes from an optional pack (mise_depth); this page needs the two
 * PNGs only.
 *
 * @module mise-film-depth
 */

import { CINE_GRADES, CINE_MOVES } from './film-cine.mjs';

/**
 * @param {{ src?: string, depth?: string, move?: string, amount?: number, duration?: number, grade?: string, grain?: number, vignette?: number }} spec
 * @param {{ exists?: (p: string) => boolean }} [env]
 */
export function validateDepthSpec(spec = {}, env = {}) {
  const problems = [];
  if (typeof spec.src !== 'string' || !spec.src) problems.push('src is required (the picture)');
  if (typeof spec.depth !== 'string' || !spec.depth) problems.push('depth is required (the grayscale depth map)');
  for (const key of ['src', 'depth']) {
    if (typeof spec[key] === 'string' && spec[key] && typeof env.exists === 'function' && !env.exists(spec[key])) {
      problems.push(`not found in the project: ${spec[key]}`);
    }
  }
  if (spec.move !== undefined && !CINE_MOVES[spec.move]) problems.push(`unknown move ${JSON.stringify(spec.move)}`);
  if (spec.grade !== undefined && !(spec.grade in CINE_GRADES)) problems.push(`unknown grade ${JSON.stringify(spec.grade)}`);
  const duration = Number(spec.duration ?? 5);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) problems.push('duration must be 0..120 seconds');
  if (spec.amount !== undefined && (!Number.isFinite(spec.amount) || spec.amount < 0 || spec.amount > 2)) problems.push('amount must be 0..2');
  return { ok: problems.length === 0, problems };
}

/** Build the page. */
export function buildDepthPage(spec = {}) {
  const move = CINE_MOVES[spec.move] ?? CINE_MOVES['push-in'];
  const grade = CINE_GRADES[spec.grade] ?? CINE_GRADES['warm-film'];
  const duration = Number(spec.duration ?? 5);
  const amount = Number.isFinite(spec.amount) ? spec.amount : 1;
  const grain = spec.grain ?? 0.16;
  const vignette = spec.vignette ?? 0.55;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #05080a; overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; filter: ${grade || 'none'}; }
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
<canvas id="c" width="1920" height="1080"></canvas>
<div class="halation"></div>
<div class="vignette"></div>
<div class="grain"></div>
<script type="module">
const D = ${duration};
const FROM = ${move.from}, TO = ${move.to};
const PANX = ${move.panX}, PANY = ${move.panY};
const AMOUNT = ${amount};
const W = 1920, H = 1080;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const smooth = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('cannot load ' + url));
    img.src = url;
  });
}

// Three depth bands, far to near. Each band is the picture clipped by a
// feathered slice of the depth map, so the seams do not read as cut-outs.
const BANDS = [
  { lo: -0.1, hi: 0.42, weight: 0.18 },
  { lo: 0.32, hi: 0.72, weight: 0.55 },
  { lo: 0.62, hi: 1.1, weight: 1.0 },
];

function makeBand(colorData, depthData, band) {
  const out = new ImageData(new Uint8ClampedArray(colorData.data), W, H);
  const d = depthData.data;
  const o = out.data;
  for (let i = 0; i < o.length; i += 4) {
    const depth = d[i] / 255;
    const a = smooth(band.lo, band.hi, depth) * (1 - smooth(band.hi - 0.06, band.hi, depth) * 0.35);
    o[i + 3] = Math.round(o[i + 3] * a);
  }
  const surface = document.createElement('canvas');
  surface.width = W; surface.height = H;
  surface.getContext('2d').putImageData(out, 0, 0);
  return surface;
}

let bands = null;
let ready = null;

async function setup() {
  const [color, depth] = await Promise.all([loadImage('${escapeAttr(spec.src)}'), loadImage('${escapeAttr(spec.depth)}')]);
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = W; colorCanvas.height = H;
  const colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
  colorCtx.drawImage(color, 0, 0, W, H);
  const colorData = colorCtx.getImageData(0, 0, W, H);

  const depthCanvas = document.createElement('canvas');
  depthCanvas.width = W; depthCanvas.height = H;
  const depthCtx = depthCanvas.getContext('2d', { willReadFrequently: true });
  depthCtx.drawImage(depth, 0, 0, W, H);
  const depthData = depthCtx.getImageData(0, 0, W, H);

  bands = BANDS.map((band) => makeBand(colorData, depthData, band));
}

function draw(t) {
  if (!bands) return;
  const k = easeInOut(clamp01(t / D));
  const scale = 1.08 + ((FROM + (TO - FROM) * k) - 1) * 0.5;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, W, H);
  // Far bands are drawn first, near bands cover them; each travels by its weight.
  for (const band of BANDS) {
    const bandCanvas = bands[BANDS.indexOf(band)];
    const dx = -PANX * 16 * k * AMOUNT * band.weight;
    const dy = -PANY * 16 * k * AMOUNT * band.weight;
    const s = 1 + (scale - 1) * band.weight;
    const w = W * s, h = H * s;
    ctx.drawImage(bandCanvas, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
  }
}

ready = setup().catch((error) => {
  // If the pictures cannot load, paint the plate flat rather than nothing.
  ctx.fillStyle = '#05080a';
  ctx.fillRect(0, 0, W, H);
  document.title = 'depth page: ' + error.message;
});

window.film = {
  duration: D,
  ready,
  frame(t) {
    draw(t);
    const step = Math.floor(t * 24) % 8;
    const grainEl = document.querySelector('.grain');
    if (grainEl) grainEl.style.backgroundPosition = step + 'px ' + ((step * 3) % 8) + 'px, ' + (1 - step) + 'px 2px';
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
