import { fontStack } from './film-fonts.mjs';
import { shotWarmth } from './film-craft.mjs';
import { grainRuntime } from './film-motionlib.mjs';
/**
 * A code-native 3D scene shot: panels in space, a camera that moves through
 * them, light, dust and type. No picture required.
 *
 * This is the piece that makes the film engine a code engine rather than a
 * slideshow of generated stills: the geometry, the camera, the light and the
 * particles are all drawn by the page, deterministic in t, and a picture — if
 * there is one — is only a texture on a panel.
 *
 * CSS 3D is used on purpose: it is software-rasterised everywhere Chromium
 * runs (no WebGL context to lose), and a panel world is exactly what it is
 * good at.
 *
 * @module openfilm-film-scene
 */

export const SCENE_MOVES = {
  'dolly-through': { fromZ: 0, toZ: 520, tilt: 0 },
  'pull-back': { fromZ: 520, toZ: 0, tilt: 0 },
  'orbit-left': { fromZ: 160, toZ: 160, tilt: -16 },
  'orbit-right': { fromZ: 160, toZ: 160, tilt: 16 },
  'rise': { fromZ: 120, toZ: 320, tilt: 8 },
};

export const SCENE_PALETTES = {
  amber: { bg: '#0b0906', ink: '#f6efe2', accent: '#f0a64b', glow: 'rgba(240,166,75,', panel: 'rgba(24,20,16,0.72)' },
  teal: { bg: '#04090b', ink: '#e8f4f4', accent: '#4fd1c5', glow: 'rgba(79,209,197,', panel: 'rgba(10,22,24,0.72)' },
  mono: { bg: '#070708', ink: '#f2f2f2', accent: '#d8d8d8', glow: 'rgba(230,230,230,', panel: 'rgba(18,18,20,0.72)' },
  rose: { bg: '#0d0609', ink: '#fbeaf0', accent: '#ff7aa2', glow: 'rgba(255,122,162,', panel: 'rgba(26,12,18,0.72)' },
};

/**
 * @param {{ panels?: Array<{ text?: string, sub?: string, image?: string, x?: number, y?: number, z?: number, rotate?: number, width?: number }>, move?: string, palette?: string, duration?: number, particles?: number, light?: number, grain?: number }} spec
 * @param {{ exists?: (p: string) => boolean }} [env]
 */
export function validateSceneSpec(spec = {}, env = {}) {
  const problems = [];
  const panels = Array.isArray(spec.panels) ? spec.panels : [];
  if (panels.length < 1) problems.push('give at least one panel (text and/or image)');
  if (panels.length > 7) problems.push('7 panels is the most that still reads in one camera move');
  panels.forEach((panel, index) => {
    if (!panel || (typeof panel.text !== 'string' && typeof panel.image !== 'string')) problems.push(`panel ${index + 1} needs text or an image`);
    if (typeof panel.image === 'string' && panel.image && typeof env.exists === 'function' && !env.exists(panel.image)) {
      problems.push(`not found in the project: ${panel.image}`);
    }
    for (const key of ['x', 'y', 'z', 'rotate', 'width']) {
      if (panel?.[key] !== undefined && !Number.isFinite(panel[key])) problems.push(`panel ${index + 1}: ${key} must be a number`);
    }
  });
  if (spec.move !== undefined && !SCENE_MOVES[spec.move]) problems.push(`unknown move ${JSON.stringify(spec.move)}; there is ${Object.keys(SCENE_MOVES).join(', ')}`);
  if (spec.palette !== undefined && !SCENE_PALETTES[spec.palette]) problems.push(`unknown palette ${JSON.stringify(spec.palette)}; there is ${Object.keys(SCENE_PALETTES).join(', ')}`);
  const duration = Number(spec.duration ?? 5);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) problems.push('duration must be 0..120 seconds');
  if (spec.particles !== undefined && (!Number.isFinite(spec.particles) || spec.particles < 0 || spec.particles > 2000)) problems.push('particles must be 0..2000');
  for (const key of ['light', 'grain']) {
    if (spec?.[key] !== undefined && (!Number.isFinite(spec[key]) || spec[key] < 0 || spec[key] > 1)) problems.push(`${key} must be 0..1`);
  }
  // The editorial furniture is what turns panels floating in a void into a shot
  // of a film; it is checked here so a caller cannot pass a paragraph where a
  // caption belongs.
  if (spec.inset !== undefined && (!Number.isFinite(Number(spec.inset)) || Number(spec.inset) < 0 || Number(spec.inset) > 400)) problems.push('inset must be 0..400 (px kept clear for letterbox bars)');
  if (spec.panelTone !== undefined && !['light', 'dark'].includes(spec.panelTone)) problems.push('panelTone must be "light" or "dark"');
  for (const [key, limit] of [['kicker', 48], ['caption', 60], ['captionSub', 90], ['frameNo', 24]]) {
    if (spec[key] !== undefined) {
      if (typeof spec[key] !== 'string') problems.push(`${key} must be a string`);
      else if (spec[key].length > limit) problems.push(`${key} is too long (max ${limit} characters)`);
    }
  }
  return { ok: problems.length === 0, problems, panels };
}

