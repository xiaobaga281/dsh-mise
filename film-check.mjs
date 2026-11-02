/**
 * Reading a film before the expensive part runs.
 *
 * `openfilm look` and `openfilm render` are the only things that used to tell
 * the agent a film was wrong, and they cost a render each: a missing `#t=0,len`
 * on a still, a clip that overlaps its neighbour, or a src pointing at a file
 * that was never written all surface only after the browser has started. This
 * module answers the same questions in milliseconds by reading film.html with
 * the upstream parser.
 *
 * The division of labour is deliberate:
 *
 *  - upstream `readFilmFile` owns the HTML: what a film may contain, attribute
 *    ranges, ids, fade fits. Its problems already carry `film.html:<line>`, so
 *    they are passed through untouched.
 *  - this module owns what only the filesystem knows: whether a src exists,
 *    whether two clips on a track overlap, how long the film is, and whether a
 *    page references an asset that is not there.
 *
 * Nothing here writes. A check that cannot read a film reports that, rather
 * than reporting a film with no problems in it.
 *
 * @module openfilm-film-check
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { castReport } from './voice-assets.mjs';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Upstream's film reader, loaded from the vendored package.
 *
 * The package maps `./film-doc` to `./src/film-doc.mjs` and keeps nothing at its
 * root, and a relative specifier does not resolve from this plugin's own
 * directory — `vendor/node_modules` is not on its resolution path. The file is
 * therefore loaded by its path inside the vendored package, with a bare
 * specifier kept as a fallback for a packed install where it is hoisted.
 */
// The film parser is part of this plugin: mise-film-doc reads the same format
// (tracks, clips, fragments) without a vendored package behind it.
const FILM_DOC = await import('./mise-film-doc.mjs');

/** The file a film project is recognised by. */
const FILM_FILE = FILM_DOC.FILM_FILE ?? 'film.html';

/** The motion kit a page may import, copied in by `open`. */
const MOTION_LIB = 'of-motion.mjs';

/**
 * Split a clip src into its file and its media fragment.
 * `assets/a.mp4#t=2,8` → { file: 'assets/a.mp4', time: [2, 8] }
 * @param {string} src
 */
function splitSrc(src) {
  if (typeof src !== 'string') return { file: '', time: [] };
  const hash = src.indexOf('#');
  if (hash < 0) return { file: src, time: [] };
  const file = src.slice(0, hash);
  const frag = src.slice(hash + 1);
  const m = /^t=([^,]*)(?:,(.*))?$/.exec(frag);
  if (!m) return { file, time: [] };
  const from = Number(m[1]);
  const to = m[2] === undefined || m[2] === '' ? null : Number(m[2]);
  const time = [];
  if (Number.isFinite(from)) time.push(from);
  if (to !== null && Number.isFinite(to)) time.push(to);
  return { file, time };
}

/** Kind of a clip, as upstream classifies it by its file. */
function kindOfSrc(src) {
  if (typeof src !== 'string') return 'unknown';
  if (src.endsWith('.html')) return 'page';
  if (/\.(mp4|webm|mov|m4v)$/i.test(src)) return 'video';
  if (/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(src)) return 'still';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(src)) return 'sound';
  return 'unknown';
}

/**
 * How long one clip is on the film, without loading any media.
 *
 * The timing lives on `clip.time` — upstream has already parsed `#t=` out of the
 * src and stripped it there, so reading the fragment from `src` finds nothing.
 * Both numbers make the length exact. A fragment with only a start, or none at
 * all, needs the file's own length — which for a video means probing it and for
 * a page means asking the page — so the length is reported as unknown rather
 * than guessed. A guess here would silently move every clip after it.
 *
 * @returns {{ length: number | null, from: number, to: number | null, why?: string }}
 */
function clipLength(clip) {
  const time = Array.isArray(clip.time) ? clip.time : [];
  const from = Number.isFinite(clip.at) ? clip.at : 0;
  if (time.length === 2) {
    const speed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
    return { length: (time[1] - time[0]) / speed, from, to: from + (time[1] - time[0]) / speed };
  }
  if (time.length === 1) return { length: null, from, to: null, why: `#t=${time[0]} has no end, so the clip's length needs the file's own` };
  return { length: null, from, to: null, why: 'no #t=, so the clip\'s length needs the file\'s own' };
}

