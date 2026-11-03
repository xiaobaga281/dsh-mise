/**
 * The genre recipes and the director layer: any kind of code film, planned.
 *
 *   node tests/genres.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const genreMod = new URL('../film-genres.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('every genre plans beats inside its own shot range and closes properly', async () => {
  const { GENRES, planProduction } = await import(genreMod);
  for (const name of Object.keys(GENRES)) {
    const plan = planProduction({ genre: name, seconds: 20 });
    const genre = GENRES[name];
    assert.equal(plan.ok, true);
    assert.ok(plan.beats.length >= 2);
    for (const beat of plan.beats) {
      assert.ok(beat.length >= genre.shot.min - 1e-9, `${name} beat ${beat.index} shorter than ${genre.shot.min}`);
      assert.ok(beat.length <= genre.shot.max + 1e-9, `${name} beat ${beat.index} longer than ${genre.shot.max}`);
    }
    assert.ok(plan.seconds > 20 * 0.85 && plan.seconds < 20 * 1.15, `${name} planned ${plan.seconds}s for a 20s film`);
    assert.equal(plan.beats[plan.beats.length - 1].kind, genre.beats[genre.beats.length - 1], `${name} does not close on its own ending`);
    // Pacing is a shape, not a mood: the lengths must actually move that way.
    const lengths = plan.beats.map((beat) => beat.length);
    if (plan.pacing === 'accelerate') {
      assert.ok(lengths[0] > lengths[lengths.length - 1], `${name} says accelerate but does not`);
    } else if (plan.pacing === 'decelerate') {
      assert.ok(lengths[lengths.length - 1] > lengths[0], `${name} says decelerate but does not`);
    } else {
      const spread = Math.max(...lengths) - Math.min(...lengths);
      assert.ok(spread <= 0.6, `${name} says even but the cuts wander by ${spread}s`);
    }
    assert.ok(plan.rules.length >= 4);
    assert.ok(['plate', 'texture', 'pose', 'none'].includes(plan.imageUse));
    // Every beat states how it will be judged: a title by the safe area, a
    // photograph by being allowed to fill the frame.
    for (const beat of plan.beats) {
      assert.ok(beat.acceptance, `${name} beat ${beat.index} has no acceptance rules`);
      if (beat.kind === 'scene') assert.equal(beat.acceptance.bleed, true, 'footage is judged as full-bleed');
      if (beat.kind === 'title' || beat.kind === 'end') {
        assert.equal(beat.acceptance.bleed, false, 'titles are judged against the safe area');
        assert.ok(beat.acceptance.safe >= 40);
      }
      // Type pages carry a composition rule; footage does not, because a
      // photograph is allowed to break it deliberately.
      if (['title', 'type', 'end'].includes(beat.kind)) {
        assert.ok(Number.isFinite(beat.acceptance.expectCentroidX), `${name} beat ${beat.index} has no composition rule`);
        assert.ok(beat.acceptance.centroidTolerance > 0);
      } else {
        assert.equal(beat.acceptance.expectCentroidX, undefined, `${name} beat ${beat.index} should not be pinned`);
      }
    }
    // The join style is part of the recipe, and a presentation join must be
    // long enough that it reads as movement.
    assert.ok(['presentation', 'overlay'].includes(plan.transition), `${name} has a join style`);
    if (plan.transition === 'presentation') {
      assert.ok(plan.transitionDuration >= 0.8, `${name} join ${plan.transitionDuration}s is too short`);
    } else {
      assert.equal(plan.transitionDuration, 0, `${name} uses a hard cut`);
    }
    // Music-first: every cut lands on the half-beat grid.
    const grid = plan.score.grid;
    assert.ok(grid > 0.15 && grid < 0.8, `${name} has a usable grid`);
    for (const beat of plan.beats) {
      const off = Math.abs(beat.length / grid - Math.round(beat.length / grid)) * grid;
      assert.ok(off < 0.02, `${name} cut ${beat.index} is ${off.toFixed(3)}s off the beat grid`);
    }
  }
});

test('pacing and the beat grid follow the genre, and can be overridden', async () => {
  const { planProduction } = await import(genreMod);
  const title = planProduction({ genre: 'title-sequence', seconds: 18 });
  const vertical = planProduction({ genre: 'social-vertical', seconds: 18 });
  const lengths = (plan) => plan.beats.map((beat) => beat.length);
  assert.ok(lengths(title)[0] < lengths(title)[lengths(title).length - 1], 'title sequence slows down');
  assert.ok(lengths(vertical)[0] > lengths(vertical)[lengths(vertical).length - 1], 'vertical speeds up');

  const free = planProduction({ genre: 'title-sequence', seconds: 18, snapToBeat: false });
  const grid = free.score.grid;
  const offGrid = free.beats.some((beat) => Math.abs(beat.length / grid - Math.round(beat.length / grid)) * grid > 0.02);
  assert.ok(offGrid, 'snapToBeat:false really frees the lengths');
});

test('every cut is classified, and only a presentation join is a join', async () => {
  const { planProduction } = await import(genreMod);
  const title = planProduction({ genre: 'title-sequence', seconds: 18 });
  assert.equal(title.cuts.length, title.beats.length - 1, 'one classification per cut');
  assert.ok(title.cuts.every((cut) => ['chapter', 'join', 'cut'].includes(cut.type)));
  assert.equal(title.cuts[title.cuts.length - 1].type, 'join', 'a presentation genre ends on a join');
  assert.equal(title.cuts[0].type, 'chapter', 'leaving a title is a chapter change');

  const lecture = planProduction({ genre: 'explainer-data', seconds: 18 });
  assert.ok(!lecture.cuts.some((cut) => cut.type === 'join'), 'an overlay genre has no presentation join');
});

test('camera moves are a budget: the rest of the film holds still', async () => {
  const { planProduction, GENRES, SHOT_MOVES } = await import(genreMod);
  for (const name of Object.keys(GENRES)) {
    const plan = planProduction({ genre: name, seconds: 18 });
    const moving = plan.beats.filter((beat) => beat.move !== 'still');
    const budget = Math.min(GENRES[name].motionBudget, plan.beats.length);
    assert.equal(moving.length, budget, `${name} spends its whole budget and no more`);
    const pool = SHOT_MOVES[name];
    assert.ok(moving.every((beat) => pool.includes(beat.move)), `${name} only uses moves its pages can do`);
    assert.equal(new Set(moving.map((beat) => beat.move)).size, moving.length, `${name} does not repeat one move`);
    assert.notEqual(plan.beats[0].move, 'still', 'the opening shot is allowed to move');
    // Determinism: the same plan twice is the same plan.
    const again = planProduction({ genre: name, seconds: 18 });
    assert.deepEqual(again.beats.map((beat) => beat.move), plan.beats.map((beat) => beat.move));
  }
});

test('a genre names its pictures as a role, not a dependency', async () => {
  const { GENRES } = await import(genreMod);
  assert.equal(GENRES['title-sequence'].imageUse, 'none');
  assert.equal(GENRES['story-photo'].imageUse, 'plate');
  assert.equal(GENRES.keynote.imageUse, 'texture');
});

test('an unknown genre is refused with the real list', async () => {
  const { validateGenre, planProduction } = await import(genreMod);
  assert.equal(validateGenre({ genre: 'anime' }).ok, false);
  assert.match(validateGenre({ genre: 'anime' }).problems.join(' '), /title-sequence/);
  assert.equal(planProduction({ genre: 'nope' }).genre, 'title-sequence', 'unknown falls back to the default recipe');
});

test('the plan tool writes .film/plan.json into a project', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_plan');
  assert.ok(tool, 'mise_plan must be registered');

  const dir = mkdtempSync(join(tmpdir(), 'mise-plan-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  const made = await tool.execute({ cwd: dir, genre: 'keynote', seconds: 18 });
  assert.equal(made.ok, true);
  assert.equal(made.relative, '.film/plan.json');
  const saved = JSON.parse(readFileSync(join(dir, '.film/plan.json'), 'utf8'));
  assert.equal(saved.genre, 'keynote');
  assert.ok(saved.beats.length >= 2);
  rmSync(dir, { recursive: true, force: true });
});