/** Build the page. */
export function buildScenePage(spec = {}) {
  const palette = SCENE_PALETTES[spec.palette] ?? SCENE_PALETTES.amber;
  const move = SCENE_MOVES[spec.move] ?? SCENE_MOVES['dolly-through'];
  const duration = Number(spec.duration ?? 5);
  const particles = Number(spec.particles ?? 90);
  const light = spec.light ?? 0.55;
  const grain = spec.grain ?? 0.14;
  const warmth = Number.isFinite(Number(spec.warmth)) ? Number(spec.warmth) : shotWarmth(Number(spec.shotIndex ?? 0));
  // Editorial furniture, optional: when present the panels move right and a
  // caption takes the lower left, which is how a still reads as a shot.
  const kicker = typeof spec.kicker === 'string' ? spec.kicker : '';
  const caption = typeof spec.caption === 'string' ? spec.caption : '';
  const captionSub = typeof spec.captionSub === 'string' ? spec.captionSub : '';
  const frameNo = typeof spec.frameNo === 'string' ? spec.frameNo : '';
  // Delivery crops 11% bars top and bottom on some recipes: anything anchored to
  // the frame edge has to sit inside the picture area or it ships clipped.
  const inset = Math.max(0, Number(spec.inset ?? 0));
  const panelTone = spec.panelTone === 'dark' ? 'dark' : 'light';
  const shift = (caption || kicker) ? 210 : 0;
  const panels = (spec.panels ?? []).map((panel, index) => {
    // Wider spacing and panels: at 1080p a 460px card with 42px type reads as a
    // small label, not a shot. These defaults fill the frame like a title card.
    const x = (panel.x ?? (index - ((spec.panels.length - 1) / 2)) * 520) + shift;
    const y = panel.y ?? (index % 2 === 0 ? -60 : 10);
    const z = panel.z ?? (index - ((spec.panels.length - 1) / 2)) * 300;
    const rotate = panel.rotate ?? (x < 0 ? 10 : -10);
    const width = panel.width ?? 500;
    const media = typeof panel.image === 'string' && panel.image
      ? `<img src="${escapeAttr(panel.image)}" alt="">`
      : '';
    return `  <div class="panel" data-x="${x}" data-y="${y}" data-z="${z}" style="--w:${width}px; --r:${rotate}deg">
${media}
    ${panel.text ? `<div class="pt">${escapeHtml(panel.text)}</div>` : ''}
    ${panel.sub ? `<div class="ps">${escapeHtml(panel.sub)}</div>` : ''}
  </div>`;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: ${palette.bg}; overflow: hidden; font-family: ${fontStack()}; }
  .stage { position: absolute; inset: 0; perspective: 1100px; overflow: hidden; }
  .world { position: absolute; inset: 0; transform-style: preserve-3d; will-change: transform; }
  .panel {
    position: absolute; left: 50%; top: 50%; width: var(--w);
    transform: translate(-50%, -50%) translate3d(var(--tx, 0px), var(--ty, 0px), var(--tz, 0px)) rotateY(var(--r));
    border-radius: 18px; padding: 34px 38px; box-sizing: border-box;
    /* A panel has to read against the light. Dark-on-dark measured 1.0% content
       at 1080p: the card and the room were the same value, so the shot was mud.
       These are light cards on a dark room, which is how a product shot reads. */
    ${panelTone === 'dark'
      ? `background: linear-gradient(160deg, rgba(46, 40, 33, 0.96), rgba(18, 15, 12, 0.97));
    border: 1px solid rgba(255,255,255,0.22);
    color: ${palette.ink};`
      : `background: linear-gradient(160deg, #f4efe6 0%, #ddd4c6 100%);
    border: 1px solid rgba(0,0,0,0.18);
    color: #17130f;`}
    box-shadow: 0 40px 90px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.16), 0 0 0 1px rgba(0,0,0,0.4);
    backface-visibility: hidden; overflow: hidden;
  }
  .panel img { display: block; width: calc(100% + 76px); margin: -34px -38px 18px; object-fit: cover; height: 220px; }
  .pt { font-size: 56px; font-weight: 700; letter-spacing: -0.015em; line-height: 1.12; }
  .ps { margin-top: 14px; font-size: 22px; line-height: 1.45; opacity: 0.78; }
  .light { position: absolute; inset: -30%; pointer-events: none; mix-blend-mode: screen;
    /* The ambient light must sit under the panels, not lift the whole frame:
       too much glow makes a dark card read as grey. */
    background: conic-gradient(from 0deg at 50% 50%, transparent 0deg, ${palette.glow}${(0.26 * light).toFixed(2)}) 300deg, transparent 360deg);
    filter: blur(30px); opacity: ${(0.45 + 0.3 * light).toFixed(2)}; }
  .glowdot { position: absolute; width: 46vw; height: 46vw; border-radius: 50%; pointer-events: none;
    background: radial-gradient(circle, ${palette.glow}${(0.26 * light).toFixed(2)}) 0%, transparent 66%);
    filter: blur(20px); }
  canvas.dust { position: absolute; inset: 0; pointer-events: none; }
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
    background: radial-gradient(120% 130% at 50% 48%, transparent 46%, rgba(0,0,0,0.42) 100%); }
  /* Editorial furniture: a caption block, a hairline rule and a frame number.
     Panels floating in a void read as a tech demo; the same panels behind a
     caption read as a shot. */
  .kicker { position: absolute; left: 96px; top: calc(104px + var(--inset, 0px)); font-size: 22px; letter-spacing: 0.34em;
    text-transform: uppercase; color: ${palette.accent}; opacity: 0.85; }
  .caption { position: absolute; left: 96px; bottom: calc(116px + var(--inset, 0px)); max-width: 720px; }
  .caption .ct { font-size: 54px; line-height: 1.16; font-weight: 700; color: ${palette.ink}; }
  .caption .cs { margin-top: 14px; font-size: 23px; line-height: 1.5; color: ${palette.ink}; opacity: 0.66; }
  .hairline { position: absolute; left: 96px; bottom: calc(88px + var(--inset, 0px)); width: 120px; height: 2px; background: ${palette.accent}; opacity: 0.9; }
  .frameno { position: absolute; right: 96px; bottom: calc(92px + var(--inset, 0px)); font-size: 20px; letter-spacing: 0.22em;
    color: ${palette.ink}; opacity: 0.4; font-variant-numeric: tabular-nums; }
