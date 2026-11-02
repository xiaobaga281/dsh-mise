/**
 * What a proposal may and may not say.
 *
 * A promo built from a project's own material is only honest if the proposal
 * invents nothing: every string comes from the README, every figure from the
 * facts file, every picture from the screenshot folder.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const promoMod = new URL('../film-promo.mjs', import.meta.url).href;

test('a proposal refuses without a product name or a screenshot', async () => {
  const { proposePromo } = await import(promoMod);
  const noName = proposePromo({ tagline: 'x', screenshots: [{ file: 'a.png' }] });
  assert.equal(noName.ok, false);
  assert.ok(noName.problems.some((problem) => /product name/.test(problem)));

  const noShot = proposePromo({ name: 'X', tagline: 'y' });
  assert.equal(noShot.ok, false);
  assert.ok(noShot.problems.some((problem) => /screenshot/.test(problem)));
});

test('the proposal keeps the project sentence and the capability figure', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({
    name: 'DSH Mobile',
    tagline: '装在口袋里的 DeepSeek Harness —— Android 端 AI 助手客户端。',
    url: 'github.com/xiaobaga281/dsh-mobile',
    facts: { tools: { catalogEntries: 154, uniqueTools: 154 }, tests: { files: 49 }, apk: { bytes: 237295867 } },
    screenshots: [{ file: 'shot_chat3.png' }, { file: 'shot_team.png' }],
  });
  assert.equal(proposal.ok, true);

  // The dash becomes a line break rather than a typo at title size.
  assert.deepEqual(proposal.shots[0].title, ['装在口袋里的 DeepSeek Harness', 'Android 端 AI 助手客户端']);

  // A capability count leads; an APK byte size is not a story.
  const number = proposal.shots.find((shot) => shot.kind === 'number');
  assert.equal(number.figure, 154);
  assert.equal(number.caption, '工具条目');
  assert.equal(number.unit, '个条目');

  assert.equal(proposal.shots.filter((shot) => shot.kind === 'plate').length, 2);
  const end = proposal.shots[proposal.shots.length - 1];
  assert.equal(end.kind, 'end');
  assert.equal(end.url, 'github.com/xiaobaga281/dsh-mobile');
});

test('kickers come from the file name, not from the folder path', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({
    name: 'X',
    tagline: 'a b',
    facts: {},
    screenshots: [{ file: 'assets/shot_team.png' }],
  });
  assert.equal(proposal.shots.find((shot) => shot.kind === 'plate').kicker, 'TEAM');
});

test('a proposal without a repository link has no end card', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({ name: 'X', tagline: 'a b c', facts: {}, screenshots: [{ file: 'a.png' }] });
  assert.equal(proposal.ok, true);
  assert.equal(proposal.shots.some((shot) => shot.kind === 'end'), false);
});

test('the figure row does not repeat a count', async () => {
  const { proposePromo } = await import(promoMod);
  const proposal = proposePromo({
    name: 'X', tagline: 'a b', url: 'github.com/x/y',
    facts: { tools: { catalogEntries: 154, uniqueTools: 154 }, tests: { files: 49, annotations: 403 } },
    screenshots: [{ file: 'a.png' }],
  });
  const shot = proposal.shots.find((entry) => entry.kind === 'number');
  const values = shot.figures.map((entry) => entry.value);
  assert.equal(new Set(values).size, values.length, 'each figure appears once');
  assert.ok(shot.sources.includes('tools.catalogEntries'), 'and each carries its source path');
});
