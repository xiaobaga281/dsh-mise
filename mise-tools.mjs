/**
 * Finding the external tools.
 *
 * ffmpeg and ffprobe are the only two programs the plugin needs from outside, and
 * a PATH on Windows is not something a plugin can count on: the harness may start
 * with a different environment than a terminal does. So the lookup is layered and
 * explicit:
 *
 *   1. DSH_FFMPEG / DSH_FFPROBE when set — the person's own choice wins;
 *   2. the name on PATH — the normal case;
 *   3. a few known install locations, checked once.
 *
 * The answer is cached: a render asks for ffmpeg thousands of times in a loop.
 *
 * @module mise-tools
 */

import { existsSync } from 'node:fs';

const KNOWN = {
  ffmpeg: [
    'D:/MicrosftEdge/ffmpeg/ffmpeg/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    'C:/Users/Public/ffmpeg/bin/ffmpeg.exe',
  ],
  ffprobe: [
    'D:/MicrosftEdge/ffmpeg/ffmpeg/bin/ffprobe.exe',
    'C:/ffmpeg/bin/ffprobe.exe',
    'C:/Program Files/ffmpeg/bin/ffprobe.exe',
    'C:/Users/Public/ffmpeg/bin/ffprobe.exe',
  ],
};

const cache = new Map();

/**
 * Resolve one tool.
 *
 * @param {'ffmpeg'|'ffprobe'} name
 * @returns {string} a path, or the bare name so the spawn reports the failure
 */
export function toolPath(name) {
  if (cache.has(name)) return cache.get(name);
  const fromEnv = name === 'ffmpeg' ? process.env.DSH_FFMPEG : process.env.DSH_FFPROBE;
  let resolved = typeof fromEnv === 'string' && fromEnv.length > 0 ? fromEnv : undefined;
  if (!resolved) {
    resolved = (KNOWN[name] ?? []).find((candidate) => existsSync(candidate));
  }
  // Falling back to the bare name keeps the Windows PATH lookup working, and the
  // caller's spawn error says what is missing.
  const answer = resolved ?? name;
  cache.set(name, answer);
  return answer;
}

/** Is there an ffmpeg this process can actually run? */
export async function hasFfmpeg() {
  const { spawn } = await import('node:child_process');
  return new Promise((done) => {
    const probe = spawn(toolPath('ffmpeg'), ['-version'], { stdio: 'ignore' });
    probe.once('error', () => done(false));
    probe.once('close', (code) => done(code === 0));
  });
}
