/**
 * Finishing: transition overlays and the one grade every shot shares.
 *
 *   node tests/finish.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const trMod = new URL('../film-transition.mjs', import.meta.url).href;
const gradeMod = new URL('../film-grade.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('transition kinds, colours and duration are checked, not guessed', async () => {
  const { validateTransitionSpec, buildTransitionPage } = await import(trMod);
  assert.equal(validateTransitionSpec({ kind: 'warp' }).ok, false);
  assert.equal(validateTransitionSpec({ kind: 'line', color: 'neon' }).ok, false);
  assert.equal(validateTransitionSpec({ kind: 'wipe', duration: 9 }).ok, false);
  assert.equal(validateTransitionSpec({ kind: 'iris' }).ok, true);
  const html = buildTransitionPage({ kind: 'wipe', duration: 0.6 });
  assert.ok(html.includes('window.film'));
  assert.ok(html.includes('background: transparent'), 'an overlay must not paint the whole frame black');
  assert.equal(html, buildTransitionPage({ kind: 'wipe', duration: 0.6 }));
});

test('a grade plan only uses filters this ffmpeg has', async () => {
  const { planGrade } = await import(gradeMod);
  const bare = planGrade({ input: 'a.mp4', output: 'b.mp4' }, { filters: [] });
  assert.equal(bare.ok, true);
  assert.ok(!bare.filter.includes('noise'), 'no noise filter on this build means no noise in the chain');

  const full = planGrade(
    { input: 'a.mp4', output: 'b.mp4', preset: 'teal-orange', grain: 0.2, vignette: 0.4, bloom: 0.3, letterbox: 0.12 },
    { filters: ['noise', 'vignette', 'gblur', 'blend', 'colorbalance', 'eq'] },
  );
  assert.equal(full.ok, true);
  assert.ok(full.filter.includes('teal') === false && full.filter.includes('colorbalance'));
  assert.ok(full.filter.includes('noise=alls='));
  assert.ok(full.filter.includes('vignette=angle='));
  assert.ok(full.filter.includes('drawbox='));
  assert.ok(full.filter.includes('blend=all_mode=screen'));

  assert.equal(planGrade({ input: 'a.mp4', output: 'b.mp4', preset: 'nope' }).ok, false);
  assert.equal(planGrade({ input: 'a.mp4', output: 'b.mp4', letterbox: 0.9 }).ok, false);
});

test('a heavier look produces a heavier command, not just a different number in a record', async () => {
  const { planGrade } = await import(gradeMod);
  const filters = ['noise', 'vignette', 'gblur', 'blend', 'colorbalance', 'eq'];
  const clean = planGrade({ input: 'a.mp4', output: 'b.mp4', preset: 'clean', grain: 0.04, vignette: 0.15, bloom: 0.04 }, { filters });
  const memory = planGrade({ input: 'a.mp4', output: 'b.mp4', preset: 'faded-print', grain: 0.22, vignette: 0.5, bloom: 0.2 }, { filters });
  const amount = (plan) => Number((plan.filter.match(/noise=alls=([0-9.]+)/) ?? [])[1] ?? 0);
  assert.ok(amount(memory) > amount(clean), 'more grain means a stronger noise filter');
  assert.ok(clean.filter !== memory.filter, 'the two looks are different chains');
});

test('both finishing tools are registered and refuse empty projects', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const transition = tools.find((t) => t.name === 'mise_transition');
  const grade = tools.find((t) => t.name === 'mise_grade');
  assert.ok(transition, 'mise_transition must be registered');
  assert.ok(grade, 'mise_grade must be registered');

  const dir = mkdtempSync(join(tmpdir(), 'mise-finish-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');

  const made = await transition.execute({ cwd: dir, name: 'cut-a', kind: 'line', duration: 0.6 });
  assert.equal(made.ok, true);
  assert.ok(made.snippet.includes('cut-a.html#t=0,0.6'));

  const noClip = await grade.execute({ cwd: dir });
  assert.equal(noClip.ok, false);
  assert.ok(noClip.problems.length > 0);

  rmSync(dir, { recursive: true, force: true });
});
