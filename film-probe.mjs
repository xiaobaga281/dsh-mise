/**
 * Look at a page the way a viewer will, and say what is wrong with it in numbers.
 *
 * A hand-written shot can be right in the idea and wrong in the pixels: a
 * subtitle at 1.6:1 on its own card, a headline that runs 40px past the frame,
 * type at 11px that nobody can read at 1080p, a shot that is identical from
 * first frame to last, or a frame that quietly depends on Math.random and will
 * not render the same twice. None of that shows up in code review, and all of
 * it shows up after a ten-minute render.
 *
 * This module loads the page in the same headless browser the renderer uses,
 * draws it at several times, and measures those things. It is a *measurement*,
 * not a style guide: it never says a shot is ugly, only that its text is 2.1:1
 * or that it leaves the safe area by 36px, so the author can decide.
 *
 * @module mise-film-probe
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadBrowser, serveProject } from './mise-render.mjs';
import { decodePng, inkGrid } from './film-compose.mjs';
import { compareFrames, describeFrame, paletteOf, profileFrames } from './film-vision.mjs';
import { motionOf } from './film-motion.mjs';

/** Draw one frame and return the text runs and media boxes it contains. */
const MEASURE = `(() => {
  const frame = document.documentElement.getBoundingClientRect();
  const IGNORE = '.grain,.texture,.vignette,.wash,.band,.light,.glowdot,.signature,.signature-glow,[data-bleed]';
  const ownText = (el) => {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === 3) text += node.nodeValue;
    return text.replace(/\\s+/g, ' ').trim();
  };
  const items = [];
  for (const el of document.querySelectorAll('body *')) {
    if (items.length >= 120) break;
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CANVAS' || tag === 'SVG' || tag === 'PATH') continue;
    if (el.matches(IGNORE) || el.closest(IGNORE)) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (Number(style.opacity) < 0.02) continue;
    const text = ownText(el);
    const media = tag === 'IMG' || tag === 'VIDEO';
    if (!text && !media) continue;
    let box = el.getBoundingClientRect();
    let lines = 1;
    // A block element is as wide as the page; its glyphs are not. Measuring the
    // element box would compare the background against itself and call readable
    // type unreadable. The range's client rects are the lines the text really
    // occupies.
    if (text) {
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = [...range.getClientRects()].filter((rect) => rect.width > 1 && rect.height > 1);
        if (rects.length) {
          lines = rects.length;
          box = {
            left: Math.min(...rects.map((rect) => rect.left)),
            top: Math.min(...rects.map((rect) => rect.top)),
            width: Math.max(...rects.map((rect) => rect.right)) - Math.min(...rects.map((rect) => rect.left)),
            height: Math.max(...rects.map((rect) => rect.bottom)) - Math.min(...rects.map((rect) => rect.top)),
          };
        }
      } catch {}
    }
    if (box.width < 2 || box.height < 2) continue;
    items.push({
      tag: tag.toLowerCase(),
      text: (text || el.getAttribute('alt') || '').slice(0, 160),
      x: box.left, y: box.top, width: box.width, height: box.height,
      fontSize: parseFloat(style.fontSize) || 0,
      lineHeight: parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 0) * 1.2,
      letterSpacing: parseFloat(style.letterSpacing) || 0,
      lines,
      color: style.color,
      media,
      broken: media && tag === 'IMG' && el.complete && el.naturalWidth === 0,
    });
  }
  return { stage: { width: frame.width, height: frame.height }, items };
})()`;

/**
 * The craft numbers an audit can hold a frame to.
 *
 * Every threshold here is a published figure, not a preference:
 * - title safe 90% (5% per edge) and action safe 93% (3.5%): EBU R 95,
 *   aligning with SMPTE ST 2046-1;
 * - 4.5:1 for body text, 3:1 for large text (>= 24px, or >= 18.5px bold):
 *   WCAG 2.1 SC 1.4.3, whose AAA level also asks for <= 80 characters a line
 *   (40 for CJK), leading of at least 1.5, and no justified text;
 * - 20 characters a second as the adult reading ceiling and 42 characters a
 *   line: Netflix's Timed Text Style Guide, the de-facto default for delivery.
 *
 * A film may break any of them on purpose. The audit's job is to make that a
 * decision someone took, not something nobody noticed.
 */
