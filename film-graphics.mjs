/**
 * Procedural graphics shots, drawn on a canvas.
 *
 * Two modes that code video does better than any generative model:
 *  - `chart`: bars that grow from zero with counting labels and a grid — a data
 *    story whose numbers are exactly true;
 *  - `particles`: a word built out of thousands of dots flying into place, the
 *    classic premium logo/opening move.
 *
 * Both are a pure function of t and seeded positions, so the same frame is the
 * same picture on every machine.
 *
 * @module openfilm-film-graphics
 */

import { TYPE_PALETTES } from './film-type.mjs';
import { fontStack } from './film-fonts.mjs';
import { shotWarmth } from './film-craft.mjs';
import { grainRuntime } from './film-motionlib.mjs';

export const GRAPHICS_MODES = ['chart', 'particles', 'pulse'];

/**
 * @param {{ mode?: string, title?: string, items?: Array<{ label: string, value: number, unit?: string }>, text?: string, duration?: number, palette?: string, grain?: number, dots?: number, envelope?: number[], fps?: number }} spec
 */
export function validateGraphicsSpec(spec = {}) {
  const problems = [];
  const mode = spec.mode ?? 'chart';
  if (!GRAPHICS_MODES.includes(mode)) problems.push(`unknown mode ${JSON.stringify(mode)}; there is ${GRAPHICS_MODES.join(', ')}`);
  if (mode === 'chart') {
    const items = Array.isArray(spec.items) ? spec.items : [];
    if (items.length < 2) problems.push('chart needs at least two items');
    if (items.length > 8) problems.push('eight bars is the most that stays readable');
    items.forEach((item, index) => {
      if (typeof item?.label !== 'string' || !item.label.trim()) problems.push(`item ${index + 1} needs a label`);
      if (!Number.isFinite(item?.value)) problems.push(`item ${index + 1} needs a numeric value`);
    });
  }
  if (mode === 'particles' && (typeof spec.text !== 'string' || !spec.text.trim())) problems.push('particles needs `text` to assemble');
  if (mode === 'particles' && spec.text !== undefined && [...spec.text].length > 24) problems.push('24 characters is the most a particle field can resolve');
  if (mode === 'pulse') {
    const env = Array.isArray(spec.envelope) ? spec.envelope : [];
    if (env.length < 2) problems.push('pulse needs `audio` (its envelope is read from the WAV)');
    if (env.some((v) => !Number.isFinite(v))) problems.push('pulse envelope values must be numbers');
  }
  if (spec.palette !== undefined && !TYPE_PALETTES[spec.palette]) problems.push(`unknown palette ${JSON.stringify(spec.palette)}`);
  const duration = Number(spec.duration ?? 5);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) problems.push('duration must be 0..120 seconds');
  if (spec.dots !== undefined && (!Number.isFinite(spec.dots) || spec.dots < 200 || spec.dots > 12000)) problems.push('dots must be 200..12000');
  if (spec.grain !== undefined && (!Number.isFinite(spec.grain) || spec.grain < 0 || spec.grain > 1)) problems.push('grain must be 0..1');
  return { ok: problems.length === 0, problems };
}

/** Build the page. */
export function buildGraphicsPage(spec = {}) {
  const palette = TYPE_PALETTES[spec.palette] ?? TYPE_PALETTES.amber;
  const mode = spec.mode ?? 'chart';
  const duration = Number(spec.duration ?? 5);
  const grain = spec.grain ?? 0.1;
  const warmth = Number.isFinite(Number(spec.warmth)) ? Number(spec.warmth) : shotWarmth(Number(spec.shotIndex ?? 0));
  const items = Array.isArray(spec.items) ? spec.items : [];
  const text = typeof spec.text === 'string' ? spec.text : '';
  const dots = Number(spec.dots ?? 2600);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: ${palette.bg}; overflow: hidden;
    font-family: ${fontStack()}; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .tint { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light;
    background: ${warmth >= 0 ? `rgba(255, 168, 96, ${(Math.abs(warmth) * 0.26).toFixed(3)})` : `rgba(118, 168, 255, ${(Math.abs(warmth) * 0.26).toFixed(3)})`}; }
  .texture { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: screen; opacity: 0.055;
    background-image:
      radial-gradient(circle, rgba(255,255,255,0.55) 0.7px, transparent 1.1px),
      radial-gradient(circle, rgba(255,255,255,0.4) 1.6px, transparent 2.4px);
    background-size: 3px 3px, 11px 11px, 100% 100%;
    background-position: 0 0, 4px 6px;
    transform: rotate(0.4deg) scale(1.02); }
  .grain { position: absolute; inset: -10%; pointer-events: none; opacity: ${grain}; mix-blend-mode: overlay;
    background-image: radial-gradient(rgba(255,255,255,.6) .5px, transparent .6px), radial-gradient(rgba(0,0,0,.6) .5px, transparent .6px);
    background-size: 3px 3px, 4px 4px; }
  .vignette { position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 130% at 50% 48%, transparent 48%, rgba(0,0,0,0.4) 100%); }
