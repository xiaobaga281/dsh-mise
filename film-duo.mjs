/**
 * A presentation transition: two pages on screen at once, one leaving while the
 * other arrives.
 *
 * The existing transition overlays paint a shape over the cut. Professional
 * editing does the opposite: both shots are *present*, and their presentation
 * animates (a push, a fade, a wipe). That is what @remotion/transitions does,
 * and it reads as editing rather than as a wipe sticker.
 *
 * The page hosts the two source pages in iframes and drives their clocks
 * itself, so this works inside the film's one-page-per-clip model: the host
 * only ever drives this page.
 *
 * @module mise-film-duo
 */

export const DUO_KINDS = ['slide', 'fade', 'wipe', 'push-up', 'depth'];

/** The shortest join that still reads as movement rather than a stutter. */
export const MIN_DUO_DURATION = 0.8;

/**
 * @param {{ from?: string, to?: string, kind?: string, duration?: number, direction?: 'left'|'right'|'up'|'down', fromAt?: number }} spec
 * @param {{ exists?: (p: string) => boolean }} [env]
 */
export function validateDuoSpec(spec = {}, env = {}) {
  const problems = [];
  if (typeof spec.from !== 'string' || !spec.from) problems.push('`from` page is required');
  if (typeof spec.to !== 'string' || !spec.to) problems.push('`to` page is required');
  for (const key of ['from', 'to']) {
    if (typeof spec[key] === 'string' && spec[key] && typeof env.exists === 'function' && !env.exists(spec[key])) {
      problems.push(`not found in the project: ${spec[key]}`);
    }
  }
  if (spec.from === spec.to) problems.push('from and to must be different pages');
  if (spec.kind !== undefined && !DUO_KINDS.includes(spec.kind)) problems.push(`unknown kind ${JSON.stringify(spec.kind)}; there is ${DUO_KINDS.join(', ')}`);
  if (spec.direction !== undefined && !['left', 'right', 'up', 'down'].includes(spec.direction)) problems.push('direction must be left, right, up or down');
  const duration = Number(spec.duration ?? 1);
  // Under about four fifths of a second a hand-over reads as a stutter rather
  // than movement: refuse it instead of shipping a broken-looking join.
  if (!Number.isFinite(duration) || duration < MIN_DUO_DURATION || duration > 8) {
    problems.push(`duration must be ${MIN_DUO_DURATION}..8 seconds (a shorter join reads as a stutter)`);
  }
  return { ok: problems.length === 0, problems };
}

/** Build the page. */
export function buildDuoPage(spec = {}) {
  const kind = DUO_KINDS.includes(spec.kind) ? spec.kind : 'slide';
  const direction = spec.direction ?? 'left';
  const duration = Number(spec.duration ?? 1);
  const fromAt = Number(spec.fromAt ?? 0);
  const toAt = Number(spec.toAt ?? 0);
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
  .layer { position: absolute; inset: 0; will-change: transform, opacity, clip-path; }
  iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
</style>
</head>
<body>
  <div class="layer" id="from"><iframe src="${escapeAttr(spec.from)}"></iframe></div>
  <div class="layer" id="to"><iframe src="${escapeAttr(spec.to)}"></iframe></div>
<script type="module">
const D = ${duration};
const KIND = ${JSON.stringify(kind)};
const AXIS = ${JSON.stringify(axis)};
const SIGN = ${sign};
const FROM_AT = ${fromAt};
const TO_AT = ${toAt};
const fromLayer = document.getElementById('from');
const toLayer = document.getElementById('to');
const fromPage = fromLayer.querySelector('iframe');
const toPage = toLayer.querySelector('iframe');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

// Drive the two child pages ourselves: the host only clocks this page.
function drive(frame, localSeconds) {
  try {
    const win = frame.contentWindow;
    if (win && win.film && typeof win.film.frame === 'function') win.film.frame(localSeconds);
  } catch {}
}

// Pre-roll: the source pages are separate documents and take a moment to load,
// so the first fraction of a second shows only the outgoing shot. Without it
// the opening frames of the hand-over can be black.
const PREROLL = Math.min(0.3, D * 0.25);

window.film = {
  duration: D,
  ready: Promise.all([
    new Promise((resolve) => { if (fromPage.contentWindow?.film) resolve(); else fromPage.addEventListener('load', resolve, { once: true }); }),
    new Promise((resolve) => { if (toPage.contentWindow?.film) resolve(); else toPage.addEventListener('load', resolve, { once: true }); }),
  ]).catch(() => {}),
  frame(t) {
    const moving = clamp01((t - PREROLL) / Math.max(0.1, D - PREROLL));
    const p = easeInOut(moving);
    drive(fromPage, FROM_AT + t);
    drive(toPage, TO_AT + Math.max(0, t - PREROLL));

    if (KIND === 'fade') {
      fromLayer.style.opacity = (1 - p).toFixed(4);
      toLayer.style.opacity = p.toFixed(4);
    } else if (KIND === 'depth') {
      // A focus pull between shots: the outgoing frame recedes and softens, the
      // incoming one arrives from the foreground and comes into focus. Two
      // layers on different depth planes read as a cut in space, not a dissolve.
      fromLayer.style.transform = 'scale(' + (1 + 0.07 * p).toFixed(4) + ')';
      fromLayer.style.filter = 'blur(' + (p * 10).toFixed(2) + 'px)';
      fromLayer.style.opacity = (1 - p).toFixed(4);
      toLayer.style.transform = 'scale(' + (0.94 + 0.06 * p).toFixed(4) + ')';
      toLayer.style.filter = 'blur(' + ((1 - p) * 10).toFixed(2) + 'px)';
      toLayer.style.opacity = p.toFixed(4);
    } else if (KIND === 'wipe') {
      toLayer.style.clipPath = AXIS === 'x'
        ? 'inset(0 ' + ((1 - moving) * 100).toFixed(2) + '% 0 0)'
        : 'inset(' + ((1 - moving) * 100).toFixed(2) + '% 0 0 0)';
      toLayer.style.opacity = '1';
    } else if (KIND === 'push-up') {
      fromLayer.style.transform = 'translateY(' + (-p * 100).toFixed(2) + '%)';
      toLayer.style.transform = 'translateY(' + ((1 - p) * 100).toFixed(2) + '%)';
    } else {
      // slide: the outgoing shot leaves in the direction, the incoming follows it.
      const shift = p * 100 * SIGN;
      if (AXIS === 'x') {
        fromLayer.style.transform = 'translateX(' + shift.toFixed(2) + '%)';
        toLayer.style.transform = 'translateX(' + (shift - 100 * SIGN).toFixed(2) + '%)';
      } else {
        fromLayer.style.transform = 'translateY(' + shift.toFixed(2) + '%)';
        toLayer.style.transform = 'translateY(' + (shift - 100 * SIGN).toFixed(2) + '%)';
      }
    }
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
