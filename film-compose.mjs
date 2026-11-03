/**
 * Composition driven by the material.
 *
 * A promo template puts every screenshot in the same box. This module looks at
 * the picture first: it decodes the PNG, measures where the ink actually is, and
 * then places the copy in the band that is empty. Two screens that carry equal
 * weight can be split across the frame; one that is dense becomes a full bleed
 * with the words underneath it.
 *
 * No image library, no native dependency: PNG decoding is done here with zlib,
 * which every Node runtime already has.
 *
 * @module openfilm-film-compose
 */

import { inflateSync } from 'node:zlib';

/**
 * Decode a non-interlaced 8-bit PNG to greyscale.
 *
 * Only what a screenshot needs: 8-bit grey, RGB, RGBA, and a palette. Anything
 * else is reported rather than guessed at.
 *
 * @param {Buffer} buffer
 * @returns {{ ok: boolean, width?: number, height?: number, gray?: Uint8Array, problems: string[] }}
 */
export function decodePng(buffer, options = {}) {
  const wantColor = options.color === true;
  const problems = [];
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return { ok: false, problems: ['not a PNG buffer'] };
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i += 1) if (buffer[i] !== signature[i]) return { ok: false, problems: ['not a PNG (bad signature)'] };

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat = [];
  let palette = null;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const data = buffer.subarray(start, start + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = start + length + 4;
  }

  if (!width || !height) return { ok: false, problems: ['PNG has no header'] };
  if (bitDepth !== 8) problems.push(`bit depth ${bitDepth} is not supported (8 only)`);
  if (interlace !== 0) problems.push('interlaced PNG is not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) problems.push(`colour type ${colorType} is not supported`);
  if (problems.length) return { ok: false, problems };

  let raw;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (error) {
    return { ok: false, problems: [`PNG data did not inflate: ${error.message}`] };
  }

  const stride = width * channels;
  const out = new Uint8Array(width * height);
  const rgb = wantColor ? new Uint8Array(width * height * 3) : null;
  const previous = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  let pointer = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[pointer];
    pointer += 1;
    for (let i = 0; i < stride; i += 1) line[i] = raw[pointer + i];
    pointer += stride;

    // The five PNG row filters, applied back in place.
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const upLeft = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + left) & 0xff;
      else if (filter === 2) line[i] = (line[i] + up) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const nearest = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        line[i] = (line[i] + nearest) & 0xff;
      }
    }

    for (let x = 0; x < width; x += 1) {
      const at = x * channels;
      let value;
      let r = 0;
      let g = 0;
      let b = 0;
      if (channels === 1) {
        if (palette) {
          const index = line[at] * 3;
          r = palette[index]; g = palette[index + 1]; b = palette[index + 2];
          value = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        } else {
          r = g = b = line[at];
          value = line[at];
        }
      } else if (channels === 2) {
        r = g = b = line[at];
        value = line[at];
      } else {
        r = line[at]; g = line[at + 1]; b = line[at + 2];
        value = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
      out[y * width + x] = value;
      if (wantColor) {
        const to = (y * width + x) * 3;
        rgb[to] = r; rgb[to + 1] = g; rgb[to + 2] = b;
      }
    }
    previous.set(line);
  }

  return { ok: true, width, height, gray: out, ...(wantColor ? { rgb } : {}), problems: [] };
}

/**
 * Where is this picture empty?
 *
 * Returns a coarse grid of ink coverage plus the bands that are free enough to
 * hold type. The caller decides what to do with it — this only measures.
 *
 * @param {{ width: number, height: number, gray: Uint8Array }} image
 * @param {{ cols?: number, rows?: number, threshold?: number, background?: number }} [options]
 */
