/**
 * A typographic shot: type that rises through a mask, tracks in, or lands word
 * by word, with a light sweep — the title-sequence primitive.
 *
 * Type is where code video beats generated video outright: a generative clip
 * cannot render a brand headline at 60 fps with exact kerning and a mask line
 * that moves with the type. This page draws that, deterministically.
 *
 * @module openfilm-film-type
 */

import { gridCss } from './film-grid.mjs';
import { grainRuntime, motionRuntime } from './film-motionlib.mjs';
import { entranceSeconds, staggerStep } from './film-craft.mjs';
import { fontStack } from './film-fonts.mjs';
import { shotWarmth } from './film-craft.mjs';

export const TYPE_MOTIONS = ['mask-rise', 'tracking-in', 'per-word', 'blur-in'];

/**
 * Where the block of type sits in the frame.
 *
 * These are the difference between a sequence of cards and a film: four title
 * shots that all put the same block on the left are read as a template by the
 * third one. The builders have always had them; the tool surface did not, which
 * is why every generated title was centred.
 */
export const TYPE_LAYOUTS = ['center', 'editorial', 'right', 'lower', 'corner'];

/** The abstract geometry drawn on the open side of the frame. */
export const TYPE_MOTIFS = ['horizon', 'orbit', 'speed', 'lattice', 'none'];

/** The role each line plays in the hierarchy; size follows from the role. */
export const TYPE_ROLES = ['eyebrow', 'main', 'sub', 'note'];

/** Frame shapes the grid knows how to lay out. */
export const TYPE_ASPECTS = ['16:9', '9:16', '1:1', '4:5'];

export const TYPE_PALETTES = {
  amber: { bg: '#0b0906', ink: '#f7f0e4', accent: '#f0a64b' },
  teal: { bg: '#04090b', ink: '#e9f5f5', accent: '#4fd1c5' },
  mono: { bg: '#070708', ink: '#f3f3f3', accent: '#cfcfcf' },
  paper: { bg: '#f2ede3', ink: '#191510', accent: '#b4562c' },
};

/**
 * @param {{ lines?: Array<{ text: string, size?: number, kicker?: string }>, motion?: string, palette?: string, duration?: number, stagger?: number, align?: 'left'|'center', grain?: number, sweep?: number }} spec
 * @param {{ exists?: (p: string) => boolean }} [env]
 */
export function validateTypeSpec(spec = {}, env = {}) {
  const problems = [];
  const lines = Array.isArray(spec.lines) ? spec.lines : [];
  if (lines.length === 0) problems.push('give at least one line of type');
  if (lines.length > 4) problems.push('four lines is the most a title shot can carry');
  lines.forEach((line, index) => {
    if (typeof line?.text !== 'string' || !line.text.trim()) problems.push(`line ${index + 1} needs text`);
    if (line?.size !== undefined && (!Number.isFinite(line.size) || line.size < 12 || line.size > 400)) problems.push(`line ${index + 1}: size must be 12..400`);
  });
  if (spec.motion !== undefined && !TYPE_MOTIONS.includes(spec.motion)) problems.push(`unknown motion ${JSON.stringify(spec.motion)}; there is ${TYPE_MOTIONS.join(', ')}`);
  if (spec.palette !== undefined && !TYPE_PALETTES[spec.palette]) problems.push(`unknown palette ${JSON.stringify(spec.palette)}`);
  if (spec.layout !== undefined && !TYPE_LAYOUTS.includes(spec.layout)) problems.push(`unknown layout ${JSON.stringify(spec.layout)}; there is ${TYPE_LAYOUTS.join(', ')}`);
  if (spec.motif !== undefined && !TYPE_MOTIFS.includes(spec.motif)) problems.push(`unknown motif ${JSON.stringify(spec.motif)}; there is ${TYPE_MOTIFS.join(', ')}`);
  if (spec.aspect !== undefined && !TYPE_ASPECTS.includes(spec.aspect)) problems.push(`unknown aspect ${JSON.stringify(spec.aspect)}; there is ${TYPE_ASPECTS.join(', ')}`);
  if (spec.inset !== undefined && (!Number.isFinite(Number(spec.inset)) || Number(spec.inset) < 0 || Number(spec.inset) > 400)) problems.push('inset must be 0..400 (px kept clear for letterbox bars)');
  if (spec.warmth !== undefined && (!Number.isFinite(Number(spec.warmth)) || Number(spec.warmth) < -1 || Number(spec.warmth) > 1)) problems.push('warmth must be -1..1');
  lines.forEach((line, index) => {
    if (line?.role !== undefined && !TYPE_ROLES.includes(line.role)) problems.push(`line ${index + 1}: unknown role ${JSON.stringify(line.role)}; there is ${TYPE_ROLES.join(', ')}`);
  });
  const duration = Number(spec.duration ?? 4);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) problems.push('duration must be 0..120 seconds');
  if (spec.stagger !== undefined && (!Number.isFinite(spec.stagger) || spec.stagger < 0 || spec.stagger > 0.5)) problems.push('stagger must be 0..0.5 seconds per unit');
  for (const key of ['grain', 'sweep']) {
    if (spec?.[key] !== undefined && (!Number.isFinite(spec[key]) || spec[key] < 0 || spec[key] > 1)) problems.push(`${key} must be 0..1`);
  }
  return { ok: problems.length === 0, problems, lines };
}

