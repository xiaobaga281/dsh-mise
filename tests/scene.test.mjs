/**
 * The code-native 3D scene: geometry, camera, light and dust drawn by the page.
 *
 *   node tests/scene.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scene = new URL('../film-scene.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('a scene needs panels, and names the moves and palettes', async () => {
  const { validateSceneSpec } = await import(scene);
  assert.equal(validateSceneSpec({ panels: [] }).ok, false);
  assert.match(validateSceneSpec({ panels: [{ text: 'a' }], move: 'warp' }).problems.join(' '), /unknown move/);
  assert.match(validateSceneSpec({ panels: [{ text: 'a' }], palette: 'neon' }).problems.join(' '), /unknown palette/);
  assert.equal(validateSceneSpec({ panels: [{ image: 'nope.png' }] }, { exists: () => false }).ok, false);
  assert.equal(validateSceneSpec({ panels: [{ text: 'a' }] }, { exists: () => true }).ok, true);
});

test('the scene page is deterministic, in 3D, and needs no picture', async () => {
  const { buildScenePage } = await import(scene);
  const spec = { panels: [{ text: '一只狐狸', sub: '把信送到了灯塔' }, { text: '光', z: -200 }], move: 'dolly-through', palette: 'amber', duration: 4, particles: 60 };
  const a = buildScenePage(spec);
  const b = buildScenePage(spec);
  assert.equal(a, b);
  assert.ok(a.includes('perspective: 1100px'));
  assert.ok(a.includes('preserve-3d'));
  assert.ok(a.includes('window.film'));
  assert.ok(a.includes('dolly-through') === false, 'the move is numbers in the page, not a word');
  assert.ok(a.includes('hash('), 'dust must be seeded, not random');
  assert.ok(!a.includes('Math.random'));
  assert.equal((a.match(/class="panel"/g) ?? []).length, 2);
});

test('the tool writes the scene page and refuses to clobber', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_scene');
  assert.ok(tool, 'mise_scene must be registered');

  const dir = mkdtempSync(join(tmpdir(), 'mise-scene-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  writeFileSync(join(dir, 'plate.png'), 'pretend');

  const made = await tool.execute({ cwd: dir, name: 'open', panels: [{ text: '标题' }, { text: '二', z: -180 }], duration: 4 });
  assert.equal(made.ok, true);
  assert.equal(made.panels, 2);
  assert.ok(made.snippet.includes('open.html#t=0,4'));
  assert.ok(readFileSync(join(dir, 'open.html'), 'utf8').includes('perspective'));

  const textured = await tool.execute({ cwd: dir, name: 'textured', panels: [{ text: 'x', image: 'plate.png' }] });
  assert.equal(textured.ok, true);

  const again = await tool.execute({ cwd: dir, name: 'open', panels: [{ text: '标题' }] });
  assert.equal(again.ok, false);
  assert.match(again.problems.join(' '), /already exists/);

  const bad = await tool.execute({ cwd: dir, name: 'bad', panels: [{ image: 'missing.png' }] });
  assert.equal(bad.ok, false);
  rmSync(dir, { recursive: true, force: true });
});