export function inkGrid(image, options = {}) {
  const cols = Math.max(2, Math.min(8, Number(options.cols ?? 4)));
  const rows = Math.max(3, Math.min(12, Number(options.rows ?? 6)));
  const threshold = Number(options.threshold ?? 26);
  const { width, height, gray } = image;

  // The page background: the most common value, not the mean, so a dark UI with
  // a bright header still reads as "dark page".
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;
  let background = 0;
  let best = -1;
  for (let v = 0; v < 256; v += 1) if (histogram[v] > best) { best = histogram[v]; background = v; }

  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    const y0 = Math.floor((height * row) / rows);
    const y1 = Math.floor((height * (row + 1)) / rows);
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((width * col) / cols);
      const x1 = Math.floor((width * (col + 1)) / cols);
      let ink = 0;
      let total = 0;
      for (let y = y0; y < y1; y += 1) {
        const base = y * width;
        for (let x = x0; x < x1; x += 1) {
          if (Math.abs(gray[base + x] - background) > threshold) ink += 1;
          total += 1;
        }
      }
      line.push(Number(((ink / Math.max(1, total)) * 100).toFixed(1)));
    }
    cells.push(line);
  }

  const rowInk = cells.map((line) => Number((line.reduce((sum, value) => sum + value, 0) / line.length).toFixed(1)));
  const totalInk = Number((cells.flat().reduce((sum, value) => sum + value, 0) / (cols * rows)).toFixed(1));
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) sum += gray[i];
  const meanLuma = Number((sum / Math.max(1, gray.length)).toFixed(1));
  // A band is usable for type when almost nothing crosses it.
  const freeBands = rowInk
    .map((value, index) => ({ index, value }))
    .filter((entry) => entry.value <= Math.max(1.5, rowInk.reduce((a, b) => a + b, 0) / rows * 0.5))
    .map((entry) => entry.index);

  // Which third of the frame is the emptiest: where a headline can live.
  const thirds = [0, 1, 2].map((third) => {
    const from = Math.floor((rows * third) / 3);
    const to = Math.floor((rows * (third + 1)) / 3);
    const slice = rowInk.slice(from, Math.max(from + 1, to));
    return { third, value: Number((slice.reduce((a, b) => a + b, 0) / slice.length).toFixed(1)) };
  });

  return { background, cells, rowInk, totalInk, meanLuma, freeBands, thirds, cols, rows };
}

/**
 * Turn a measured screenshot into a placement decision.
 *
 * @param {{ file: string, grid: ReturnType<typeof inkGrid> }} screen
 * @param {{ band?: 'top' | 'bottom' | 'middle' }} [options]
 */
export const INTENT_PRESETS = {
  statement: { band: null, scrim: -0.06, exposure: +0.05, push: 0.05, treatment: null },
  proof: { band: null, scrim: +0.04, exposure: 0, push: 0.08, treatment: 'device' },
  loud: { band: null, scrim: +0.12, exposure: +0.12, push: 0.16, treatment: 'bleed' },
  quiet: { band: 'middle', scrim: -0.08, exposure: +0.02, push: 0.03, treatment: 'device' },
};

/**
 * Guess what a shot is for, from what the picture and the copy already say.
 *
 * The rules are small and legible on purpose: a figure carries the beat, a screen
 * that is too dense cannot be bled without burying its own content, a dark screen
 * wants air rather than a push, and the film's first screen is proof by
 * definition. A caller that says what it wants always wins.
 *
 * @param {{ index?: number, screen?: Record<string, unknown>, grid?: object }} input
 * @returns {{ intent: string, reason: string }}
 */
export function inferIntent(input = {}) {
  const screen = input.screen ?? {};
  const grid = input.grid;
  const index = Number(input.index ?? 0);

  const role = typeof screen.role === 'string' ? screen.role.toLowerCase() : '';
  if (role === 'hero') return { intent: 'loud', reason: 'role: hero' };
  if (role === 'screen') return { intent: 'proof', reason: 'role: screen' };
  if (role === 'figure') return { intent: 'loud', reason: 'role: figure' };
  if (role === 'rest' || role === 'quiet') return { intent: 'quiet', reason: 'role: rest' };

  // A figure carries the beat: it is the loudest shot available.
  if (screen.figures || Number.isFinite(Number(screen.figure))) return { intent: 'loud', reason: 'a figure leads' };
  // A busy screen keeps its own composition: bleeding it would bury the content.
  if (grid && Number(grid.totalInk) >= 40) return { intent: 'statement', reason: `${grid.totalInk}% ink is too dense to bleed` };
  // A very dark screen wants air and a light hand, not a push.
  if (grid && Number(grid.meanLuma) < 14) return { intent: 'quiet', reason: 'a low-key screen wants stillness' };
  // The first screen proves the product exists; the rest carry the argument.
  if (index === 0) return { intent: 'proof', reason: 'the first screen is the proof' };
  return { intent: 'statement', reason: 'a calm screen with room for words' };
}