/** Build the page. */
export function buildTypePage(spec = {}) {
  const palette = TYPE_PALETTES[spec.palette] ?? TYPE_PALETTES.amber;
  const motion = spec.motion ?? 'mask-rise';
  const duration = Number(spec.duration ?? 4);
  // Both come from the craft constants so the entrance band and the stagger cap
  // are enforced for every title page rather than remembered per call site.
  const stagger = staggerStep(Array.isArray(spec.lines) ? spec.lines.length : 2, { perItem: spec.stagger ?? 0.055 });
  const entrance = entranceSeconds(spec.entrance ?? 0.62);
  const grain = spec.grain ?? 0.1;
  // Colour temperature for this shot: a small band around the palette, not a
  // second palette. Deterministic from the shot index when not given.
  const warmth = Number.isFinite(Number(spec.warmth)) ? Number(spec.warmth) : shotWarmth(Number(spec.shotIndex ?? 0));
  const sweep = spec.sweep ?? 0.6;
  const align = spec.align === 'left' ? 'flex-start' : 'center';
  const layout = TYPE_LAYOUTS.includes(spec.layout) ? spec.layout : 'center';
  const inset = Math.max(0, Number(spec.inset ?? 0));
  // Which abstract motif sits on the open side of the frame. Deterministic for
  // a given page: the same film renders identically on every machine.
  const motif = TYPE_MOTIFS.includes(spec.motif)
    ? spec.motif
    : (layout === 'editorial' ? 'horizon' : 'orbit');
  const specimen = (() => {
    if (motif === 'none') return '';
    const W = 700;
    const H = 640;
    if (motif === 'horizon') {
      return Array.from({ length: 9 }, (_, i) => {
        const y = 90 + i * 58;
        const inset = i * 22;
        return `<path d="M${inset} ${y} H${W - inset}" opacity="${(0.5 - i * 0.04).toFixed(2)}"/>`;
      }).join('');
    }
    if (motif === 'orbit') {
      return Array.from({ length: 7 }, (_, i) => {
        const r = 90 + i * 46;
        return `<circle cx="${W * 0.62}" cy="${H * 0.46}" r="${r}" opacity="${(0.45 - i * 0.05).toFixed(2)}"/>`;
      }).join('');
    }
    if (motif === 'speed') {
      return Array.from({ length: 10 }, (_, i) => {
        const x = 70 + i * 62;
        return `<path d="M${x} ${H - 40} L${x - 150} 40" opacity="${(0.4 - i * 0.03).toFixed(2)}"/>`;
      }).join('');
    }
    return Array.from({ length: 11 }, (_, row) => Array.from({ length: 9 }, (_, col) =>
      `<circle cx="${60 + col * 72}" cy="${60 + row * 54}" r="1.8" opacity="0.3"/>`).join('')).join('');
  })();

  // Roles instead of "first line big, the rest smaller": a title shot has an
  // eyebrow, a headline, a line of support and a footnote, and each one is a
  // different size, weight and colour. That hierarchy is what reads as designed.
  const ROLE_SIZE = {
    eyebrow: 'var(--small)',
    main: 'var(--display)',
    sub: 'var(--h2)',
    note: 'var(--body)',
  };
  const lines = (spec.lines ?? []).map((line, index, all) => {
    // The first line that is not explicitly something else is the headline. An
    // eyebrow above it must not steal the role, which is what "index 0 is main"
    // used to do.
    const explicit = Object.prototype.hasOwnProperty.call(ROLE_SIZE, line.role);
    let role = line.role;
    if (!explicit) {
      const earlier = all.slice(0, index).some((other) => !Object.prototype.hasOwnProperty.call(ROLE_SIZE, other.role) || other.role === 'main');
      role = earlier ? 'sub' : 'main';
    }
    const size = line.size !== undefined ? (typeof line.size === 'number' ? `${line.size}px` : String(line.size)) : ROLE_SIZE[role];
    const units = motion === 'per-word'
      ? line.text.split(/(\s+)/).filter(Boolean).map((word) => `<span class="u word">${escapeHtml(word)}</span>`)
      : [...line.text].map((char) => `<span class="u char">${char === ' ' ? '&nbsp;' : escapeHtml(char)}</span>`);
    return `    <div class="line" data-role="${role}" style="--size:${size}">
      ${line.kicker ? `<div class="kicker">${escapeHtml(line.kicker)}</div>` : ''}
      <div class="row">${units.join('')}</div>
    </div>`;
  }).join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
${gridCss(spec.aspect ?? '16:9')}
  html, body { margin: 0; width: 100%; height: 100%; background: ${palette.bg}; overflow: hidden;
    font-family: ${fontStack()}; }
  .stage { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;
    align-items: ${align}; padding: 0 var(--margin); gap: calc(var(--body) * 0.9); box-sizing: border-box; }
  /* Editorial layout: the type sits in the second column, left-aligned, with a
     short accent bar above it. A single centred line on an empty field is the
     look of a placeholder; this is the look of a page. */
  .stage.editorial { align-items: flex-start; text-align: left;
    padding-left: calc(var(--margin) + var(--col) + var(--gutter)); }
  .stage.editorial .line { max-width: calc(var(--col) * 9 + var(--gutter) * 8); }
  .stage.editorial .kicker { letter-spacing: 0.34em; opacity: 0.72; color: ${palette.accent}; }
  /* Layout variants. Four title shots in a row cannot all be the same block on
     the left: the eye stops reading variation and starts reading a template.
     Right, lower and corner place the same hierarchy in a different part of the
     frame, which is how a sequence of cards stays alive. */
  .stage.right { align-items: flex-end; text-align: right;
    padding-right: calc(var(--margin) + var(--col) + var(--gutter)); }
  .stage.right .line { max-width: calc(var(--col) * 9 + var(--gutter) * 8); }
  .stage.right .bar { margin-left: auto; }
  .stage.lower { justify-content: flex-end; align-items: flex-start; text-align: left;
    padding: 0 var(--margin) calc(var(--safe) + var(--body) * 2.2 + var(--inset, 0px)) calc(var(--margin) + var(--col) + var(--gutter)); }
  .stage.corner { justify-content: flex-end; align-items: flex-end; text-align: right;
    padding: 0 calc(var(--margin) + var(--col) + var(--gutter)) calc(var(--safe) + var(--body) * 1.6 + var(--inset, 0px)) 0; }
  .stage.corner .bar { margin-left: auto; }
  .stage.right .line[data-role="note"], .stage.corner .line[data-role="note"] { border-top: none; }
  /* Role styling: an eyebrow is small, spaced and coloured; a headline is the
     heaviest thing on screen; support is quieter; a footnote is a whisper with a
     rule above it. Same four levels on every title shot. */
  .line[data-role="eyebrow"] { margin-bottom: calc(var(--body) * 0.35); }
  .line[data-role="eyebrow"] .u { font-weight: 600; letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.85; }
  .line[data-role="main"] { margin-bottom: calc(var(--body) * 0.15); }
  .line[data-role="sub"] .u { font-weight: 500; line-height: 1.22; letter-spacing: 0; opacity: 0.86; }
  .line[data-role="note"] { margin-top: calc(var(--body) * 0.55); padding-top: calc(var(--body) * 0.4);
    border-top: 1px solid ${palette.accent}55; }
  .line[data-role="note"] .u { font-weight: 400; letter-spacing: 0.02em; opacity: 0.62; }
  .stage.editorial .bar { width: calc(var(--col) * 2); height: 3px; background: ${palette.accent};
    margin-bottom: calc(var(--body) * 0.6); opacity: 0.9; }
  .band { position: absolute; left: 0; right: 0; bottom: 0; height: 38%; pointer-events: none;
    background: linear-gradient(to top, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.18) 55%, transparent 100%); }
  .wash { position: absolute; inset: -25%; pointer-events: none; opacity: 0.5;
    background: radial-gradient(46% 44% at 22% 26%, ${palette.accent}33, transparent 72%); }
  .edge { position: absolute; top: 0; bottom: 0; left: calc(var(--margin) + var(--col) * 0.5); width: 1px;
    background: linear-gradient(to bottom, transparent, ${palette.accent}55 30%, ${palette.accent}55 70%, transparent); opacity: 0.5; }
  /* A graphic signature: abstract geometry at a whisper of opacity on the open
     side of the frame. Type alone on black reads as a slide; a few drawn lines
     give the eye somewhere to rest without competing with the words. */
  .signature { position: absolute; right: 0; bottom: 0; width: 62%; height: 78%; pointer-events: none;
    opacity: 0.9; mix-blend-mode: screen; }
  .signature.on-left { right: auto; left: 0; }
  .signature-glow { position: absolute; right: -6%; bottom: -8%; width: 58%; height: 62%; pointer-events: none;
    background: radial-gradient(52% 52% at 60% 55%, ${palette.accent}22, transparent 72%); opacity: 0.85; }
  .layout-right .signature-glow, .layout-corner .signature-glow { right: auto; left: -6%; }
  .signature path, .signature circle, .signature line { fill: none; stroke: ${palette.accent}; stroke-width: 3.2;
    vector-effect: non-scaling-stroke; }
  .line { color: ${palette.ink}; max-width: calc(var(--col) * var(--cols) + var(--gutter) * (var(--cols) - 1)); }
  .kicker { font-size: var(--small); letter-spacing: 0.3em; text-transform: uppercase; opacity: 0.5; margin-bottom: calc(var(--body) * 0.5); }
  .row { display: flex; flex-wrap: wrap; align-items: baseline; overflow: hidden; }
  .u { display: inline-block; font-size: var(--size); font-weight: 700; line-height: 1.04; letter-spacing: -0.015em;
    will-change: transform, opacity, filter; background-image: linear-gradient(100deg, ${palette.ink} 0%, ${palette.ink} 38%, ${palette.accent} 50%, ${palette.ink} 62%, ${palette.ink} 100%);
    background-size: 280% 100%; background-position: 0% 0; -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent; }
  .u.accent { background-image: linear-gradient(100deg, ${palette.accent} 0%, ${palette.accent} 38%, ${palette.ink} 50%, ${palette.accent} 62%, ${palette.accent} 100%); }
  .rule { position: absolute; left: var(--margin); right: var(--margin); height: 1px; background: var(--rule); }
  .rule.top { top: var(--safe); } .rule.bottom { bottom: calc(var(--safe) + var(--inset, 0px)); }
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
    background: radial-gradient(120% 130% at 50% 48%, transparent 45%, rgba(0,0,0,0.35) 100%); }
  .tint { position: absolute; inset: 0; pointer-events: none; mix-blend-mode: soft-light;
    background: ${warmth >= 0 ? `rgba(255, 168, 96, ${(Math.abs(warmth) * 0.26).toFixed(3)})` : `rgba(118, 168, 255, ${(Math.abs(warmth) * 0.26).toFixed(3)})`}; }
