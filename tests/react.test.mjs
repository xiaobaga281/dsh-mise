/**
 * Sound-reactive picture: the score's envelope, baked into a page.
 *
 *   node tests/react.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const audioMod = new URL('../film-audio.mjs', import.meta.url).href;
const gfxMod = new URL('../film-graphics.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

/** A 2s stereo WAV: silence, then a loud 440 Hz half-second, then silence. */
function syntheticWav() {
  const sr = 44100;
  const frames = sr * 2;
  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const t = i / sr;
    const active = t > 0.5 && t < 1.0;
    const value = active ? Math.sin(2 * Math.PI * 440 * t) * 0.8 : 0;
    const sample = Math.round(value * 32767);
    buffer.writeInt16LE(sample, 44 + i * 4);
    buffer.writeInt16LE(sample, 46 + i * 4);
  }
  return buffer;
}

test('the envelope follows the loud part of the file', async () => {
  const { wavEnvelope, envelopeForPage } = await import(audioMod);
  const env = wavEnvelope(syntheticWav(), { fps: 30 });
  assert.equal(env.fps, 30);
  assert.ok(Math.abs(env.duration - 2) < 0.01);
  assert.equal(env.values.length, 60);
  assert.ok(Math.max(...env.values) === 1, 'normalised to its loudest frame');
  assert.ok(env.values[20] > 0.5, 'loud inside the burst');
  assert.ok(env.values[5] < 0.05, 'quiet before the burst');
  assert.ok(envelopeForPage(env).every((v) => v >= 0 && v <= 1));
});

test('pulse needs an envelope and bakes it into the page', async () => {
  const { validateGraphicsSpec, buildGraphicsPage } = await import(gfxMod);
  assert.equal(validateGraphicsSpec({ mode: 'pulse' }).ok, false);
  const env = Array.from({ length: 60 }, (_, i) => (i > 20 && i < 40 ? 1 : 0.1));
  assert.equal(validateGraphicsSpec({ mode: 'pulse', envelope: env }).ok, true);
  const page = buildGraphicsPage({ mode: 'pulse', envelope: env, duration: 2, palette: 'teal' });
  assert.ok(page.includes('drawPulse'));
  assert.ok(page.includes('const ENV = ['));
  assert.equal(page, buildGraphicsPage({ mode: 'pulse', envelope: env, duration: 2, palette: 'teal' }));
});

test('the graphics tool reads the WAV and writes a pulse page', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_graphics');
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-pulse-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  writeFileSync(join(dir, 'bed.wav'), syntheticWav());

  const made = await tool.execute({ cwd: dir, name: 'pulse', mode: 'pulse', audio: 'bed.wav', duration: 2, palette: 'teal' });
  assert.equal(made.ok, true);
  assert.ok(made.snippet.includes('pulse.html#t=0,2'));

  const noAudio = await tool.execute({ cwd: dir, name: 'p2', mode: 'pulse' });
  assert.equal(noAudio.ok, false);
  assert.match(noAudio.problems.join(' '), /audio/);

  const missing = await tool.execute({ cwd: dir, name: 'p3', mode: 'pulse', audio: 'nope.wav' });
  assert.equal(missing.ok, false);
  rmSync(dir, { recursive: true, force: true });
});