export function placeCopy(screen, options = {}) {
  const grid = screen?.grid;
  if (!grid) return { ok: false, problems: ['no measurement for this screen'] };
  const emptiest = [...grid.thirds].sort((a, b) => a.value - b.value)[0];
  const inferred = INTENT_PRESETS[options.intent]
    ? { intent: options.intent, reason: 'asked for' }
    : inferIntent({ index: Number(options.index ?? 0), screen, grid });
  const intent = INTENT_PRESETS[inferred.intent] ? inferred.intent : 'statement';
  const preset = INTENT_PRESETS[intent];
  const measuredBand = emptiest.third === 0 ? 'top' : emptiest.third === 2 ? 'bottom' : 'middle';
  // The intent may name a band; otherwise the measurement decides.
  let bandOverride = null;
  const band = options.band ?? preset.band ?? measuredBand;
  // A dense screen needs a scrim behind the type; an empty one does not.
  const scrim = Math.max(0.2, Math.min(0.72, 0.26 + grid.totalInk * 0.011 + preset.scrim));
  // A portrait screen cannot be bled full-frame without cropping to a dark gap.
  const treatment = preset.treatment ?? (Number(screen?.aspect ?? 0) > 1.5 ? 'device' : 'bleed');
  // Exposure for a full bleed: a low-key screen is lifted, a bright one is left
  // alone. Without this, a dark chat screen becomes an almost black frame.
  const exposure = Math.max(0.8, Math.min(1.8, (grid.meanLuma < 18 ? 1.55 : grid.meanLuma < 30 ? 1.3 : grid.meanLuma > 90 ? 0.92 : 1.05) + preset.exposure));

  // Column occupancy inside the chosen band, from the same grid.
  const rows = grid.rowsList ?? grid.cells?.length ?? 0;
  const perRow = grid.cells?.[0]?.length ?? 0;
  let anchor = 'left';
  let anchorInk = null;
  if (rows > 0 && perRow > 0) {
    const bandRows = band === 'top' ? [0, Math.floor(rows / 3)]
      : band === 'bottom' ? [Math.ceil((rows * 2) / 3), rows]
        : [Math.floor(rows / 3), Math.ceil((rows * 2) / 3)];
    const columns = new Array(perRow).fill(0);
    for (let row = bandRows[0]; row < bandRows[1]; row += 1) {
      for (let col = 0; col < perRow; col += 1) columns[col] += Number(grid.cells?.[row]?.[col] ?? 0);
    }
    const lowest = Math.min(...columns);
    const normalized = columns.map((value) => value - lowest);
    anchorInk = Number(lowest.toFixed(1));
    // A third of the width, left or centre: right-aligned copy fights the read.
    const leftThird = normalized.slice(0, Math.max(1, Math.floor(perRow / 3))).reduce((a, b) => a + b, 0);
    const middleThird = normalized.slice(Math.floor(perRow / 3), Math.ceil((perRow * 2) / 3)).reduce((a, b) => a + b, 0);
    anchor = middleThird < leftThird ? 'center' : 'left';
  }
  if (treatment === 'device') {
    const rowsAll = grid.cells?.length ?? 0;
    const colsAll = grid.cells?.[0]?.length ?? 0;
    if (rowsAll && colsAll) {
      const half = Math.floor(colsAll / 2);
      let inkLeft = 0;
      let inkRight = 0;
      for (let row = 0; row < rowsAll; row += 1) {
        for (let col = 0; col < colsAll; col += 1) {
          const value = Number(grid.cells[row][col] ?? 0);
          if (col < half) inkLeft += value; else inkRight += value;
        }
      }
      anchor = inkLeft <= inkRight ? 'left' : 'right';
      anchorInk = Number(Math.min(inkLeft, inkRight).toFixed(1));
    } else {
      anchor = 'right';
    }
  }

  // A picture with its subject off to one side is looking that way: the words go
  // to the other side, in the lower band, never across the eyes.
  const subject = subjectSide(grid);
  const portrait = String(screen?.role ?? '').toLowerCase() === 'portrait';
  if ((subject || portrait) && treatment === 'bleed') {
    anchor = subject === 'left' ? 'right' : subject === 'right' ? 'left' : (anchor === 'center' ? 'left' : anchor);
    if (subject) anchorInk = null;
    if (subject) {
      const measured = ['top', 'middle', 'bottom'][Math.max(0, Math.min(2, Number(emptiest.third)))];
      // A subject in the upper frame leaves the bottom to the words.
      if (measured !== 'middle') bandOverride = 'bottom';
    }
  }

  // The title-safe margin: broadcast practice is 5% for 16:9 and a little more
  // for vertical, where phones round the corners.
  const safe = Number(screen?.aspect ?? 0) < 1 ? 0.08 : 0.06;

  return {
    ok: true,
    intent,
    anchor,
    anchorInk,
    safe,
    band,
    treatment,
    push: preset.push,
    scrim,
    exposure,
    luma: grid.meanLuma,
    density: grid.totalInk,
    band: bandOverride ?? band,
    subject,
    reason: `${intent} (${inferred.reason})${subject ? `, subject ${subject}` : ''}: ${preset.band ? 'band chosen by intent' : 'band measured'}, the ${['top', 'middle', 'bottom'][emptiest.third]} third carries ${emptiest.value}% ink`,
  };
}