</style>
</head>
<body style="--inset:${inset.toFixed(0)}px">
<div class="rule top"></div>
<div class="rule bottom"></div>
<div class="signature-glow"></div>
<svg class="signature${layout === 'right' || layout === 'corner' ? ' on-left' : ''}" viewBox="0 0 700 640" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">${specimen}</svg>
${layout === 'editorial' ? '<div class="wash"></div>\n<div class="band"></div>\n<div class="edge"></div>\n' : ''}<div class="stage${layout === 'center' ? '' : ` ${layout}`}">
${layout === 'center' ? '' : '  <div class="bar"></div>\n'}${lines}
</div>
<div class="vignette"></div>
<div class="texture"></div>
<div class="tint"></div>
<div class="grain"></div>
<script type="module">
const D = ${duration};
const STAGGER = ${stagger};
const ENTRANCE = ${entrance};
const MOTION = ${JSON.stringify(motion)};
const SWEEP = ${sweep};
const stageEl = document.querySelector('.stage');
const units = [...document.querySelectorAll('.u')];
const grainEl = document.querySelector('.grain');
const sigEl = document.querySelector('.signature');
const sigParts = sigEl ? [...sigEl.querySelectorAll('path, circle, line')] : [];
// A drawn line has a length; that length is the dash it starts hidden behind.
const sigLengths = sigParts.map((part) => { try { return part.getTotalLength(); } catch { return 0; } });

