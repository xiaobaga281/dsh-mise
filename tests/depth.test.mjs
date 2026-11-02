/**
 * The depth page: real parallax from a picture + its depth map, with a flat
 * fallback when WebGL is unavailable.
 *
 *   node tests/depth.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const depth = new URL('../film-depth.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('a depth shot needs both pictures and refuses a missing one', async () => {
  const { validateDepthSpec } = await import(depth);
  assert.equal(validateDepthSpec({}).ok, false);
  assert.equal(validateDepthSpec({ src: 'a.png' }).ok, false);
  const missing = validateDepthSpec({ src: 'a.png', depth: 'd.png' }, { exists: () => false });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join(' '), /not found/);
  assert.equal(validateDepthSpec({ src: 'a.png', depth: 'd.png', move: 'orbit' }, { exists: () => true }).ok, false);
});

test('the depth page is deterministic, slices bands, and needs no WebGL', async () => {
  const { buildDepthPage } = await import(depth);
  const spec = { src: 'assets/shot.png', depth: 'assets/depth.png', move: 'dolly-diag', grade: 'warm-film', duration: 4, amount: 1.2 };
  const a = buildDepthPage(spec);
  const b = buildDepthPage(spec);
  assert.equal(a, b);
  assert.ok(a.includes('<canvas'));
  assert.ok(!a.includes('webgl'), 'the page must not depend on WebGL: headless software contexts are lost');
  assert.ok(a.includes('BANDS'), 'depth is used as bands');
  assert.ok(a.includes('window.film'));
});

test('the cine tool builds a depth page when depth is given', async () => {
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
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-depth-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  writeFileSync(join(dir, 'plate.png'), 'pretend');
  writeFileSync(join(dir, 'depth.png'), 'pretend');

  const made = await tool.execute({ cwd: dir, name: 'depth-shot', src: 'plate.png', depth: 'depth.png', move: 'pan-right', duration: 4 });
  assert.equal(made.ok, true);
  const html = readFileSync(join(dir, 'depth-shot.html'), 'utf8');
  assert.ok(html.includes('<canvas'));

  const bad = await tool.execute({ cwd: dir, name: 'depth-bad', src: 'plate.png', depth: 'nope.png' });
  assert.equal(bad.ok, false);
  assert.match(bad.problems.join(' '), /not found/);
  rmSync(dir, { recursive: true, force: true });
});