const esc = (text) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A full-bleed proof shot: the screenshot is the frame, the words sit in the band
 * the measurement said was empty, and the scrim is only as heavy as that band needs.
 *
 * @param {{ image: string, kicker?: string, title?: string[], band?: string, scrim?: number, duration: number, at: number, total: number, meta?: string, index?: number, count?: number }} spec
 */
export function buildBleedPage(spec) {
  const band = ['top', 'middle', 'bottom'].includes(spec.band) ? spec.band : 'bottom';
  const scrim = Math.max(0.2, Math.min(0.9, Number(spec.scrim ?? 0.6)));
  const exposure = Math.max(0.8, Math.min(1.8, Number(spec.exposure ?? 1.05)));
  // How far the camera travels: a loud beat pushes, a quiet one barely moves.
  const PUSH = Math.max(0.01, Math.min(0.3, Number(spec.push ?? 0.05)));
  // Title-safe margin and horizontal anchor, measured by placeCopy.
  const SAFE = Math.max(0.03, Math.min(0.12, Number(spec.safe ?? 0.06)));
  const ANCHOR = ['center', 'right'].includes(spec.anchor) ? spec.anchor : 'left';
  const treatment = spec.treatment === 'device' ? 'device' : 'bleed';
  const lines = (spec.title ?? []).map((line) => `<div>${esc(line)}</div>`).join('');
  const align = ANCHOR === 'center' ? 'center' : 'left';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=1920, height=1080">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #04060a; overflow: hidden;
    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }
  .shot { position: absolute; inset: 0; overflow: hidden; }
  .shot img { position: absolute; left: 50%; top: 50%; width: 116%; transform: translate(-50%, -50%);
    filter: brightness(${exposure}) saturate(1.02); }
  .scrim { position: absolute; inset: 0; }
  /* Device treatment: a portrait screen is an object in the frame, with a blurred
     copy of itself as the room behind it. Cropping a 1080x2400 phone to a 16:9
     frame would only ever show its emptiest band. */
  body.device .shot img.item { width: auto; height: 124%; border-radius: 34px; left: 50%;
    box-shadow: 0 60px 120px rgba(0,0,0,0.75), 0 0 0 1px rgba(130,175,240,0.28); }
  body.device .shot img.bgcopy { width: 132%; height: 132%; object-fit: cover; left: 50%;
    border-radius: 0; box-shadow: none; filter: blur(46px) brightness(0.40) saturate(0.9); }
  .copy { position: absolute; display: flex; flex-direction: column; gap: 18px;
    max-width: ${ANCHOR === 'center' ? 74 : ANCHOR === 'right' ? 40 : 58}%;
    align-items: ${align === 'center' ? 'center' : 'flex-start'}; text-align: ${align};
    ${ANCHOR === 'center'
      ? `left: 50%; right: auto; transform: translateX(-50%);`
      : ANCHOR === 'right'
        ? `right: ${(SAFE * 100).toFixed(2)}%; left: auto;`
        : `left: ${(SAFE * 100).toFixed(2)}%; right: auto;`} }
  .copy.top { top: 104px; } .copy.middle { top: 50%; transform: translateY(-50%); } .copy.bottom { bottom: 120px; }
  .kicker { font-size: 20px; letter-spacing: 0.36em; color: #468CFF; text-transform: uppercase; }
  .title { font-size: 76px; line-height: 1.14; font-weight: 800; color: #F4F7FC; letter-spacing: -0.02em;
    text-shadow: 0 10px 44px rgba(0,0,0,0.85); }
  .meta { position: absolute; left: 54px; bottom: 44px; font-size: 15px; letter-spacing: 0.34em;
    color: rgba(200,215,235,0.5); text-transform: uppercase; }
  .prog { position: absolute; left: 0; bottom: 0; height: 2px; width: 100%; background: rgba(255,255,255,0.07); }
  .prog i { display: block; height: 100%; width: 0; background: #468CFF; }
</style></head>
<body class="${treatment}">
  ${treatment === 'device'
    ? `<div class="shot"><img class="bgcopy" src="${esc(spec.image)}" alt=""><img class="item" src="${esc(spec.image)}" alt=""></div>`
    : `<div class="shot"><img src="${esc(spec.image)}" alt=""></div>`}
  <div class="scrim"></div>
  <div class="copy ${band}">
    ${spec.kicker ? `<div class="kicker">${esc(spec.kicker)}</div>` : ''}
    <div class="title">${lines}</div>
  </div>
  ${spec.meta ? `<div class="meta">${esc(spec.meta)}</div>` : ''}
  <div class="prog"><i></i></div>
<script type="module">
const D = ${Number(spec.duration)};
const AT = ${Number(spec.at)};
const TOTAL = ${Number(spec.total)};
const SCRIM = ${scrim};
const PUSH = ${PUSH};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k) => 1 - Math.pow(1 - k, 3);
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const shot = document.querySelector('.shot img.item') ?? document.querySelector('.shot img:not(.bgcopy)');
const bgCopy = document.querySelector('.shot img.bgcopy');
const scrim = document.querySelector('.scrim');
const copy = document.querySelector('.copy');
const items = [...copy.children];
const prog = document.querySelector('.prog i');
window.film = { duration: D, frame(t) {
  const g = AT + t;
  prog.style.width = (clamp01(g / TOTAL) * 100).toFixed(2) + '%';
  // The screen drifts like a camera reading it; the scrim is weighted to the band.
  if (shot) shot.style.transform = 'translate(-50%, -50%) scale(' + (1.02 + PUSH * easeInOut(clamp01(t / D))).toFixed(4) + ')';
  if (bgCopy) bgCopy.style.transform = 'translate(-50%, -50%) scale(' + (1.06 + PUSH * 0.8 * easeInOut(clamp01(t / D))).toFixed(4) + ')';
  if (scrim) {
    const dir = '${band}' === 'top' ? '180deg' : '${band}' === 'bottom' ? '0deg' : '135deg';
    scrim.style.background = 'linear-gradient(' + dir + ', rgba(4,6,10,' + (SCRIM * 0.98).toFixed(2) + ') 0%, rgba(4,6,10,' + (SCRIM * 0.35).toFixed(2) + ') 42%, rgba(4,6,10,' + (SCRIM * 0.9).toFixed(2) + ') 100%)';
  }
  items.forEach((el, i) => {
    const k = easeOut(clamp01((t - 0.12 - i * 0.1) / 0.55));
    el.style.opacity = k.toFixed(3);
    el.style.transform = 'translateY(' + ((1 - k) * 22).toFixed(1) + 'px)';
  });
} };
</script>
</body></html>`;
}

/**
 * A page that is only type: the opening, the claim, the end card.
 *
 * These are the beats a material-driven structure asks for that no screenshot
 * can supply. They share the film's type scale and its dark stage, so a plate
 * and a title cut together without a change of language.
 *
 * @param {{ kind: 'type'|'claim'|'end', title?: string[], kicker?: string,
 *   claim?: string, url?: string, brand?: string, stage?: { w: number, h: number } }} spec
 */
/**
 * A page that is only type: the opening, the claim, the end card.
 *
 * These are the beats a material-driven structure asks for that no screenshot can
 * supply. They share the film's type scale and its dark stage, so a plate and a
 * title cut together without a change of language.
 *
 * @param {{ kind: 'type'|'claim'|'end', title?: string[], kicker?: string,
 *   claim?: string, url?: string, brand?: string, duration?: number,
 *   stage?: { w: number, h: number } }} spec
 */
export function buildTextPage(spec = {}) {
  const kind = ['type', 'claim', 'end'].includes(spec.kind) ? spec.kind : 'type';
  const stage = spec.stage ?? { w: 1920, h: 1080 };
  const lines = (Array.isArray(spec.title) ? spec.title : []).filter((line) => typeof line === 'string' && line);
  const kicker = typeof spec.kicker === 'string' ? spec.kicker : (spec.brand ?? 'MISE');
  const claim = typeof spec.claim === 'string' ? spec.claim : '';
  const url = typeof spec.url === 'string' ? spec.url : '';
  // The clip's length is the page's length: the player asks, it does not assume.
  const duration = Math.max(0.8, Math.min(30, Number(spec.duration ?? 3)));
  const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const body = kind === 'claim'
    ? `<div class="claim">${esc(claim)}</div>`
    : kind === 'end'
      ? `<div class="end-mark">${esc(kicker)}</div><div class="end-rule"></div><div class="end-url">${esc(url)}</div>`
      : lines.map((line) => `<div class="line">${esc(line)}</div>`).join('');

  // The timeline script is assembled as an array so the generated page can carry
  // `${}`-free source and this module stays readable.
  const script = [
    '  <script>',
    "    // The same t always draws the same frame: nothing animates on its own clock.",
    `    const D = ${duration};`,
    "    const stage = document.querySelector('.stage');",
    "    const mark = document.querySelector('.mark');",
    '    const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);',
    '    window.film = {',
    '      duration: D,',
    '      ready: Promise.resolve(true),',
    '      frame(t) {',
    '        const p = ease(t / Math.max(0.2, D * 0.42));',
    '        stage.style.opacity = String(0.15 + 0.85 * p);',
    "        stage.style.transform = 'translateY(' + ((1 - p) * 26).toFixed(2) + 'px)';",
    '        mark.style.opacity = String(0.42 * Math.max(0, Math.min(1, (t - D * 0.2) / (D * 0.5))));',
    '      },',
    '    };',
    '    window.film.frame(0);',
    '  </script>',
    '</body></html>',
  ].join('\n');

  const head = [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=${stage.w}, height=${stage.h}">`,
    '<style>',
    '  html, body { margin: 0; width: 100%; height: 100%; background: #04060a; overflow: hidden;',
    '    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }',
    '  .stage { position: absolute; inset: 0; display: flex; flex-direction: column;',
    '    justify-content: center; padding: 0 8%; gap: 22px; }',
    '  .kicker { font-size: 20px; letter-spacing: 0.36em; color: #468CFF; text-transform: uppercase; }',
    '  .line { font-size: 92px; line-height: 1.1; font-weight: 800; color: #F4F7FC; letter-spacing: -0.03em; }',
    '  .claim { font-size: 64px; line-height: 1.28; font-weight: 700; color: #F4F7FC; max-width: 82%; }',
    '  .end-mark { font-size: 84px; font-weight: 800; letter-spacing: -0.02em; color: #F4F7FC; }',
    '  .end-rule { width: 168px; height: 3px; border-radius: 2px; background: linear-gradient(90deg, #2C6BFF, rgba(44,107,255,0)); }',
    '  .end-url { font-size: 40px; letter-spacing: 0.06em; color: rgba(220,232,248,0.86); }',
    '  .mark { position: absolute; left: 8%; bottom: 7%; font-size: 15px; letter-spacing: 0.34em;',
    '    color: rgba(200,215,235,0.42); text-transform: uppercase; }',
    '</style></head>',
    '<body>',
    '  <div class="stage">',
    `    <div class="kicker">${esc(kicker)}</div>`,
    `    ${body}`,
    '  </div>',
    `  <div class="mark">${esc(kicker)}</div>`,
  ].join('\n');

  return `${head}\n${script}`;
}