</style>
</head>
<body style="--inset:${inset.toFixed(0)}px">
<div class="stage">
  <div class="light"></div>
  <div class="glowdot" style="left:-6vw; top:8vh"></div>
  <div class="glowdot" style="right:-8vw; bottom:-6vh"></div>
  <canvas class="dust" width="1920" height="1080"></canvas>
  <div class="world">
${panels}
  </div>
  ${kicker ? `<div class="kicker">${escapeHtml(kicker)}</div>` : ''}
  ${caption ? `<div class="caption"><div class="ct">${escapeHtml(caption)}</div>${captionSub ? `<div class="cs">${escapeHtml(captionSub)}</div>` : ''}</div>` : ''}
  ${caption ? '<div class="hairline"></div>' : ''}
  ${frameNo ? `<div class="frameno">${escapeHtml(frameNo)}</div>` : ''}
  <div class="vignette"></div>
  <div class="texture"></div>
<div class="tint"></div>
<div class="grain"></div>
</div>
<script type="module">
const D = ${duration};
const FROM_Z = ${move.fromZ}, TO_Z = ${move.toZ}, TILT = ${move.tilt};
const world = document.querySelector('.world');
const panels = [...document.querySelectorAll('.panel')];
const lightEl = document.querySelector('.light');
const dust = document.querySelector('.dust');
const captionEl = document.querySelector('.caption');
const kickerEl = document.querySelector('.kicker');
const framenoEl = document.querySelector('.frameno');
const dctx = dust.getContext('2d');
const grainEl = document.querySelector('.grain');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
// Seeded noise: a hash of the index, never a random stream, so a frame is the
// same on every machine.
const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const PARTICLES = Array.from({ length: ${particles} }, (_, i) => ({
  x: hash(i * 1.7) * 1920,
  y: hash(i * 2.3) * 1080,
  r: 0.6 + hash(i * 3.1) * 2.2,
  speed: 6 + hash(i * 4.9) * 22,
  drift: (hash(i * 5.3) - 0.5) * 18,
  alpha: 0.12 + hash(i * 6.7) * 0.4,
}));

