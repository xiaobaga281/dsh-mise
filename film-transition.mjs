/**
 * Transition overlays: an element that covers a cut, so the join reads as a
 * move instead of a jump.
 *
 * An overlay is its own page on its own track, above the picture. It paints a
 * shape (a line that opens into a band, an iris, RGB strips, letterbox bars, a
 * warm flash) that is opaque where the cut happens and gone by the end, so the
 * two shots appear to pass through it.
 *
 * The page has a transparent background on purpose: the track above the picture
 * is composited over it.
 *
 * @module openfilm-film-transition
 */

export const TRANSITION_KINDS = ['line', 'wipe', 'iris', 'rgb', 'letterbox', 'flash'];

export const TRANSITION_COLORS = {
  ink: '#f4efe6',
  black: '#05080a',
  amber: '#f0a64b',
  teal: '#4fd1c5',
  white: '#ffffff',
};

/**
 * @param {{ kind?: string, duration?: number, color?: string, direction?: 'left'|'right'|'up'|'down', thickness?: number, softness?: number }} spec
 */
export function validateTransitionSpec(spec = {}) {
  const problems = [];
  const kind = spec.kind ?? 'line';
  if (!TRANSITION_KINDS.includes(kind)) problems.push(`unknown kind ${JSON.stringify(kind)}; there is ${TRANSITION_KINDS.join(', ')}`);
  if (spec.color !== undefined && !TRANSITION_COLORS[spec.color]) problems.push(`unknown color ${JSON.stringify(spec.color)}; there is ${Object.keys(TRANSITION_COLORS).join(', ')}`);
  if (spec.direction !== undefined && !['left', 'right', 'up', 'down'].includes(spec.direction)) problems.push('direction must be left, right, up or down');
  const duration = Number(spec.duration ?? 0.7);
  if (!Number.isFinite(duration) || duration <= 0.05 || duration > 5) problems.push('duration must be 0.05..5 seconds');
  for (const key of ['thickness', 'softness']) {
    if (spec?.[key] !== undefined && (!Number.isFinite(spec[key]) || spec[key] < 0 || spec[key] > 1)) problems.push(`${key} must be 0..1`);
  }
  return { ok: problems.length === 0, problems };
}

/** Build the page. */
export function buildTransitionPage(spec = {}) {
  const kind = spec.kind ?? 'line';
  const duration = Number(spec.duration ?? 0.7);
  // A cut is best hidden in the film's own darkness: black is the default, and
  // white ("ink") stays available for a deliberate flash.
  const color = TRANSITION_COLORS[spec.color] ?? TRANSITION_COLORS.black;
  const direction = spec.direction ?? 'right';
  const thickness = spec.thickness ?? 0.5;
  const softness = spec.softness ?? 0.2;
  const axis = direction === 'up' || direction === 'down' ? 'y' : 'x';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .layer { position: absolute; inset: -5%; will-change: transform, opacity, clip-path; }
  .solid { background: ${color}; }
  .band { position: absolute; inset: 0; }
  .split { display: flex; flex-direction: row; height: 100%; }
  .split > div { flex: 1; }
</style>
</head>
<body>
<div class="layer solid" id="solid" style="transform: scale(0)"></div>
<div class="layer" id="bars">
  <div class="band" style="top:0;height:50%;background:${color}"></div>
  <div class="band" style="bottom:0;height:50%;background:${color}"></div>
</div>
<div class="layer" id="stripes" style="opacity:0">
  <div class="split"><div style="background:#ff2a2a"></div><div style="background:#2aff6a"></div><div style="background:#2a6aff"></div></div>
</div>
<script type="module">
const D = ${duration};
const KIND = ${JSON.stringify(kind)};
const AXIS = ${JSON.stringify(axis)};
const SIGN = ${sign};
const THICK = ${thickness};
const SOFT = ${softness};
const solid = document.getElementById('solid');
const bars = document.getElementById('bars');
const stripes = document.getElementById('stripes');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);

window.film = {
  duration: D,
  frame(t) {
    const k = clamp01(t / D);
    // The element must be OPAQUE exactly at the cut (k = 0.5) and gone by both
    // ends, so each kind is a pair of ramps around that midpoint.
    const cover = 1 - Math.abs(k - 0.5) * 2; // 0 → 1 → 0
    if (KIND === 'line') {
      const w = easeOut(clamp01(cover));
      solid.style.transform = 'scale(' + (0.02 + 0.98 * w).toFixed(4) + ')';
      solid.style.opacity = cover > 0.02 ? '1' : '0';
    } else if (KIND === 'wipe') {
      const p = easeInOut(clamp01((k - 0.5) * 2 + 0.5));
      solid.style.opacity = '1';
      solid.style.transform = 'none';
      solid.style.clipPath = AXIS === 'x'
        ? 'inset(0 ' + ((1 - clamp01(cover)) * 100).toFixed(2) + '% 0 0)'
        : 'inset(' + ((1 - clamp01(cover)) * 100).toFixed(2) + '% 0 0 0)';
    } else if (KIND === 'iris') {
      const r = 4 + 150 * easeOut(clamp01(cover));
      solid.style.transform = 'none';
      solid.style.opacity = '1';
      solid.style.clipPath = 'circle(' + r.toFixed(1) + '% at 50% 50%)';
    } else if (KIND === 'rgb') {
      stripes.style.opacity = String(clamp01(cover * 1.6));
      stripes.style.transform = 'translateX(' + (SIGN * (1 - cover) * 12).toFixed(2) + '%)';
      solid.style.opacity = '0';
    } else if (KIND === 'letterbox') {
      solid.style.opacity = '0';
      const h = 46 * easeOut(clamp01(cover));
      bars.style.opacity = '1';
      const bands = bars.querySelectorAll('.band');
      bands[0].style.height = h.toFixed(2) + '%';
      bands[0].style.top = '0';
      bands[1].style.height = h.toFixed(2) + '%';
    } else {
      // flash: a soft warm bloom that peaks exactly on the cut
      solid.style.transform = 'none';
      solid.style.opacity = (0.55 * cover).toFixed(3);
    }
    const soft = 1 - SOFT * (1 - cover);
    solid.style.filter = 'blur(' + ((1 - soft) * 24).toFixed(1) + 'px)';
  },
};
</script>
</body>
</html>
`;
}