/**
 * Where two clips sit on one track, as the timeline would place them.
 *
 * Every earlier clip is compared, not only the previous one: a long clip that
 * contains two shorter ones overlaps the third even when the two short ones do
 * not touch each other.
 */
function overlaps(trackClips) {
  const placed = trackClips
    .map((clip) => ({ clip, ...clipLength(clip) }))
    .filter((c) => c.length !== null)
    .sort((a, b) => a.from - b.from || b.to - a.to);
  const out = [];
  for (let i = 1; i < placed.length; i++) {
    const cur = placed[i];
    for (let j = 0; j < i; j++) {
      const prev = placed[j];
      // A clip that starts before an earlier one ends, by more than a frame.
      if (cur.from < prev.to - 1 / 30) {
        out.push({
          a: { id: prev.clip.id, from: prev.from, to: prev.to },
          b: { id: cur.clip.id, from: cur.from, to: cur.to },
          overlap: Number((prev.to - cur.from).toFixed(3)),
        });
      }
    }
  }
  return out;
}

/**
 * The pixel decoders, loaded the way the cutout module loads them: from the
 * plugin's own vendor directory, with a bare specifier as the fallback for a
 * packed install. Absence is not fatal — the border probe then reports nothing.
 */
async function loadDecoders() {
  const vendor = (...parts) => {
    const target = join(PLUGIN_ROOT, 'vendor', 'node_modules', ...parts);
    return existsSync(target) ? import(pathToFileURL(target).href) : import(require.resolve(parts[0]));
  };
  const pngjs = await vendor('pngjs', 'lib', 'png.js');
  const jpeg = await vendor('jpeg-js', 'index.js');
  return { PNG: pngjs.PNG, JPEG: jpeg };
}
const DECODERS = await loadDecoders().catch(() => null);

/**
 * Whether a picture still carries its own rectangular background.
 *
 * A cut sticker, a logo with alpha, and a photograph all answer "no" for
 * different reasons: the first two have transparent or varied edges, the third
 * has a border that is not one flat colour. The only case that answers "yes" is
 * a subject drawn on a plain card — the rectangle that reads as a patch when it
 * is placed on a page. This is a property of the file, so it is the same answer
 * whatever the film does with it.
 *
 * @param {string} file absolute path
 * @returns {{ uniform: boolean, color: [number, number, number] | null, spread: number, w: number, h: number } | null}
 */
function borderProbe(file) {
  if (!DECODERS) return null;
  let bytes;
  try { bytes = readFileSync(file); } catch { return null; }
  if (bytes.length > 24 * 1024 * 1024) return null;
  let w, h, data;
  try {
    const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (isPng) {
      const png = DECODERS.PNG.sync.read(bytes);
      w = png.width; h = png.height; data = png.data;
    } else {
      const jpeg = DECODERS.JPEG.decode(bytes, { useTArray: true, formatAsRGBA: true });
      w = jpeg.width; h = jpeg.height; data = jpeg.data;
    }
  } catch {
    return null;
  }
  const at = (x, y) => (y * w + x) * 4;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 48));
  const samples = [];
  for (let x = 0; x < w; x += step) { samples.push(at(x, 0), at(x, h - 1)); }
  for (let y = 0; y < h; y += step) { samples.push(at(0, y), at(w - 1, y)); }
  const opaque = samples.filter((i) => data[i + 3] >= 250);
  // Transparent edges mean the picture is already cut; a border that is partly
  // transparent is a soft cut, not a card.
  if (opaque.length < samples.length * 0.9) return { uniform: false, color: null, spread: 0, w, h };
  let r = 0, g = 0, b = 0;
  for (const i of opaque) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  r /= opaque.length; g /= opaque.length; b /= opaque.length;
  let variance = 0;
  for (const i of opaque) {
    variance += (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2;
  }
  const spread = Math.sqrt(variance / opaque.length);
  // A flat card sits under ~10 of RGB spread; a picture with real content at its
  // edge is far above it.
  return { uniform: spread <= 12, color: [Math.round(r), Math.round(g), Math.round(b)], spread: Math.round(spread * 10) / 10, w, h };
}

/** The one `<img …>` tag in a page that names `file`, or '' when the page
 *  builds the name in code (which the report already says it cannot see). */