/**
 * A page that carries a number.
 *
 * A figure is the evidence a claim rests on, so it gets its own shot: the number
 * counts up as the shot plays, its unit and label sit beside it, and when there
 * are several figures they become bars whose lengths are the numbers themselves.
 *
 * Everything on the page is a pure function of t — the value at t is computed
 * from t, never from a timer — so the same frame is drawn whatever order the
 * renderer asks for them.
 *
 * @param {{ kicker?: string, title?: string[],
 *   figures: Array<{ value: number, unit?: string, label?: string }>,
 *   duration?: number, note?: string, stage?: { w: number, h: number } }} spec
 */
export function buildFigurePage(spec = {}) {
  const stage = spec.stage ?? { w: 1920, h: 1080 };
  const duration = Math.max(1.2, Math.min(20, Number(spec.duration ?? 3.2)));
  const figures = (Array.isArray(spec.figures) ? spec.figures : [])
    .filter((figure) => Number.isFinite(Number(figure?.value)))
    .slice(0, 4)
    .map((figure) => ({
      value: Number(figure.value),
      unit: typeof figure.unit === 'string' ? figure.unit : '',
      label: typeof figure.label === 'string' ? figure.label : '',
    }));
  const kicker = typeof spec.kicker === 'string' ? spec.kicker : 'MISE';
  const note = typeof spec.note === 'string' ? spec.note : '';
  const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // The largest value sets the bar scale; a single figure is drawn as one big number.
  const max = Math.max(1, ...figures.map((figure) => Math.abs(figure.value)));
  const one = figures.length === 1;

  const rows = figures.map((figure, index) => `
    <div class="fig" data-value="${figure.value}" data-index="${index}">
      <div class="fig-head">
        <span class="fig-value" data-role="value">0</span>
        <span class="fig-unit">${esc(figure.unit)}</span>
      </div>
      <div class="fig-label">${esc(figure.label)}</div>
      <div class="fig-track"><div class="fig-bar" data-role="bar"></div></div>
    </div>`).join('');

  const head = [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=${stage.w}, height=${stage.h}">`,
    '<style>',
    '  html, body { margin: 0; width: 100%; height: 100%; background: #04060a; overflow: hidden;',
    '    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }',
    '  .stage { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;',
    '    padding: 0 8%; gap: 30px; }',
    '  .kicker { font-size: 20px; letter-spacing: 0.36em; color: #468CFF; text-transform: uppercase; }',
    `  .grid { display: grid; gap: 34px 46px; grid-template-columns: ${one ? '1fr' : 'repeat(2, minmax(0, 1fr))'}; }`,
    '  .fig { display: flex; flex-direction: column; gap: 8px; }',
    '  .fig-head { display: flex; align-items: baseline; gap: 10px; }',
    `  .fig-value { font-size: ${one ? 190 : 108}px; line-height: 0.96; font-weight: 800; color: #F4F7FC;`,
    '    letter-spacing: -0.04em; font-variant-numeric: tabular-nums; }',
    '  .fig-unit { font-size: 30px; color: #7FA8E8; letter-spacing: 0.04em; }',
    '  .fig-label { font-size: 22px; color: rgba(210,224,242,0.62); }',
    '  .fig-track { height: 5px; border-radius: 3px; background: rgba(120,150,190,0.16); overflow: hidden; }',
    '  .fig-bar { height: 100%; width: 0%; border-radius: 3px;',
    '    background: linear-gradient(90deg, #2C6BFF, #7FB1FF); }',
    '  .note { position: absolute; left: 8%; bottom: 7%; font-size: 16px; color: rgba(200,215,235,0.45); }',
    '</style></head>',
    '<body>',
    '  <div class="stage">',
    `    <div class="kicker">${esc(kicker)}</div>`,
    `    <div class="grid">${rows}</div>`,
    '  </div>',
    note ? `  <div class="note">${esc(note)}</div>` : '',
  ].filter(Boolean).join('\n');

  const script = [
    '  <script>',
    `    const D = ${duration};`,
    `    const MAX = ${max};`,
    "    const cells = Array.from(document.querySelectorAll('.fig'));",
    '    const ease = (x) => { const p = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - p, 3); };',
    '    window.film = {',
    '      duration: D,',
    '      ready: Promise.resolve(true),',
    '      frame(t) {',
    '        // Each figure counts up over the first ~55% of the shot, then holds.',
    '        const p = ease(t / Math.max(0.3, D * 0.55));',
    '        for (const cell of cells) {',
    '          const value = Number(cell.dataset.value);',
    "          const shown = value * p;",
    "          const decimals = Math.abs(value % 1) > 0.0001 ? 1 : 0;",
    "          cell.querySelector('[data-role=\"value\"]').textContent = shown.toFixed(decimals);",
    "          cell.querySelector('[data-role=\"bar\"]').style.width = String((Math.abs(value) / MAX) * 100 * p) + '%';",
    '        }',
    '      },',
    '    };',
    '    window.film.frame(0);',
    '  </script>',
    '</body></html>',
  ].join('\n');

  return `${head}\n${script}`;
}