${motionRuntime()}
${grainRuntime()}
const easeOut = EASE.outCubic;

window.film = {
  duration: D,
  frame(t) {
    units.forEach((el, i) => {
      // A sprung entrance, not a linear slide: each unit arrives, overshoots a
      // hair and settles. stiffness/damping are the vocabulary motion references
      // use (Remotion / Reanimated), and the same curve the tests check. The
      // stagger and the entrance length come from the craft constants: a long
      // line must not take a second to appear.
      const delay = 0.18 + stagger(i, { base: STAGGER, spread: 0.02, seed: 11 });
      const k = clamp01(springPhysics({
        frame: (t - delay) * 60,
        fps: 60,
        config: { stiffness: 140, damping: 15, mass: 1 },
        durationInFrames: ENTRANCE * 60,
      }));
      const settle = clamp01((t - delay) / 0.32);
      if (MOTION === 'mask-rise') {
        el.style.transform = 'translateY(' + ((1 - k) * 112).toFixed(2) + '%)';
        el.style.opacity = settle.toFixed(3);
      } else if (MOTION === 'tracking-in') {
        el.style.transform = 'scale(' + (1 + (1 - k) * 0.08).toFixed(3) + ')';
        el.style.opacity = settle.toFixed(3);
        el.style.letterSpacing = ((1 - k) * 0.22).toFixed(3) + 'em';
      } else if (MOTION === 'blur-in') {
        el.style.filter = 'blur(' + ((1 - k) * 14).toFixed(2) + 'px)';
        el.style.opacity = settle.toFixed(3);
      } else {
        el.style.transform = 'translateY(' + ((1 - k) * 24).toFixed(2) + 'px)';
        el.style.opacity = settle.toFixed(3);
      }
    });
    // The shine travels inside the glyphs (background-clip: text), not across
    // the frame: a full-frame gradient band is a screen wipe, not a title cue.
    const crossing = clamp01((t - 0.1) / Math.max(0.8, D * 0.55));
    const easedBand = crossing < 0.5 ? 4 * crossing * crossing * crossing : 1 - Math.pow(-2 * crossing + 2, 3) / 2;
    const position = ((-20 + 140 * easedBand) * (0.4 + 0.6 * SWEEP)).toFixed(2) + '% 0';
    units.forEach((el) => { el.style.backgroundPosition = position; });

    // Idle life: after the entrance the frame must not freeze. A real camera is
    // never perfectly still, and a still frame of type reads as a slide rather
    // than a shot. This is deliberately tiny — 3px of drift and a 0.4% scale
    // over the whole shot — so it registers as life, not as movement.
    const breath = Math.sin((t / Math.max(1, D)) * Math.PI * 2) * 0.5 + 0.5;
    const driftY = (-3 + 6 * breath).toFixed(2);
    const driftScale = (1.004 + 0.002 * breath).toFixed(4);
    stageEl.style.transform = 'translateY(' + driftY + 'px) scale(' + driftScale + ')';
    stageEl.style.transformOrigin = '50% 55%';

    setGrain(grainEl, t, 30);

    // The signature draws itself in and then drifts very slowly: it is scenery,
    // not animation, so it is allowed to arrive after the words do.
    if (sigEl && sigParts.length) {
      const draw = clamp01((t - 0.25) / 1.6);
      sigParts.forEach((part, i) => {
        const length = sigLengths[i] || 0;
        const local = clamp01((draw - i * 0.02) / 0.9);
        part.style.strokeDasharray = length.toFixed(1);
        part.style.strokeDashoffset = (length * (1 - local)).toFixed(1);
      });
      sigEl.style.transform = 'translate3d(' + (-8 * clamp01(t / D)).toFixed(2) + 'px,' + (6 * clamp01(t / D)).toFixed(2) + 'px,0)';
      sigEl.style.opacity = (0.5 + 0.24 * draw).toFixed(3);
    }
  },
};
</script>
</body>
</html>
`;
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
