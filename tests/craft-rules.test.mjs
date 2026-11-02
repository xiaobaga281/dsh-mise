/**
 * Craft constants: the published timing rules, as things the engine enforces.
 *
 *   node tests/craft-rules.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const craftMod = new URL('../film-craft.mjs', import.meta.url).href;
const typeMod = new URL('../film-type.mjs', import.meta.url).href;
const genreMod = new URL('../film-genres.mjs', import.meta.url).href;

test('the entrance band and the stagger cap are enforced, not suggested', async () => {
  const { DURATION, STAGGER, entranceSeconds, staggerStep } = await import(craftMod);
  assert.equal(entranceSeconds(0.05), DURATION.entrance[0], 'too fast is lifted into the band');
  assert.equal(entranceSeconds(5), DURATION.entrance[1], 'too slow is pulled back');
  assert.equal(entranceSeconds(0.62), 0.62, 'a value inside the band is kept');

  // Many items must not add up to a long wait.
  const many = staggerStep(20);
  assert.ok(many * 20 <= STAGGER.totalCap + 1e-9, 'the whole list appears inside the cap');
  assert.ok(staggerStep(2) === STAGGER.perItem || staggerStep(2) * 2 <= STAGGER.totalCap);
  assert.ok(staggerStep(0) > 0, 'a single item still gets a step');
});

test('a title page uses the craft constants rather than hard-coded timing', async () => {
  const { DURATION } = await import(craftMod);
  const { buildTypePage } = await import(typeMod);
  const page = buildTypePage({ lines: Array.from({ length: 10 }, (_, i) => ({ text: `line ${i}` })), duration: 5 });
  assert.ok(page.includes('ENTRANCE'), 'the page carries the entrance length');
  const entrance = Number(/const ENTRANCE = ([0-9.]+)/.exec(page)?.[1] ?? 0);
  assert.ok(entrance >= DURATION.entrance[0] && entrance <= DURATION.entrance[1]);
  const step = Number(/const STAGGER = ([0-9.]+)/.exec(page)?.[1] ?? 1);
  assert.ok(step * 10 <= 0.5 + 1e-9, 'ten units still fit the total stagger cap');
});

test('the plan tells the author the timing rules it will be held to', async () => {
  const { planProduction } = await import(genreMod);
  const plan = planProduction({ genre: 'title-sequence', seconds: 16 });
  assert.ok(plan.rules.some((line) => /入场 0\.5–0\.8s/.test(line)), 'entrance band is stated');
  assert.ok(plan.rules.some((line) => /错峰/.test(line)), 'stagger rule is stated');
  assert.ok(plan.rules.some((line) => /不要回弹/.test(line)), 'no-bounce rule is stated');
  assert.ok(plan.rules.some((line) => /调色档/.test(line)), 'the grade ladder travels with the plan');
});

test('each genre carries a distinct finishing look', async () => {
  const { planProduction, GRADE_LOOK, GENRES } = await import(genreMod);
  const looks = Object.keys(GENRES).map((name) => planProduction({ genre: name, seconds: 14 }).grade);
  for (const look of looks) {
    for (const key of ['preset', 'grain', 'bloom', 'vignette']) assert.ok(look[key] !== undefined, `grade has ${key}`);
  }
  const presets = new Set(Object.values(GRADE_LOOK).map((look) => look.preset));
  assert.ok(presets.size >= 4, 'the ladder really has different looks');
  const memory = GRADE_LOOK['story-photo'];
  const keynote = GRADE_LOOK.keynote;
  assert.ok(memory.grain > keynote.grain * 3, 'a memory film is grainier than a launch film');
  assert.ok(memory.vignette > keynote.vignette, 'and darker at the corners');
});
