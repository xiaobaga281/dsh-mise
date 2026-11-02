/**
 * Product promos as a reusable language.
 *
 * A promo is not six unrelated slides. It is one frame repeated: same grid, same
 * chrome (brand, index, progress), same camera move, and joins that pull focus
 * instead of sliding. This module builds that film from a brief — a list of
 * shots, each either a statement, a real screen, or a number — so a user with
 * screenshots and copy can get a product film without designing a system first.
 *
 * Everything here is deterministic: the same brief produces the same bytes.
 *
 * @module openfilm-film-promo
 */

export const PROMO_DEFAULTS = {
  blue: '#468CFF',
  ink: '#F2F6FB',
  dim: '#7F93A8',
  background: '#05070B',
  transition: 0.55,
  bpm: 84,
};

const SHOT_KINDS = ['type', 'plate', 'number', 'claim', 'end'];

const esc = (text) => String(text ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const titleLines = (list) => (list ?? []).map((line) => `<div class="tl">${esc(line)}</div>`).join('');

/**
 * Validate a promo brief before anything is written.
 *
 * @param {{ title?: string, shots?: Array<object>, transition?: number, bpm?: number }} brief
 */
export function planPromo(brief = {}) {
  const problems = [];
  const shots = Array.isArray(brief.shots) ? brief.shots : [];
  if (!shots.length) problems.push('a promo needs at least one shot');
  if (shots.length > 12) problems.push('keep a promo to 12 shots or fewer');
  const style = SKELETON_STYLE[brief.skeleton] ?? SKELETON_STYLE.product;
  const transition = Number(brief.transition ?? style.transition?.duration ?? PROMO_DEFAULTS.transition);
  const joinKind = String(brief.joinKind ?? style.transition?.kind ?? 'depth');
  const pace = Number(style.paceScale ?? 1);
  if (!(transition > 0.1 && transition <= 1.5)) problems.push('transition must be 0.1..1.5 seconds');

  let cursor = 0;
  const planned = shots.map((shot, index) => {
    const kind = SHOT_KINDS.includes(shot?.kind) ? shot.kind : 'type';
    // The structure sets the pace: a credibility film breathes, a speed film
    // is cut tighter. An explicit duration always wins.
    const duration = Number(shot?.duration ?? 3.6 * pace);
    if (!(duration > 0.8 && duration <= 12)) problems.push(`shot ${index + 1}: duration must be 0.8..12s`);
    if (kind === 'plate' && !shot?.image) problems.push(`shot ${index + 1}: a plate needs an image`);
    if (kind !== 'plate' && kind !== 'number' && kind !== 'claim' && !shot?.title) problems.push(`shot ${index + 1}: a ${kind} shot needs a title`);
    if (kind === 'claim' && !shot?.claim) problems.push(`shot ${index + 1}: a claim shot needs a claim`);
    if (kind === 'claim' && Array.isArray(shot?.evidence) && shot.evidence.some((row) => !row?.text)) {
      problems.push(`shot ${index + 1}: every evidence row needs text`);
    }
    // A number shot needs at least one honest figure: a single value, or a row of
    // them where each carries its own unit.
    if (kind === 'number') {
      const rows = Array.isArray(shot?.figures) ? shot.figures.filter((entry) => Number.isFinite(Number(entry?.value))) : [];
      if (!rows.length && !Number.isFinite(Number(shot?.figure))) {
        problems.push(`shot ${index + 1}: a number shot needs a figure (or a figures row)`);
      }
      for (const [entryIndex, entry] of rows.entries()) {
        if (!entry.unit) problems.push(`shot ${index + 1}: figure ${entryIndex + 1} needs a unit`);
      }
    }
    if (kind === 'end' && !shot?.url) problems.push(`shot ${index + 1}: the end card needs a url`);

    const at = Number(cursor.toFixed(3));
    // Every shot gives its first transition length to the join that precedes it,
    // so no two clips ever share a frame: the film's clips are exactly the pages'
    // [transition, duration] ranges (the first page starts at 0).
    const visible = Number((duration - transition).toFixed(3));
    cursor += visible;
    return {
      index,
      kind,
      duration: Number(duration.toFixed(3)),
      at,
      visible,
      shot,
    };
  });

  // The claim is the one shot that should outlast the rest: if the film stops to
  // say something, it has to actually stop.
  const claimIndex = planned.findIndex((entry) => entry.kind === 'claim');
  let claimDuration = 0;
  if (claimIndex >= 0) {
    const others = planned.reduce((sum, entry, i) => (i === claimIndex ? sum : sum + entry.duration), 0);
    claimDuration = Number(Math.min(6.4, Math.max(4.6, others * 0.34)).toFixed(3));
    planned[claimIndex].duration = claimDuration;
    // Re-lay the timeline with the longer claim.
    let at = 0;
    planned.forEach((entry, i) => {
      entry.at = Number(at.toFixed(3));
      entry.visible = Number((entry.duration - transition).toFixed(3));
      at += entry.duration - transition;
    });
    cursor = at;
  }
  const seconds = Number(cursor.toFixed(3));
  if (problems.length) return { ok: false, problems };
  return { ok: true, problems: [], shots: planned, seconds, transition, joinKind };
}

/** The shared page shell: one grid, one chrome, one set of moves. */
function pageHtml({ shot, planned, total, index, count, motion = SKELETON_STYLE.product.motion }) {
  const blue = PROMO_DEFAULTS.blue;
  const ink = PROMO_DEFAULTS.ink;
  const dim = PROMO_DEFAULTS.dim;
  const bg = PROMO_DEFAULTS.background;
  const isPlate = planned.kind === 'plate';
  // The film is lit from one place. Everything that catches light — the room,
  // the glass, the sweep, the callout's shadow — uses this same source, which is
  // what makes separate shots read as one room.
  const LIGHT = { x: 0.34, y: 0.26 };
  const lightDeg = Number(((Math.atan2(LIGHT.y - 0.5, LIGHT.x - 0.5) * 180) / Math.PI).toFixed(1));
  // The camera language per shot kind: a dolly for words, a shoulder for proof,
  // a locked-off frame for figures — each with a start and a settle.
  const FOCUS = planned.kind === 'plate' ? { bg: 40, surface: 1.8, copy: 0 }
    : planned.kind === 'number' ? { bg: 48, surface: 2.4, copy: 0 }
      : { bg: 60, surface: 0.8, copy: 0 };
  const CAMERA = planned.kind === 'number' ? 'locked'
    : (planned.kind === 'claim' || planned.kind === 'type' || planned.kind === 'end') ? 'dolly'
      : 'shoulder';
  const surfaceClass = planned.kind === 'number' ? 'surface-metal'
    : planned.kind === 'claim' ? 'surface-glass'
      : isPlate ? 'surface-glass'
        : 'surface-paper';
  const kicker = shot.kicker ?? shot.eyebrow ?? '';
  const push = Number(motion.push ?? 0.09);
  const settle = Number(motion.settle ?? 0.9);
  const stagger = Number(motion.stagger ?? 0.1);
  const sweep = Number(motion.sweep ?? 1.5);

  const bgLayer = isPlate
    ? `<div class="bg"><img src="${esc(shot.image)}" alt=""></div><div class="veil"></div>`
    : '<div class="room"></div>';

  let body = '';
  let css = '';
  let frameCode = '';

  if (planned.kind === 'number') {
    // A number shot may carry one figure or a short row of them. Each cell keeps
    // its own unit and label, and the row can name where the figures came from.
    const numberFigures = Array.isArray(shot.figures) && shot.figures.length
      ? shot.figures.slice(0, 3)
      : [{ value: Number(shot.figure ?? 0), unit: shot.unit ?? '', label: shot.caption ?? '' }];
    body = `
  <div class="copy">
    <div class="kicker">${esc(shot.caption ?? '')}</div>
    <div class="figures">${numberFigures.map((entry, i) => `<div class="fig"><b data-v="${Number(entry.value)}">0</b><u>${esc(entry.unit ?? '')}</u><span>${esc(entry.label ?? '')}</span></div>`).join('')}</div>
    ${shot.sources ? `<div class="figs-src">${esc(shot.sources)}</div>` : ''}
  </div>`;
    css = `
  .figures { display: flex; flex-direction: column; gap: 30px; }
  .fig { display: flex; align-items: baseline; gap: 16px; }
  .fig b { font-size: 128px; line-height: 1; font-weight: 800; color: var(--ink);
    letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }
  .fig u { text-decoration: none; font-size: 38px; font-weight: 700; color: var(--blue); }
  .fig span { font-size: 26px; color: var(--dim); }
  .figs-src { margin-top: 26px; font-size: 19px; letter-spacing: 0.04em; color: #5D6D80; }`;
    frameCode = `
    const figs = [...document.querySelectorAll('.fig b')];
    figs.forEach((el, i) => {
      const target = Number(el.dataset.v ?? 0);
      const k = easeOut(clamp01((t - 0.2 - i * 0.12) / 1.05));
      el.textContent = String(Math.round(target * k));
    });`;
  } else if (planned.kind === 'claim') {
    // The conclusion, and the receipts under it: a claim with no evidence rows is
    // just a louder slide, so the rows are part of the layout.
    const evidence = Array.isArray(shot.evidence) ? shot.evidence.slice(0, 3) : [];
    body = `
  <div class="copy claimcopy">
    ${shot.kicker ? `<div class="kicker">${esc(shot.kicker)}</div>` : ''}
    <div class="claimtext">${esc(shot.claim)}</div>
    <div class="evid">${evidence.map((row) => `<div class="ev"><i></i><span>${esc(row.text)}</span>${row.source ? `<em>${esc(row.source)}</em>` : ''}</div>`).join('')}</div>
  </div>`;
    css = `
  .claimcopy { width: 900px; gap: 30px; }
  .claimtext { font-size: 72px; line-height: 1.18; font-weight: 800; color: var(--ink); letter-spacing: -0.02em; }
  .evid { display: flex; flex-direction: column; gap: 14px; margin-top: 6px; }
  .ev { display: flex; align-items: center; gap: 14px; font-size: 24px; color: var(--dim); }
  .ev i { width: 26px; height: 3px; background: var(--blue); border-radius: 2px; flex: 0 0 auto; }
  .ev em { font-style: normal; font-size: 19px; color: #56657a; } `;
    frameCode = `
    const rows = [...document.querySelectorAll('.ev')];
    rows.forEach((el, i) => {
      const k = easeOut(clamp01((t - 0.35 - i * 0.14) / 0.5));
      el.style.opacity = k.toFixed(3);
      el.style.transform = 'translateX(' + ((1 - k) * -18).toFixed(1) + 'px)';
    });`;
  } else if (planned.kind === 'end') {
    body = `
  <div class="copy endcopy">
    <div class="kicker">${esc(shot.eyebrow ?? 'OPEN SOURCE')}</div>
    <div class="endtitle">${esc((shot.title ?? [])[0] ?? '')}</div>
    <div class="bar"></div>
    <div class="endurl">${esc(shot.url)}</div>
    ${shot.note ? `<div class="note">${esc(shot.note)}</div>` : ''}
  </div>`;
    css = `
  .endcopy { width: 900px; gap: 26px; }
  .endtitle { font-size: 128px; line-height: 1; font-weight: 800; color: var(--ink); letter-spacing: -0.03em; }
  .endurl { font-size: 40px; font-weight: 700; color: #9CC3FF; }`;
  } else {
    body = `
  <div class="copy">
    ${kicker ? `<div class="kicker">${esc(kicker)}</div>` : ''}
    <div class="title">${titleLines(shot.title)}</div>
    <div class="bar"></div>
    ${shot.note ? `<div class="note">${esc(shot.note)}</div>` : ''}
  </div>`;
  }

  if (isPlate) {
    frameCode = `
    if (phoneEl) {
      const k = settle(clamp01(t / SETTLE));
      const fl = Math.sin(t * 1.05) * 4;
      phoneEl.style.transform = 'translate3d(' + ((1 - k) * 230).toFixed(1) + 'px,' + (((1 - k) * 38) + fl).toFixed(1) + 'px,0)';
      phoneEl.style.opacity = clamp01(t / 0.45).toFixed(3);
    }
    if (screenEl) screenEl.style.transform = 'translateY(' + (-16 * easeInOut(clamp01(t / D))).toFixed(1) + 'px)';`;
  }

  const mark = isPlate && shot.mark && Number.isFinite(Number(shot.mark.x))
    ? {
      x: Number(shot.mark.x),
      y: Number(shot.mark.y),
      w: Number(shot.mark.w ?? 560),
      h: Number(shot.mark.h ?? 120),
      label: String(shot.mark.label ?? shot.kicker ?? ''),
    }
    : null;
  // A behaviour claim needs two states of the same screen: the callout then has
  // somewhere to travel, which is what makes "it now does this" visible.
  const markAfter = isPlate && shot.markAfter && Number.isFinite(Number(shot.markAfter.x))
    ? {
      x: Number(shot.markAfter.x),
      y: Number(shot.markAfter.y),
      w: Number(shot.markAfter.w ?? mark?.w ?? 560),
      h: Number(shot.markAfter.h ?? mark?.h ?? 120),
    }
    : null;
  const afterImage = isPlate && shot.imageAfter
    ? `<img class="after" src="${esc(shot.imageAfter)}" alt="">`
    : '';

  const phone = isPlate
    ? `<div class="phone"><div class="screen"><img src="${esc(shot.image)}" alt="">${afterImage}</div></div>${mark ? '<div class="mark"><div class="mark-box"></div><div class="mark-label"></div></div>' : ''}`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080">
<style>
  :root { --blue: ${blue}; --ink: ${ink}; --dim: ${dim}; --bg: ${bg};
    --bg-blur: ${FOCUS.bg}px; --surface-blur: ${FOCUS.surface}px; }
  html, body { margin: 0; width: 100%; height: 100%; background: var(--bg); overflow: hidden;
    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }
  .grid { position: absolute; inset: 0; pointer-events: none; opacity: 0.55;
    background-image: linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px);
    background-size: calc(100% / 12) 100%; }
  .bg { position: absolute; inset: 0; overflow: hidden; }
  .bg img { position: absolute; left: 50%; top: 50%; width: 112%; height: 112%; transform: translate(-50%,-50%);
    object-fit: cover; filter: blur(var(--bg-blur)) brightness(0.34) saturate(0.85); }
  .veil { position: absolute; inset: 0; background:
    radial-gradient(120% 100% at 16% 50%, rgba(5,7,11,0.97) 0%, rgba(5,7,11,0.78) 34%, rgba(5,7,11,0.30) 68%, rgba(5,7,11,0.74) 100%); }
  .room { position: absolute; inset: 0; background:
    radial-gradient(80% 70% at ${(LIGHT.x * 100).toFixed(0)}% ${(LIGHT.y * 100).toFixed(0)}%, rgba(120,170,255,0.22) 0%, rgba(5,7,11,0) 62%),
    radial-gradient(60% 60% at ${((1 - LIGHT.x) * 100).toFixed(0)}% ${((1 - LIGHT.y) * 100).toFixed(0)}%, rgba(20,40,80,0.35) 0%, rgba(5,7,11,0) 60%); }
  /* The side away from the source sits a little darker. */
  /* Air in the room: a haze that thickens toward the light, and a bloom that
     only spreads the highlights — both kept faint enough to never read as fog. */
  .haze { position: absolute; inset: 0; pointer-events: none; opacity: 0.4;
    background:
      radial-gradient(70% 55% at ${(LIGHT.x * 100).toFixed(0)}% ${(LIGHT.y * 100).toFixed(0)}%, rgba(150,185,235,0.10) 0%, rgba(150,185,235,0) 60%),
      linear-gradient(175deg, rgba(120,150,190,0.055) 0%, rgba(0,0,0,0) 52%); }
  .bloom { position: absolute; inset: 0; pointer-events: none; opacity: 0.11;
    mix-blend-mode: screen; backdrop-filter: blur(24px) brightness(1.5) saturate(0.9);
    -webkit-mask-image: radial-gradient(58% 48% at ${(LIGHT.x * 100).toFixed(0)}% ${(LIGHT.y * 100).toFixed(0)}%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0) 78%);
    mask-image: radial-gradient(58% 48% at ${(LIGHT.x * 100).toFixed(0)}% ${(LIGHT.y * 100).toFixed(0)}%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0) 78%); }
  .shade { position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(${(lightDeg + 180).toFixed(0)}deg, rgba(0,0,0,0) 42%, rgba(0,0,0,0.34) 100%); }
  /* Each kind of shot gets its own surface, so a cut changes the material as
     well as the content: paper under the words, glass over a screen, machined
     metal under a number. */
  .surface { position: absolute; inset: 0; pointer-events: none; filter: blur(var(--surface-blur)); }
  .surface-paper { opacity: 0.62;
    background-image: radial-gradient(rgba(255,255,255,0.085) 0.6px, transparent 0.7px);
    background-size: 3px 3px; }
  .surface-glass { opacity: 0.7;
    background: linear-gradient(${(lightDeg + 90).toFixed(0)}deg, transparent 26%, rgba(150,195,255,0.10) 42%, rgba(255,255,255,0.18) 50%, rgba(150,195,255,0.08) 58%, transparent 74%); }
  .surface-metal { opacity: 0.6;
    background-image: repeating-linear-gradient(90deg, rgba(255,255,255,0.085) 0 1px, transparent 1px 6px),
      repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 64px); }
  .sweep { position: absolute; inset: -20%; pointer-events: none; opacity: 0;
    background: linear-gradient(102deg, transparent 40%, rgba(255,255,255,0.10) 50%, transparent 60%); }
  .brand { position: absolute; left: 96px; top: 72px; font-size: 17px; letter-spacing: 0.44em;
    color: var(--dim); text-transform: uppercase; }
  .brand b { color: var(--ink); font-weight: 700; }
  .prog { position: absolute; left: 96px; right: 96px; bottom: 60px; height: 2px; background: rgba(255,255,255,0.09); }
  .prog i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: var(--blue); }
  .idx { position: absolute; right: 96px; top: 68px; font-size: 15px; letter-spacing: 0.32em; color: var(--dim); }
  .copy { position: absolute; left: 118px; top: 50%; transform: translateY(-50%); width: 800px;
    display: flex; flex-direction: column; gap: 24px; }
  .kicker { font-size: 20px; letter-spacing: 0.36em; color: var(--blue); text-transform: uppercase; }
  .title { font-size: 84px; line-height: 1.16; font-weight: 800; color: var(--ink); letter-spacing: -0.015em; }
  .tl { display: block; }
  .note { font-size: 26px; line-height: 1.55; color: var(--dim); }
  .bar { width: 96px; height: 3px; background: var(--blue); }
  /* The callout that ties the line to the part of the screen it is about. */
  .mark { position: absolute; left: 1403px; top: 131px; width: 378px; height: 818px;
    overflow: hidden; pointer-events: none; }
  .mark-box { position: absolute; border: 3px solid #FFC15E; border-radius: 14px;
    box-shadow: 0 0 0 9999px rgba(3,6,10,0.34); opacity: 0; }
  .mark-label { position: absolute; padding: 7px 13px; border-radius: 8px; background: #FFC15E;
    color: #05070b; font-size: 19px; font-weight: 800; letter-spacing: 0.02em; opacity: 0;
    white-space: nowrap; transform: translateY(-100%); }
  .phone { position: absolute; right: 128px; top: 50%; width: 400px; height: 840px; margin-top: -420px;
    border-radius: 54px; padding: 11px; box-sizing: border-box; background: #0b0f16;
    box-shadow: 0 70px 130px rgba(0,0,0,0.72), 0 0 0 1.5px rgba(120,165,240,0.34); overflow: hidden; }
  .screen { position: relative; width: 100%; height: 100%; border-radius: 43px; overflow: hidden; background: #000; }
  .screen img.after { position: absolute; inset: 0; width: 100%; height: auto; opacity: 0; }
  .screen img { display: block; width: 100%; height: auto; }
  ${css}
</style></head>
<body>
  ${bgLayer}
  <div class="grid"></div>
  <div class="surface ${surfaceClass}"></div>
  <div class="haze"></div>
  <div class="shade"></div>
  <div class="bloom"></div>
  ${body}
  ${phone}
  <div class="brand">${esc(shot.brand ?? 'OPENFILM').replace(/^(\S+)/, '<b>$1</b>')}</div>
  <div class="idx">${String(index + 1).padStart(2, '0')} / ${String(count).padStart(2, '0')}</div>
  <div class="prog"><i></i></div>
  <div class="sweep"></div>
<script type="module">
const D = ${planned.duration};
const AT = ${planned.at};
// Camera and arrival speed come from the film's structure.
const PUSH = ${push};
const SETTLE = ${settle};
const STAGGER = ${stagger};
const SWEEP = ${sweep};
const TOTAL = ${total};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const settle = (x) => 1 - Math.exp(-6.2 * x) * Math.cos(8.2 * x);
const bgEl = document.querySelector('.bg img');
const sweep = document.querySelector('.sweep');
const prog = document.querySelector('.prog i');
const copyItems = [...document.querySelectorAll('.copy > *')];
const copyEl = document.querySelector('.copy');
const CAMERA = ${JSON.stringify(CAMERA)};
const phoneWrap = document.querySelector('.phone');
const metalEl = document.querySelector('.surface-metal');
const phoneEl = document.querySelector('.phone');
const screenEl = document.querySelector('.screen img');
const MARK = ${mark ? `[${mark.x}, ${mark.y}, ${mark.w}, ${mark.h}]` : 'null'};
const MARK_AFTER = ${markAfter ? `[${markAfter.x}, ${markAfter.y}, ${markAfter.w}, ${markAfter.h}]` : 'null'};
const AFTER = document.querySelector('.screen img.after');
const MARK_LABEL = ${mark ? JSON.stringify(mark.label) : "''"};
const markBox = document.querySelector('.mark-box');
const markLabel = document.querySelector('.mark-label');
const chips = [...document.querySelectorAll('.chip')];
window.film = {
  duration: D,
  frame(t) {
    const g = AT + t;
    if (bgEl) bgEl.style.transform = 'translate(-50%,-50%) scale(' + (1.03 + PUSH * easeInOut(clamp01(g / TOTAL))).toFixed(4) + ')';
    const s = clamp01((t - 0.3) / SWEEP);
    sweep.style.opacity = (0.5 * Math.sin(Math.PI * s)).toFixed(3);
    sweep.style.transform = 'translateX(' + ((-30 + 60 * s).toFixed(2)) + '%)';
    prog.style.width = (clamp01(g / TOTAL) * 100).toFixed(2) + '%';
    // Start from rest, move, and settle: a real head never begins at full speed.
    const shotT = clamp01(t / D);
    const head = easeInOut(clamp01(shotT / 0.22)) * (1 - 0.35 * easeInOut(clamp01((shotT - 0.7) / 0.3)));
    if (CAMERA === 'shoulder') {
      // Multi-frequency micro-motion: a person holding the camera, not a tripod.
      const sx = 1.6 * Math.sin(t * 1.7) + 0.9 * Math.sin(t * 3.3 + 1.1);
      const sy = 1.2 * Math.sin(t * 1.3 + 0.4) + 0.7 * Math.sin(t * 4.1);
      if (phoneWrap) phoneWrap.style.marginLeft = sx.toFixed(2) + 'px';
      if (phoneWrap) phoneWrap.style.marginTop = (-420 + sy).toFixed(2) + 'px';
    }
    if (CAMERA === 'locked') {
      // Locked off, but the dial behind the figure drifts: the world moves, the camera does not.
      if (metalEl) metalEl.style.backgroundPositionX = (-7 * easeInOut(shotT)).toFixed(1) + 'px';
    }
    if (copyEl) copyEl.style.transform = 'translateY(-50%) translateY(' + ((1 - head) * 8 - 8 * shotT).toFixed(1) + 'px) scale(' + (1 + PUSH * 0.5 * easeInOut(clamp01(g / TOTAL))).toFixed(4) + ')';
    copyItems.forEach((el, i) => {
      const k = easeOut(clamp01((t - 0.12 - i * STAGGER) / (0.55 * (SETTLE / 0.9))));
      el.style.opacity = k.toFixed(3);
      el.style.transform = 'translateY(' + ((1 - k) * 24).toFixed(1) + 'px)';
    });
    ${frameCode}
    if (AFTER) {
      // The change lands in the middle of the shot, after the words have arrived.
      const swap = easeInOut(clamp01((t - D * 0.42) / (D * 0.2)));
      AFTER.style.opacity = swap.toFixed(3);
      if (markBox && MARK && MARK_AFTER) {
        MARK[0] = MARK[0] + (MARK_AFTER[0] - MARK[0]) * swap;
        MARK[1] = MARK[1] + (MARK_AFTER[1] - MARK[1]) * swap;
      }
    }
    if (MARK && markBox) {
      // Screenshot pixels -> the phone's own pixels. The frame is 400 wide with
      // 11px of bezel on each side, so the screen is 378 across a 1080 image.
      const SCALE = 378 / 1080;
      const x = MARK[0] * SCALE;
      const y = MARK[1] * SCALE;
      const k = easeOut(clamp01((t - 0.85) / 0.4));
      markBox.style.left = (x - 6).toFixed(1) + 'px';
      markBox.style.top = (y - 6).toFixed(1) + 'px';
      markBox.style.width = (MARK[2] * SCALE).toFixed(1) + 'px';
      markBox.style.height = (MARK[3] * SCALE).toFixed(1) + 'px';
      markBox.style.opacity = k.toFixed(3);
      markBox.style.transform = 'scale(' + (0.94 + 0.06 * k).toFixed(3) + ')';
      if (markLabel) {
        markLabel.textContent = MARK_LABEL;
        markLabel.style.left = x.toFixed(1) + 'px';
        markLabel.style.top = (y - 14).toFixed(1) + 'px';
        markLabel.style.opacity = clamp01((t - 1.05) / 0.35).toFixed(3);
      }
    }
  },
};
</script>
</body></html>`;
}

/**
 * Build every page of a promo, plus the film that cuts them together.
 *
 * @param {{ title?: string, shots: Array<object>, transition?: number, aspect?: string }} brief
 */
export function buildPromo(brief = {}) {
  const plan = planPromo(brief);
  // The plan's own skeleton decides style; the caller's choice is carried on it.
  if (!plan.ok) return { ok: false, problems: plan.problems };
  const transition = plan.transition;
  const joinKind = plan.joinKind ?? 'depth';
  const total = plan.seconds;
  const skeletonId = SKELETON_STYLE[brief.skeleton] ? brief.skeleton : (brief.skeleton ?? 'product');
  const style = SKELETON_STYLE[skeletonId] ?? SKELETON_STYLE.product;
  const planWithSkeleton = { ...plan, skeleton: skeletonId };

  const pages = plan.shots.map((planned, index) => ({
    name: `${String(index + 1).padStart(2, '0')}-${planned.kind}.html`,
    html: pageHtml({ shot: planned.shot, planned, total, index, count: plan.shots.length, motion: style.motion }),
  }));

  // The picture track. A join owns the window where two shots hand over, and it
  // drives both neighbours itself, so each shot is trimmed by that window on the
  // side where a join sits: trimmed twice in the middle, once at the ends.
  const clips = [];
  const joins = [];
  const last = plan.shots.length - 1;
  plan.shots.forEach((planned, index) => {
    const name = pages[index].name;
    const head = index === 0 ? 0 : transition;
    const tail = index === last ? 0 : transition;
    const out = Number((planned.duration - tail).toFixed(3));
    clips.push({ src: name, in: head, out, at: Number((planned.at + head).toFixed(3)) });
    if (index === last) return;
    const joinName = `join-${String(index + 1).padStart(2, '0')}.html`;
    clips.push({ join: true, name: joinName, at: Number((planned.at + planned.duration - transition).toFixed(3)), duration: transition });
    joins.push({ name: joinName, kind: joinKind, from: name, to: pages[index + 1].name, duration: transition, fromAt: planned.duration - transition });
  });

  const lanes = plan.shots.map((planned) => ({ at: planned.at, length: planned.visible }));

  const iframes = clips
    .map((clip) => (clip.join
      ? `<iframe src="${clip.name}#t=0,${clip.duration.toFixed(2)}" at="${clip.at.toFixed(2)}"></iframe>`
      : `<iframe src="${clip.src}#t=${Number(clip.in).toFixed(2)},${Number(clip.out).toFixed(2)}"${clip.at > 0 ? ` at="${clip.at.toFixed(2)}"` : ''}></iframe>`))
    .join('\n  ');

  return {
    ok: true,
    problems: [],
    seconds: total,
    transition,
    pages,
    joins,
    filmHtml: `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080">
<style>html, body { margin: 0; background: #000; } iframe { border: 0; }</style></head>
<body>
<section>
  <audio src="assets/score.wav" at="0" volume="0.9"></audio>
</section>
<section>
  ${iframes}
</section>
</body></html>
`,
    // The score runs on the picture's own spans, so sound and picture end together.
    lanes,
    // The score needs to know a claim when it sees one: that shot drops its rhythm.
    kinds: plan.shots.map((planned) => (planned.kind === 'plate' ? 'scene'
      : planned.kind === 'type' ? 'title'
        : planned.kind === 'number' ? 'graphics'
          : planned.kind)),
    plan: {
      genre: 'product-mg',
      label: brief.label ?? '产品宣传',
      aspect: brief.aspect ?? '16:9',
      seconds: total,
      beats: plan.shots.map((planned, i) => ({
        index: i + 1,
        at: planned.at,
        length: planned.duration,
        kind: planned.kind === 'plate' ? 'scene' : planned.kind,
        move: 'still',
      })),
      score: {
        mood: 'warm',
        bpm: Number(brief.bpm ?? style.bpm),
        grid: 0,
        groove: style.groove,
        dynamics: style.dynamics,
      },
      skeleton: skeletonId,
      grade: { preset: 'clean', grain: 0.06, bloom: 0.1, vignette: 0.12, letterbox: 0 },
    },
  };
}

/**
 * Propose a shot list from what a project already says about itself.
 *
 * A person asking for a promo usually has a README, some numbers and a folder of
 * screenshots, not a script. This reads those and proposes shots — but it only
 * uses strings and figures that exist in the input: a proposal with an invented
 * claim would be worse than no proposal.
 *
 * @param {{
 *   name?: string,
 *   tagline?: string,
 *   facts?: Record<string, unknown>,
 *   screenshots?: Array<{ file: string, caption?: string, kicker?: string }>,
 *   url?: string,
 *   note?: string,
 * }} input
 */
export function proposePromo(input = {}) {
  const problems = [];
  const name = String(input.name ?? "").trim();
  if (!name) problems.push("a proposal needs a product name");
  const screenshots = Array.isArray(input.screenshots) ? input.screenshots.filter((shot) => shot?.file) : [];
  if (!screenshots.length) problems.push("a proposal needs at least one screenshot");
  const url = String(input.url ?? "").trim();
  if (problems.length) return { ok: false, problems };

  const skeleton = input.skeleton && SKELETONS[input.skeleton]
    ? { id: input.skeleton, reason: "chosen by the caller" }
    : detectSkeleton({ text: [input.text, input.tagline, input.note].filter(Boolean).join(" "), facts: input.facts });
  const order = SKELETONS[skeleton.id];
  const figure = biggestFigure(input.facts);

  const pools = {
    type: {
      kind: "type",
      kicker: String(input.kicker ?? name).toUpperCase(),
      title: splitTitle(input.tagline),
      ...(input.note ? { note: String(input.note) } : {}),
      duration: 3.6,
    },
    claim: input.claim
      ? {
        kind: 'claim',
        ...(input.claimKicker ? { kicker: String(input.claimKicker) } : {}),
        claim: String(input.claim),
        evidence: Array.isArray(input.evidence) ? input.evidence.filter((row) => row?.text) : [],
        duration: 4.0,
      }
      : null,
    why: {
      kind: "type",
      kicker: "WHY OPEN SOURCE",
      title: splitTitle(input.why ?? "代码在明处"),
      ...(input.note ? { note: String(input.note) } : {}),
      duration: 3.4,
    },
    end: url
      ? { kind: "end", eyebrow: "OPEN SOURCE", title: [name], url, ...(input.note ? { note: String(input.note) } : {}), duration: 4.2 }
      : null,
  };

  const shots = [];
  let screenIndex = 0;
  let numberUsed = false;
  for (const slot of order) {
    if (slot === "proof") {
      const shot = screenshots[screenIndex];
      if (!shot) continue;
      screenIndex += 1;
      shots.push({
        kind: "plate",
        image: shot.file,
        kicker: shot.kicker ?? captionFromFile(shot.file),
        title: splitTitle(shot.caption ?? ""),
        duration: 4.6,
      });
      continue;
    }
    if (slot === "number") {
      if (!figure || numberUsed) continue;
      numberUsed = true;
      shots.push({ kind: 'number', figure: figure.value, unit: figure.unit, caption: figure.label, figures: figure.rows, sources: figure.sources, duration: 3.6 });
      continue;
    }
    const fixed = pools[slot];
    if (fixed) shots.push({ ...fixed });
  }

  return { ok: true, problems: [], shots, name, url, skeleton: skeleton.id, reason: skeleton.reason };
}

/** Two short lines read better than one long one at title size. */
function splitTitle(text) {
  // A tagline often arrives as "positioning —— what it is". The dash is the
  // natural line break at title size; leaving it in reads like a typo.
  const raw = String(text ?? '').trim();
  const dash = raw.split(/\s*(?:——|—|--)\s*/);
  if (dash.length >= 2 && dash[0] && dash[1]) {
    return [dash[0].trim(), dash.slice(1).join(' ').replace(/[。.]$/, '').trim()];
  }
  const value = raw.replace(/[。.]$/, '').trim();
  if (!value) return ['', ''];
  const words = value.split(/\s+/);
  if (words.length >= 6) {
    const half = Math.ceil(words.length / 2);
    return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
  }
  return [value];
}

/** "shot_team.png" -> "TEAM": a kicker, not a claim. */
function captionFromFile(file) {
  return String(file)
    .split(/[\\/]/).pop()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/^(shot|screen|img|image)[_-]?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * The largest figure worth showing as a count-up, with its unit taken from the
 * key that carried it. Small numbers (versions, counts of one) are not a story.
 */
function biggestFigure(facts) {
  const found = [];
  const visit = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      const here = path ? `${path}.${key}` : key;
      const named = Object.prototype.hasOwnProperty.call(UNITS, key);
      const noisy = /bytes|size|sha|hash|code|id|ms|duration/i.test(key);
      // A number is worth counting up only if it means something a person can
      // picture: 154 tools, not 237,295,867 bytes of APK.
      const plausible = named || (!noisy && value >= 20 && value <= 5000);
      if (typeof value === 'number' && Number.isFinite(value) && plausible) {
        found.push({ value, key, path: here, label: labelFor(key), named });
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        visit(value, here);
      }
    }
  };
  visit(facts ?? {}, '');
  if (!found.length) return null;
  // A named count beats a bigger unnamed one, and among named ones the larger
  // figure wins: "154 个工具" says more than "112 versionCode".
  // What leads: capability counts, then quality counts, then size on disk.
  const weight = (key) => (['tools', 'uniqueTools', 'catalogEntries'].includes(key) ? 3
    : ['tests', 'annotations'].includes(key) ? 2
      : Object.prototype.hasOwnProperty.call(UNITS, key) ? 1 : 0);
  found.sort((a, b) => (weight(b.key) - weight(a.key)) || (b.value - a.value));
  const top = found[0];
  // Up to three, each with the key path it came from: a figure without a source
  // is a claim, and this film does not make those.
  // Two keys can carry the same count (a total and its unique version): the row
  // shows a number once, with the first label that described it.
  const distinct = [];
  for (const entry of found) {
    if (distinct.some((kept) => kept.value === entry.value)) continue;
    distinct.push(entry);
    if (distinct.length === 3) break;
  }
  const rows = distinct.map((entry) => ({
    value: entry.value,
    unit: unitFor(entry.key),
    label: entry.label,
  }));
  const sources = distinct.map((entry) => entry.path).join(' · ');
  return { value: top.value, unit: unitFor(top.key), label: top.label, rows, sources };
}

const UNITS = {
  tools: '个工具',
  tests: '个测试',
  uniqueTools: '个工具',
  catalogEntries: '个条目',
  annotations: '条断言',
  permissions: '项权限',
  files: '个文件',
};

function unitFor(key) {
  return UNITS[key] ?? '';
}

const LABELS = {
  tools: '工具',
  uniqueTools: '可用工具',
  catalogEntries: '工具条目',
  tests: '测试',
  annotations: '断言',
  permissions: '权限',
  files: '文件',
};

function labelFor(key) {
  if (LABELS[key]) return LABELS[key];
  // A raw identifier ("catalogEntries") is not a caption: space it out.
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * Which story does this material want?
 *
 * The same five shots do not fit every product: an open-source tool is argued
 * with its licence and its repo, a paid app with a price, a fast tool with a
 * number before a screenshot. Detection is by the words and figures the project
 * already contains, and it only changes the ORDER and PRESENCE of shots — never
 * the copy.
 *
 * @param {{ text?: string, facts?: Record<string, unknown> }} input
 */
export function detectSkeleton(input = {}) {
  const text = String(input.text ?? "");
  const facts = input.facts ?? {};
  const has = (key) => JSON.stringify(facts).toLowerCase().includes(`"${key.toLowerCase()}"`);
  if (/(开源|open[\s-]?source|github\.com)/i.test(text) || has("license")) {
    return { id: "open-source", reason: "the project talks about open source or a repository" };
  }
  if (/(价格|定价|付费|免费版|pricing|price|subscription)/i.test(text) || has("price")) {
    return { id: "pricing", reason: "the project talks about price" };
  }
  if (/(性能|延迟|毫秒|速度|benchmark|latency|throughput|fps)/i.test(text) || has("latency")) {
    return { id: "performance", reason: "the project talks about speed" };
  }
  return { id: "product", reason: "no special claim to lead with" };
}

/** The shot order each skeleton asks for. "proof" means a real screenshot. */
/**
 * How each structure should sound and pace.
 *
 * A credibility film (open source) breathes: slower tempo, sparse groove, no
 * pulse. A speed film is edited tight: faster tempo, syncopated groove and a
 * climax the score can follow. The structure should be audible, not only visible.
 */
export const SKELETON_STYLE = {
  // push: how far the camera travels across the film; settle: how long an element
  // takes to arrive; stagger: the gap between lines; sweep: the light pass.
  'open-source': { bpm: 76, groove: 'sparse', dynamics: 'flat', paceScale: 1.06, motion: { push: 0.06, settle: 1.35, stagger: 0.18, sweep: 1.9 }, transition: { kind: 'depth', duration: 0.7 } },
  pricing: { bpm: 82, groove: 'straight', dynamics: 'flat', paceScale: 1.0, motion: { push: 0.09, settle: 0.95, stagger: 0.1, sweep: 1.6 }, transition: { kind: 'fade', duration: 0.5 } },
  performance: { bpm: 100, groove: 'syncopated', dynamics: 'auto', paceScale: 0.9, motion: { push: 0.14, settle: 0.6, stagger: 0.05, sweep: 1.15 }, transition: { kind: 'fade', duration: 0.22 } },
  product: { bpm: 84, groove: 'sparse', dynamics: 'flat', paceScale: 1.0, motion: { push: 0.09, settle: 0.9, stagger: 0.1, sweep: 1.5 }, transition: { kind: 'depth', duration: 0.55 } },
};

export const SKELETONS = {
  // A credibility film earns a conclusion: after the evidence and the reason, it
  // says the thing the rest of the film was for.
  "open-source": ["type", "proof", "proof", "number", "why", "claim", "end"],
  pricing: ["type", "proof", "number", "proof", "claim", "end"],
  performance: ["type", "number", "proof", "proof", "claim", "end"],
  product: ["type", "proof", "proof", "number", "claim", "end"],
};
