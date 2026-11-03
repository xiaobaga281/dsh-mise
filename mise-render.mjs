/**
 * Mise renderer — our own frames, our own player, no Studio.
 *
 * The upstream runtime served the film folder, opened its page in Chromium and
 * asked it for frames; that path also brought a Studio server with it. This
 * renderer owns every step:
 *
 *   1. parse the film's clips out of its own DOM (iframe + `at` + `#t=in,out`);
 *   2. serve the project over a throwaway loopback HTTP server;
 *   3. drive the page clock ourselves — for each frame, place the active clips and
 *      call each page's `film.frame(localTime)`;
 *   4. screenshot every frame and pipe it into ffmpeg;
 *   5. mix the film's audio tags and mux it with the picture.
 *
 * Nothing here talks to a hosted service, and no long-lived web app is started.
 *
 * @module mise-render
 */

import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { toolPath } from './mise-tools.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/** A tiny static server for the project, on an ephemeral port. */
export async function serveProject(root) {
  const base = resolve(root);
  const server = createServer((request, response) => {
    const requested = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const path = normalize(join(base, requested));
    if (!path.startsWith(base)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const file = statSync(path, { throwIfNoEntry: false });
    const target = file?.isDirectory() ? join(path, 'index.html') : path;
    if (!existsSync(target)) {
      response.writeHead(404).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': MIME[extname(target).toLowerCase()] ?? 'application/octet-stream' });
    createReadStream(target).pipe(response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}

/** Load playwright-core from the plugin's own vendor tree. */
export async function loadBrowser() {
  const candidates = [
    new URL('./vendor/node_modules/playwright-core/index.mjs', import.meta.url),
    new URL('../vendor/node_modules/playwright-core/index.mjs', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const module = await import(candidate.href);
      return module.chromium;
    } catch { /* try the next location */ }
  }
  throw new Error('playwright-core is not available beside this module');
}

/**
 * The film's own player.
 *
 * It reads the clips from the document (don't change the film format: the pages
 * already declare where they sit and which slice of their clock they show) and
 * exposes one function: seek(t).
 */
const PLAYER = `(() => {
  if (window.__mise) return window.__mise;
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  // A clip may carry overrides='[{"fade":[in,out]}]'. The host applies that ramp
  // itself, so a renderer that ignores it silently loses every fade in the film.
  const fadeOf = (frame) => {
    let list = [];
    try { list = JSON.parse(frame.getAttribute('overrides') ?? '[]'); } catch { return null; }
    const fade = Array.isArray(list) ? list.find((item) => item && Array.isArray(item.fade))?.fade : null;
    if (!fade) return null;
    const [inFade, outFade] = fade.map(Number);
    return { in: Number.isFinite(inFade) ? Math.max(0, inFade) : 0, out: Number.isFinite(outFade) ? Math.max(0, outFade) : 0 };
  };
  const clips = [...document.querySelectorAll('iframe')].map((frame, index) => {
    const src = frame.getAttribute('src') ?? '';
    const [, range] = src.split('#t=');
    const [a, b] = (range ?? '').split(',').map(Number);
    const inPoint = Number.isFinite(a) ? a : 0;
    const outPoint = Number.isFinite(b) && b > inPoint ? b : null;
    const at = Number(frame.getAttribute('at'));
    return {
      index,
      frame,
      inPoint,
      outPoint,
      start: Number.isFinite(at) ? at : 0,
      length: outPoint === null ? null : outPoint - inPoint,
      fade: fadeOf(frame),
      shown: null,
    };
  });
  const container = clips.length ? clips[0].frame.parentElement : document.body;
  if (container) {
    container.style.position = 'absolute';
    container.style.left = '0';
    container.style.top = '0';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.overflow = 'hidden';
  }
  document.documentElement.style.background = '#000';
  document.body.style.margin = '0';
  document.body.style.width = '100%';
  document.body.style.height = '100%';
  document.body.style.overflow = 'hidden';
  for (const clip of clips) {
    clip.frame.style.position = 'absolute';
    clip.frame.style.left = '0';
    clip.frame.style.top = '0';
    clip.frame.style.width = '100%';
    clip.frame.style.height = '100%';
    clip.frame.style.zIndex = String(10 + clip.index);
    clip.frame.style.display = 'none';
    clip.frame.style.border = '0';
  }
  const total = clips.reduce((end, clip) => Math.max(end, clip.start + (clip.length ?? 0)), 0);
  const seek = (t) => {
    for (const clip of clips) {
      const end = clip.start + (clip.length ?? 0);
      const active = t >= clip.start - 0.0001 && t < end + 0.0001;
      const want = active ? 'block' : 'none';
      if (clip.shown !== want) { clip.frame.style.display = want; clip.shown = want; }
      if (!active) continue;
      const localTime = Math.max(0, Math.min(clip.length ?? 0, t - clip.start));
      if (clip.fade && (clip.fade.in > 0 || clip.fade.out > 0)) {
        let opacity = 1;
        if (clip.fade.in > 0) opacity = Math.min(opacity, clamp01(localTime / clip.fade.in));
        if (clip.fade.out > 0 && clip.length) opacity = Math.min(opacity, clamp01((clip.length - localTime) / clip.fade.out));
        clip.frame.style.opacity = opacity.toFixed(3);
      }
      const local = localTime + clip.inPoint;
      const win = clip.frame.contentWindow;
      if (win && win.film && typeof win.film.frame === 'function') win.film.frame(local);
    }
  };
  window.__mise = { clips: clips.length, total, seek };
  return window.__mise;
})()`;

/** Wait until every iframe has a film clock, or report what did not. */
const READY = `(() => {
  const frames = [...document.querySelectorAll('iframe')];
  return frames.map((frame) => {
    try {
      const win = frame.contentWindow;
      return Boolean(win && win.film && typeof win.film.frame === 'function');
    } catch { return false; }
  });
})()`;

/**
 * Render a film project to an MP4.
 *
 * @param {{
 *   projectDir: string,
 *   entry?: string,
 *   out?: string,
 *   fps?: number,
 *   width?: number,
 *   height?: number,
 *   supersample?: number,
 *   motionBlur?: boolean,
 *   onProgress?: (done: number, total: number) => void,
 *   signal?: { aborted: boolean },
 * }} options
 */
export async function renderFilm(options) {
  const projectDir = resolve(options.projectDir);
  const entry = options.entry ?? 'film.html';
  const fps = Math.max(1, Math.min(120, Number(options.fps ?? 30)));
  const width = Number(options.width ?? 1920);
  const height = Number(options.height ?? 1080);
  // Rasterise above the delivery size and let the scaler bring it down. At 1x a
  // hairline rule, a 0.5px grid and small type are drawn on the pixel boundary
  // and they staircase; 2x with a Lanczos downscale is the cheapest sharpness
  // there is, and it costs render time, not quality.
  const supersample = Math.max(1, Math.min(3, Math.round(Number(options.supersample ?? 2)) || 1));
  // A shutter is two samples per frame averaged: real motion blur, not a blur
  // filter. It doubles the frames drawn, so it is opt-in.
  const shutter = options.motionBlur === true ? 2 : 1;
  const sampleFps = fps * shutter;
  if (!existsSync(join(projectDir, entry))) throw new Error(`no ${entry} in ${projectDir}`);

  const chromium = await loadBrowser();
  const site = await serveProject(projectDir);
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: supersample });
    await page.goto(new URL(entry, site.url).href, { waitUntil: 'load' });

    // Every clip page must expose its clock before a single frame is taken.
    const ready = await page.evaluate(READY);
    const missing = ready.map((ok, index) => (ok ? null : index)).filter((index) => index !== null);
    if (missing.length) throw new Error(`clip ${missing.map((i) => i + 1).join(', ')} never exposed window.film`);

    const info = await page.evaluate(PLAYER);
    if (!info.total || !Number.isFinite(info.total)) throw new Error('the film has no clips with a length');
    const frames = Math.max(1, Math.round(info.total * fps));
    // With a shutter, every delivered frame is the mean of `shutter` samples.
    const drawn = frames * shutter;

    // Audio: every <audio> the film declares, placed at its own time.
    const audios = await page.evaluate(`[...document.querySelectorAll('audio')].map((a) => ({ src: a.getAttribute('src'), at: Number(a.getAttribute('at') ?? 0), volume: Number(a.getAttribute('volume') ?? 1) }))`);

    const out = resolve(options.out ?? join(projectDir, `render-${Date.now()}.mp4`));
    const audioInputs = audios
      .filter((audio) => typeof audio.src === 'string' && audio.src)
      .map((audio) => ({ path: resolve(projectDir, audio.src), at: audio.at, volume: audio.volume }))
      .filter((audio) => existsSync(audio.path));
    const ffmpegArgs = buildFfmpegArgs({ fps, sampleFps, width, height, supersample, shutter, out, audios: audioInputs });
    const ffmpeg = spawn(ffmpegCommand(), ffmpegArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffmpegLog = '';
    let spawnFailure = null;
    ffmpeg.on('error', (error) => {
      spawnFailure = new Error(`ffmpeg could not start (${ffmpegCommand()}): ${error.message}`);
    });
    ffmpeg.stderr.on('data', (chunk) => { ffmpegLog += chunk.toString(); });
    // Wait for the encoder to exist before encoding into it: a missing binary must
    // cost a message, not every frame of the film.
    await new Promise((ok, fail) => {
      ffmpeg.once('spawn', ok);
      ffmpeg.once('error', (error) => fail(new Error(
        `ffmpeg could not start (${ffmpegCommand()}): ${error.message}. Install ffmpeg, or point DSH_FFMPEG at it.`,
      )));
    });

    for (let index = 0; index < drawn; index += 1) {
      if (options.signal?.aborted) throw new Error('render cancelled');
      const t = index / sampleFps;
      await page.evaluate((time) => { window.__mise.seek(time); }, t);
      // One animation frame plus a short settle: page code writes styles in frame().
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const shot = await page.screenshot({ type: 'png' });
      if (!ffmpeg.stdin.write(shot)) await once(ffmpeg.stdin, 'drain');
      // The bar counts delivered frames, not samples: a shutter should not make
      // the progress look like it is going backwards.
      options.onProgress?.(Math.min(frames, Math.ceil((index + 1) / shutter)), frames);
    }
    if (spawnFailure) throw spawnFailure;
    ffmpeg.stdin.end();
    const [code] = await once(ffmpeg, 'close');
    if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${ffmpegLog.slice(-400)}`);
    return { out, frames, seconds: Number((frames / fps).toFixed(3)), clips: info.clips, audio: audios.length, supersample, motionBlur: shutter > 1 };
  } finally {
    await page?.close().catch(() => {});
    await browser.close().catch(() => {});
    await site.close();
    void writeFileSync;
    void readdirSync;
    void mkdirSync;
  }
}

/** ffmpeg: pictures on stdin, the film's audio summed under them, H.264 + AAC out. */
function buildFfmpegArgs({ fps, sampleFps = fps, width = 1920, height = 1080, supersample = 1, shutter = 1, out, audios }) {
  const args = ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(sampleFps), '-i', 'pipe:0'];
  for (const audio of audios) args.push('-i', audio.path);
  const filters = audios.map((audio, index) => {
    const delay = Math.max(0, Math.round(Number(audio.at ?? 0) * 1000));
    const volume = Math.max(0, Math.min(4, Number(audio.volume ?? 1)));
    return `[${index + 1}:a]adelay=${delay}|${delay},volume=${volume.toFixed(2)}[a${index}]`;
  });
  if (audios.length === 1) filters.push('[a0]anull[aout]');
  else if (audios.length > 1) filters.push(`${audios.map((_, index) => `[a${index}]`).join('')}amix=inputs=${audios.length}:normalize=0[aout]`);
  if (filters.length) args.push('-filter_complex', filters.join(';'));

  const video = [];
  // A shutter is an average of the samples inside one frame's exposure: it is
  // what a real camera does to a fast move, and it is not the same thing as a
  // blur filter, which would soften the whole picture including the stills.
  if (shutter > 1) {
    video.push(`tmix=frames=${shutter}:weights='${Array.from({ length: shutter }, () => '1').join(' ')}'`);
    video.push(`fps=${fps}`);
  }
  // The samples were rasterised larger than the delivery frame; Lanczos brings
  // them down with the least ringing.
  //
  // ffmpeg's RGB -> YUV conversion already maps 0..255 onto legal 16..235; what
  // it does not do is say so. An untagged file is one every player has to guess
  // about, and one of the guesses crushes the blacks — so the tags below are the
  // part that matters. (Whether the scaler's overshoot needs a legalizer on top
  // is a question for a waveform monitor, not for signalstats: its readings here
  // are self-contradictory, so the plugin claims the tag and nothing more.)
  if (supersample > 1) video.push(`scale=${width}:${height}:flags=lanczos`);
  if (video.length) args.push('-vf', video.join(','));

  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  if (audios.length) args.push('-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k', '-shortest');
  else args.push('-an');
  args.push('-movflags', '+faststart', out);
  return args;
}

/**
 * Take stills out of a film at the given times — the timeline's thumbnails.
 *
 * Uses the same serve-and-seek machinery as the renderer, so a thumbnail is the
 * frame the film will actually show, not a guess made from the shot's markup.
 *
 * @param {{ projectDir: string, entry?: string, times: number[], outDir?: string, width?: number, prefix?: string }} spec
 */
export async function grabFrames(spec) {
  const projectDir = resolve(spec.projectDir);
  const entry = spec.entry ?? 'film.html';
  const times = Array.isArray(spec.times) ? spec.times.filter((t) => Number.isFinite(t) && t >= 0) : [];
  if (!times.length) throw new Error('grabFrames needs at least one time');
  const width = Math.max(120, Math.min(1920, Number(spec.width ?? 480)));
  const height = Math.round((width / 16) * 9);
  const outDir = resolve(spec.outDir ?? join(projectDir, '.film', 'thumbs'));
  mkdirSync(outDir, { recursive: true });
  const prefix = String(spec.prefix ?? 'shot');

  const chromium = await loadBrowser();
  const site = await serveProject(projectDir);
  const browser = await chromium.launch({ headless: true });
  const files = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(new URL(entry, site.url).href, { waitUntil: 'load' });
    const ready = await page.evaluate(READY);
    if (ready.some((ok) => !ok)) throw new Error('a clip never exposed window.film');
    await page.evaluate(PLAYER);
    for (const [index, time] of times.entries()) {
      await page.evaluate((t) => { window.__mise.seek(t); }, time);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const file = join(outDir, `${prefix}-${String(index + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
      files.push({ time, file });
    }
    await page.close();
  } finally {
    await browser.close().catch(() => {});
    await site.close();
  }
  // Resize to thumbnail width with ffmpeg, when there is an ffmpeg. Without one the
  // full-size stills are still usable: the panel scales them in CSS.
  const resizeAvailable = await new Promise((done) => {
    const probe = spawn(ffmpegCommand(), ['-version'], { stdio: 'ignore' });
    probe.once('error', () => done(false));
    probe.once('close', (code) => done(code === 0));
  });
  if (!resizeAvailable) return { outDir, thumbs: files, resized: false };
  const small = [];
  for (const entryFile of files) {
    const out = entryFile.file.replace(/\.png$/, '.small.png');
    await new Promise((done) => {
      const child = spawn(ffmpegCommand(), ['-y', '-hide_banner', '-loglevel', 'error', '-i', entryFile.file, '-vf', `scale=${width}:-1`, out]);
      let failure = '';
      child.stderr?.on('data', (chunk) => { failure += chunk.toString(); });
      child.on('error', (error) => done({ error }));
      child.on('close', () => done(failure ? { failure } : {}));
    });
    small.push({ time: entryFile.time, file: out });
  }
  return { outDir, thumbs: small };
}

/**
 * Which ffmpeg to run.
 *
 * The harness does not always inherit a PATH that contains it, so an explicit
 * DSH_FFMPEG wins, then the PATH, then the two places Windows installs put it.
 * Returns a string either way: the failure is reported by the spawn, with a
 * message that says what to install.
 */
function ffmpegCommand() {
  return toolPath('ffmpeg');
}
