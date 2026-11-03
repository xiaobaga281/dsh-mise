/**
 * The cinematic page generator and the doctor: the parts that must work on any
 * machine, with no model and no GPU.
 *
 *   node tests/cine.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cine = new URL('../film-cine.mjs', import.meta.url).href;
const doctor = new URL('../film-doctor.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

function project(extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mise-cine-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  writeFileSync(join(dir, 'plate.png'), 'not a real png, existence is what matters here');
  for (const [name, body] of Object.entries(extra)) writeFileSync(join(dir, name), body);
  return dir;
}

test('a shot spec is refused with the choices, not silently defaulted', async () => {
  const { validateCine } = await import(cine);
  assert.equal(validateCine({}).ok, false);
  assert.match(validateCine({ src: 'a.png', move: 'orbit' }).problems.join(' '), /unknown move/);
  assert.match(validateCine({ src: 'a.png', grade: 'bw' }).problems.join(' '), /unknown grade/);
  assert.match(
    validateCine({ src: 'a.png' }, { exists: () => false }).problems.join(' '),
    /not found in the project/,
  );
  assert.equal(validateCine({ src: 'a.png', move: 'push-in', grade: 'warm-film' }, { exists: () => true }).ok, true);
});

test('the page is deterministic and carries the camera, grade and layers', async () => {
  const { buildCinePage } = await import(cine);
  const spec = {
    layers: [{ src: 'bg.png', depth: 0.1 }, { src: 'fg.png', depth: 0.9 }],
    move: 'dolly-diag',
    grade: 'teal-orange',
    duration: 6,
    grain: 0.2,
  };
  const a = buildCinePage(spec);
  const b = buildCinePage(spec);
  assert.equal(a.html, b.html, 'same plan must build the same page');
  assert.equal(a.duration, 6);
  assert.ok(a.html.includes('window.film'));
  assert.ok(a.html.includes('data-depth="0.1"'));
  assert.ok(a.html.includes('data-depth="0.9"'));
  assert.ok(a.html.includes('teal-orange') || a.html.includes('saturate(1.12)'));
  assert.ok(!a.html.includes('Math.random'), 'motion must not depend on randomness');
});

test('the cine tool writes a page, refuses to clobber, and names the iframe line', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_cine');
  assert.ok(tool, 'mise_cine must be registered');

  const dir = project();
  const made = await tool.execute({ cwd: dir, name: 'shot-a', src: 'plate.png', move: 'pan-right', grade: 'warm-film', duration: 4 });
  assert.equal(made.ok, true);
  assert.equal(made.relative, 'shot-a.html');
  assert.equal(made.layers, 1);
  assert.ok(made.snippet.includes('shot-a.html#t=0,4'));
  const html = readFileSync(join(dir, 'shot-a.html'), 'utf8');
  assert.ok(html.includes('window.film'));

  const again = await tool.execute({ cwd: dir, name: 'shot-a', src: 'plate.png' });
  assert.equal(again.ok, false);
  assert.match(again.problems.join(' '), /already exists/);

  const missing = await tool.execute({ cwd: dir, name: 'shot-b', src: 'nope.png' });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join(' '), /not found/);

  rmSync(dir, { recursive: true, force: true });
});

test('the doctor names a tier and says what is missing', async () => {
  const { assessEnvironment, describeTier } = await import(doctor);

  const bare = assessEnvironment({ node: '22', ffmpeg: { ok: false }, chromium: { ok: true }, fonts: { cjk: true } });
  assert.equal(bare.ok, false);
  assert.equal(bare.tier, 'unsupported');
  assert.ok(bare.recommendations.some((r) => /ffmpeg/.test(r)));

  const cinematic = assessEnvironment({
    node: '22',
    ffmpeg: { ok: true, version: '8.0', filters: ['scale', 'lut3d', 'vignette', 'noise', 'gblur'] },
    ffprobe: { ok: true },
    chromium: { ok: true, path: 'x' },
    fonts: { cjk: true },
  });
  assert.equal(cinematic.tier, 'cinematic');
  assert.ok(cinematic.filters.lut3d.ok);
  assert.ok(!cinematic.filters.minterpolate.ok);

  const animated = assessEnvironment({
    node: '22',
    ffmpeg: { ok: true, filters: ['minterpolate', 'lut3d'] },
    chromium: { ok: true },
    fonts: { cjk: true },
  });
  assert.equal(animated.tier, 'animated');
  assert.equal(describeTier(animated), 'cinematic + interpolated motion');

  const layered = assessEnvironment({
    node: '22',
    ffmpeg: { ok: true, filters: ['minterpolate'] },
    chromium: { ok: true },
    fonts: { cjk: true },
    packs: { installed: ['depth'], available: [] },
  });
  assert.equal(layered.tier, 'layered');
});
