/**
 * Cutting a sticker out of its picture, in pixels rather than in weights.
 *
 * A generated sticker-style picture is a subject drawn on a plain background,
 * usually with its own white die-cut stroke. That is exactly what classical
 * background removal is for: sample the border, flood the background away by
 * color distance, feather the cut by how close a pixel is to the background
 * color. No model, no download, no runtime: the whole thing is ~700 lines of
 * arithmetic over the pixel array, and on sticker-style art its result is as
 * good as, and often better than, a segmentation model — the model tends to
 * eat the white stroke this preserves.
 *
 * For photographs of the real world this is the wrong tool; that is what a
 * provider is for. The sticker pipeline's pictures are not that.
 *
 * Decoders: pngjs (PNG) and jpeg-js (JPEG), pure JS, together under a
 * megabyte — everything else in this module is arithmetic.
 *
 * @module mise-cutout
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * A vendored package by path. `vendor/node_modules` is not on this module's
 * resolution path (the plugin is installed as a link), so the real file is
 * resolved directly, with a bare specifier as the fallback for a packed
 * install. The same pattern as film-check's reader and voice-assets' engine.
 */
function vendorImport(...parts) {
  const target = join(PLUGIN_ROOT, 'vendor', 'node_modules', ...parts);
  if (existsSync(target)) return import(pathToFileURL(target).href);
  return import(require.resolve(parts[0]));
}

const PNG = (await vendorImport('pngjs', 'lib', 'png.js')).PNG;
const JPEG_JS = await vendorImport('jpeg-js', 'index.js');

/** A pixel access and the RGB distance between colors, shared by the passes. */

/**
 * Remove the background of an image read from `bytes`.
 *
 * @param {Uint8Array} bytes png or jpeg bytes
 * @param {{ feather?: number, threshold?: number, tolerance?: number }} [opts]
 *   `feather` is the soft-edge width in pixels (default 2). `threshold`
 *   overrides the auto threshold. `tolerance` multiplies the auto threshold
 *   (default 1), for a background that resists or over-cuts.
 * @returns {{ png: Uint8Array, width: number, height: number, background: [number, number, number], threshold: number, cut: number }}
 *   `png` is the composited result as PNG bytes; `cut` is how many pixels were
 *   removed, so a caller can tell a full-frame cut (an empty result) from a
 *   real one.
 */
export function removeBackgroundPixels(bytes, opts = {}) {
  const png = PNG.sync.read(Buffer.from(bytes));
  const W = png.width, H = png.height;
  const data = png.data;
  const px = (x, y) => {
    const i = (y * W + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  // 1. The background is whatever the frame's edge is. An average of edge
  //    samples, rejecting transparent ones outright (an image that is already
  //    cut has no background to find).
  const samples = [];
  const step = Math.max(1, Math.floor(Math.min(W, H) / 60));
  for (let x = 0; x < W; x += step) { samples.push(px(x, 0)); samples.push(px(x, H - 1)); }
  for (let y = 0; y < H; y += step) { samples.push(px(0, y)); samples.push(px(W - 1, y)); }
  let br = 0, bg = 0, bb = 0, opaque = 0;
  for (const s of samples) {
    if (s[3] < 128) continue;
    br += s[0]; bg += s[1]; bb += s[2]; opaque += 1;
  }
  if (opaque === 0) {
    // Every edge pixel is already transparent: nothing to cut.
    return { png: new Uint8Array(bytes), width: W, height: H, background: null, threshold: 0, cut: 0 };
  }
  br /= opaque; bg /= opaque; bb /= opaque;

  const dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
  const distToBg = (p) => dist(p, [br, bg, bb]);

  // 2. The threshold adapts to the background's own spread: a flat color cuts
  //    tightly, a gradient or vignette cuts loosely. A caller's `threshold`
  //    wins outright; `tolerance` scales the automatic one.
  let variance = 0;
  for (const s of samples) if (s[3] >= 128) variance += distToBg(s) ** 2;
  const spread = Math.sqrt(variance / opaque);
  const THRESH = Number.isFinite(opts.threshold)
    ? Math.max(1, opts.threshold)
    : Math.min(80, Math.max(28, spread * 2.2)) * (Number.isFinite(opts.tolerance) ? Math.max(0.1, opts.tolerance) : 1);

  // 3. Flood the background in from every border pixel that is near it.
  const visited = new Uint8Array(W * H);
  const mask = new Uint8Array(W * H); // 1 = background
  const stack = [];
  for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
  for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const idx = y * W + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    const p = px(x, y);
    if (p[3] === 0 || distToBg(p) <= THRESH) {
      mask[idx] = 1;
      stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }

  // 4. Alpha: background out, subject kept, the mask's edge feathered by how
  //    far the pixel sits from the background color — which keeps a sticker's
  //    own white stroke alive instead of slicing through it.
  const FEATHER = Math.max(0, Math.floor(opts.feather ?? 2));
  const alpha = new Uint8ClampedArray(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!mask[idx]) { alpha[idx] = data[idx * 4 + 3]; continue; }
      let nearEdge = false;
      for (let dy = -FEATHER; dy <= FEATHER && !nearEdge; dy++) {
        for (let dx = -FEATHER; dx <= FEATHER; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (!mask[ny * W + nx]) { nearEdge = true; break; }
        }
      }
      if (nearEdge) {
        const p = px(x, y);
        const a = Math.max(0, Math.min(1, (distToBg(p) - THRESH * 0.4) / (THRESH * 0.8)));
        alpha[idx] = Math.round(a * 255);
      } else {
        alpha[idx] = 0;
      }
    }
  }

  const out = new PNG({ width: W, height: H });
  out.data.set(data);
  for (let i = 0; i < W * H; i++) out.data[i * 4 + 3] = alpha[i];
  const bytes2 = PNG.sync.write(out);
  let cut = 0;
  for (let i = 0; i < W * H; i++) if (alpha[i] === 0) cut += 1;

  return { png: new Uint8Array(bytes2), width: W, height: H, background: [Math.round(br), Math.round(bg), Math.round(bb)], threshold: Math.round(THRESH * 10) / 10, cut };
}