/**
 * Which side of the picture carries the subject.
 *
 * Without a face detector this is still decidable: a person, a product, a phone
 * held in the frame all put their weight in the upper two thirds and to one side.
 * When one side holds clearly more ink up there, the copy belongs on the other
 * side — the shot is looking that way, and the words must not block it.
 *
 * @param {object} grid the measurement returned by inkGrid
 * @returns {'left'|'right'|null} the heavy side, or null when the frame is even
 */
export function subjectSide(grid) {
  const rows = grid?.cells?.length ?? 0;
  const cols = grid?.cells?.[0]?.length ?? 0;
  if (!rows || !cols) return null;
  const topRows = Math.max(1, Math.round(rows * 0.66));
  const half = Math.floor(cols / 2);
  let left = 0;
  let right = 0;
  for (let row = 0; row < topRows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const value = Number(grid.cells[row][col] ?? 0);
      if (col < half) left += value;
      else right += value;
    }
  }
  const total = left + right;
  if (total < 40) return null;
  const ratio = left === 0 ? Infinity : right === 0 ? 0 : right / left;
  if (ratio >= 1.35) return 'right';
  if (ratio <= 1 / 1.35) return 'left';
  return null;
}

/**
 * A page that draws its numbers.
 *
 * A figure page holds up to four values as type. Past that — or when the point is
 * the comparison between them — the values have to be drawn, so this page renders
 * them as horizontal bars whose lengths are the numbers themselves, with the
 * value printed at the end of each bar.
 *
 * Everything is a function of t: bars grow once, from zero, and the printed value
 * is the same arithmetic the bar length uses, so a label can never disagree with
 * its bar.
 *
 * @param {{ kicker?: string, items: Array<{ label: string, value: number, unit?: string }>,
 *   duration?: number, sort?: boolean, note?: string, stage?: { w: number, h: number } }} spec
 */