function imageTag(pageText, file) {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<img[^>]*${escaped}[^>]*>`, 'i').exec(pageText)?.[0] ?? '';
}

/** Every asset a page loads, found by reading its markup. Best effort: a page
 *  that builds a URL in code is not seen, which is said in the report. */
function pageAssets(pageText) {
  const found = [];
  const re = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(pageText)) !== null) {
    const url = m[1];
    if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith('#') || url.startsWith('data:')) continue;
    const file = url.split('#')[0].split('?')[0];
    if (!file) continue;
    found.push(file);
  }
  return found;
}

/**
 * Read a film and report what is wrong, and what is in it.
 *
 * @param {string} projectPath the folder holding film.html
 * @returns {{ ok: boolean, problems: Array<{line: number|null, message: string, rule: string}>, facts: object }}
 */
export function checkFilm(projectPath) {
  const root = resolve(projectPath);
  const filmPath = join(root, FILM_FILE);

  if (!existsSync(filmPath)) {
    return {
      ok: false,
      problems: [{ line: NO_LINE, message: `no ${FILM_FILE} in ${root}`, rule: 'missing-film' }],
      warnings: [],
      deferred: [],
      facts: emptyFacts(),
    };
  }

  let text;
  try {
    text = readFileSync(filmPath, 'utf8');
  } catch (error) {
    return {
      ok: false,
      problems: [{ line: NO_LINE, message: `could not read ${FILM_FILE}: ${error?.message ?? error}`, rule: 'unreadable' }],
      warnings: [],
      deferred: [],
      facts: emptyFacts(),
    };
  }

  const read = FILM_DOC.readFilmFile(text);
  const problems = (read.problems ?? []).map((p) => ({ line: lineOf(p), message: stripLine(p), rule: 'upstream' }));

  const facts = emptyFacts();
  if (!read.doc) {
    // Upstream refused the whole file; its problems say why, and nothing below
    // can be checked, so the facts stay empty rather than half-guessed.
    return { ok: false, problems, warnings: [], deferred: [], facts };
  }

  facts.stage = { w: read.doc.stage.w, h: read.doc.stage.h };
  facts.tracks = read.doc.tracks.length;

  /** Every clip, with its track, as one flat list. */
  const all = [];
  read.doc.tracks.forEach((track, ti) => {
    (track.clips ?? []).forEach((clip) => all.push({ clip, trackIndex: ti }));
  });
  facts.clips = all.length;

  const byKind = {};
  const missingFiles = [];
  const missingTiming = [];
  const badAttrs = [];
  const rectangular = [];
  /** What static reading cannot decide, and `look` can: not defects. */
  const deferred = [];
  /** Real defects that do not stop a render: the picture is still made. */
  const warnings = [];
  let duration = 0;
  let durationKnown = true;
  const unknownLength = [];

  for (const { clip, trackIndex } of all) {
    const kind = kindOfSrc(clip.src);
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const { file } = splitSrc(clip.src);

    // A missing file is the cheapest mistake and the most expensive to find in
    // a render, so it is checked first. It is also a blocking defect: the rest
    // of this clip cannot be judged, and the film's length is no longer known.
    if (file && !existsSync(join(root, file))) {
      missingFiles.push({ clip: clip.id, src: clip.src, track: trackIndex });
      durationKnown = false;
      continue;
    }

    // Upstream reports a still or a page without a duration as a throw from
    // clipSpan; catching it per clip keeps one bad clip from hiding the rest.
    // The throw and `clipLength`'s "unknown" are the same fact seen twice — the
    // clip's length needs its file — so both lists record it and both must agree.
    let span;
    try {
      span = FILM_DOC.clipSpan(clip, undefined, `track ${trackIndex} clip "${clip.id}"`);
    } catch (error) {
      const message = String(error?.message ?? error);
      missingTiming.push({ clip: clip.id, src: clip.src, track: trackIndex, message });
      // The same fact in the length view: the film's total cannot be stated
      // while any clip's length is only in its file.
      durationKnown = false;
      unknownLength.push({ clip: clip.id, src: clip.src, why: message.split('\n')[0] });
      // A still without `#t=0,length` is refused by the renderer with certainty.
      // A page may declare its own `duration`, and that value can be computed
      // at runtime, so static reading cannot call it broken: `look` reads the
      // running page. A video or a sound with only a start (`#t=2`) is legal
      // too: its length is in the file.
      if (kind === 'still') {
        problems.push({ line: NO_LINE, rule: 'missing-length', message });
      } else {
        deferred.push({
          clip: clip.id,
          kind,
          rule: kind === 'page' ? 'page-length' : 'length-in-file',
          message: kind === 'page'
            ? `clip "${clip.id}" is a page with no #t=0,length: openfilm look checks that the page declares its own duration`
            : `clip "${clip.id}" takes its length from ${clip.src}; openfilm look reads it`,
        });
      }
      continue;
    }

    const len = clipLength(clip);
    if (len.length === null) {
      durationKnown = false;
      unknownLength.push({ clip: clip.id, src: clip.src, why: len.why });
    } else {
      duration = Math.max(duration, len.to);
    }

    if (clip.speed !== undefined && !(clip.speed >= FILM_DOC.SPEED_MIN && clip.speed <= FILM_DOC.SPEED_MAX)) {
      badAttrs.push({ clip: clip.id, attr: 'speed', value: clip.speed, range: [FILM_DOC.SPEED_MIN, FILM_DOC.SPEED_MAX] });
    }
    if (clip.volume !== undefined && !(clip.volume >= 0)) {
      badAttrs.push({ clip: clip.id, attr: 'volume', value: clip.volume });
    }
    // A fade longer than its clip is reported by upstream when the length is
    // written; here it is reported when the length is only now known.
    const fade = FILM_DOC.clipFade(clip);
    if (fade && len.length !== null && fade[0] + fade[1] > len.length + 1e-3) {
      badAttrs.push({ clip: clip.id, attr: 'fade', value: fade, clipLength: len.length });
    }

    // A page's own assets, so a typo in a page is caught here too. A path is
    // relative to the page that names it, not to the project: `shots/a.html`
    // asking for `../assets/x.png` is correct and must not be reported.
    if (kind === 'page' && existsSync(join(root, file))) {
      const pageBase = dirname(join(root, file));
      let pageText = '';
      try { pageText = readFileSync(join(root, file), 'utf8'); } catch {}
      for (const asset of pageAssets(pageText)) {
        if (!existsSync(resolve(pageBase, asset))) missingFiles.push({ clip: clip.id, src: asset, track: trackIndex, from: 'page' });
      }
      if (pageText && !/(?:of-motion|\.mjs)/.test(pageText)) facts.pagesWithoutMotion += 1;
      // A page puts its pictures on top of whatever else it draws, so a flat
      // border there is a rectangle on screen. A picture the page crops with
      // object-fit: cover is a plate by intent, and is left alone.
      for (const asset of pageAssets(pageText)) {
        const assetPath = resolve(pageBase, asset);
        if (!/\.(png|jpe?g|webp|avif)$/i.test(asset) || !existsSync(assetPath)) continue;
        if (/object-fit\s*:\s*cover/i.test(imageTag(pageText, asset))) continue;
        const probe = borderProbe(assetPath);
        if (probe?.uniform) {
          rectangular.push({
            id: clip.id, src: asset, track: trackIndex, where: 'page',
            width: probe.w, height: probe.h, border: probe.color,
          });
        }
      }
    }

    // A still the film places as a smaller-than-stage picture is an overlay: it
    // is composited onto the page, so its own rectangular background is on
    // screen. Probing the file says whether it has one. A still that covers the
    // stage is a background plate, and a flat border there is the picture.
    if (kind === 'still' && existsSync(join(root, file))) {
      // The stage comes from the film itself. Without it there is no honest way
      // to call a picture "smaller than the stage", so no verdict is given
      // rather than assuming a frame size the film may not have.
      const stage = read.doc.stage;
      const box = clip.box;
      const bw = Number.isFinite(box?.w) ? box.w : null;
      const bh = Number.isFinite(box?.h) ? box.h : null;
      const sizedAgainstStage = Number.isFinite(stage?.w) && Number.isFinite(stage?.h);
      const overlay = Boolean(box) && sizedAgainstStage && (
        (bw !== null && bw < stage.w * 0.98) || (bh !== null && bh < stage.h * 0.98)
      );
      if (overlay) {
        const probe = borderProbe(join(root, file));
        if (probe?.uniform) {
          rectangular.push({
            id: clip.id, src: clip.src, track: trackIndex, where: 'clip',
            width: probe.w, height: probe.h, border: probe.color,
          });
        }
      }
    }
  }

  facts.byKind = byKind;
  facts.missingFiles = missingFiles;
  facts.missingTiming = missingTiming;
  facts.badAttrs = badAttrs;
  facts.unknownLength = unknownLength;
  facts.duration = durationKnown ? Number(duration.toFixed(3)) : NO_LENGTH;
  facts.durationKnown = durationKnown;
  facts.overlaps = read.doc.tracks.map((track) => overlaps(track.clips ?? [])).flat();
  facts.audio = all.filter(({ clip }) => kindOfSrc(clip.src) === 'sound').map(({ clip }) => ({
    id: clip.id, src: clip.src, at: Number.isFinite(clip.at) ? clip.at : 0,
  }));
  // The picture tracks, per clip with their real placement — what a timeline
  // view draws. A clip's length is its own `time` (exact) when written, else
  // unknown, in which case the row shows the clip at its start.
  facts.picture = all
    .filter(({ clip }) => kindOfSrc(clip.src) !== 'sound')
    .map(({ clip, trackIndex }) => {
      const len = clipLength(clip);
      return {
        id: clip.id,
        src: clip.src,
        track: trackIndex,
        at: Number.isFinite(clip.at) ? clip.at : 0,
        length: len.length,
        kind: kindOfSrc(clip.src),
      };
    });

  // The motion kit and the Rive runtime are copied into a project by `open`;
  // a page that asks for a path that does not resolve renders empty, and the
  // message a browser gives (404 net::ERR_ABORTED) names no page.
  facts.motionLibPresent = existsSync(join(root, MOTION_LIB));
  const unresolved = [];
  for (const { clip } of all) {
    const { file } = splitSrc(clip.src);
    if (kindOfSrc(clip.src) !== 'page' || !existsSync(join(root, file))) continue;
    let pageText = '';
    try { pageText = readFileSync(join(root, file), 'utf8'); } catch {}
    const base = file.includes('/') ? join(root, dirname(file)) : root;
    // Each file a page asks for by a relative path, and what it needs beside it.
    const wants = [];
    if (pageText.includes('of-motion.mjs')) wants.push(['of-motion.mjs']);
    if (pageText.includes('vendor-rive/rive.js')) wants.push(['vendor-rive/rive.js', 'vendor-rive/rive.wasm']);
    for (const group of wants) {
      for (const rel of group) {
        if (!existsSync(join(base, rel)) && !existsSync(join(root, rel))) {
          unresolved.push({ clip: clip.id, page: file, wants: rel });
        }
      }
    }
  }

  // The page contract (window.film), read from the page's own text — the same
  // fields upstream `look` validates, caught here before a render. A page that
  // declares a duration that is not a positive number, or a width/height that
  // is not a positive whole number, is refused by look with a message that
  // names no line; this names the page.
  facts.pageContract = [];
  for (const { clip } of all) {
    const { file } = splitSrc(clip.src);
    if (kindOfSrc(clip.src) !== 'page' || !existsSync(join(root, file))) continue;
    let pageText = '';
    try { pageText = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    if (!/window\s*\.\s*film\s*=\s*\{/.test(pageText)) continue;
    // Only the film object's own text is searched: a page's CSS has width and
    // height too, and matching those would report every styled page as broken.
    const at = pageText.search(/window\s*\.\s*film\s*=\s*\{/);
    const objectText = pageText.slice(at, at + 4000);
    const bad = [];
    const literal = /^-?\d+(?:\.\d+)?$/;
    const duration = /duration\s*:\s*([^\s,}\]]+)/.exec(objectText)?.[1];
    if (duration !== undefined) {
      if (!literal.test(duration)) {
        // `duration: pageLength` is a value only the browser can know; calling
        // it invalid here would refuse a correct page.
        deferred.push({ page: file, field: 'duration', rule: 'dynamic-contract', value: duration, message: `${file} declares duration ${duration}, which only the running page can resolve` });
      } else if (!(Number(duration) > 0)) {
        bad.push(`duration ${duration} is not a positive number of seconds`);
      }
    }
    for (const field of ['width', 'height']) {
      const v = new RegExp(`\\b${field}\\s*:\\s*([^\\s,}\\]]+)`).exec(objectText)?.[1];
      if (v === undefined) continue;
      if (!literal.test(v)) {
        deferred.push({ page: file, field, rule: 'dynamic-contract', value: v, message: `${file} declares ${field} ${v}, which only the running page can resolve` });
        continue;
      }
      if (!(Number.isInteger(Number(v)) && Number(v) > 0)) bad.push(`${field} ${v} is not a positive whole number of px`);
    }
    if (bad.length) facts.pageContract.push({ page: file, problems: bad });
  }
  facts.unresolvedImports = unresolved;
  facts.rectangularAssets = rectangular;

  // Every defect the filesystem can prove is a blocking problem, not a note in
  // `facts`: a tool that answers "clean" while a file is missing sends the film
  // straight into a failed render. `facts` stays as the detailed view so the
  // panel can still draw what was found.
  for (const missing of missingFiles) {
    problems.push({
      line: NO_LINE,
      rule: 'missing-file',
      message: missing.from === 'page'
        ? `a page in clip "${missing.clip}" loads ${missing.src}, which does not exist beside that page`
        : `clip "${missing.clip}" (track ${missing.track}) plays ${missing.src}, which does not exist`,
    });
  }
  for (const overlap of facts.overlaps) {
    problems.push({
      line: NO_LINE,
      rule: 'overlap',
      message: `clips "${overlap.a.id}" (${overlap.a.from}–${overlap.a.to}s) and "${overlap.b.id}" (${overlap.b.from}–${overlap.b.to}s) overlap by ${overlap.overlap}s on one track`,
    });
  }
  for (const attr of badAttrs) {
    problems.push({
      line: NO_LINE,
      rule: 'bad-attribute',
      message: `clip "${attr.clip}" has ${attr.attr} ${JSON.stringify(attr.value)}${attr.range ? `, outside ${attr.range[0]}–${attr.range[1]}` : ''}`,
    });
  }
  for (const want of unresolved) {
    problems.push({ line: NO_LINE, rule: 'missing-import', message: `${want.page} asks for ${want.wants}, which is not beside it or in the project` });
  }
  for (const page of facts.pageContract) {
    problems.push({ line: NO_LINE, rule: 'page-contract', message: `${page.page}: ${page.problems.join('; ')}` });
  }

  // A rectangle pasted onto a page is the defect the person sees. It is worth
  // saying, but it does not break the render, so it is a warning.
  for (const asset of rectangular) {
    const border = Array.isArray(asset.border) ? `rgb(${asset.border.join(', ')})` : 'one flat colour';
    warnings.push({
      rule: 'asset-background',
      message:
        `${asset.where === 'clip' ? `clip "${asset.id}"` : `a page in clip "${asset.id}"`} puts ${asset.src} on top of the film, `
        + `but the file still carries its own rectangular background (${border}, ${asset.width}x${asset.height}). `
        + 'Cut the subject out with mise_cutout and use the transparent PNG; '
        + 'if the whole card is wanted, crop it with object-fit: cover inside a rounded frame so its edge is a design edge, not a leftover rectangle.',
    });
  }

  // Voice consistency is per role, not per film: one narrator must keep one
  // voice, and several characters must each keep theirs. The cast file records
  // who spoke each file, so this is checked rather than trusted.
  const voiceReport = castReport(root);
  facts.voiceCast = voiceReport;
  for (const finding of voiceReport.problems) {
    warnings.push({ rule: finding.rule, message: finding.message });
  }

  return { ok: problems.length === 0, problems, warnings, deferred, facts };}
function emptyFacts() {
  return {
    stage: null, tracks: 0, clips: 0, byKind: {},
    duration: null, durationKnown: true,
    missingFiles: [], missingTiming: [], badAttrs: [], unknownLength: [],
    overlaps: [], audio: [], picture: [], unresolvedImports: [], pageContract: [],
    rectangularAssets: [],
    voiceCast: { problems: [], roles: [], narratorOnly: true },
    motionLibPresent: false, pagesWithoutMotion: 0,
  };
}

/**
 * A line number that does not exist reads as -1, not null: a tool result schema
 * keeps to single types, and a schema validator rejecting the whole result would
 * hide the very problems it was asked for.
 */
const NO_LINE = -1;
/** The film's length, when the markup alone cannot state it. */
const NO_LENGTH = -1;

/** `film.html:12: message` → { line: 12, message: 'message' } */
function lineOf(problem) {
  const m = /^film\.html:(\d+):\s*/.exec(problem);
  return m ? Number(m[1]) : NO_LINE;
}

function stripLine(problem) {
  return problem.replace(/^film\.html:\d+:\s*/, '');
}

export { FILM_FILE, MOTION_LIB };