export const CRAFT = {
  titleSafe: 0.05,
  actionSafe: 0.035,
  largeTextPx: 24,
  contrastLarge: 3.0,
  contrastBody: 4.5,
  maxCjkPerLine: 40,
  maxLatinPerLine: 80,
  minLeading: 1.15,
  maxCps: 20,
  contrastFatal: 2.0,
  clippedWhiteShare: 0.02,
};

const CJK_TEXT = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/**
 * Merge character-level runs into the lines they form.
 *
 * A title page splits its headline into one span per character (that is how the
 * stagger works), so measuring per element would report forty 12px runs instead
 * of one 118px line. Runs that share a size, a colour and a baseline are one
 * line of type, whatever the markup did.
 */
export function clusterRuns(items) {
  const groups = new Map();
  for (const item of items ?? []) {
    if (!item || item.media) continue;
    const key = `${Math.round(Number(item.fontSize))}|${item.color}|${Math.round(Number(item.y) / 8)}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...item, count: 1, tops: [Number(item.y)], ownLines: Number(item.lines) || 1, lineHeight: Number(item.lineHeight) || 0 });
      continue;
    }
    const left = Math.min(existing.x, item.x);
    const top = Math.min(existing.y, item.y);
    const right = Math.max(existing.x + existing.width, item.x + item.width);
    const bottom = Math.max(existing.y + existing.height, item.y + item.height);
    groups.set(key, {
      ...existing,
      x: left,
      y: top,
      width: right - left,
      height: bottom - top,
      text: `${existing.text}${existing.text.endsWith(' ') || item.text.startsWith(' ') ? '' : ' '}${item.text}`.trim().slice(0, 120),
      count: existing.count + 1,
      tops: [...existing.tops, Number(item.y)],
      ownLines: Math.max(Number(existing.ownLines) || 1, Number(item.lines) || 1),
      lineHeight: Math.max(Number(existing.lineHeight) || 0, Number(item.lineHeight) || 0),
    });
  }
  // Characters arrive as one element per glyph; the block they form is as tall
  // as the number of distinct baselines in it.
  return [...groups.values()].map((group) => ({
    ...group,
    // One element that wrapped carries its own count; spans on one baseline
    // carry one each, so the taller of the two answers is the truth.
    lines: Math.max(new Set(group.tops.map((y) => Math.round(y / 4))).size, Number(group.ownLines) || 1),
  }));
}

/**
 * Hold one frame's type to the published numbers.
 *
 * Returns rules, not verdicts: each has an id, a severity and a sentence naming
 * the measurement and the standard behind it, so an author can decide whether
 * the exception is the point.
 *
 * @param {Array<object>} blocks from clusterRuns, each with contrast filled in
 * @param {{ width: number, height: number }} stage
 */
export function auditType(blocks, stage) {
  const rules = [];
  const safeX = stage.width * CRAFT.titleSafe;
  const safeY = stage.height * CRAFT.titleSafe;
  for (const block of blocks ?? []) {
    const label = JSON.stringify(String(block.text ?? '').slice(0, 14));
    const chars = [...String(block.text ?? '').replace(/\s+/g, '')].length;
    // Title safe: EBU R 95 asks text to stay inside the central 90%.
    const insetX = Math.min(Number(block.x), stage.width - (Number(block.x) + Number(block.width)));
    const insetY = Math.min(Number(block.y), stage.height - (Number(block.y) + Number(block.height)));
    const inset = Math.min(insetX, insetY);
    if (inset < Math.min(safeX, safeY) - 1) {
      rules.push({
        id: 'title-safe',
        severity: 'warn',
        message: `${label} sits ${Math.round(inset)}px from the frame edge; title safe is ${Math.round(Math.min(safeX, safeY))}px (EBU R 95, 90%)`,
      });
    }
    // Contrast against what is actually behind it, at the floor for its size.
    const large = Number(block.fontSize) >= CRAFT.largeTextPx;
    const floor = large ? CRAFT.contrastLarge : CRAFT.contrastBody;
    if (Number(block.contrast) > 0 && Number(block.contrast) < floor) {
      rules.push({
        id: 'contrast',
        // Size lowers the floor from 4.5 to 3, it does not make 1.5:1 readable.
        severity: large && Number(block.contrast) >= CRAFT.contrastFatal ? 'warn' : 'problem',
        message: `${label} is ${Number(block.contrast).toFixed(1)}:1 — ${large ? 'large' : 'body'} text needs ${floor}:1 (WCAG 1.4.3)`,
      });
    }
    // Line length: past ~40 CJK or 80 Latin glyphs the eye loses the return.
    const perLine = chars / Math.max(1, Number(block.lines) || 1);
    const cjk = [...String(block.text ?? '')].filter((ch) => CJK_TEXT.test(ch)).length;
    const limit = cjk > chars / 3 ? CRAFT.maxCjkPerLine : CRAFT.maxLatinPerLine;
    if (perLine > limit) {
      rules.push({
        id: 'line-length',
        severity: 'warn',
        message: `${label} runs ${Math.round(perLine)} characters a line; ${limit} is the readable ceiling (WCAG 1.4.8)`,
      });
    }
    // Leading: lines closer than 1.15 collide once they wrap.
    const leading = Number(block.fontSize) > 0 ? Number(block.lineHeight) / Number(block.fontSize) : 0;
    if (Number(block.lines) > 1 && leading > 0 && leading < CRAFT.minLeading) {
      rules.push({
        id: 'leading',
        severity: 'warn',
        message: `${label} has leading ${leading.toFixed(2)} across ${block.lines} lines; below ${CRAFT.minLeading} the lines start to touch`,
      });
    }
  }
  return rules;
}

/** Share of a grey frame at dead black and at clipped white. */
export function clipShares(gray) {
  if (!gray || !gray.length) return { black: 0, white: 0 };
  let black = 0;
  let white = 0;
  for (let i = 0; i < gray.length; i += 1) {
    const v = gray[i];
    if (v <= 4) black += 1;
    else if (v >= 252) white += 1;
  }
  return { black: Number((black / gray.length).toFixed(3)), white: Number((white / gray.length).toFixed(3)) };
}

/** Percentile luminances of a region, 0..255, from a decoded grey frame. */
export function regionSpread(image, rect) {
  const { width, height, gray } = image;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width - 1, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height - 1, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  const histogram = new Uint32Array(256);
  let total = 0;
  for (let y = y0; y <= y1; y += 1) {
    const base = y * width;
    for (let x = x0; x <= x1; x += 1) {
      histogram[gray[base + x]] += 1;
      total += 1;
    }
  }
  const at = (fraction) => {
    const target = Math.max(1, Math.floor(total * fraction));
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v];
      if (seen >= target) return v;
    }
    return 255;
  };
  return { low: at(0.02), high: at(0.98), median: at(0.5), pixels: total };
}

/** sRGB 0..255 → relative luminance, the WCAG way. */
function linear(value) {
  const c = Math.max(0, Math.min(255, Number(value))) / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Contrast ratio between the darkest and lightest 2% of a region. */
export function localContrast(spread) {
  if (!spread) return 0;
  const high = linear(spread.high);
  const low = linear(spread.low);
  return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
}

/** How far a box leaves the frame, in px, on its worst edge. */
export function overhang(box, stage) {
  return Math.round(Math.max(
    0,
    -box.x,
    -box.y,
    box.x + box.width - stage.width,
    box.y + box.height - stage.height,
  ));
}

/** A hash of the picture, for "is the same t the same frame?". */
export function digest(buffer) {
  return createHash('sha1').update(buffer).digest('hex');
}

/** Mean absolute difference of two grey frames, 0..255. */
export function frameDelta(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]);
    count += 1;
  }
  return Number((sum / Math.max(1, count)).toFixed(2));
}

/** Which page to probe when the caller names none: the first shot in the film. */
export function firstShotPage(projectDir) {
  const filmPath = join(projectDir, 'film.html');
  if (!existsSync(filmPath)) return null;
  try {
    const text = readFileSync(filmPath, 'utf8');
    const match = /<iframe[^>]+src\s*=\s*["']([^"']+\.html)(?:#[^"']*)?["']/i.exec(text);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A promise that gives up, so a hung page cannot hang the probe. */
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(message)), ms); }),
  ]);
}

/**
 * Probe one page.
 *
 * @param {{ projectDir: string, page?: string, times?: number[], width?: number, height?: number }} options
 * @returns {Promise<object>} a report; `ok` is false when a measurement fails
 */
export async function probePage(options = {}) {
  const projectDir = resolve(options.projectDir);
  const width = Math.max(320, Math.min(3840, Number(options.width ?? 1920)));
  const height = Math.max(240, Math.min(2160, Number(options.height ?? 1080)));

  let page = typeof options.page === 'string' && options.page.trim() ? options.page.trim() : null;
  if (!page) page = firstShotPage(projectDir);
  if (!page) return { ok: false, problems: ['no page given and no shot page found in film.html'], page: null };
  const pagePath = join(projectDir, page);
  if (!existsSync(pagePath)) return { ok: false, problems: [`${page} does not exist in the project`], page };

  const errors = [];
  const site = await serveProject(projectDir);
  const chromium = await loadBrowser();
  const browser = await chromium.launch({ headless: true });
  try {
    const view = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    view.on('pageerror', (error) => errors.push(String(error).slice(0, 200)));
    view.on('console', (message) => { if (message.type() === 'error') errors.push(message.text().slice(0, 200)); });
    view.on('requestfailed', (request) => errors.push(`${request.url().split('/').pop()} failed to load`));

    await view.goto(new URL(page, site.url).href, { waitUntil: 'load' });
    // A page may load fonts or a texture before it can draw; give it a moment,
    // then require the contract rather than assume it.
    const ready = await view.evaluate(() => Boolean(window.film && typeof window.film.frame === 'function')).catch(() => false);
    if (!ready) {
      return { ok: false, page, problems: [`${page} never exposed window.film.frame(t)`], errors };
    }
    const duration = await view.evaluate(() => Number(window.film?.duration ?? 0)).catch(() => 0);
    const span = Number.isFinite(duration) && duration > 0 ? duration : 4;
    const asked = Array.isArray(options.times) ? options.times.filter((t) => Number.isFinite(t) && t >= 0) : [];
    const times = asked.length ? asked : [span * 0.15, span * 0.4, span * 0.65, span * 0.9].map((t) => Number(t.toFixed(2)));

    const draw = async (t) => {
      // A page with an infinite loop in frame(t) would otherwise hang the tool
      // with no message, which is the worst possible feedback.
      await withTimeout(
        view.evaluate((time) => { window.film.frame(time); }, t),
        20_000,
        `frame(${t}) did not return within 20s — check frame() for an unbounded loop or an await that never settles`,
      );
      await withTimeout(
        view.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))),
        20_000,
        `the page stopped painting at ${t}s — a long task is blocking the main thread`,
      );
    };

    const samples = [];
    for (const t of times) {
      await draw(t);
      const measured = await view.evaluate(MEASURE);
      const shot = await view.screenshot({ type: 'png' });
      const decoded = decodePng(shot, { color: true });
      if (!decoded.ok) {
        samples.push({ t, frame: { t: Number(t.toFixed(2)), problems: ['could not read the frame back'] }, gray: null, digest: null });
        continue;
      }
      const grid = inkGrid(decoded, { cols: 4, rows: 6 });
      const runs = clusterRuns(measured.items ?? []);
      const blocks = runs.map((run) => ({ ...run, contrast: localContrast(regionSpread(decoded, run)) }));
      const clip = clipShares(decoded.gray);
      const overflow = [];
      for (const run of runs) {
        const px = overhang(run, measured.stage);
        if (px) overflow.push({ text: run.text.slice(0, 24), px });
      }
      for (const item of measured.items ?? []) {
        const px = overhang(item, measured.stage);
        if (item.media && px) overflow.push({ text: `[${item.tag}]`, px });
      }
      samples.push({
        t: Number(t.toFixed(2)),
        digest: digest(shot),
        gray: decoded.gray,
        frame: {
          t: Number(t.toFixed(2)),
          coverage: grid.totalInk,
          mean: grid.meanLuma,
          minFont: blocks.length ? Math.min(...blocks.map((block) => block.fontSize)) : 0,
          contrast: blocks.length ? Number(Math.min(...blocks.map((block) => block.contrast)).toFixed(2)) : 0,
          blocks: blocks.map((block) => ({ text: block.text.slice(0, 32), chars: [...String(block.text).replace(/\s+/g, '')].length, fontSize: Math.round(block.fontSize), lines: block.lines, contrast: block.contrast })),
          rules: auditType(blocks, measured.stage),
          vision: decoded.rgb ? describeFrame({ rgb: decoded.rgb, gray: decoded.gray, width: decoded.width, height: decoded.height }) : null,
          clip,
          overflow,
          brokenImages: (measured.items ?? []).filter((item) => item.broken).length,
        },
      });
    }
    const frames = samples.map((sample) => sample.frame);

    // Purity: draw the middle frame, look away, come back. A page that depends
    // on Math.random, Date.now or a CSS animation returns a different picture.
    let purity = { ok: true, problems: [] };
    if (times.length) {
      const at = times[Math.floor(times.length / 2)];
      await draw(at);
      const before = digest(await view.screenshot({ type: 'png' }));
      for (const other of [times[0], times[times.length - 1]]) await draw(other);
      await draw(at);
      const after = digest(await view.screenshot({ type: 'png' }));
      if (before !== after) {
        purity = { ok: false, problems: [`frame(${at}) draws a different picture the second time — the page is not a pure function of t (Math.random, Date.now, a CSS animation, or state kept between calls)`] };
      }
    }

    // Motion: how much the picture changes from one probe time to the next.
    for (let index = 1; index < samples.length; index += 1) {
      const delta = frameDelta(samples[index - 1].gray, samples[index].gray);
      if (delta !== null) frames[index].delta = delta;
    }

    // The same defect at four probe times is one defect: report it once, with
    // the times it was seen, or the report reads like four separate problems and
    // the author fixes one of them.
    const group = (map, at, message) => {
      const entry = map.get(message) ?? { times: [], message };
      if (at !== null && !entry.times.includes(at)) entry.times.push(at);
      map.set(message, entry);
    };
    const flatten = (map) => [...map.values()].map((entry) => (entry.times.length
      ? `${entry.times.join('s, ')}s — ${entry.message}`
      : entry.message));

    const problemMap = new Map();
    const warningMap = new Map();
    for (const problem of purity.problems) group(problemMap, null, problem);
    for (const frame of frames) {
      if (frame.coverage !== undefined && frame.coverage < 1) group(warningMap, frame.t, `almost empty (${frame.coverage}% ink) — nothing may be drawing`);
      if (frame.minFont && frame.minFont < 14) group(warningMap, frame.t, `type at ${frame.minFont}px will not read at ${height}p`);
      for (const rule of frame.rules ?? []) {
        group(rule.severity === 'problem' ? problemMap : warningMap, frame.t, `[${rule.id}] ${rule.message}`);
      }
      if (frame.clip && frame.clip.white > CRAFT.clippedWhiteShare) {
        group(problemMap, frame.t, `[clip] ${(frame.clip.white * 100).toFixed(1)}% of the frame is clipped white — the highlights are blown`);
      }
      for (const item of frame.overflow ?? []) group(problemMap, frame.t, `[overflow] "${item.text}" leaves the frame by ${item.px}px`);
      if (frame.brokenImages) group(problemMap, frame.t, `${frame.brokenImages} image(s) failed to load`);
      if (frame.delta !== undefined && frame.delta < 0.15) group(warningMap, frame.t, 'barely differs from the frame before it — the shot may be frozen');
    }
    if (frames.length >= 2) {
      const deltas = frames.slice(1).map((frame) => frame.delta ?? 0);
      if (deltas.every((delta) => delta < 0.2)) group(warningMap, null, 'the whole shot never moves — even a still frame needs a little life');
    }

    // Reading speed. A block that is up for the whole shot has `duration`
    // seconds to be read, and Netflix's adult ceiling is 20 characters a
    // second: past that the viewer is reading, not watching.
    for (const block of frames[0]?.blocks ?? []) {
      const text = String(block.text ?? '');
      const chars = Number(block.chars ?? [...text.replace(/\s+/g, '')].length);
      if (chars < 12) continue;
      const everywhere = frames.every((frame) => (frame.blocks ?? []).some((other) => other.text === text));
      if (!everywhere) continue;
      const cps = chars / Math.max(0.5, span);
      if (cps > CRAFT.maxCps) {
        group(warningMap, null, `[reading-speed] ${JSON.stringify(text.slice(0, 16))} runs ${cps.toFixed(0)} characters a second if it stays up for the shot; ${CRAFT.maxCps} is the adult ceiling (Netflix TTSG)`);
      }
    }
    for (const error of new Set(errors)) group(problemMap, null, error);

    // The page measured against itself: its own median tone and palette become
    // the reference, so nothing here assumes a style.
    const look = profileFrames(frames.map((frame) => ({ t: frame.t, vision: frame.vision })));

    // What moved, and how. The probe already holds a grey plane per sample, so
    // this costs no extra screenshots: change coverage separates a camera move
    // from a subject, and the speed curve says whether the motion eased.
    const motion = motionOf({
      width,
      height,
      frames: samples.filter((sample) => sample.gray).map((sample) => ({ t: sample.t, gray: sample.gray })),
    });

    let reference = null;
    if (typeof options.reference === 'string' && options.reference) {
      const refPath = join(projectDir, options.reference);
      if (!existsSync(refPath)) {
        group(problemMap, null, `reference ${options.reference} does not exist in the project`);
      } else {
        const image = readFileSync(refPath);
        const ref = decodePng(image, { color: true });
        if (!ref.ok || !ref.rgb) {
          group(problemMap, null, `reference ${options.reference} is not a readable PNG`);
        } else {
          const refVision = describeFrame({ rgb: ref.rgb, gray: ref.gray, width: ref.width, height: ref.height });
          const target = frames[Math.floor(frames.length / 2)]?.vision;
          reference = {
            file: options.reference,
            palette: refVision.palette,
            tone: refVision.tone,
            color: refVision.color,
            compare: target ? compareFrames(refVision, target) : null,
          };
        }
      }
    }

    const problems = flatten(problemMap);
    const warnings = flatten(warningMap);

    return {
      ok: problems.length === 0,
      page,
      width,
      height,
      duration: Number(span.toFixed(2)),
      frames,
      purity,
      look,
      ...(motion ? { motion } : {}),
      ...(reference ? { reference } : {}),
      errors: [...new Set(errors)],
      problems,
      warnings,
    };
  } catch (error) {
    // A hung or throwing page is a finding, not a crash: the author needs the
    // sentence, not a stack trace from the tool layer.
    return { ok: false, page, problems: [error?.message ?? String(error)], errors };
  } finally {
    await browser.close().catch(() => {});
    await site.close();
  }
}