</style>
</head>
<body>
<canvas id="c" width="1920" height="1080"></canvas>
<div class="vignette"></div>
<div class="texture"></div>
<div class="tint"></div>
<div class="grain"></div>
<script type="module">
const D = ${duration};
const MODE = ${JSON.stringify(mode)};
const INK = ${JSON.stringify(palette.ink)};
const ACCENT = ${JSON.stringify(palette.accent)};
const BG = ${JSON.stringify(palette.bg)};
const TITLE = ${JSON.stringify(spec.title ?? '')};
const ITEMS = ${JSON.stringify(items)};
const TEXT = ${JSON.stringify(text)};
const DOTS = ${dots};
const ENV = ${JSON.stringify(Array.isArray(spec.envelope) ? spec.envelope : [])};
const FPS = ${Number.isFinite(spec.fps) ? Number(spec.fps) : 30};
const W = 1920, H = 1080;
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const grainEl = document.querySelector('.grain');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ── chart ────────────────────────────────────────────────────────────────
const MAX = Math.max(1, ...ITEMS.map((item) => item.value));
const PLOT = { x: 180, y: 330, w: 1560, h: 500 };
const FONT = '"Noto Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif';

function drawChart(t) {
  ctx.clearRect(0, 0, W, H);

  // A chart is a shot, not a screenshot: a very slow push-in keeps the frame
  // alive after the bars have grown. 1.5% over the shot is enough to feel like
  // a camera and not enough to notice.
  const push = 1 + 0.015 * clamp01(t / Math.max(0.5, D));
  canvas.style.transform = 'scale(' + push.toFixed(4) + ')';
  canvas.style.transformOrigin = '50% 58%';

  // Editorial header: a kicker line, the claim set large and left, a short
  // accent rule beneath it. A chart is a page, not a widget dropped on black.
  if (TITLE) {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = ACCENT;
    ctx.font = '600 22px ' + FONT;
    ctx.letterSpacing = '6px';
    ctx.fillText('DATA', PLOT.x, 120);
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
    // Fit the claim to the width instead of letting it run off the frame.
    let size = 58;
    ctx.font = '700 ' + size + 'px ' + FONT;
    while (ctx.measureText(TITLE).width > PLOT.w && size > 30) {
      size -= 2;
      ctx.font = '700 ' + size + 'px ' + FONT;
    }
    ctx.fillStyle = INK;
    ctx.fillText(TITLE, PLOT.x, 196);
    ctx.fillStyle = ACCENT;
    ctx.fillRect(PLOT.x, 232, 96, 3);
  }

  // Grid: quiet horizontal rules, no box. The baseline is the only solid line.
  ctx.strokeStyle = INK;
  for (let i = 1; i <= 4; i += 1) {
    const y = PLOT.y + PLOT.h - (PLOT.h / 4) * i;
    ctx.globalAlpha = i === 1 ? 0.16 : 0.075;
    ctx.lineWidth = 1;
    ctx.setLineDash(i === 1 ? [] : [3, 9]);
    ctx.beginPath(); ctx.moveTo(PLOT.x, y); ctx.lineTo(PLOT.x + PLOT.w, y); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.moveTo(PLOT.x, PLOT.y + PLOT.h); ctx.lineTo(PLOT.x + PLOT.w, PLOT.y + PLOT.h); ctx.stroke();
  ctx.globalAlpha = 1;

  const slot = PLOT.w / ITEMS.length;
  const barW = Math.min(132, slot * 0.34);
  const peakIndex = ITEMS.reduce((best, item, index) => (item.value > ITEMS[best].value ? index : best), 0);

  ITEMS.forEach((item, index) => {
    const k = easeOut(clamp01((t - 0.15 - index * 0.1) / 0.9));
    const h = (item.value / MAX) * PLOT.h * k;
    const x = PLOT.x + slot * index + (slot - barW) / 2;
    const y = PLOT.y + PLOT.h - h;
    // The bar that carries the argument gets the accent; the rest stay quiet.
    const grad = ctx.createLinearGradient(0, y, 0, PLOT.y + PLOT.h);
    if (index === peakIndex) {
      grad.addColorStop(0, ACCENT);
      grad.addColorStop(1, ACCENT + '22');
    } else {
      grad.addColorStop(0, INK + 'cc');
      grad.addColorStop(1, INK + '11');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    const r = Math.min(10, barW / 2);
    ctx.moveTo(x, PLOT.y + PLOT.h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, PLOT.y + PLOT.h);
    ctx.closePath();
    ctx.fill();

    // Value above its own bar, right-aligned to the bar, at a size that reads.
    const shown = Math.round(item.value * k * 10) / 10;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = index === peakIndex ? ACCENT : INK;
    ctx.font = '700 ' + (index === peakIndex ? 40 : 30) + 'px ' + FONT;
    const value = String(shown) + (item.unit ?? '');
    ctx.fillText(value, x + barW - ctx.measureText(value).width, Math.max(36, y - 20));

    // Label below the baseline, quiet but aligned to the bar.
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = INK;
    ctx.font = '500 24px ' + FONT;
    ctx.fillText(item.label, x + (barW - ctx.measureText(item.label).width) / 2, PLOT.y + PLOT.h + 44);
    ctx.globalAlpha = 1;
  });
}

// ── particles ────────────────────────────────────────────────────────────
let points = null;

function sampleText() {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d', { willReadFrequently: true });
  // Fit the word to the frame: measure down from a large size until it fits.
  let size = 440;
  octx.font = '800 ' + size + 'px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  while (octx.measureText(TEXT).width > W * 0.84 && size > 60) {
    size -= 12;
    octx.font = '800 ' + size + 'px "Noto Sans SC", "Microsoft YaHei", sans-serif';
  }
  octx.fillStyle = '#fff';
  octx.textAlign = 'center'; octx.textBaseline = 'middle';
  octx.fillText(TEXT, W / 2, H / 2);
  const data = octx.getImageData(0, 0, W, H).data;
  const found = [];
  const gap = Math.max(4, Math.round(Math.sqrt((W * H) / DOTS / 14)));
  for (let y = 0; y < H; y += gap) {
    for (let x = 0; x < W; x += gap) {
      if (data[(y * W + x) * 4 + 3] > 128) found.push({ x, y });
    }
  }
  return found.slice(0, DOTS);
}

function drawParticles(t) {
  if (!points) points = sampleText();
  ctx.clearRect(0, 0, W, H);
  const progress = easeInOut(clamp01((t - 0.2) / 1.7));
  ctx.fillStyle = ACCENT;
  for (let i = 0; i < points.length; i += 1) {
    const target = points[i];
    const sx = hash(i * 1.7) * W;
    const sy = hash(i * 2.9) * H;
    // Each dot starts on its own cloud point and lands with a small stagger, so
    // the word assembles from the middle outward.
    const delay = 0.25 * hash(i * 5.1);
    const k = easeOut(clamp01((progress - delay) / (1 - delay || 1)));
    const x = sx + (target.x - sx) * k;
    const y = sy + (target.y - sy) * k;
    ctx.globalAlpha = 0.25 + 0.75 * k;
    ctx.fillRect(x, y, 2.6, 2.6);
  }
  ctx.globalAlpha = 1;
}

// ── pulse: the picture breathes with the score ───────────────────────────
function envAt(index) {
  if (!ENV.length) return 0;
  const i = Math.max(0, Math.min(ENV.length - 1, index));
  return ENV[i] ?? 0;
}

function drawPulse(t) {
  ctx.clearRect(0, 0, W, H);
  const index = Math.floor(t * FPS);
  const amp = envAt(index);
  const cx = W / 2, cy = H / 2;
  const base = 150;

  // A ring history: each older frame sits further out, so loudness leaves a
  // visible wake instead of a single twitching circle.
  ctx.lineWidth = 3;
  for (let ring = 0; ring < 42; ring += 1) {
    const value = envAt(index - ring * 3);
    const radius = base + ring * 9 + value * 26;
    ctx.globalAlpha = 0.05 + 0.5 * value * (1 - ring / 42);
    ctx.strokeStyle = ring % 7 === 0 ? ACCENT : INK;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Radial bars around the same centre, each from a different moment.
  for (let i = 0; i < 96; i += 1) {
    const value = envAt(index - i * 2);
    const angle = (i / 96) * Math.PI * 2;
    const inner = 210 + value * 30;
    const outer = inner + 20 + value * 150;
    ctx.globalAlpha = 0.15 + 0.85 * value;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.stroke();
  }

  // The centre is the beat: it swells and settles with the current frame.
  ctx.globalAlpha = 0.85;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * (1 + amp));
  grad.addColorStop(0, ACCENT);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, base * (0.35 + 0.65 * amp), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

${grainRuntime()}

window.film = {
  duration: D,
  frame(t) {
    if (MODE === 'chart') drawChart(t);
    else if (MODE === 'particles') drawParticles(t);
    else drawPulse(t);
    setGrain(grainEl, t, 30);
  },
};
</script>
</body>
</html>
`;
}
