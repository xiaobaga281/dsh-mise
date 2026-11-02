/**
 * Keyframe dissolves: poses at exact times, weighted so the sum never dips.
 *
 *   node tests/keyframes.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const morph = new URL('../film-keyframes.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('a keyframe shot needs 2–8 real files and a sane fade', async () => {
  const { validateMorphSpec } = await import(morph);
  assert.equal(validateMorphSpec({ frames: [{ src: 'a.png' }] }).ok, false);
  assert.equal(validateMorphSpec({ frames: Array.from({ length: 9 }, (_, i) => ({ src: `f${i}.png` })) }).ok, false);
  const missing = validateMorphSpec({ frames: [{ src: 'a.png' }, { src: 'b.png' }] }, { exists: () => false });
  assert.match(missing.problems.join(' '), /not found/);
  assert.equal(validateMorphSpec({ frames: [{ src: 'a.png' }, { src: 'b.png' }], fade: 0 }).ok, false);
  assert.equal(validateMorphSpec({ frames: [{ src: 'a.png' }, { src: 'b.png' }] }, { exists: () => true }).ok, true);
});

test('weights hand over between poses without a dip or a jump', async () => {
  const { frameWeights } = await import(morph);
  const times = [1, 3, 5];
  const atFirst = frameWeights(times, 0.6, 1);
  assert.ok(atFirst[0] > 0.9, 'first pose owns its moment');
  const handover = frameWeights(times, 0.6, 2.7);
  assert.ok(Math.abs(handover.reduce((a, b) => a + b, 0) - 1) < 1e-6, 'weights sum to one');
  assert.ok(handover[0] > 0 && handover[1] > 0, 'two poses share the dissolve');
  assert.ok(Math.abs(handover[0] - 0.5) < 0.01, 'the dissolve is centred before the next pose');
  assert.equal(frameWeights(times, 0.6, 3)[1], 1, 'the next pose is complete at its own time');
  const late = frameWeights(times, 0.6, 5);
  assert.ok(late[2] > 0.9, 'last pose owns the end');
});

test('the page is deterministic and carries times and a push', async () => {
  const { buildMorphPage } = await import(morph);
  const spec = { frames: [{ src: 'a.png' }, { src: 'b.png' }, { src: 'c.png' }], duration: 4, fade: 0.5, grade: 'teal-orange' };
  const a = buildMorphPage(spec);
  const b = buildMorphPage(spec);
  assert.equal(a, b);
  assert.ok(a.includes('window.film'));
  assert.ok(a.includes('TIMES'));
  assert.ok(a.includes('data-i="2"'));
});

test('the tool writes the page and refuses to clobber', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_keyframes');
  assert.ok(tool, 'mise_keyframes must be registered');

  const dir = mkdtempSync(join(tmpdir(), 'openfilm-kf-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  writeFileSync(join(dir, 'p1.png'), 'a');
  writeFileSync(join(dir, 'p2.png'), 'b');

  const made = await tool.execute({ cwd: dir, name: 'turn', frames: [{ src: 'p1.png' }, { src: 'p2.png' }], duration: 3 });
  assert.equal(made.ok, true);
  assert.equal(made.frames, 2);
  assert.deepEqual(made.times, [0.75, 2.25]);

  const again = await tool.execute({ cwd: dir, name: 'turn', frames: [{ src: 'p1.png' }, { src: 'p2.png' }] });
  assert.equal(again.ok, false);
  assert.match(again.problems.join(' '), /already exists/);
  rmSync(dir, { recursive: true, force: true });
});