export function buildChartPage(spec = {}) {
  const stage = spec.stage ?? { w: 1920, h: 1080 };
  const duration = Math.max(1.2, Math.min(20, Number(spec.duration ?? 3.6)));
  const raw = (Array.isArray(spec.items) ? spec.items : [])
    .filter((item) => Number.isFinite(Number(item?.value)))
    .slice(0, 8)
    .map((item) => ({
      label: typeof item.label === 'string' ? item.label : '',
      value: Number(item.value),
      unit: typeof item.unit === 'string' ? item.unit : '',
    }));
  // A chart of values is read by its order: biggest first, unless told otherwise.
  const items = spec.sort === false
    ? raw
    : [...raw].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const max = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  // When one value is twenty times another, a linear bar makes the small ones
  // invisible: the page switches to a square-root scale and says so on the page.
  const nonZero = items.map((item) => Math.abs(item.value)).filter((value) => value > 0);
  const ratio = nonZero.length ? Math.max(...nonZero) / Math.max(0.0001, Math.min(...nonZero)) : 1;
  const scale = ratio > 20 ? 'sqrt' : 'linear';
  const kicker = typeof spec.kicker === 'string' ? spec.kicker : 'MISE';
  const note = typeof spec.note === 'string' ? spec.note : '';
  const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  const rows = items.map((item, index) => `
    <div class="row" data-value="${item.value}" data-label="${esc(item.label)}" data-unit="${esc(item.unit)}" data-index="${index}">
      <div class="row-label">${esc(item.label)}</div>
      <div class="row-track"><div class="row-bar" data-role="bar"></div></div>
      <div class="row-value"><span data-role="value">0</span><span class="row-unit">${esc(item.unit)}</span></div>
    </div>`).join('');

  const head = [
    '<!doctype html>',
    `<html><head><meta charset="utf-8"><meta name="viewport" content="width=${stage.w}, height=${stage.h}">`,
    '<style>',
    '  html, body { margin: 0; width: 100%; height: 100%; background: #04060a; overflow: hidden;',
    '    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }',
    '  .stage { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: center;',
    '    padding: 0 8%; gap: 26px; }',
    '  .kicker { font-size: 19px; letter-spacing: 0.36em; color: #468CFF; text-transform: uppercase; }',
    '  .rows { display: flex; flex-direction: column; gap: 22px; }',
    '  .row { display: grid; grid-template-columns: 210px 1fr 150px; align-items: center; gap: 22px; }',
    '  .row-label { font-size: 24px; color: rgba(214,228,245,0.82); }',
    '  .row-track { height: 14px; border-radius: 7px; background: rgba(120,150,190,0.14); overflow: hidden; }',
    '  .row-bar { height: 100%; width: 0%; border-radius: 7px;',
    '    background: linear-gradient(90deg, #2C6BFF, #7FB1FF); }',
    '  .row-value { font-size: 34px; font-weight: 700; color: #F4F7FC; text-align: right;',
    '    font-variant-numeric: tabular-nums; }',
    '  .row-unit { font-size: 19px; color: #7FA8E8; margin-left: 4px; }',
    '  .note { position: absolute; left: 8%; bottom: 7%; font-size: 16px; color: rgba(200,215,235,0.45); }',
    '</style></head>',
    '<body>',
    '  <div class="stage">',
    `    <div class="kicker">${esc(kicker)}</div>`,
    `    <div class="rows">${rows}</div>`,
    '  </div>',
    note || scale === 'sqrt' ? `  <div class="note">${esc(note || '条形为平方根刻度，数值见标签')}</div>` : '',
  ].filter(Boolean).join('\n');

  const script = [
    '  <script>',
    `    const D = ${duration};`,
    `    const MAX = ${max};`,
    `    const SCALE = '${scale}';`,
    "    const rows = Array.from(document.querySelectorAll('.row'));",
    '    const ease = (x) => { const p = Math.min(1, Math.max(0, x)); return 1 - Math.pow(1 - p, 3); };',
    '    window.film = {',
    '      duration: D,',
    '      ready: Promise.resolve(true),',
    '      frame(t) {',
    '        const p = ease(t / Math.max(0.3, D * 0.6));',
    '        for (const row of rows) {',
    '          const value = Number(row.dataset.value);',
    "          const decimals = Math.abs(value % 1) > 0.0001 ? 1 : 0;",
    "          row.querySelector('[data-role=\"value\"]').textContent = (value * p).toFixed(decimals);",
    "          const weight = SCALE === 'sqrt' ? Math.sqrt(Math.abs(value) / MAX) : Math.abs(value) / MAX;",
    "          row.querySelector('[data-role=\"bar\"]').style.width = String(weight * 100 * p) + '%';",
    '        }',
    '      },',
    '    };',
    '    window.film.frame(0);',
    '  </script>',
    '</body></html>',
  ].join('\n');

  return `${head}\n${script}`;
}