/**
 * Decode PNG or JPEG bytes to RGBA the way pngjs reads them. PNG first (the
 * usual case for generated art); a PNG signature check decides, so a JPEG
 * never reaches the PNG decoder's throw.
 */
function decodeAny(bytes) {
  const isPng = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) return bytes;
  const jpeg = JPEG_JS.decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true });
  const png = new PNG({ width: jpeg.width, height: jpeg.height });
  png.data.set(jpeg.data);
  return PNG.sync.write(png);
}

/**
 * Whether a picture already is a subject on a flat card.
 *
 * The same border sample the cut itself uses, exposed on its own so the asset
 * pipeline can ask the question without paying for a cut: a generated sticker
 * and a photograph both arrive as rectangles, and only one of them should be
 * cut. A picture whose edges are transparent, or not one flat colour, answers
 * "no" and is left exactly as it was.
 *
 * @param {string} file png or jpeg
 * @returns {{ uniform: boolean, color: [number, number, number] | null, spread: number, width: number, height: number } | null}
 */
export function assessBackground(file) {
  let raw;
  try {
    raw = readFileSync(file);
  } catch {
    return null;
  }
  let png;
  try {
    png = PNG.sync.read(Buffer.from(decodeAny(raw)));
  } catch {
    return null;
  }
  const W = png.width, H = png.height, data = png.data;
  const at = (x, y) => (y * W + x) * 4;
  const step = Math.max(1, Math.floor(Math.min(W, H) / 60));
  const indices = [];
  for (let x = 0; x < W; x += step) { indices.push(at(x, 0), at(x, H - 1)); }
  for (let y = 0; y < H; y += step) { indices.push(at(0, y), at(W - 1, y)); }
  const opaque = indices.filter((i) => data[i + 3] >= 250);
  if (opaque.length < indices.length * 0.9) return { uniform: false, color: null, spread: 0, width: W, height: H };
  let r = 0, g = 0, b = 0;
  for (const i of opaque) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
  r /= opaque.length; g /= opaque.length; b /= opaque.length;
  let variance = 0;
  for (const i of opaque) variance += (data[i] - r) ** 2 + (data[i + 1] - g) ** 2 + (data[i + 2] - b) ** 2;
  const spread = Math.sqrt(variance / opaque.length);
  return {
    uniform: spread <= 12,
    color: [Math.round(r), Math.round(g), Math.round(b)],
    spread: Math.round(spread * 10) / 10,
    width: W,
    height: H,
  };
}

/**
 * Cut a project image and write the transparent result beside it.
 * @param {{ src: string, projectPath: string, hint?: string, threshold?: number, tolerance?: number, feather?: number }} req
 */
export async function cutoutImage(req) {
  const raw = readFileSync(req.src);
  let pngBytes;
  try {
    pngBytes = decodeAny(raw);
  } catch {
    throw new Error('the file is neither a PNG nor a JPEG');
  }
  const result = removeBackgroundPixels(pngBytes, { threshold: req.threshold, tolerance: req.tolerance, feather: req.feather });
  if (result.cut === 0 && result.background !== null) {
    throw new Error('nothing was cut — the background resists the sampled color; try a higher `tolerance`');
  }
  if (result.background === null) {
    throw new Error('the image already has a transparent background');
  }

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const safe = String(req.hint ?? 'sticker').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const fileName = `cut-${safe ? safe + '-' : ''}${stamp}.png`;
  const assets = join(req.projectPath, 'assets');
  mkdirSync(assets, { recursive: true });
  const target = join(assets, fileName);
  writeFileSync(target, result.png);
  return {
    relative: `assets/${fileName}`,
    bytes: result.png.length,
    sourceBytes: raw.length,
    width: result.width,
    height: result.height,
    background: result.background,
    threshold: result.threshold,
    cutPixels: result.cut,
  };
}
