/**
 * Mise look — the film, looked at.
 *
 * The last thing this plugin still asked the vendored runtime for was a contact
 * sheet. This does it here: take stills at given times with the same
 * serve-and-seek machinery the renderer uses, tile them into one sheet, and
 * measure the film's loudness so the picture and the sound are judged together.
 *
 * @module mise-look
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { toolPath } from './mise-tools.mjs';

/** Run a command and collect its output; never throws for a non-zero exit. */
function run(command, args) {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', (error) => done({ code: -1, stdout: '', stderr: `could not run ${command}: ${error.message}` }));
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

/**
 * Tile PNGs into one sheet, `cols` across.
 *
 * ffmpeg does the tiling: a montage built by hand would need an image library
 * for no benefit, and the ffmpeg filter is one line.
 *
 * @param {{ files: string[], out: string, cols?: number, cellWidth?: number, gap?: number }} spec
 */
export async function tileSheet(spec) {
  const files = spec.files.filter((file) => existsSync(file));
  if (!files.length) throw new Error('tileSheet needs at least one picture');
  const cols = Math.max(1, Math.min(6, Number(spec.cols ?? 3)));
  const cellWidth = Math.max(160, Math.min(1920, Number(spec.cellWidth ?? 640)));
  const gap = Math.max(0, Math.min(40, Number(spec.gap ?? 12)));
  mkdirSync(resolve(spec.out, '..'), { recursive: true });

  if (files.length === 1) {
    const single = await run(toolPath('ffmpeg'), [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', files[0],
      '-vf', `scale=${cellWidth}:-1,format=rgb24`, '-frames:v', '1', spec.out,
    ]);
    if (single.code !== 0) throw new Error(`tiling failed: ${single.stderr.slice(-300)}`);
    return { out: spec.out, files: 1, cols: 1, rows: 1 };
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const file of files) args.push('-i', file);
  const parts = [];
  files.forEach((_, index) => {
    parts.push(`[${index}:v]scale=${cellWidth}:-1,format=rgba[cell${index}]`);
  });
  // Pad each cell and lay them out row by row, then colour the gaps.
  const padded = files.map((_, index) => `[cell${index}]pad=${cellWidth}:${Math.round(cellWidth * 0.5625)}:0:0:color=black[p${index}]`);
  const inputs = files.map((_, index) => `[p${index}]`).join('');
  const rows = Math.ceil(files.length / cols);
  parts.push(...padded);
  parts.push(`${inputs}xstack=inputs=${files.length}:layout=${Array.from({ length: files.length }, (_, index) => `${(index % cols) * cellWidth}_${Math.floor(index / cols) * Math.round(cellWidth * 0.5625)}`).join('|')}:fill=black[stack]`);
  // Normalise to a predictable sheet width and finish.
  parts.push(`[stack]pad=iw+${gap * 2}:ih+${gap * 2}:${gap}:${gap}:color=0x05070b,format=rgb24[sheet]`);
  args.push('-filter_complex', parts.join(';'), '-map', '[sheet]', '-frames:v', '1', spec.out);
  const result = await run(toolPath('ffmpeg'), args);
  if (result.code !== 0) throw new Error(`tiling failed: ${result.stderr.slice(-300)}`);
  return { out: spec.out, files: files.length, cols, rows };
}

/**
 * Measure a file's loudness (and its peak), the broadcast numbers.
 *
 * @param {string} file
 */
export async function measureLoudness(file) {
  const result = await run(toolPath('ffmpeg'), [
    '-hide_banner', '-nostats', '-i', file, '-map', '0:a:0',
    '-af', 'loudnorm=print_format=json', '-f', 'null', '-',
  ]);
  if (result.code !== 0) return { ok: false, problems: [`no audio stream: ${result.stderr.slice(-200)}`] };
  const match = result.stderr.match(/\{[\s\S]*\}/);
  try {
    if (!match) throw new Error('no json');
    const json = JSON.parse(match[0]);
    return {
      ok: true,
      problems: [],
      integrated: Number(json.input_i),
      truePeak: Number(json.input_tp),
      lra: Number(json.input_lra),
    };
  } catch {
    return { ok: false, problems: ['loudness could not be read'] };
  }
}

/** The stills already drawn for this film, newest set first. */
export function existingSheet(projectPath) {
  for (const candidate of [
    join(projectPath, '.film', 'cache', 'look', 'contact-sheet.png'),
    join(projectPath, '.film', 'contact-sheet.png'),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  const dir = join(projectPath, '.film', 'cache', 'look');
  if (!existsSync(dir)) return null;
  const newest = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.png'))
    .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0];
  return newest ? join(dir, newest.name) : null;
}

/**
 * Compare two versions of the same film, frame by frame.
 *
 * The question after a change is never "is it different" but "did the shot that
 * needed to change, change" — so this reports per shot, in the order the film
 * plays, with the numbers that mean something: how much of the frame moved, how
 * far the brightness went, and whether the composition shifted.
 *
 * @param {{ times: number[], before: string, after: string, width?: number }} spec
 */
export async function compareFrames(spec) {
  const { decodePng } = await import('./film-compose.mjs');
  const times = Array.isArray(spec.times) ? spec.times.filter((t) => Number.isFinite(t)) : [];
  if (!times.length) throw new Error('compareFrames needs at least one time');
  const width = Math.max(160, Math.min(1280, Number(spec.width ?? 480)));

  const grab = async (file) => {
    const results = [];
    for (const time of times) {
      const out = file.replace(/\.png$/i, '') + `.${time}s.png`;
      const result = await run(toolPath('ffmpeg'), [
        '-y', '-hide_banner', '-loglevel', 'error', '-ss', String(time), '-i', file,
        '-frames:v', '1', '-vf', `scale=${width}:-1`, out,
      ]);
      if (result.code !== 0) throw new Error(`could not grab ${time}s from ${file}: ${result.stderr.slice(-160)}`);
      const image = decodePng(readFileSync(out));
      if (!image.ok) throw new Error(`could not read the still at ${time}s: ${image.problems.join(', ')}`);
      results.push({ time, out, image });
    }
    return results;
  };

  const beforeStills = await grab(spec.before);
  const afterStills = await grab(spec.after);
  const shots = [];
  for (const [index, before] of beforeStills.entries()) {
    const after = afterStills[index];
    const a = before.image;
    const b = after.image;
    if (a.width !== b.width || a.height !== b.height) {
      shots.push({ time: before.time, ok: false, problems: ['the two versions do not share a frame size'] });
      continue;
    }
    let total = 0;
    let changed = 0;
    let brightA = 0;
    let brightB = 0;
    let sumA = 0;
    let sumB = 0;
    let weightA = 0;
    let weightB = 0;
    for (let i = 0; i < a.gray.length; i += 1) {
      const va = a.gray[i];
      const vb = b.gray[i];
      const diff = Math.abs(va - vb);
      total += diff;
      if (diff > 18) changed += 1;
      brightA += va;
      brightB += vb;
      // A crude centroid: where the picture carries its weight, horizontally.
      const x = i % a.width;
      weightA += va * x;
      weightB += vb * x;
      sumA += va;
      sumB += vb;
    }
    const pixels = a.gray.length;
    shots.push({
      time: before.time,
      ok: true,
      problems: [],
      meanDiff: Number((total / pixels).toFixed(2)),
      changedPercent: Number(((changed / pixels) * 100).toFixed(1)),
      brightnessBefore: Number((brightA / pixels).toFixed(1)),
      brightnessAfter: Number((brightB / pixels).toFixed(1)),
      centroidShift: Number((((weightB / Math.max(1, sumB)) - (weightA / Math.max(1, sumA))) / a.width).toFixed(3)),
    });
  }
  return { shots, width };
}