function placePanels() {
  for (const el of panels) {
    el.style.setProperty('--tx', el.dataset.x + 'px');
    el.style.setProperty('--ty', el.dataset.y + 'px');
    el.style.setProperty('--tz', el.dataset.z + 'px');
  }
}
placePanels();

function drawDust(t) {
  dctx.clearRect(0, 0, 1920, 1080);
  for (const p of PARTICLES) {
    const y = ((p.y - p.speed * t) % 1080 + 1080) % 1080;
    const x = p.x + Math.sin((t + p.y * 0.01) * 0.6) * p.drift;
    dctx.beginPath();
    dctx.arc(x, y, p.r, 0, Math.PI * 2);
    dctx.fillStyle = ${JSON.stringify(palette.accent)} + '';
    dctx.globalAlpha = p.alpha;
    dctx.fill();
  }
  dctx.globalAlpha = 1;
}

${grainRuntime()}

window.film = {
  duration: D,
  frame(t) {
    const k = easeInOut(clamp01(t / D));
    const z = FROM_Z + (TO_Z - FROM_Z) * k;
    const tilt = TILT * Math.sin(k * Math.PI);
    world.style.transform = 'translateZ(' + (-z).toFixed(1) + 'px) rotateY(' + tilt.toFixed(2) + 'deg)';
    // Panels fade with distance so the camera move reads as depth, not scale.
    for (const el of panels) {
      const pz = Number(el.dataset.z);
      const near = clamp01(1 - Math.abs(pz + z) / 900);
      el.style.opacity = (0.18 + 0.82 * near).toFixed(3);
    }
    lightEl.style.transform = 'rotate(' + (t * 6).toFixed(2) + 'deg)';
    drawDust(t);

    // Parallax: three planes at three speeds. The caption is nearest the
    // viewer and moves most; the panels ride the camera; the light and dust
    // hardly move at all. One constant-speed frame reads flat however good the
    // panels are — depth is what the eye reads as a camera.
    const p = clamp01(t / D);
    if (captionEl) {
      captionEl.style.transform = 'translate3d(' + (0).toFixed(2) + 'px,' + (-10 * p).toFixed(2) + 'px,0)';
      captionEl.style.opacity = (0.94 + 0.06 * Math.sin(p * Math.PI)).toFixed(3);
    }
    if (kickerEl) kickerEl.style.transform = 'translate3d(' + (-6 * p).toFixed(2) + 'px,0,0)';
    if (framenoEl) framenoEl.style.opacity = (0.28 + 0.16 * p).toFixed(3);
    dust.style.transform = 'translate3d(0,' + (-26 * p).toFixed(2) + 'px,0) scale(' + (1 + 0.02 * p).toFixed(4) + ')';

    setGrain(grainEl, t, 30);
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

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
